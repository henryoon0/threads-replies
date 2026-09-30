// 말투 만들기 · 제외 심사 먼저 (시안 픽 4 "vb-exclude", 2026-09-29).
//
// 주인이 예전에 단 답 가운데 초안기가 배우면 안 되는 것을 코드로 먼저 걸러낸다.
//   박약사(관문 strict): 처방약 선택·용량·전환 · 제품·브랜드·구매처 · 약 이름을 표시만 하고 기본은 그대로 배운다
//     (2026-09-29 운영자: 제품 추천도 박약사 답의 한 유형. 2026-09-30 henry: 용량·증량도 상황 판단으로 답한다 —
//      박약사의 실제 판단이 그 답들에 있으니 잠그지 않는다. 주인이 골라서 뺄 수는 있다)
//   AICC(관문 light):     날짜·마감·가격처럼 시간이 지나면 틀리는 사실 (확인만, 기본은 그대로 배움)
// 주인이 고른 결정은 팩 private/voice-exclusions.json 에 남는다. 예시 고르기(voice.ts)와
// 카테고리 만들기(scripts/personas/build-categories.ts)가 제외된 답을 건너뛴다.
//
// 위쪽은 순수 판정(테스트가 바로 부른다), 아래쪽 "파일" 절만 I/O 다.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PersonaConfig, PersonaId } from "./model";
import { packPrivateDir } from "./registry";

export type ExclusionKind = "처방약 용량·선택" | "처방약 언급" | "제품·구매처" | "약 이름" | "날짜·가격";
export type ExclusionDecision = "exclude" | "keep" | "mask";

export interface ExclusionReason {
  kind: ExclusionKind;
  /** 답글 안에 실제로 있는 문자열 (화면에서 색칠할 자리) */
  phrase: string;
}

/** 말투 재료 한 쌍 (댓글 + 주인 답). id 는 내용으로 만든 안정 id. */
export interface OwnerPair {
  id: string;
  comment: string;
  reply: string;
  at?: string;
  commenter?: string;
  root?: string;
}

export interface PairReview {
  id: string;
  comment: string;
  reply: string;
  reasons: ExclusionReason[];
  /** 주인 결정이 없을 때 쓰는 값 */
  defaultDecision: ExclusionDecision;
  /** true 면 제외만 가능 (박약사 처방약 용량·선택) */
  locked: boolean;
  /** 지금 적용되는 결정 */
  decision: ExclusionDecision;
  decidedBy: "default" | "owner";
}

// ── 판정 규칙 (순수) ────────────────────────────────────────────────

const GLP1_DRUGS = /(마운자로|위고비|삭센다|싹센다|젭바운드|오젬픽|리벨서스|터제파타이드|세마글루타이드|리라글루타이드)/;

/**
 * 처방약과 같은 문장에 있으면 "선택·용량·전환" 답으로 본다.
 * "올려/내려" 만으로는 잡지 않는다 ("혈압이 내려가" 같은 설명까지 잠기므로) — 용량·숫자·권유 말과 함께일 때만.
 */
const DOSE_CHOICE =
  /(\d+(?:\.\d+)?\s*(?:mg|미리|밀리|㎎)|\d+(?:\.\d+)?\s*(?:으로|로)\s*(?:올|내리|내려|바꾸|바꿔|시작|가)|강추|비추|추천|바꿔|바꾸|바꿀|갈아타|전환|넘어가|용량|증량|처방\s*받|맞아\s*보|(?:해|봐)도\s*(?:상관|괜찮|돼|되)|보다\s*(?:훨씬\s*)?(?:효과|좋|낫)|펜)/i;

const PURCHASE_PLACES =
  "아이허브|iherb|쿠팡|코스트코|올리브영|스마트스토어|아마존|amazon|직구|창고형\\s*약국|나만의닥터|지오영";
const BRANDS = [
  "비맥스", "쏜(?=[\\s(꺼거껄]|$)", "thorne", "종근당", "뉴트리원", "고려은단", "안국건강", "나우\\s*푸[드즈]", "now foods",
  "닥터스\\s*베스트", "doctor'?s best", "라이프\\s*익스텐션", "life extension", "바이탈\\s*뉴트리언츠", "프로헬스", "prohealth",
  "스마티\\s*팬츠", "바이크롬", "바이오가이아", "biogaia", "비오프로베베", "테라로직스", "theralogix", "오바시톨", "오바바이트",
  "ovavite", "ovasitol", "홀썸스토리", "웰틴", "wellteen", "리츄얼", "ritual", "엘레비트", "노르딕", "nordic", "리브온", "livon",
  "armra", "\\bpure\\b", "엘레나", "마이칼디", "볼그레", "헤모큐", "훼럼포라", "스파톤", "글루콤", "임팩타민", "임패타민", "삐콤",
  "마그비", "벤포벨", "오드\\s*m-?01", "키포텐", "티라노", "마이타민", "알티쥐", "글리프", "오마비디씨", "로이코비에스", "큐업",
  "여명\\s*808", "센트룸", "솔가", "solgar", "gnc", "락토핏", "세노비스", "오쏘몰", "재로우", "jarrow",
];
const PRODUCT = new RegExp(`(${PURCHASE_PLACES}|${BRANDS.join("|")})`, "i");
/** "제품은 ○○ 추천", "○○꺼 제품", "어디 회사껄로" 같은 제품 권유 문형 */
const PRODUCT_SHAPE = /(제품은\s+[^.!?\n]{1,30}?추천|[가-힣A-Za-z]+(?:꺼|껄)\s*(?:제품|로\s*먹|먹어)|브랜드는\s+\S+)/;
/** 영문 제품명 (대문자로 시작하는 낱말 둘 이상: "Thorne Iron Bisglycinate") */
const LATIN_PRODUCT = /[A-Z][a-z]+[A-Za-z]*(?:[ -][A-Z0-9][A-Za-z0-9-]*)+/;

/** 일반의약품·전문의약품 이름 (영양제 성분 이름은 넣지 않는다) */
const DRUG_NAMES =
  /(판시딜|기넥신|락툴로오스|마그밀|발라시클로버|미녹시딜|판피린|겔포스|우루사|박카스|쌍화탕|노자임|오마코|루나팜|콘서타|신지로이드|씬지로이드|항우울제|메트포르민|프리페민)/;

const STALE_DATE =
  /(\d{1,2}\s*월\s*\d{1,2}\s*일|\d{1,2}\/\d{1,2}(?!\d)|\d{1,2}일\s*(?:까지|부터|에|날)|(?:이번|다음)\s*주|내일|모레|마감|선착순|얼리버드|\d+\s*기(?=[는가도\s!,.]|$)|\d{4}년)/;
/** 숫자 + 원·만 원·달러 ("3원칙"·"2원리" 같은 말은 빼고) */
const STALE_PRICE = /(\d[\d,]*\s*(?:원|만\s*원|천\s*원|달러|불)(?!칙|리|래|형|인)|\$\s*\d|할인|쿠폰|무료)/;

interface Sentence {
  text: string;
  question: boolean;
}

/** 문장 나누기: 문장부호 뒤 공백·줄바꿈에서 자른다 ("2.5mg" 의 점은 자르지 않는다). */
export function splitSentences(text: string): Sentence[] {
  return text
    .split(/(?<=[.!?])\s+|\n+|\s{2,}/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => ({ text: t, question: /\?[!?.~ㅠㅜ]*$/.test(t) }));
}

function firstMatch(re: RegExp, text: string): string | null {
  const m = re.exec(text);
  return m ? m[0].trim() : null;
}

/** 처방약 선택·용량·전환: 약 이름이 있는 문장(답에 약 이름이 없으면 댓글의 약 이름)에서 선택·용량 표현. 되묻는 문장은 뺀다. */
function rxDoseReason(comment: string, reply: string): ExclusionReason | null {
  const replyNamesDrug = GLP1_DRUGS.test(reply);
  if (!replyNamesDrug && !GLP1_DRUGS.test(comment)) return null;
  for (const s of splitSentences(reply)) {
    if (s.question) continue;
    if (replyNamesDrug && !GLP1_DRUGS.test(s.text)) continue;
    const phrase = firstMatch(DOSE_CHOICE, s.text);
    if (phrase) return { kind: "처방약 용량·선택", phrase };
  }
  return null;
}

function productReasons(reply: string): ExclusionReason[] {
  const out: ExclusionReason[] = [];
  const seen = new Set<string>();
  for (const re of [PRODUCT, PRODUCT_SHAPE, LATIN_PRODUCT]) {
    const phrase = firstMatch(re, reply);
    if (phrase && ![...seen].some((p) => p.includes(phrase) || phrase.includes(p))) {
      seen.add(phrase);
      out.push({ kind: "제품·구매처", phrase });
    }
  }
  return out;
}

function pharmacyReasons(comment: string, reply: string): ExclusionReason[] {
  const reasons: ExclusionReason[] = [];
  const rx = rxDoseReason(comment, reply);
  const mention = firstMatch(GLP1_DRUGS, reply);
  if (rx) reasons.push(rx);
  else if (mention) reasons.push({ kind: "처방약 언급", phrase: mention });
  reasons.push(...productReasons(reply));
  const drug = firstMatch(DRUG_NAMES, reply);
  if (drug) reasons.push({ kind: "약 이름", phrase: drug });
  return reasons;
}

function staleReasons(reply: string): ExclusionReason[] {
  const out: ExclusionReason[] = [];
  const date = firstMatch(STALE_DATE, reply);
  const price = firstMatch(STALE_PRICE, reply);
  if (date) out.push({ kind: "날짜·가격", phrase: date });
  if (price) out.push({ kind: "날짜·가격", phrase: price });
  return out;
}

export type ExclusionRuleSet = "pharmacy" | "stale-facts";

/** 관문이 strict 인 팩(박약사)은 약사 규칙, 나머지는 날짜·가격 확인 규칙. */
export function ruleSetFor(persona: Pick<PersonaConfig, "gate">): ExclusionRuleSet {
  return persona.gate === "strict" ? "pharmacy" : "stale-facts";
}

export function flagReply(rules: ExclusionRuleSet, comment: string, reply: string): ExclusionReason[] {
  return rules === "pharmacy" ? pharmacyReasons(comment, reply) : staleReasons(reply);
}

/** 걸린 표현은 표시만 하고 기본은 그대로 배운다 (처방약 용량·선택 포함, 2026-09-30). */
export function defaultDecisionFor(reasons: readonly ExclusionReason[]): ExclusionDecision {
  void reasons;
  return "keep";
}

/** 잠금(제외만 가능)은 2026-09-30 에 풀었다. 잠글 종류가 다시 생기면 여기서 고른다. */
export function isLocked(reasons: readonly ExclusionReason[]): boolean {
  void reasons;
  return false;
}

export interface StoredDecision {
  decision: ExclusionDecision;
  at: string;
}

export function reviewPair(
  pair: Pick<OwnerPair, "id" | "comment" | "reply">,
  rules: ExclusionRuleSet,
  stored?: StoredDecision
): PairReview {
  const reasons = flagReply(rules, pair.comment, pair.reply);
  const locked = isLocked(reasons);
  const defaultDecision = defaultDecisionFor(reasons);
  const owner = reasons.length > 0 && stored && !locked ? stored.decision : undefined;
  return {
    id: pair.id,
    comment: pair.comment,
    reply: pair.reply,
    reasons,
    defaultDecision,
    locked,
    decision: owner ?? defaultDecision,
    decidedBy: owner ? "owner" : "default",
  };
}

/** 주인 결정을 받아도 되는지. 잠긴 답은 exclude 만. 걸린 게 없는 답은 결정할 게 없다. */
export function validateDecision(review: PairReview, decision: ExclusionDecision): string | null {
  if (review.reasons.length === 0) return "제외 심사 대상이 아닌 답이에요";
  if (review.locked && decision !== "exclude") return "처방약 선택·용량 답은 제외만 할 수 있어요";
  return null;
}

/** mask: 걸린 표현을 ○○ 로 가린다 (말투는 배우고 사실은 안 배우게). */
export function maskReply(reply: string, reasons: readonly ExclusionReason[]): string {
  let out = reply;
  for (const r of [...reasons].sort((a, b) => b.phrase.length - a.phrase.length)) {
    if (r.phrase) out = out.split(r.phrase).join("○○");
  }
  return out;
}

/** 배울 답만 남긴다: exclude 는 빼고 mask 는 가린다. */
export function learnablePairs<T extends OwnerPair>(pairs: readonly T[], reviews: ReadonlyMap<string, PairReview>): T[] {
  const out: T[] = [];
  for (const p of pairs) {
    const r = reviews.get(p.id);
    if (!r || r.decision === "keep") out.push(p);
    else if (r.decision === "mask") out.push({ ...p, reply: maskReply(p.reply, r.reasons) });
  }
  return out;
}

export interface ExclusionStats {
  total: number;
  flagged: number;
  excluded: number;
  kept: number;
  masked: number;
}

export function exclusionStats(reviews: readonly PairReview[]): ExclusionStats {
  const flagged = reviews.filter((r) => r.reasons.length > 0);
  const count = (d: ExclusionDecision) => flagged.filter((r) => r.decision === d).length;
  return { total: reviews.length, flagged: flagged.length, excluded: count("exclude"), kept: count("keep"), masked: count("mask") };
}

/** 내용으로 만든 쌍 id — 파일 순서가 바뀌어도 결정·카테고리 예시가 같은 쌍을 가리킨다. */
export function pairId(comment: string, reply: string): string {
  return `v${createHash("sha1").update(`${comment.trim()}\u0000${reply.trim()}`).digest("hex").slice(0, 10)}`;
}

// ── 파일 (I/O) ──────────────────────────────────────────────────────

export interface ExclusionFile {
  version: 1;
  updatedAt: string;
  /** 주인이 고른 결정 (source owner) + 심사 당시 기본값 기록 (source default) */
  decisions: Record<string, StoredDecision & { source: "owner" | "default"; reasons?: ExclusionReason[] }>;
}

export function exclusionsPath(id: PersonaId): string {
  return path.join(packPrivateDir(id), "voice-exclusions.json");
}

export async function readExclusionFile(id: PersonaId): Promise<ExclusionFile> {
  try {
    const raw = JSON.parse(await readFile(exclusionsPath(id), "utf8")) as Partial<ExclusionFile>;
    return { version: 1, updatedAt: raw.updatedAt ?? "", decisions: raw.decisions ?? {} };
  } catch {
    return { version: 1, updatedAt: "", decisions: {} };
  }
}

async function writeExclusionFile(id: PersonaId, file: ExclusionFile): Promise<void> {
  const p = exclusionsPath(id);
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, `${JSON.stringify(file, null, 2)}\n`, "utf8");
}

/** 주인 결정만 뽑는다 (기본값 기록은 규칙이 바뀌면 다시 계산되므로 결정으로 치지 않는다). */
export function ownerDecisions(file: ExclusionFile): Map<string, StoredDecision> {
  const out = new Map<string, StoredDecision>();
  for (const [id, d] of Object.entries(file.decisions)) if (d.source === "owner") out.set(id, { decision: d.decision, at: d.at });
  return out;
}

export async function reviewPairs(persona: Pick<PersonaConfig, "id" | "gate">, pairs: readonly OwnerPair[]): Promise<PairReview[]> {
  const decisions = ownerDecisions(await readExclusionFile(persona.id));
  const rules = ruleSetFor(persona);
  return pairs.map((p) => reviewPair(p, rules, decisions.get(p.id)));
}

/** 심사 결과를 파일에 남긴다: 주인 결정은 그대로 두고, 걸린 답의 기본값을 기록한다. */
export async function seedExclusionFile(id: PersonaId, reviews: readonly PairReview[]): Promise<ExclusionFile> {
  const file = await readExclusionFile(id);
  const decisions: ExclusionFile["decisions"] = {};
  const now = new Date().toISOString();
  for (const r of reviews) {
    if (r.reasons.length === 0) continue;
    const prev = file.decisions[r.id];
    decisions[r.id] =
      prev?.source === "owner" && !r.locked
        ? { ...prev, reasons: r.reasons }
        : { decision: r.defaultDecision, at: prev?.at ?? now, source: "default", reasons: r.reasons };
  }
  const next: ExclusionFile = { version: 1, updatedAt: now, decisions };
  await writeExclusionFile(id, next);
  return next;
}

export async function saveOwnerDecision(id: PersonaId, review: PairReview, decision: ExclusionDecision): Promise<void> {
  const file = await readExclusionFile(id);
  file.decisions[review.id] = { decision, at: new Date().toISOString(), source: "owner", reasons: review.reasons };
  file.updatedAt = new Date().toISOString();
  await writeExclusionFile(id, file);
}
