import { describe, expect, it } from "vitest";
import { closingPostText, formatThreadPostParagraphs } from "./threads-link-text";

describe("formatThreadPostParagraphs", () => {
  it("groups long prose into readable two-sentence paragraphs", () => {
    const text = "첫 문장입니다. 두 번째 문장입니다. 세 번째 문장입니다. 네 번째 문장입니다.";
    expect(formatThreadPostParagraphs(text)).toBe(
      "첫 문장입니다. 두 번째 문장입니다.\n\n세 번째 문장입니다. 네 번째 문장입니다."
    );
  });

  it("preserves numbered headings and explicit paragraph boundaries", () => {
    const text =
      "1. 모델 전체를 다시 학습할 필요는 없습니다.\n\nLoRA를 붙일 수 있습니다. 비용도 줄어듭니다.";
    expect(formatThreadPostParagraphs(text)).toBe(text);
  });

  it("keeps compact list lines together", () => {
    const text = "- 첫 항목\n- 둘째 항목\n- 셋째 항목";
    expect(formatThreadPostParagraphs(text)).toBe(text);
  });

  it("normalizes excessive blank lines without changing words", () => {
    expect(formatThreadPostParagraphs("첫 문단입니다.\n\n\n\n둘째 문단입니다.")).toBe(
      "첫 문단입니다.\n\n둘째 문단입니다."
    );
  });

  it("turns a single entered line break into visible paragraph spacing", () => {
    expect(formatThreadPostParagraphs("첫 문단입니다.\n둘째 문단입니다.")).toBe(
      "첫 문단입니다.\n\n둘째 문단입니다."
    );
  });
});

describe("closingPostText", () => {
  it("drops the link line from the last post", () => {
    const posts = ["첫 칸", "저라면 수집 스크립트부터 고쳐보겠습니다. 오늘 /effort low로 시작해보세요.\n\n링크: https://x.com/a/status/1"];
    expect(closingPostText(posts)).toBe("저라면 수집 스크립트부터 고쳐보겠습니다. 오늘 /effort low로 시작해보세요.");
  });

  it("uses the previous post when the last post is only a link", () => {
    const posts = ["첫 칸", "저라면 대시보드에 붙여보겠습니다. 다음 작업을 low로 시작해보세요.", "링크: https://x.com/a/status/1"];
    expect(closingPostText(posts)).toBe("저라면 대시보드에 붙여보겠습니다. 다음 작업을 low로 시작해보세요.");
  });

  it("returns an empty string for an empty thread", () => {
    expect(closingPostText([])).toBe("");
  });
});
