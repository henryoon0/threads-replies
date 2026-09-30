import { describe, expect, it } from "vitest";
import { locateVerbatim, queryTerms, selectExcerpt } from "./passage";

describe("locateVerbatim", () => {
  const doc = "첫 줄입니다.\n\nIt runs  locally in Claude Code —\nno API key needed.\n\n“따옴표” 문장.";

  it("returns the quote when it is an exact substring", () => {
    expect(locateVerbatim(doc, "첫 줄입니다.")).toBe("첫 줄입니다.");
  });

  it("tolerates whitespace and line-break differences and returns the real slice", () => {
    const got = locateVerbatim(doc, "It runs locally in Claude Code — no API key needed.");
    expect(got).toBe("It runs  locally in Claude Code —\nno API key needed.");
    expect(doc.includes(got!)).toBe(true);
  });

  it("tolerates curly vs straight quotes", () => {
    const got = locateVerbatim(doc, '"따옴표" 문장.');
    expect(got).toBe("“따옴표” 문장.");
  });

  it("rejects paraphrases and translations", () => {
    expect(locateVerbatim(doc, "Claude Code 안에서 API 키 없이 돌아갑니다.")).toBeNull();
    expect(locateVerbatim(doc, "It runs locally in Claude Code, no API key needed.")).toBeNull();
  });

  it("rejects empty or one-character quotes", () => {
    expect(locateVerbatim(doc, " ")).toBeNull();
    expect(locateVerbatim(doc, "첫")).toBeNull();
  });
});

describe("queryTerms", () => {
  it("keeps Korean words and English tokens and strips common particles", () => {
    const t = queryTerms("Prompt-audit는 api사용 아니어도 써도 되나요.?");
    expect(t).toContain("prompt-audit");
    expect(t).toContain("api");
  });
});

describe("selectExcerpt", () => {
  it("returns short docs whole", () => {
    expect(selectExcerpt("짧은 글", ["글"], 100)).toBe("짧은 글");
  });

  it("keeps the head and the paragraphs that match the terms, in original order", () => {
    const paras = Array.from({ length: 40 }, (_, i) => (i === 30 ? "Blender 로 풍차를 만들었다." : `잡담 문단 ${i} `.repeat(10)));
    const text = "제목\n\n" + paras.join("\n\n");
    const out = selectExcerpt(text, ["blender"], 800);
    expect(out.startsWith("제목")).toBe(true);
    expect(out).toContain("Blender 로 풍차를 만들었다.");
    expect(out.length).toBeLessThanOrEqual(900);
  });
});
