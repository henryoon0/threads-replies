// 근거 문장 뽑기의 순수 부분 (2026-09-27).
//
// 모델이 "원문 그대로" 옮겼다고 한 인용을 코드로 다시 확인한다. 캡처 형광펜이 이 문자열을
// 원문에서 찾아 칠하므로, 한 글자라도 의역되면 캡처가 빈손이 된다. 공백·줄바꿈·따옴표
// 모양 차이는 흔한 복사 잡음이라 느슨하게 맞추되, 돌려주는 값은 항상 원문의 실제 조각이다.
//
// Pure — I/O 없음.

const QUOTE_MAP: Record<string, string> = {
  "‘": "'",
  "’": "'",
  "“": '"',
  "”": '"',
  " ": " ",
};

function normChar(ch: string): string {
  return QUOTE_MAP[ch] ?? ch;
}

/** 공백을 하나로 접은 문자열과, 접힌 글자마다 원문 위치를 기록한 표. */
function foldWithMap(text: string): { folded: string; map: number[] } {
  let folded = "";
  const map: number[] = [];
  let prevSpace = true; // 앞쪽 공백은 버린다
  for (let i = 0; i < text.length; i += 1) {
    const ch = normChar(text[i]);
    if (/\s/.test(ch)) {
      if (prevSpace) continue;
      folded += " ";
      map.push(i);
      prevSpace = true;
      continue;
    }
    folded += ch;
    map.push(i);
    prevSpace = false;
  }
  return { folded, map };
}

/**
 * quote 가 text 안에 있으면 text 속 실제 조각을 돌려준다(공백·따옴표 모양만 느슨하게).
 * 없으면 null. 마크다운 강조(**)·줄머리 기호 차이는 맞춰주지 않는다 — 그건 의역이다.
 */
export function locateVerbatim(text: string, quote: string): string | null {
  const q = foldWithMap(quote).folded.trim();
  if (q.length < 2) return null;
  const exact = text.indexOf(quote);
  if (exact >= 0) return quote;
  const { folded, map } = foldWithMap(text);
  const at = folded.indexOf(q);
  if (at < 0) return null;
  const start = map[at];
  const end = map[at + q.length - 1] + 1;
  return text.slice(start, end);
}

// ── 긴 문서에서 모델에게 보여줄 부분 고르기 ─────────────────────────

/** 한국어·영어 섞인 질문에서 비교용 낱말을 뽑는다 (2글자 이상, 조사 꼬리 약간 제거). */
export function queryTerms(...parts: string[]): string[] {
  const text = parts.join(" ").toLowerCase();
  const raw = text.match(/[a-z0-9][a-z0-9.+#-]*|[가-힣]{2,}/g) ?? [];
  const out = new Set<string>();
  for (const w of raw) {
    const t = w.replace(/(은|는|이|가|을|를|에서|에게|으로|로|와|과|도|만|의|요|나요|까요|인가요)$/u, "");
    if (t.length >= 2) out.add(t);
  }
  return [...out];
}

/**
 * 긴 문서를 문단으로 나눠 질문 낱말이 많이 걸리는 문단을 고른다. 문서 머리(제목·요약)는
 * 항상 넣고, 고른 문단은 원래 순서대로 이어 붙인다. 모델이 이 조각에서 인용해도 원문
 * 전체의 부분 문자열이므로 locateVerbatim 확인은 원문 전체로 한다.
 */
export function selectExcerpt(text: string, terms: readonly string[], maxChars: number): string {
  if (text.length <= maxChars) return text;
  const headChars = Math.min(1200, Math.floor(maxChars / 4));
  const head = text.slice(0, headChars);
  const rest = text.slice(headChars);
  const paras = rest.split(/\n{2,}/).map((p, i) => ({ p, i }));
  const lowered = terms.map((t) => t.toLowerCase());
  const scored = paras
    .map(({ p, i }) => {
      const l = p.toLowerCase();
      let s = 0;
      for (const t of lowered) if (l.includes(t)) s += t.length >= 4 ? 2 : 1;
      return { p, i, s };
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i);
  const picked: { p: string; i: number }[] = [];
  let used = head.length;
  for (const x of scored) {
    const piece = x.p.length > 1500 ? x.p.slice(0, 1500) : x.p;
    if (used + piece.length + 6 > maxChars) continue;
    picked.push({ p: piece, i: x.i });
    used += piece.length + 6;
  }
  picked.sort((a, b) => a.i - b.i);
  return [head, ...picked.map((x) => x.p)].join("\n\n…\n\n");
}
