// henry 답글 말투 — 규칙책(data/threads-reply-style.md)과 실제 (댓글, 답글) 예시 고르기.
//
// 초안기(draft.ts)는 매 호출마다 규칙책 전문 + 지금 댓글과 닮은 henry 실제 답글 k개를 싣는다.
// 규칙책은 "어떤 상황에서 어떻게 쓰는지", 예시는 "이번 댓글과 비슷한 자리에서 실제로 쓴 글"을 맡는다.
// 고르는 순서: 같은 상황 → 댓글 글자 유사도 → 최근 → 거의 같은 답글 중복 제거.
// 순수 선택 로직(classifySituation·pickStyleExamples)은 I/O 가 없어 테스트가 바로 부른다.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { textSimilarity } from "@/lib/text-similarity";
import { asksForInfo, isQuestionShaped } from "./intent";
import type { ThreadsReply } from "./model";

/** 답글 상황 7종. 규칙책의 절 제목과 1:1 이다. */
export type ReplySituation =
  | "thanks" // 감사/칭찬 반응
  | "question_fact" // 질문 — 아는 것에 사실로 답함
  | "question_unknown" // 질문 — 모르거나 단정 못 함
  | "conversation" // 대화 이어가기
  | "joke" // 농담
  | "class_inquiry" // 강의 문의 (신청 링크 안내)
  | "share"; // 추천/정보 공유

export const SITUATION_LABEL: Record<ReplySituation, string> = {
  thanks: "감사/칭찬 반응",
  question_fact: "질문(사실 답)",
  question_unknown: "질문(모르는 것)",
  conversation: "대화 이어가기",
  joke: "농담",
  class_inquiry: "신청·구매 문의",
  share: "추천/정보 공유",
};

export interface VoiceExample {
  comment: string;
  commenter?: string;
  reply: string;
  /** ISO 시각 */
  at: string;
  root?: string;
  situation: ReplySituation;
}

// ── 상황 판정 (순수) ────────────────────────────────────────────────

const CLASS_WORDS = /(신청|수강|기수|클래스|강의|특강|원데이|등록|모집|선예약|북콘서트|북토크)/;
const THANKS_WORDS =
  /(감사|고마|축하|멋지|멋져|최고|대단|좋은 ?글|좋은 ?정보|잘 ?보|잘보|유익|리스펙|👍|🙏|👏|🥳|🎉|응원|화이팅|파이팅)/;
const LAUGH = /(ㅋㅋ|ㅎㅎㅎ|🤣|😂|😆|웃기|웃겨|개웃)/;
const UNKNOWN_REPLY =
  /(모르|잘 모|어렵|어려운|어려울|전문가가 아니|예정이|공유해드릴|알려드릴|함부로|확인해|알아볼|아마|것 같아요|것 같습니다|궁금하네|궁금해|글쎄|어떨까)/;
const WH_ASK = /(어떻게|어디서|어떤|언제|몇|무엇|뭐가|뭘)/;
const LINK = /https?:\/\/\S+/;
const KAKAO_LINK = /open\.kakao\.com/;

/** 정보를 묻는 댓글인가 — 댓글 성격 분류(intent.ts)와 같은 판정을 쓴다. */
export function isQuestionText(text: string): boolean {
  if (isQuestionShaped(text) && asksForInfo(text)) return true;
  // "~되려나요", "~할지" 처럼 물음표 없이 끝나는 의문사 질문
  return WH_ASK.test(text) && /(나요|려나|을지|ㄹ지|할지|는지)[\s.~ㅎㅋ?]*$/.test(text.trim());
}

/**
 * 댓글(+있으면 henry 답글)로 상황을 정한다. 답글이 없을 때(새 댓글)는 질문을
 * question_fact 로 두고, 모르는지 아는지는 초안기가 근거를 보고 가른다.
 */
export function classifySituation(comment: string, reply?: string): ReplySituation {
  const c = comment ?? "";
  const r = reply ?? "";
  const question = isQuestionText(c);
  if (KAKAO_LINK.test(r) || (question && CLASS_WORDS.test(c))) return "class_inquiry";
  if (question) {
    if (r && UNKNOWN_REPLY.test(r) && !LINK.test(r)) return "question_unknown";
    return "question_fact";
  }
  if (LINK.test(r) || (/(추천|공유|정보|링크)/.test(c.slice(0, 80)) && c.length > 60)) return "share";
  if (THANKS_WORDS.test(c)) return "thanks";
  if (LAUGH.test(c) || (r && LAUGH.test(r) && c.length < 40)) return "joke";
  return "conversation";
}

/** 새 댓글의 상황. 계약의 intent 를 먼저 믿고, 질문이면 강의 문의인지만 더 가른다. */
export function situationForReply(reply: Pick<ThreadsReply, "text" | "intent">): ReplySituation {
  if (reply.intent === "question") {
    return CLASS_WORDS.test(reply.text) ? "class_inquiry" : "question_fact";
  }
  if (reply.intent === "reaction") {
    const s = classifySituation(reply.text);
    return s === "joke" ? "joke" : "thanks";
  }
  if (reply.intent === "chat") return LAUGH.test(reply.text) ? "joke" : "conversation";
  return classifySituation(reply.text) === "joke" ? "joke" : "conversation";
}

/** 같은 계열로 치는 상황 — 질문은 사실/모름 둘 다 보여줘야 "모를 때 말투"도 배운다. */
function situationTier(target: ReplySituation, ex: ReplySituation): number {
  if (target === ex) return 0;
  const q = (s: ReplySituation) => s === "question_fact" || s === "question_unknown";
  if (q(target) && q(ex)) return 0;
  const light = (s: ReplySituation) => s === "thanks" || s === "joke" || s === "conversation";
  if (light(target) && light(ex)) return 1;
  if (target === "class_inquiry" && q(ex)) return 1;
  return 2;
}

// ── 예시 고르기 (순수) ──────────────────────────────────────────────

export interface PickOptions {
  /** 기준 시각(최근 가중치). 기본 = 풀에서 가장 늦은 시각 */
  now?: number;
  /** 예시에서 뺄 것 (홀드아웃·자기 자신) */
  exclude?: (ex: VoiceExample) => boolean;
  /** 이 이상 닮은 답글은 중복으로 본다 */
  dupThreshold?: number;
}

const DAY_MS = 86_400_000;

export function pickStyleExamples(
  pool: readonly VoiceExample[],
  target: { text: string; situation: ReplySituation },
  k: number,
  opts: PickOptions = {}
): VoiceExample[] {
  if (k <= 0) return [];
  const dup = opts.dupThreshold ?? 0.6;
  const times = pool.map((e) => Date.parse(e.at)).filter(Number.isFinite);
  const now = opts.now ?? (times.length ? Math.max(...times) : Date.now());
  const scored = pool
    .filter((e) => e.reply.trim() && !(opts.exclude?.(e) ?? false))
    .map((e) => {
      const ageDays = Math.max(0, (now - (Date.parse(e.at) || 0)) / DAY_MS);
      const recency = 0.15 * Math.exp(-ageDays / 120);
      return {
        e,
        tier: situationTier(target.situation, e.situation),
        score: textSimilarity(target.text, e.comment) + recency,
      };
    })
    .sort((a, b) => a.tier - b.tier || b.score - a.score);

  const out: VoiceExample[] = [];
  for (const { e } of scored) {
    if (out.length >= k) break;
    const near = out.some(
      (o) => o.reply.trim() === e.reply.trim() || textSimilarity(o.reply, e.reply) >= dup
    );
    if (!near) out.push(e);
  }
  return out;
}

// ── 파일 (I/O) ──────────────────────────────────────────────────────

export function threadsRepliesDataDir(): string {
  return process.env.THREADS_REPLIES_DIR ?? path.join(process.cwd(), "data", "threads-replies");
}

export function styleBookPath(): string {
  return (
    process.env.THREADS_REPLY_STYLE_PATH ??
    path.join(process.cwd(), "data", "threads-reply-style.md")
  );
}

export async function loadStyleBook(): Promise<string> {
  try {
    return await readFile(styleBookPath(), "utf8");
  } catch {
    return "";
  }
}

interface RawPair {
  comment?: string | null;
  commenter?: string;
  reply?: string;
  at?: string;
  root?: string;
}

let poolCache: { key: string; pool: VoiceExample[] } | null = null;

/** voice-pairs.json → 상황이 붙은 예시 풀. 같은 경로면 메모리 캐시. */
export async function loadVoiceExamples(): Promise<VoiceExample[]> {
  const file = path.join(threadsRepliesDataDir(), "voice-pairs.json");
  if (poolCache?.key === file) return poolCache.pool;
  let raw: RawPair[] = [];
  try {
    raw = JSON.parse(await readFile(file, "utf8")) as RawPair[];
  } catch {
    raw = [];
  }
  const pool = toVoiceExamples(raw);
  poolCache = { key: file, pool };
  return pool;
}

export function toVoiceExamples(raw: readonly RawPair[]): VoiceExample[] {
  return raw
    .filter((p) => (p.comment ?? "").trim() && (p.reply ?? "").trim())
    .map((p) => ({
      comment: String(p.comment).trim(),
      commenter: p.commenter,
      reply: String(p.reply).trim(),
      at: p.at ?? "",
      root: p.root,
      situation: classifySituation(String(p.comment), String(p.reply)),
    }));
}

export async function selectStyleExamples(
  reply: Pick<ThreadsReply, "text" | "intent">,
  k: number,
  opts: PickOptions = {}
): Promise<VoiceExample[]> {
  const pool = await loadVoiceExamples();
  return pickStyleExamples(pool, { text: reply.text, situation: situationForReply(reply) }, k, opts);
}
