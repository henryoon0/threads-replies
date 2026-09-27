// link 잡 재료(data/threads-runs/<runId>/00_input/source.md)를 색인 문서로 (순수, 2026-09-27).
//
// 왜: 원글 원본(anchor.ts)은 글 시각 전후 재료만 후보로 올려서, 며칠 뒤에 조사한 원문은 색인에
// 없었다 (09-27 QA: 09-02 글의 "Prompt-audit 는 API 없이도?" 질문 — 답은 09-07 에 수집한
// lydiahallie 원문 "Also works if you don't use the API!" 에 있었다). 그래서 henry 가 조사한
// 원문 전부를 색인 한 장에 "수집한 원문"으로 올린다. 여기서는 source.md 머리 해석과 url 정규화만.
//
// source.md 머리 모양 (실측 616개):
//   # 원문 수집 / # 자료 수집 (블로그/웹 글) / # 자료 수집 (GitHub 레포)
//     - URL: … / - 작성자: 이름 (@핸들) / - 제목: … / - 레포: … / - 수집: ISO / ---  본문
//   # 리뷰 재료 수집: "주제" / # 리서치 재료 수집: "주제" / # 사례 모음 재료: "주제"   (url 없음)
//   # 질문 답변 재료   ← 댓글 답하기가 만든 잡. 원문이 아니고 질문 자체라 색인에서 뺀다.

export interface RunSourceHeader {
  url?: string;
  title: string;
  author?: string;
  /** YYYY-MM-DD (수집 시각, 없으면 runId 앞 날짜) */
  date: string;
  /** 머리 첫 줄 (# 원문 수집 …) */
  heading: string;
}

function headerValue(md: string, key: string): string {
  return md.match(new RegExp(`^- ${key}:\\s*(.+)$`, "m"))?.[1]?.trim() ?? "";
}

/** 머리(첫 --- 앞) 다음 첫 본문 줄. 이미지 마커·제목줄은 건너뛴다. */
function firstBodyLine(md: string): string {
  const cut = md.indexOf("\n---\n");
  const body = cut >= 0 ? md.slice(cut + 5) : md;
  const line = body
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !/^-{3,}$/.test(l) && !l.startsWith("#") && !l.startsWith("[이미지") && !l.startsWith("!["));
  return (line ?? "").replace(/\s+/g, " ").slice(0, 80);
}

/** ISO 시각 → 로컬(한국) 날짜. 머리의 수집 시각은 UTC 라 그대로 자르면 하루 밀린다. */
function localDateOf(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 색인 제목용 작성자: "Lydia Hallie ✨ (@lydiahallie)" → "Lydia Hallie". 이름이 없으면 @핸들. */
function shortAuthor(author: string | undefined): string {
  if (!author) return "";
  const name = author.replace(/\s*\(@[^)]*\)\s*/g, " ").replace(/[^\p{L}\p{N}\s._-]/gu, "").replace(/\s+/g, " ").trim();
  return name || (author.match(/@\w+/)?.[0] ?? "");
}

/** 별칭 재료: 머리를 뺀 본문 앞부분 한 줄 (이미지 마커 제외). 제목만으로는 별칭이 빈약하다. */
export function runSourceSeed(md: string, chars = 600): string {
  const cut = md.indexOf("\n---\n");
  const body = cut >= 0 ? md.slice(cut + 5) : md.replace(/^#.*\n/, "");
  return body
    .replace(/^\s*-{3,}\s*$/gm, " ")
    .replace(/\[이미지[^\]]*\]/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, chars);
}

/** 댓글 답하기가 만든 잡 등 원문이 아닌 재료. */
export function isNonSourceRun(md: string): boolean {
  return /^# 질문 답변 재료/.test(md.trimStart());
}

/** 머리 영역: 첫 "---" 또는 첫 "## " 앞 (사례 모음·리뷰는 본문 속 사례마다 "- URL:" 이 또 있다). */
function headerBlock(md: string): string {
  const ends = [md.indexOf("\n---\n"), md.indexOf("\n## ")].filter((i) => i >= 0);
  return ends.length ? md.slice(0, Math.min(...ends)) : md;
}

/** 제목 고르기: 머리의 제목·레포 → "리뷰 재료 · 주제" → "작성자 · 첫 문장" → 머리 첫 줄 → runId. */
function pickTitle(md: string, head: string, heading: string, author: string | undefined, runId: string): string {
  const topic = heading.match(/"(.+)"/)?.[1];
  const kindWord = heading.replace(/:.*$/, "").replace(/\s*\(.*\)$/, "").trim();
  const options = [
    headerValue(head, "제목"),
    headerValue(head, "레포"),
    topic ? `${kindWord} · ${topic}` : "",
    [shortAuthor(author), firstBodyLine(md)].filter(Boolean).join(" · "),
    heading !== "원문 수집" ? heading : "",
  ];
  return (options.find(Boolean) ?? runId).slice(0, 120);
}

export function parseRunSourceHeader(md: string, runId: string): RunSourceHeader {
  const head = headerBlock(md);
  const heading = md.trimStart().split("\n", 1)[0].replace(/^#\s*/, "").trim();
  const url = headerValue(head, "URL") || headerValue(head, "링크");
  const author = headerValue(head, "작성자") || undefined;
  const date = localDateOf(headerValue(head, "수집")) || (runId.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? "");
  return {
    url: /^https?:\/\//.test(url) ? url : undefined,
    title: pickTitle(md, head, heading, author, runId),
    author,
    date,
    heading,
  };
}

/**
 * url 비교 열쇠. X 게시물은 상태 번호만 (x.com/twitter.com, 핸들 대소문자, /i/web 경로가 달라도 같은 글),
 * 그 밖은 스킴·www·쿼리·조각·끝 슬래시를 떼고 소문자.
 */
export function normalizeSourceUrl(u: string | undefined): string {
  const raw = (u ?? "").trim();
  if (!raw) return "";
  const status = raw.match(/^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/(?:[^/]+|i\/web)\/status(?:es)?\/(\d+)/i);
  if (status) return `x:${status[1]}`;
  return raw
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "");
}

/**
 * replies.md 에서 원글 작성자 본인이 단 답글만 (다른 사람 답글은 질문·잡담이라 근거가 아니다).
 * 줄 모양: "- @handle (원글 작성자 셀프 답글) (♥1): 본문".
 */
export function authorFollowUps(repliesMd: string): string[] {
  return repliesMd
    .split("\n")
    .filter((l) => l.includes("(원글 작성자 셀프 답글)"))
    .map((l) => l.replace(/^-\s*/, "").trim())
    .filter((l) => l.replace(/^.*?\):\s*/, "").trim().length > 0);
}

export interface Dedupable {
  id: string;
  url?: string;
  text: string;
}

/**
 * 같은 원문(정규화 url)이 여러 번 있으면 한 건만 남긴다. 본문이 긴 쪽이 이긴다 (같으면 먼저 온 쪽).
 * url 이 없는 문서는 그대로 둔다. 순서는 이긴 문서의 첫 등장 자리.
 */
export function dedupeByUrl<T extends Dedupable>(docs: readonly T[]): T[] {
  const best = new Map<string, T>();
  for (const d of docs) {
    const k = normalizeSourceUrl(d.url);
    if (!k) continue;
    const cur = best.get(k);
    if (!cur || d.text.length > cur.text.length) best.set(k, d);
  }
  return docs.filter((d) => {
    const k = normalizeSourceUrl(d.url);
    return !k || best.get(k) === d;
  });
}
