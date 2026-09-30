// 토글 초안 프롬프트 — 운영자 카테고리 5개의 지시문과 "켠 조각만 쓰기" 요청문.
//
// 말투의 공급원은 여기와 팩 AGENTS.md, 그리고 레퍼런스로 싣는 실제 답 조각(팩 examples.md 에서 댓글마다 다르게 고른다)이다.
// 고정 예시 문장은 싣지 않는다: 모든 댓글에 같은 문장이 실리면 초안마다 그 문장이 되풀이된다(2026-09-29 eval).
// 조각은 isCleanExample 로 거른 것만 싣는다(말줄임·웃음 기호·달래기가 든 예시는 그 말투를 그대로 퍼뜨린다).
// 금지 문형은 여기 싣지 않는다. 검사는 코드(compose-kinds.ts voiceViolations)가 한다.
// 순수 — I/O 없음.

import { CHANNEL_NAME, KIND_NAME, type ComposeKind, type ProductChannel } from "./compose-kinds";
import { NEED_NAME, type ReadingExample } from "./reading";

/** 운영자가 정의한 대로의 종류 설명 (태깅 · 지시문 · 카테고리 when 공통) */
export const OWNER_KIND_GUIDE: Record<ComposeKind, string> = {
  empathy:
    "공감 + 성실 장문. 상대 상황을 판단으로 짚고(몸이 완전 지쳤다는 신호야) 할 일을 순서대로 꽤 길게 정리한다. 감정 표현은 짧은 응원 한 줄이 최대치고, 그 한 줄도 이번 상대 상황에 맞는 말로 매번 새로 쓴다.",
  joke: "드립 한 마디 + 짧은 건강상식으로 뒤통수 치기. 운영자의 드립은 상황을 있는 그대로 짚고 할 일을 반말로 툭 던지는 말이다(예: 술을 끊는게 젤 좋아 돈도 안들고 / 남편 잘 교육하고). 웃음 기호 없이 마침표로 끝낸다. 한두 문장.",
  principle:
    "원리 설명. 그 증상이 왜 생기는지 영양소 기전으로 푼다(예: 철분이 바닥나면 산소를 못 날라서 피곤하다). 상대가 꼭 알아야 할 사실을 단정한다.",
  ingredient:
    "성분 설명. 그 성분이 몸에서 하는 일, 형태, 함량, 먹는 시간을 짚는다. 중복 복용 방지: 종합비타민 등 라벨에서 같은 성분이 겹치지 않게 확인시키고, 먹는 법을 실제로 준다(예: 철분제는 칼슘·커피와 4시간 띄어서 먹어).",
  product:
    "제품 추천 3분할. 약국(일반의약품 위주) / 온라인(건강기능식품, 적게, 좋아하는 뉘앙스 없이) / 해외 직구(해외 브랜드를 대놓고 좋아하는 약사 입장, 리베이트 없이 내가 먹는 것)로 나눠 댄다. 그 경로에 말이 되는 제품이 없을 때만 그 경로를 뺀다. 경로마다 브랜드 + 제품 이름 + 함량(예: 쏜리서치 아이언 비스글리시네이트 25mg, 나우푸드 D3 2000IU).",
};

const HOW: Record<ComposeKind, string> = {
  empathy:
    "판단 한 줄로 연다(상대 말을 되풀이하지 않는다). 할 일을 성분·검사·생활 순으로 문단을 나눠 성실하게 쓴다. 따뜻함은 행동 지시로 보여주고, 감정 표현은 맨 앞이나 맨 끝에 한 줄만.",
  joke: "상대가 기대한 답(영양제 이름) 대신 진짜 할 일을 평범한 말로 바로 말한다. 웃음은 단어를 꾸며서가 아니라 그 솔직함에서 나온다. 몸·약·물건을 사람처럼 행동하게 만드는 비유와 새로 지은 별명은 운영자 드립에 없으니 쓰지 않는다. 말투는 건조하게. 설명을 붙이지 않는다.",
  principle: "결론부터 박고 '~해서 ~거든' 식으로 인과를 한두 단계 푼다. 어려운 말은 바로 뒤에 일상 말로. 교과서 말투 금지.",
  ingredient: "성분 이름 → 몸에서 하는 일 한 줄 → 형태·함량·시간 → 겹치는 것 확인. 숫자는 정확하게.",
  product:
    "경로마다 한 줄씩 '약국은 ~', '온라인이면 ~', '직구는 ~'으로 쓴다. 한 줄 = 브랜드 + 제품 이름 + 함량 + 먹는 법(간격·시간). 등록 제품이 맞으면 그 이름을 그대로 먼저 쓴다. 겹치면 위험한 성분(비타민D·철분 등)일 때만 끝에 한 줄로 합쳐서 넘으면 안 되는 양을 숫자로 짚는다.",
};

export interface KindSegment {
  pairId: string;
  text: string;
  channel?: ProductChannel;
}

const LENGTH_BOUNDS: Record<ComposeKind, [number, number]> = {
  empathy: [8, 400],
  joke: [6, 140],
  principle: [25, 400],
  ingredient: [20, 350],
  product: [12, 350],
};

/** 레퍼런스 조각 4~8개: 길이 범위 안 · 같은 답에서 하나씩 · 중앙 길이에 가까운 순. 제품은 경로가 골고루. */
export function pickSegments(kind: ComposeKind, segments: readonly KindSegment[], max = 8): KindSegment[] {
  const [lo, hi] = LENGTH_BOUNDS[kind];
  const seen = new Set<string>();
  const ok = segments.filter((s) => {
    const n = [...s.text].length;
    if (n < lo || n > hi || seen.has(s.pairId) || seen.has(s.text)) return false;
    seen.add(s.pairId);
    seen.add(s.text);
    return true;
  });
  const lens = ok.map((s) => [...s.text].length).sort((a, b) => a - b);
  const median = lens[Math.floor(lens.length / 2)] ?? 0;
  const ranked = [...ok].sort((a, b) => Math.abs([...a.text].length - median) - Math.abs([...b.text].length - median));
  if (kind !== "product") return ranked.slice(0, max);
  return roundRobinByChannel(ranked, max);
}

function roundRobinByChannel(ranked: readonly KindSegment[], max: number): KindSegment[] {
  const buckets = new Map<string, KindSegment[]>();
  for (const s of ranked) buckets.set(s.channel ?? "-", [...(buckets.get(s.channel ?? "-") ?? []), s]);
  const out: KindSegment[] = [];
  while (out.length < max && [...buckets.values()].some((b) => b.length)) {
    for (const b of buckets.values()) if (b.length && out.length < max) out.push(b.shift() as KindSegment);
  }
  return out;
}

function segmentLines(segments: readonly KindSegment[]): string {
  return segments.map((s) => `- ${s.channel ? `(${CHANNEL_NAME[s.channel]}) ` : ""}${s.text}`).join("\n");
}

/** categories.json 에 넣는 카테고리 지시문 (3벌 초안기도 이걸 읽는다) */
export function categoryPrompt(kind: ComposeKind, segments: readonly KindSegment[]): string {
  return [
    `목표: ${OWNER_KIND_GUIDE[kind]}`,
    `쓰는 법: ${HOW[kind]}`,
    "공통: 반말, 단정, 드라이하지만 따뜻하게. 말줄임표와 웃음·울음 기호는 쓰지 않는다. 끝을 '-'로 닫는 버릇은 써도 된다.",
    segments.length ? `실제 답 조각:\n${segmentLines(segments)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

// ── 토글 초안 요청문 ────────────────────────────────────────────────

export interface ComposePromptParts {
  owner: string;
  ownerLine: string;
  /** 댓글·내 글·대화·예전 답까지 이미 조립한 맥락 */
  context: string;
  kinds: ComposeKind[];
  channels: ProductChannel[];
  /** 종류별 레퍼런스 조각 (이 댓글과 같은 댓글에서 온 조각은 이미 뺐다) */
  segments: Partial<Record<ComposeKind, KindSegment[]>>;
  /** 앞 초안 (토글을 바꿔 다시 쓸 때) */
  base?: { draft: string; kinds?: ComposeKind[] };
  /** 같은 세션에 이어 쓰는 턴이면 맥락을 다시 싣지 않는다 */
  resumed?: boolean;
  /** 이번 버전 (답 버전 버튼 하나). guide 가 있으면 그 버전 지시가 조각 설명보다 먼저다. */
  version?: { name: string; guide?: string };
  /** 주인이 실제로 되물은 문장 몇 개 (댓글마다 다르게 고른다) */
  asks?: string[];
  /** 운영자가 등록한 제품 (켠 경로·성분이 맞는 것 먼저). 제품 조각에서 이 이름을 그대로 쓰게 한다. */
  products?: { name: string; brand: string; ingredient: string; note: string }[];
  /** 읽기 단계 결과 (reading.ts readingBlock 으로 조립한 글). 모든 버전에 먼저 싣는다. */
  reading?: string;
  /** 비슷한 과거 댓글을 주인이 어떻게 읽고 답했나 (reading-examples.json) */
  readingExamples?: readonly ReadingExample[];
}

function productsLine(p: ComposePromptParts): string {
  if (!p.products?.length) return "";
  const lines = p.products.map((x) => `- ${x.name}${x.brand ? ` (${x.brand})` : ""}${x.ingredient ? ` · 성분: ${x.ingredient}` : ""}${x.note ? ` · ${x.note}` : ""}`);
  return `\n<owner_products>\n${p.owner}이(가) 직접 등록한 제품이다. 댓글에 맞는 것이 있으면 이 이름 그대로 쓴다. 맞는 게 없으면 억지로 넣지 않는다.\n${lines.join("\n")}\n</owner_products>`;
}

function partBlock(kind: ComposeKind, p: ComposePromptParts): string {
  const channels = kind === "product" ? `\n<channels>${p.channels.map((c) => CHANNEL_NAME[c]).join(", ")} (이 경로만 쓴다)</channels>${productsLine(p)}` : "";
  const refs = segmentLines(p.segments[kind] ?? []);
  return `<part kind="${kind}" name="${KIND_NAME[kind]}">
<what>${OWNER_KIND_GUIDE[kind]}</what>
<how>${HOW[kind]}</how>${channels}
<owner_real_parts>
${refs || "(실제 조각 없음)"}
</owner_real_parts>
</part>`;
}

/** 요청문에 싣는 예시 글 전부 (평가가 "예시 베끼기"를 잴 때 쓴다) */
export function promptExamples(kinds: readonly ComposeKind[], segments: ComposePromptParts["segments"]): string[] {
  return kinds.flatMap((k) => (segments[k] ?? []).map((s) => s.text));
}

/** 분량은 상한만 준다 (하한을 주면 할 말이 적은 댓글도 그만큼 채운다 — 2026-09-29 henry "모든 댓글에 길게 쓸 필요 없다"). */
function lengthLine(kinds: readonly ComposeKind[]): string {
  if (kinds.includes("empathy")) return "분량: 할 일이 여러 개일 때만 문단을 나눠 길게(최대 문단 4개, 480자). 할 일이 하나면 두세 문장으로 끝낸다.";
  if (kinds.includes("product")) return `분량: 경로마다 한 줄. 많아야 ${180 + (kinds.length - 1) * 80}자.`;
  if (kinds.length === 1 && kinds[0] === "joke") return "분량: 한두 문장, 80자 안.";
  return `분량: 조각마다 한두 문장, 많아야 ${kinds.length * 90}자. 이 댓글에 제일 중요한 것만 말하고, 주의사항을 빠짐없이 챙기려 하지 않는다.`;
}

/** 판단 정보가 모자라면 되묻는다 — 버전과 상관없이 먼저 적용한다. 되묻기 결은 주인 실제 되묻기에서. */
function readingAskLine(owner: string): string {
  return `\n- <reading>의 모자란 정보가 "없음"이면 enough=true 다. 있으면 enough=false 로 그걸 묻는다. 다만 니즈가 상담이면 질문만 던지고 끝내지 않는다: 지금 판단할 수 있는 건 켠 조각으로 다 주고, 묻는 건 ask 에 붙인다(${owner}도 "나이가 어떻게 돼?" 묻고 바로 방법까지 준다).`;
}

function askBlock(p: ComposePromptParts): string {
  const asks = p.asks?.length ? `\n<owner_asks>\n${p.asks.map((a) => `- ${a}`).join("\n")}\n</owner_asks>\n위는 ${p.owner}이(가) 다른 댓글에 실제로 되물은 문장이다. 묻는 호흡만 참고하고 문장은 이번 댓글에 맞게 새로 쓴다.` : "";
  return `## 먼저 판단: 답할 정보가 있나 (버전 지시보다 먼저)
이 댓글만 보고 ${p.owner}이(가) 판단하기에 핵심 정보(누가 먹는지·나이, 지금 먹는 약, 증상이 언제부터·얼마나, 검사 수치 등)가 빠져서 답이 크게 달라지면 enough=false 다.
질문이 아닌 댓글(인사·칭찬·후기·잡담)은 판단할 게 없으니 enough=true 다.
- enough=false: 켠 조각을 다 채우지 않는다. 보통은 지금 말할 수 있는 판단 한두 문장(sections 에 켠 조각 하나로) + ask 에 그 빠진 사실을 묻는 질문 1개. 판단할 게 하나도 없으면 sections 를 비우고 질문만. 짧을수록 좋다.
- 헷갈리면: 빠진 사실 하나 때문에 추천(제품·용량)이 바뀌는지 본다. 바뀌면 enough=false 로 짧게 답하고 묻는다.
- enough=true: ask 는 빈 문자열. 켠 조각을 이번 버전에 맞는 분량으로 쓴다. 이미 답할 수 있는데 되묻지 않는다.${p.reading ? readingAskLine(p.owner) : ""}${asks}`;
}

function readingExamplesBlock(p: ComposePromptParts): string {
  if (!p.readingExamples?.length) return "";
  const body = p.readingExamples
    .map((e) => `<past>\n댓글: ${e.comment.trim().slice(0, 300)}\n읽은 지점: ${e.focus}\n니즈: ${NEED_NAME[e.need]}\n접근: ${e.approach}\n</past>`)
    .join("\n");
  // 실제 답 문장은 싣지 않는다: 판단(지점·니즈·접근)만 보여준다. 문장을 실으면 제품 줄·구절을 그대로 옮긴다(2026-09-30 eval 베끼기 6.7→13.3%).
  return `\n\n## ${p.owner}이(가) 비슷한 댓글을 실제로 읽고 답한 방식\n${body}\n어느 지점을 짚고, 어떤 니즈로 읽고, 어떤 접근으로 답했는지를 본다.`;
}

function readingIntro(p: ComposePromptParts): string {
  if (!p.reading) return "";
  // 이어 쓰는 턴에도 읽기 결과를 다시 싣는다: 앞 턴이 읽기 단계 전 세션일 수 있다 (2026-09-30 실경로 떠넘기기).
  if (p.resumed) return `\n\n${p.reading}`;
  return `\n\n${p.reading}${readingExamplesBlock(p)}`;
}

function versionBlock(p: ComposePromptParts): string {
  if (!p.version) return "";
  const guide = p.version.guide ? `\n이 버전의 지시 (아래 조각 설명과 부딪히면 이쪽을 따른다):\n${p.version.guide.trim()}` : "";
  return `\n<version name="${p.version.name}">${guide}\n</version>`;
}

function baseBlock(p: ComposePromptParts): string {
  if (!p.base?.draft.trim()) return "";
  const before = new Set(p.base.kinds ?? []);
  const removed = [...before].filter((k) => !p.kinds.includes(k));
  const added = p.kinds.filter((k) => before.size && !before.has(k));
  const change = [
    removed.length ? `뺄 조각: ${removed.map((k) => KIND_NAME[k]).join(", ")} — 그 부분만 지운다.` : "",
    added.length ? `넣을 조각: ${added.map((k) => KIND_NAME[k]).join(", ")} — 새로 써서 자연스러운 자리에 끼운다.` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const judge = p.reading ? "\n앞 초안이 <reading>의 판단(니즈·접근)과 어긋나는 문장은 그대로 두지 않고 판단에 맞게 고친다." : "";
  return `\n<previous_draft>\n${p.base.draft.trim()}\n</previous_draft>\n앞 초안을 고쳐 쓴다. ${change || "켠 조각에 맞게 다듬는다."}\n남는 조각은 글자를 최대한 그대로 둔다(연결이 어색한 곳만 손본다).${judge}\n`;
}

export function buildComposePrompt(p: ComposePromptParts): string {
  const intro = p.resumed
    ? `[토글 바꿔 다시 쓰기] ${p.owner}이(가) 켠 조각이 바뀌었다. 맥락은 앞 턴과 같다.`
    : `당신은 ${p.ownerLine}의 스레드 답글을 ${p.owner} 대신 쓰는 사람이다. ${p.owner}의 말투 규칙책은 이 폴더의 AGENTS.md 로 이미 읽었다. 그 규칙을 따른다. 목표: 팔로워가 읽었을 때 ${p.owner}이(가) 직접 쓴 답과 구별이 안 되는 글.\n\n${p.context}`;
  return `${intro}${readingIntro(p)}

${askBlock(p)}

## 이번 일
${p.owner}이(가) 켠 조각만 넣어 답글 하나를 쓴다. 켜지 않은 조각은 쓰지 않는다.
<parts>
${p.kinds.map((k) => partBlock(k, p)).join("\n")}
</parts>${versionBlock(p)}
${baseBlock(p)}
- ${lengthLine(p.kinds)}
- 조각 순서는 자연스럽게(보통 공감·드립 → 원리 → 성분 → 제품). 조각 하나 = 문단 하나.
- <owner_real_parts>는 ${p.owner}이(가) 다른 댓글에 실제로 단 답에서 뽑은 조각이다. 문장 길이가 들쭉날쭉한 것, 끝맺는 방식, 단정하는 호흡 같은 결만 참고한다. 문장·구절·제품 예시는 가져오지 말고, 이번 댓글을 읽고 ${p.owner}이(가) 처음 하는 말처럼 새로 쓴다.

## 출력
JSON 하나만. 설명·코드펜스 없이. enough=true 면 kind 는 켠 조각(${p.kinds.join(", ")})이 정확히 한 번씩. enough=false 면 켠 조각 가운데 쓴 것만.
{"enough": true, "ask": "", "sections": [{"kind": "${p.kinds[0]}", "text": "그 조각의 글"}]}`;
}

/** 말투 위반이 있을 때 같은 세션에 한 번 더 묻는 요청문 */
export function buildVoiceFixPrompt(owner: string, phrases: readonly string[]): string {
  return `[말투 고치기] 방금 초안에 ${owner}이(가) 쓰지 않는 표현이 있다: ${phrases.map((p) => `"${p}"`).join(", ")}.
그 부분만 ${owner}답게(단정하고 건조하게, 걱정은 할 일로 보여주게) 고쳐서 같은 JSON 모양으로 다시 낸다. 켠 조각과 나머지 글은 그대로 둔다.`;
}
