// 답 버전 (2026-09-29 henry: "토글 느낌이 아니라, 버튼 하나에 여러 조각이 섞인 버전들이 여러 개").
//
// 버전 = 주인이 실제 답에서 조각(공감·드립·원리·성분·제품)을 섞는 방식 하나.
//   1) 조각 태깅이 있는 계정(박약사 voice-labels.json): 실제 답마다 든 조각 조합을 세고(함께 나온 횟수),
//      가장 많이 쓴 조합 4~6개를 버전으로 삼는다. 한 번도 버전에 안 든 조각은 그 조각이 가장 도드라진 조합으로 채운다.
//   2) 태깅이 없는 계정(AICC): 팩 categories.json 의 답 유형을 비율 순으로 버전으로 삼고, 유형 지시문을 버전 지시로 싣는다.
// 제품이 든 버전은 늘 약국·온라인·직구 3분할로 쓴다 (운영자 명세: 말이 안 되는 경로만 뺀다).
// 댓글마다 비슷한 댓글에 주인이 실제로 쓴 조합과 얼마나 겹치는지로 버전 순서를 정하고 위 둘을 추천한다.
// 순수 — I/O 없음.

import { textSimilarity } from "@/lib/content-ideas-style-eval";
import { COMPOSE_KINDS, PRODUCT_CHANNELS, type ComposeKind, type LabeledComment, type PairLabel } from "./compose-kinds";

export const MAX_PRESETS = 6;
const NEIGHBORS = 7;
const RECOMMEND = 2;

export interface ComposePreset {
  /** 미리 쓴 벌의 열쇠이기도 하다 (조합 "principle+product" 또는 유형 id) */
  id: string;
  /** 버튼 이름 (쉬운 한국어) */
  name: string;
  /** 든 조각 한 줄 "원리+성분+제품 3분할" */
  parts: string;
  kinds: ComposeKind[];
  /** 주인의 실제 답 가운데 이 조합(유형) 수 */
  count: number;
  /** 버전 지시 (유형 지시문). 조각 조합 버전엔 없다. */
  guide?: string;
}

export interface RankedPreset extends ComposePreset {
  score: number;
  recommended: boolean;
}

// 버튼 이름은 "어떤 답이 나오는지"로 짓는다 (2026-10-02 henry "토글 네이밍이 더 직관적이게").
// 안쪽 열쇠(principle·joke…)와 프롬프트 말은 그대로다 — 이름만 바꿔서 써 둔 벌은 그대로 쓴다.
export const PART_NAME: Record<ComposeKind, string> = {
  empathy: "공감",
  joke: "농담",
  principle: "이유",
  ingredient: "성분",
  product: "제품 추천",
};

/** 조합 열쇠: 정해진 순서로 이은 조각 이름. 예) "principle+ingredient+product" */
export function mixKey(kinds: readonly ComposeKind[]): string {
  return COMPOSE_KINDS.filter((k) => kinds.includes(k)).join("+");
}

/** 버전 → 초안기 토글 (제품은 늘 세 경로 모두) */
export function presetSet(p: Pick<ComposePreset, "kinds">): { kinds: ComposeKind[]; channels: (typeof PRODUCT_CHANNELS)[number][] } {
  const kinds = COMPOSE_KINDS.filter((k) => p.kinds.includes(k));
  return { kinds, channels: kinds.includes("product") ? [...PRODUCT_CHANNELS] : [] };
}

const SINGLE_NAME: Record<ComposeKind, string> = {
  empathy: "공감 한마디",
  joke: "짧게 농담으로",
  principle: "이유 설명",
  ingredient: "성분 설명",
  product: "제품만 추천",
};

const MIX_NAME: Record<string, string> = {
  "ingredient+product": "성분 + 제품 추천",
  "principle+product": "이유 + 제품 추천",
  "principle+ingredient": "이유 + 성분",
  "principle+ingredient+product": "이유부터 제품까지",
};

/** 조합 → 버튼 이름 */
export function presetName(kinds: readonly ComposeKind[]): string {
  const key = mixKey(kinds);
  const list = key.split("+") as ComposeKind[];
  if (list.length === 1) return SINGLE_NAME[list[0]];
  if (MIX_NAME[key]) return MIX_NAME[key];
  if (list.includes("empathy") && list.length >= 3) return list.includes("product") ? "자세히 길게 + 제품" : "자세히 길게";
  if (list.includes("joke") && list.length === 2) return `농담 + ${PART_NAME[list.find((k) => k !== "joke") as ComposeKind]}`;
  return list.map((k) => PART_NAME[k]).join(" + ");
}

export function partsLine(kinds: readonly ComposeKind[]): string {
  return COMPOSE_KINDS.filter((k) => kinds.includes(k))
    .map((k) => PART_NAME[k])
    .join("+");
}

// ── 조각 조합 세기 (태깅 있는 계정) ─────────────────────────────────

export interface MixCount {
  kinds: ComposeKind[];
  count: number;
}

/** 실제 답마다 든 조각 조합을 센다. 많은 순, 같으면 조각 수 적은 순. */
export function countMixes(labels: readonly Pick<PairLabel, "kinds">[]): MixCount[] {
  const counts = new Map<string, number>();
  for (const l of labels) {
    const key = mixKey(l.kinds);
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ kinds: key.split("+") as ComposeKind[], count }))
    .sort((a, b) => b.count - a.count || a.kinds.length - b.kinds.length || mixKey(a.kinds).localeCompare(mixKey(b.kinds)));
}

/** 그 조각이 가장 도드라진 조합: (횟수 ÷ 조각 수)가 큰 것, 같으면 횟수 많은 것 */
function bestMixFor(kind: ComposeKind, mixes: readonly MixCount[]): MixCount | undefined {
  return mixes
    .filter((m) => m.kinds.includes(kind))
    .sort((a, b) => b.count / b.kinds.length - a.count / a.kinds.length || b.count - a.count)[0];
}

function toPreset(m: MixCount): ComposePreset {
  return { id: mixKey(m.kinds), name: presetName(m.kinds), parts: partsLine(m.kinds), kinds: m.kinds, count: m.count };
}

/** 이름이 겹치면 뒤의 것은 든 조각으로 부른다 */
function uniqueNames(presets: ComposePreset[]): ComposePreset[] {
  const seen = new Set<string>();
  return presets.map((p) => {
    const name = seen.has(p.name) ? p.parts : p.name;
    seen.add(name);
    return { ...p, name };
  });
}

/**
 * 조각 조합 → 버전 max 개. 많이 쓴 조합부터 고르되, 실제 답에 나온 조각인데 어떤 버전에도 안 든 조각이 있으면
 * 뒤쪽 자리를 비워 그 조각이 가장 도드라진 조합을 넣는다 (예: 드립은 늘 다른 조각과 섞여 나와 상위에 안 든다).
 */
export function derivePresets(labels: readonly Pick<PairLabel, "kinds">[], max = MAX_PRESETS): ComposePreset[] {
  const mixes = countMixes(labels);
  const top = mixes.slice(0, max);
  const seen = new Set(mixes.flatMap((m) => m.kinds));
  const missing = COMPOSE_KINDS.filter((k) => seen.has(k) && !top.some((m) => m.kinds.includes(k)));
  const reserve = [...new Set(missing.map((k) => bestMixFor(k, mixes)).filter((m): m is MixCount => !!m))];
  const keep = mixes.filter((m) => !reserve.includes(m)).slice(0, Math.max(0, max - reserve.length));
  return uniqueNames([...keep, ...reserve].sort((a, b) => b.count - a.count).map(toPreset));
}

// ── 유형 → 버전 (태깅 없는 계정) ────────────────────────────────────

/** AICC 답 유형이 대략 어떤 조각인가 (초안기 조각 이름을 빌린다. 제품 3분할은 약사 계정 전용이라 쓰지 않는다) */
const CATEGORY_KINDS: Record<string, ComposeKind[]> = {
  "joke-back": ["joke"],
  "short-reaction": ["joke"],
  "excited-share": ["empathy"],
  "warm-thanks-back": ["empathy"],
  "meet-promise": ["empathy"],
  "ask-back": ["empathy"],
  "honest-unsure": ["empathy"],
  "my-experience": ["empathy", "principle"],
  "my-take": ["principle"],
  "direct-answer": ["principle"],
  "how-to-explain": ["principle", "ingredient"],
  "link-guide": ["principle"],
};

export interface CategoryLike {
  id: string;
  name: string;
  when: string;
  share: number;
  prompt: string;
}

/** 답 유형 → 버전: 비율 높은 순 max 개. 유형 지시문이 버전 지시가 된다. */
export function presetsFromCategories(categories: readonly CategoryLike[], max = MAX_PRESETS): ComposePreset[] {
  return [...categories]
    .sort((a, b) => b.share - a.share)
    .slice(0, max)
    .map((c) => {
      const kinds = CATEGORY_KINDS[c.id] ?? ["principle"];
      return { id: c.id, name: c.name, parts: c.when, kinds, count: Math.round(c.share), guide: c.prompt };
    });
}

// ── 이 댓글에 맞는 버전 순서 ────────────────────────────────────────

function jaccard(a: readonly string[], b: readonly string[]): number {
  const union = new Set([...a, ...b]).size;
  return union ? a.filter((x) => b.includes(x)).length / union : 0;
}

function withRank(presets: readonly ComposePreset[], scores: readonly number[]): RankedPreset[] {
  const ranked = presets.map((p, i) => ({ ...p, score: Math.round(scores[i] * 1000) / 1000, recommended: false }));
  ranked.sort((a, b) => b.score - a.score);
  return ranked.map((p, i) => ({ ...p, recommended: i < RECOMMEND && p.score > 0 }));
}

/**
 * 비슷한 댓글(글자 유사도 상위 7개)에 주인이 쓴 조합과 버전이 얼마나 겹치나(유사도 가중 자카드).
 * 흔한 버전에 작은 가산점(횟수 비율 × 0.1)을 준다. 위 둘을 추천.
 */
export function rankByNeighbors(comment: string, presets: readonly ComposePreset[], pool: readonly LabeledComment[]): RankedPreset[] {
  const near = pool
    .map((p) => ({ kinds: p.label.kinds, w: Math.max(textSimilarity(comment, p.comment), 0.01) }))
    .sort((a, b) => b.w - a.w)
    .slice(0, NEIGHBORS);
  const total = near.reduce((n, e) => n + e.w, 0) || 1;
  const maxCount = Math.max(1, ...presets.map((p) => p.count));
  const scores = presets.map((p) => near.reduce((n, e) => n + e.w * jaccard(e.kinds, p.kinds), 0) / total + 0.1 * (p.count / maxCount));
  return withRank(presets, scores);
}

/** 이미 순서가 정해진 id 목록(유형 점수 순)으로 버전을 줄 세운다. 목록에 없는 버전은 뒤로. */
export function rankByOrder(presets: readonly ComposePreset[], order: readonly string[]): RankedPreset[] {
  const scores = presets.map((p) => {
    const at = order.indexOf(p.id);
    return at < 0 ? 0 : 1 - at / (order.length + 1);
  });
  return withRank(presets, scores);
}
