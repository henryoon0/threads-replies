// 답글 말투 재료 — 지금 페르소나(주인)의 규칙책과 실제 (댓글, 답글) 예시 고르기.
//
// 규칙책은 팩의 AGENTS.md 다. 초안기는 팩 폴더에서 Claude 를 돌려 규칙책을 세션이 직접 읽게 하고,
// 팩이 없을 때만 규칙책 전문을 프롬프트에 싣는다(loadStyleBook).
// 예시 = 주인이 실제로 단 답: AICC 는 voice-pairs.json(260쌍), 박약사는 qa-pairs {q,a}(122쌍)를 같은 모양으로.
// 팩 private/voice-pairs.json 이 있으면 그쪽이 먼저다. 제외 심사(personas/voice-exclusions.ts)에서
// 제외된 답은 빼고, 가림(mask)은 걸린 표현을 ○○ 로 가려 넣는다.
// 고르는 순서: 같은 상황 → 댓글 글자 유사도 → 최근 → 거의 같은 답글 중복 제거.
// 순수 선택 로직(classifySituation·pickStyleExamples)은 I/O 가 없어 테스트가 바로 부른다.

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { textSimilarity } from "@/lib/content-ideas-style-eval";
import { currentPersona } from "@/lib/personas/context";
import type { PersonaConfig } from "@/lib/personas/model";
import { packPrivateDir, packRulebookPath, repoPath } from "@/lib/personas/registry";
import { learnablePairs, pairId, reviewPairs, type OwnerPair } from "@/lib/personas/voice-exclusions";
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
  class_inquiry: "강의 문의",
  share: "추천/정보 공유",
};

export interface VoiceExample {
  /** 쌍 id (personas/voice-exclusions pairId). 카테고리 exampleIds 가 이 값을 가리킨다. */
  id?: string;
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
  const asked = inquiryOrQuestion(c, r);
  if (asked) return asked;
  if (isShare(c, r)) return "share";
  if (THANKS_WORDS.test(c)) return "thanks";
  return isJoke(c, r) ? "joke" : "conversation";
}

/** 강의 문의(카톡 링크 답 포함) · 질문(모름/사실). 질문이 아니면 null. */
function inquiryOrQuestion(c: string, r: string): ReplySituation | null {
  const question = isQuestionText(c);
  if (KAKAO_LINK.test(r) || (question && CLASS_WORDS.test(c))) return "class_inquiry";
  if (!question) return null;
  return r && UNKNOWN_REPLY.test(r) && !LINK.test(r) ? "question_unknown" : "question_fact";
}

function isShare(c: string, r: string): boolean {
  return LINK.test(r) || (/(추천|공유|정보|링크)/.test(c.slice(0, 80)) && c.length > 60);
}

function isJoke(c: string, r: string): boolean {
  return LAUGH.test(c) || (!!r && LAUGH.test(r) && c.length < 40);
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

/** 예전 AICC 경로. THREADS_REPLIES_DIR 가 있으면 그 폴더의 voice-pairs.json 을 쓴다 (테스트·평가 스크립트). */
export function threadsRepliesDataDir(): string {
  return process.env.THREADS_REPLIES_DIR ?? path.join(process.cwd(), "data", "threads-replies");
}

/** 팩이 없을 때 쓰는 예전 규칙책 경로 */
export function styleBookPath(): string {
  return (
    process.env.THREADS_REPLY_STYLE_PATH ??
    path.join(process.cwd(), "data", "threads-reply-style.md")
  );
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** 지금 페르소나의 규칙책 전문 (팩 AGENTS.md → 예전 경로). 팩 폴더에서 돌지 못할 때만 프롬프트에 싣는다. */
export async function loadStyleBook(persona: PersonaConfig = currentPersona()): Promise<string> {
  for (const file of [packRulebookPath(persona.id), styleBookPath()]) {
    try {
      return await readFile(file, "utf8");
    } catch {
      // 다음 후보
    }
  }
  return "";
}

/** 말투 재료 파일: env 덮어쓰기 → 팩 private/voice-pairs.json → persona.voicePairs → 예전 AICC 경로. */
export async function ownerPairsPath(persona: PersonaConfig = currentPersona()): Promise<string> {
  if (process.env.THREADS_REPLIES_DIR) return path.join(process.env.THREADS_REPLIES_DIR, "voice-pairs.json");
  const override = path.join(packPrivateDir(persona.id), "voice-pairs.json");
  if (await exists(override)) return override;
  if (persona.voicePairs) return repoPath(persona.voicePairs);
  return path.join(threadsRepliesDataDir(), "voice-pairs.json");
}

interface RawPair {
  id?: string;
  comment?: string | null;
  commenter?: string;
  reply?: string;
  at?: string;
  root?: string;
}

function text(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function pairList(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  const pairs = (raw as { pairs?: unknown } | null)?.pairs;
  return Array.isArray(pairs) ? pairs : [];
}

function toOwnerPair(item: unknown): OwnerPair | null {
  const o = (item ?? {}) as Record<string, unknown>;
  const comment = text(o.comment ?? o.q);
  const reply = text(o.reply ?? o.a);
  if (!comment || !reply) return null;
  return { id: pairId(comment, reply), comment, reply, at: text(o.at), commenter: text(o.commenter) || undefined, root: text(o.root) || undefined };
}

/** 두 모양을 받는다: [{comment, reply, …}] (AICC) · {pairs:[{q, a}]} (박약사 수집본). */
export function parseOwnerPairs(raw: unknown): OwnerPair[] {
  return pairList(raw)
    .map(toOwnerPair)
    .filter((p): p is OwnerPair => p !== null);
}

// 페르소나마다 파일이 달라 파일별로 캐시한다. hot reload 에도 살아남게 globalThis.
type PairCache = Map<string, { mtimeMs: number; pairs: OwnerPair[] }>;
function pairCache(): PairCache {
  const g = globalThis as typeof globalThis & { __ownerPairsCache?: PairCache };
  g.__ownerPairsCache ??= new Map();
  return g.__ownerPairsCache;
}

/** 주인의 실제 (댓글, 답) 전부. 제외 심사 전. 같은 파일·같은 수정 시각이면 메모리 캐시. */
export async function loadOwnerPairs(persona: PersonaConfig = currentPersona()): Promise<OwnerPair[]> {
  const file = await ownerPairsPath(persona);
  try {
    const s = await stat(file);
    const hit = pairCache().get(file);
    if (hit && hit.mtimeMs === s.mtimeMs) return hit.pairs;
    const pairs = parseOwnerPairs(JSON.parse(await readFile(file, "utf8")));
    pairCache().set(file, { mtimeMs: s.mtimeMs, pairs });
    return pairs;
  } catch {
    return [];
  }
}

/** 배울 수 있는 주인 답만 (제외 빼고 가림 적용). 카테고리 만들기와 예시 고르기가 같은 함수를 쓴다. */
export async function loadLearnablePairs(persona: PersonaConfig = currentPersona()): Promise<OwnerPair[]> {
  const pairs = await loadOwnerPairs(persona);
  const reviews = await reviewPairs(persona, pairs);
  return learnablePairs(pairs, new Map(reviews.map((r) => [r.id, r])));
}

/** 지금 페르소나의 예시 풀 (상황이 붙은 모양). */
export async function loadVoiceExamples(persona: PersonaConfig = currentPersona()): Promise<VoiceExample[]> {
  return toVoiceExamples(await loadLearnablePairs(persona));
}

export function toVoiceExamples(raw: readonly RawPair[]): VoiceExample[] {
  return raw
    .filter((p) => (p.comment ?? "").trim() && (p.reply ?? "").trim())
    .map((p) => ({
      id: p.id ?? pairId(String(p.comment), String(p.reply)),
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
