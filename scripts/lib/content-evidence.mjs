function compact(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function firstSentence(text) {
  const clean = compact(text);
  const match = clean.match(/^.*?[.!?](?=\s|$)/);
  return (match?.[0] || clean).slice(0, 180);
}

export function isSubstantiveEvidenceText(text) {
  const clean = compact(text);
  if (clean.length < 100 || clean.length > 1800) return false;
  if (/^(subscribe|sign in|share|menu|cookie|newsletter)\b/i.test(clean)) return false;
  return clean.split(" ").length >= 12;
}

export function describeEvidenceBlock({ heading, text }) {
  const section = compact(heading);
  const quote = firstSentence(text);
  return ["근거 화면", section, quote].filter(Boolean).join(" · ");
}

// 근거 화면의 "칠할 구간" 계산. 예전에는 첫 문장을 220자에서 글자 수로 잘라
// upc|oming 처럼 단어 한가운데가 끊겼다 (henry 08-19 신고). 사람이 형광펜을
// 긋듯 문장·절 경계에서만 끝나게 한다.
const SELECTION_MIN_CHARS = 60; // 이보다 짧으면 다음 문장을 이어 붙인다
const SELECTION_WHOLE_MAX = 420; // 여기까지는 문장을 통째로 칠한다
const SELECTION_CUT_MAX = 300; // 더 긴 문장은 이 안에서 절 경계로 자른다
const SELECTION_CUT_MIN = 120; // 자를 자리가 이보다 앞이면 후보로 안 본다

// 마침표가 문장 끝이 아닌 경우: 약어(Dr., e.g., U.S.)와 소수점(3.5).
const ABBREVIATION_TAIL =
  /(?:^|[\s("'[])(?:[A-Z]|[A-Z]\.[A-Z]|Mr|Mrs|Ms|Dr|Prof|St|Jr|Sr|vs|etc|al|eg|ie|e\.g|i\.e|Fig|No|Inc|Ltd|Co|Corp|Approx)\.$/;

/** 문장 끝 위치(끝나는 문자 다음 인덱스) 목록. */
function sentenceEnds(text) {
  const ends = [];
  const re = /[.!?]["')\]]?/g;
  let match = re.exec(text);
  while (match) {
    const end = match.index + match[0].length;
    const after = text.slice(end, end + 1);
    const isBoundary = after === "" || /\s/.test(after);
    const head = text.slice(0, end);
    const decimal = /\d$/.test(text.slice(match.index - 1, match.index)) && /^\d/.test(after);
    if (isBoundary && !decimal && !ABBREVIATION_TAIL.test(head)) ends.push(end);
    match = re.exec(text);
  }
  return ends;
}

/** limit 이하에서 가장 뒤쪽의 절 경계(쉼표·콜론·세미콜론·대시) 뒤 위치. */
function clauseCut(text, limit) {
  let best = -1;
  const re = /[,;:—–][ ]/g;
  let match = re.exec(text);
  while (match && match.index < limit) {
    if (match.index + 1 >= SELECTION_CUT_MIN) best = match.index + 1;
    match = re.exec(text);
  }
  return best;
}

/** limit 이하에서 마지막 단어 경계(공백 앞) 위치. */
function wordCut(text, limit) {
  const window = text.slice(0, limit + 1);
  const at = window.search(/\s\S*$/);
  return at > 0 ? at : -1;
}

/**
 * 블록 원문(textContent)에서 형광펜을 칠할 [start, end) 를 고른다.
 * 끝은 항상 문장 끝이거나 절 경계, 최소한 단어 경계다 — 단어 중간에서 끊지 않는다.
 * 칠할 만한 구간이 없으면 null.
 */
export function planEvidenceSelection(raw, options = {}) {
  const text = String(raw || "");
  const minChars = options.minChars ?? SELECTION_MIN_CHARS;
  const wholeMax = options.wholeMax ?? SELECTION_WHOLE_MAX;
  const cutMax = options.cutMax ?? SELECTION_CUT_MAX;

  const start = text.search(/\S/);
  if (start < 0) return null;
  const body = text.slice(start);

  // 1) 문장 단위로 채운다. 첫 문장이 너무 짧으면 다음 문장을 이어 붙여
  //    "한 줄만 덩그러니 칠해진" 화면을 막는다.
  const ends = sentenceEnds(body);
  let end = -1;
  for (const candidate of ends) {
    if (candidate > wholeMax) break;
    end = candidate;
    if (candidate >= minChars) break;
  }
  if (end > 0) return { start, end: start + end };

  // 2) 문장 하나가 상한을 넘으면 절 경계 → 단어 경계 순으로 물러선다.
  const limit = Math.min(cutMax, body.length);
  const cut = clauseCut(body, limit);
  const fallback = cut > 0 ? cut : wordCut(body, limit);
  if (fallback > 0) return { start, end: start + fallback };

  // 3) 경계가 하나도 없을 만큼 짧은 블록은 통째로 칠한다.
  const whole = body.replace(/\s+$/, "").length;
  return whole > 0 ? { start, end: start + whole } : null;
}

// ── 형광펜 (09-26, Highlightr 방식) ─────────────────────────────────────────
// 초록 판(Needle식 2단 강조)은 원문을 우리 색으로 덮어 "원문 캡처"로 안 읽혔다
// (henry 09-26). 원문은 그대로 두고 요점에만 형광펜을 긋고, 요점이 여러 개면
// 요점마다 색을 바꾼다. 색과 모양은 Obsidian Highlightr 플러그인(MPL-2.0)의 기본
// 팔레트(분홍·파랑·노랑)와 "rounded" 스타일에서 가져왔다.
// https://github.com/chetachiezikeuzor/Highlightr-Plugin
export const HIGHLIGHT_COLORS = ["#FFB8EBA6", "#ADCCFFA6", "#FFF3A3A6"];

export function highlightMarkStyle(color = HIGHLIGHT_COLORS[0]) {
  return [
    `background:${color}`,
    "color:inherit",
    "margin:0 -0.05em",
    "padding:0.125em 0.15em",
    "border-radius:0.2em",
    "-webkit-box-decoration-break:clone",
    "box-decoration-break:clone",
  ].join(";");
}

// X 아티클 수집(collectArticle)은 블록마다 한 줄씩 "\n"으로 이어 준다. 줄을 문단으로
// 되살리지 않으면 카드에서 문단·목록이 한 덩어리로 붙는다 (09-26 Takeaways 실측).
// 목록 표시는 텍스트에 안 남으므로, 콜론으로 끝난 줄 뒤의 짧은 줄들을 목록으로 본다.
const LIST_ITEM_MAX = 160; // 이보다 긴 줄은 목록이 끝나고 돌아온 본문 문단으로 본다
export function splitParagraphs(text) {
  const lines = String(text || "")
    .split(/\n+/)
    .map(compact)
    .filter(Boolean);
  const out = [];
  let inList = false;
  for (const line of lines) {
    inList = inList && line.length <= LIST_ITEM_MAX;
    out.push(inList ? `• ${line}` : line);
    if (/:$/.test(line)) inList = true;
  }
  return out;
}

// 카드 한 장에 읽히는 크기로 들어가는 분량 (본문 38px @1080×1350). 넘치면 다음 카드.
export const CARD_WINDOW_CHARS = 650;
const MAX_CARDS_PER_SECTION = 4;

/** 문단들을 카드 한 장 분량씩 나눈다. 짧은 꼬리는 버린다(카드 한 장이 되기엔 빈약). */
export function chunkParagraphs(paragraphs, { windowChars = CARD_WINDOW_CHARS, minChars = 120 } = {}) {
  const windows = [];
  let current = [];
  let total = 0;
  for (const paragraph of paragraphs) {
    current.push(paragraph);
    total += paragraph.length;
    if (total >= windowChars) {
      windows.push(current);
      current = [];
      total = 0;
    }
  }
  if (current.length && total >= minChars) windows.push(current);
  return windows;
}

/**
 * X 아티클 본문 항목(head·text·img)을 섹션으로 묶고, 형광펜 카드 목록을 만든다.
 *
 * henry 09-26: "게시물 이미지는 최대한 활용, 이미지가 없는 경우엔 하이라이팅".
 * 처음엔 원문 이미지가 있는 섹션을 통째로 건너뛰었는데, 그러면 같은 섹션의 다른
 * 대목을 다루는 칸(예: 그래프 한 장 + HTML 필터 사례)이 맨몸이 됐다. 그래서 모든
 * 섹션에 카드를 만들되 긴 섹션은 한 장 분량씩 나누고, "원문 이미지 먼저"는 배정
 * 단계(threads-link-images)가 지킨다. hasImage 는 설명에 실어 배정이 알게 한다.
 * 첫 소제목 앞 도입부는 아티클 제목을 소제목 자리에 둔다.
 * @returns {{ heading: string, paragraphs: string[], hasImage: boolean, part: number,
 *            intro: boolean, occurrence: number }[]}
 */
export function planSectionCards(items, { articleTitle = "", minChars = 120, max = 24 } = {}) {
  const sections = [];
  // intro 는 문자열 비교가 아니라 위치로 정한다 — 제목을 못 받아 첫 소제목이 제목
  // 자리에 들어오면 그 섹션까지 도입부로 오판했다 (09-26 검토).
  let current = { heading: compact(articleTitle), paragraphs: [], hasImage: false, intro: true };
  for (const it of items) {
    if (it.kind === "head") {
      sections.push(current);
      current = { heading: compact(it.text), paragraphs: [], hasImage: false, intro: false };
    } else if (it.kind === "text") {
      current.paragraphs.push(...splitParagraphs(it.text));
    } else if (it.kind === "img" || it.kind === "vid") {
      current.hasImage = true;
    }
  }
  sections.push(current);
  // 같은 소제목이 여러 번 나오면(예: "Example" 두 개) 몇 번째인지로 구별한다 —
  // 제목만으로 찾으면 두 번째 섹션 카드가 첫 번째 화면으로 찍혔다 (09-26 검토).
  const seen = new Map();
  for (const s of sections) {
    if (s.intro) continue;
    const key = s.heading.toLowerCase();
    s.occurrence = seen.get(key) ?? 0;
    seen.set(key, s.occurrence + 1);
  }
  return sections
    .filter((s) => s.heading)
    .flatMap((s) =>
      chunkParagraphs(s.paragraphs, { minChars })
        .slice(0, MAX_CARDS_PER_SECTION)
        .map((paragraphs, part) => ({
          heading: s.heading,
          paragraphs,
          hasImage: s.hasImage,
          part,
          intro: s.intro,
          occurrence: s.occurrence ?? 0,
        }))
    )
    .slice(0, max);
}
