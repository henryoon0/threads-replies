// 성분 페이지(gbrain topics/*.md) 한 조각을 화면용 구조로 푼다. 순수 함수.
// 조각은 페이지 중간에서 잘려 올 수 있으므로, 어떤 줄이 빠져도 남은 것만 돌려준다.

export type BrainItemLabel = "추천" | "용량·타이밍" | "주의점" | "원리" | "경험담" | (string & {});

export interface BrainItem {
  label?: BrainItemLabel;
  speaker?: string;
  text: string;
  link?: { label: string; url: string };
}

export interface BrainSection {
  title: string;
  items: BrainItem[];
}

export interface BrainPage {
  heading?: string;
  slug?: string;
  tags: string[];
  sections: BrainSection[];
  rest: string;
}

const NO_SPEAKER = new Set(["unknown", "guest", "speaker", "host"]);
const MD_LINK = /\[([^\]]*)\]\(([^()\s]+(?:\([^()\s]*\))?)\)/g;

/** 남은 마크다운 기호를 걷어낸 평문 */
function plain(s: string): string {
  return s
    .replace(MD_LINK, "$1")
    .replace(/^#+\s*/, "")
    .replace(/\*\*|__|`/g, "")
    .trim();
}

/** http(s) 주소만 링크로 인정한다 (javascript: 등은 버림) */
export function safeUrl(u: string): string | undefined {
  try {
    const url = new URL(u);
    return url.protocol === "http:" || url.protocol === "https:" ? u : undefined;
  } catch {
    return undefined;
  }
}

type Taken<T> = { value?: T; rest: string };

/** 앞머리 "[추천]" 표시 */
function takeLabel(rest: string): Taken<string> {
  const m = rest.match(/^\[([^\]]+)\]\s*(?!\()/);
  return m ? { value: m[1].trim(), rest: rest.slice(m[0].length) } : { rest };
}

/** 끝의 "([영상 55분](url))" 또는 글 안 첫 링크. http(s) 가 아니면 버린다 */
function takeLink(rest: string): Taken<NonNullable<BrainItem["link"]>> {
  const tail = rest.match(/\s*\(\[([^\]]+)\]\(([^()\s]+(?:\([^()\s]*\))?)\)\)\s*$/);
  const found = tail ? { label: tail[1].trim(), url: tail[2] } : [...rest.matchAll(MD_LINK)].map((m) => ({ label: m[1].trim() || "링크", url: m[2] }))[0];
  const next = tail ? rest.slice(0, tail.index) : rest;
  return found && safeUrl(found.url) ? { value: found, rest: next } : { rest: next };
}

/** 앞머리 "Rhonda Patrick: " (unknown·guest 같은 자리표는 떼기만 한다) */
function takeSpeaker(rest: string): Taken<string> {
  const m = rest.match(/^([^:.!?\n]{1,40}):\s+/);
  if (!m) return { rest };
  const name = m[1].trim();
  return { value: NO_SPEAKER.has(name.toLowerCase()) ? undefined : name, rest: rest.slice(m[0].length) };
}

function parseItem(body: string): BrainItem {
  const label = takeLabel(body.trim());
  const link = takeLink(label.rest);
  const speaker = takeSpeaker(link.rest);
  return {
    text: plain(speaker.rest),
    ...(label.value ? { label: label.value } : {}),
    ...(speaker.value ? { speaker: speaker.value } : {}),
    ...(link.value ? { link: link.value } : {}),
  };
}

/** 앞머리(frontmatter)가 통째로 들어온 경우 건너뛴다 */
function bodyLines(quote: string): string[] {
  const lines = (quote ?? "").replace(/\r\n?/g, "\n").split("\n");
  if (lines[0]?.trim() !== "---") return lines;
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  return end > 0 ? lines.slice(end + 1) : lines;
}

type Reader = { out: BrainPage; rest: string[]; current: BrainSection | null };

function readHeading(r: Reader, line: string): boolean {
  const h1 = line.match(/^#\s+(.+)$/);
  if (h1) {
    const m = h1[1].match(/^(.*?)\s*\(([a-z0-9][a-z0-9-]*)\)\s*$/i);
    r.out.heading = plain(m ? m[1] : h1[1]);
    if (m) r.out.slug = m[2];
    return true;
  }
  const h2 = line.match(/^#{2,6}\s+(.+)$/);
  if (!h2) return false;
  r.current = { title: plain(h2[1]), items: [] };
  r.out.sections.push(r.current);
  return true;
}

function readTags(r: Reader, line: string): boolean {
  const m = line.match(/^이럴 때 찾는다\s*[:：]\s*(.*)$/);
  if (m) r.out.tags.push(...m[1].split(/[,，、]/).map((t) => plain(t)).filter(Boolean));
  return Boolean(m);
}

function readBullet(r: Reader, line: string): boolean {
  const m = line.match(/^[-*+]\s+(.*)$/);
  if (!m) return false;
  if (!r.current) {
    r.current = { title: "", items: [] };
    r.out.sections.push(r.current);
  }
  const item = parseItem(m[1]);
  if (item.text) r.current.items.push(item);
  return true;
}

export function parseBrainPage(quote: string): BrainPage {
  const r: Reader = { out: { tags: [], sections: [], rest: "" }, rest: [], current: null };
  for (const raw of bodyLines(quote)) {
    const line = raw.trim();
    if (!line || readHeading(r, line) || readTags(r, line) || readBullet(r, line)) continue;
    r.rest.push(plain(line));
  }
  const { out } = r;
  out.tags = [...new Set(out.tags)];
  out.sections = out.sections.filter((s) => s.items.length || s.title);
  out.rest = r.rest.filter(Boolean).join("\n");
  return out;
}
