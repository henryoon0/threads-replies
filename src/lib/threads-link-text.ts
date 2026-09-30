const sentenceSegmenter = new Intl.Segmenter("ko", { granularity: "sentence" });
const LIST_LINE_RE = /^(?:[-*•]|(?:\d{1,2}|[①-⑳])[.)])\s+/;
const NUMBER_ONLY_RE = /^\d{1,2}\.$/;

function sentences(text: string): string[] {
  const segments = [...sentenceSegmenter.segment(text)]
    .map(({ segment }) => segment.trim())
    .filter(Boolean);
  const merged: string[] = [];
  for (const segment of segments) {
    if (NUMBER_ONLY_RE.test(segment) && merged.length === 0) {
      merged.push(segment);
      continue;
    }
    const previous = merged.at(-1);
    if (previous && NUMBER_ONLY_RE.test(previous)) {
      merged[merged.length - 1] = `${previous} ${segment}`;
    } else {
      merged.push(segment);
    }
  }
  return merged;
}

function formatBlock(block: string): string {
  const lines = block
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.some((line) => LIST_LINE_RE.test(line))) return lines.join("\n");

  const parts = sentences(lines.join(" "));
  if (parts.length <= 2) return parts.join(" ");

  const paragraphs: string[] = [];
  for (let index = 0; index < parts.length; index += 2) {
    paragraphs.push(parts.slice(index, index + 2).join(" "));
  }
  return paragraphs.join("\n\n");
}

export function formatThreadPostParagraphs(text: string): string {
  const blocks: string[] = [];
  let listLines: string[] = [];
  const flushList = () => {
    if (listLines.length === 0) return;
    blocks.push(listLines.join("\n"));
    listLines = [];
  };
  for (const rawLine of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      flushList();
    } else if (LIST_LINE_RE.test(line)) {
      listLines.push(line);
    } else {
      flushList();
      blocks.push(line);
    }
  }
  flushList();
  return blocks
    .map(formatBlock)
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

// 스레드의 마무리 칸 본문. 마지막 칸의 "링크:" 줄은 빼고, 마지막 칸이 링크 줄뿐이면
// (500자 초과로 링크만 따로 뺀 경우) 그 앞 칸을 마무리로 본다. 관점 벌이 원안의
// 마무리 장면을 피하도록 넘길 때 쓴다.
export function closingPostText(posts: string[]): string {
  const stripLink = (p: string) => p.replace(/^링크:.*$/gm, "").trim();
  const last = stripLink(posts.at(-1) ?? "");
  if (last || posts.length < 2) return last;
  return stripLink(posts.at(-2) ?? "");
}
