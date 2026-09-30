// 시안 3벌 스타일 Eval — 기계 판정 조각들 (2026-08-29, henry: "3벌이 생각보다
// 비슷하다" → STYLE_DIRECTIVE를 구조 수준으로 재설계하면서 세운 검증 루프).
//
// 여기엔 글자만 보고 확정할 수 있는 판정만 둔다(문체·형식·유사도·숫자 보존).
// "결이 지시문대로인가" 같은 판단 판정은 scripts/variant-style-eval.ts 가
// LLM(기준당 호출 1개)으로 한다 — blog-eval 과 같은 규칙: 점수 없음, 통과/실패
// 표, 실패는 후보일 뿐 자동 수정하지 않는다.

/** 존댓말 종결(습니다·요 계열) 등장 횟수. 선언적 통찰(info) 시안은 0이어야 한다. */
export function politeEndingCount(posts: string[]): number {
  const text = posts.join("\n");
  // 문장 끝(마침표·물음표·따옴표·줄끝)에 붙은 존댓말 종결만 센다 — "요일", "요즘"
  // 같은 단어 속 글자를 오인하지 않게 종결 위치로 한정한다. "니다"는 한다체
  // "아니다"를 오인하지 않게 앞 글자가 "아"면 제외한다(합니다·됩니다·아닙니다는
  // ㅂ받침 글자가 앞이라 그대로 잡힌다 — 08-29 Ng 시안 실측 오탐).
  const re = /(습니다|입니다|(?<!아)니다|세요|어요|아요|에요|예요|해요|이에요|죠|고요|는데요|거든요|다고요|까요|네요)[.!?…"”']*(?=\s|$)/gm;
  return (text.match(re) ?? []).length;
}

/** 본문 칸(첫 칸 제외)이 "1/ ", "2/ " 넘버링으로 시작하는 비율. */
export function insightNumberingRatio(posts: string[]): number {
  const body = posts.slice(1);
  if (body.length === 0) return 0;
  const numbered = body.filter((p) => /^\d+\/\s/.test(p.trim())).length;
  return numbered / body.length;
}

/**
 * 선언적 통찰 발행형(08-29 henry 실제 글 기준)의 첫 문장 판정: 첫 칸의 첫
 * 문장이 한다체 선언인가. "이긴다."는 통과, "이깁니다."·"이겨요."는 실패.
 */
export function firstSentenceDeclarative(posts: string[]): boolean {
  const first = (posts[0] ?? "").trim();
  if (!first) return false;
  const sentence = (first.split(/(?<=[.!?…])\s/)[0] ?? "").trim();
  const bare = sentence.replace(/[.!?…"”']+$/g, "");
  return /다$/.test(bare) && politeEndingCount([sentence]) === 0;
}

/** 대조법("~가 아니라 ~다") 무브가 한 번이라도 있는가. "게/건 아니라"도 잡는다. */
export function hasContrastMove(posts: string[]): boolean {
  return /아니라[,\s]/.test(posts.join("\n"));
}

// ── 시안 간 겹침 ─────────────────────────────────────────────────────────────

function bigrams(text: string): Set<string> {
  const s = text.replace(/\s+/g, "");
  const out = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}

/** 두 텍스트의 글자 바이그램 Dice 유사도 (0~1). 같은 글이면 1에 가깝다. */
export function textSimilarity(a: string, b: string): number {
  const A = bigrams(a);
  const B = bigrams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return (2 * inter) / (A.size + B.size);
}

/**
 * 시안 첫 **문장**들끼리의 최대 유사도. 3벌이 갈렸는지 판정하는 주 지표다.
 *
 * 08-31 교정: 원래 첫 칸 전체를 쟀는데, 세 시안이 같은 소재를 설명하는 이상
 * 첫 칸 뒷부분은 닮을 수밖에 없어 실제로 갈린 뒤에도 계속 실패가 떴다(실측:
 * 값매김 방식을 결별로 가른 뒤 첫 문장 유사도는 0.26→0.10으로 떨어졌는데 첫 칸
 * 전체는 0.44→0.41로 거의 그대로). 독자가 스크롤에서 보는 것도 첫 문장이다.
 */
export function maxFirstSentenceSimilarity(firstPosts: string[]): number {
  const sentences = firstPosts.map((p) => {
    const t = (p ?? "").trim();
    return (t.split(/(?<=[.!?…])\s/)[0] ?? t).trim();
  });
  return maxFirstPostSimilarity(sentences);
}

/** 첫 칸 전체의 최대 유사도. 참고값 — 판정은 첫 문장으로 한다. */
export function maxFirstPostSimilarity(firstPosts: string[]): number {
  let max = 0;
  for (let i = 0; i < firstPosts.length; i++) {
    for (let j = i + 1; j < firstPosts.length; j++) {
      max = Math.max(max, textSimilarity(firstPosts[i], firstPosts[j]));
    }
  }
  return max;
}

// ── 숫자 보존 (원본 충실) ────────────────────────────────────────────────────

/** 텍스트 속 숫자들(콤마 제거·정규화). "1,000" → "1000". */
export function numbersIn(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/\d[\d,.]*/g)) {
    out.add(m[0].replace(/,/g, "").replace(/\.$/, ""));
  }
  return out;
}

/**
 * 시안에 등장하지만 소재에는 없는 숫자 목록. 웹 검색으로 보강된 검증 숫자일 수도
 * 있어 "등장 = 실패"는 아니고, henry 가 표에서 눈으로 확인할 후보다.
 */
export function numbersNotInSource(source: string, posts: string[]): string[] {
  const src = numbersIn(source);
  const found = new Set<string>();
  for (const n of numbersIn(posts.join("\n"))) {
    // 칸 번호(1~2자리 "1/" 넘버링 등)와 연도가 아닌 1~2자리 수는 장면 소품일 수
    // 있어 제외 — 사실 주장 성격이 큰 3자리 이상·소수점 숫자만 후보로 올린다.
    if (n.length < 3 && !n.includes(".")) continue;
    if (!src.has(n)) found.add(n);
  }
  return [...found];
}
