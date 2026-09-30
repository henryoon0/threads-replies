import { describe, expect, it } from "vitest";
import {
  MAX_POST_CHARS,
  countChars,
  clampChars,
  splitToLimit,
  buildRevisionSnapshot,
  isGenerationMode,
  isXUrl,
  detectLinkTopic,
  repairLinkTopic,
} from "./content-ideas-model";

const noWs = (s: string) => s.replace(/\s+/g, "");

describe("countChars", () => {
  it("counts Hangul syllables as one each", () => {
    expect(countChars("안녕하세요")).toBe(5);
    expect(countChars("")).toBe(0);
  });

  it("counts an emoji as one grapheme, not its UTF-16 length", () => {
    // The exact bug class String.length gets wrong: "👍".length === 2.
    expect("👍".length).toBe(2);
    expect(countChars("👍")).toBe(1);
  });

  it("counts whitespace and newlines", () => {
    expect(countChars("a b\nc")).toBe(5);
  });
});

describe("clampChars", () => {
  it("leaves text at or under the limit untouched", () => {
    expect(clampChars("가나다", 5)).toBe("가나다");
    const exact = "가".repeat(MAX_POST_CHARS);
    expect(clampChars(exact)).toBe(exact);
  });

  it("truncates over-limit text to exactly the limit (grapheme-aware)", () => {
    const clamped = clampChars("가".repeat(600));
    expect(countChars(clamped)).toBe(MAX_POST_CHARS);
  });
});

describe("splitToLimit", () => {
  it("returns the text unchanged when it already fits", () => {
    expect(splitToLimit("짧은 글입니다.")).toEqual(["짧은 글입니다."]);
    const exact = "가".repeat(MAX_POST_CHARS);
    expect(splitToLimit(exact)).toEqual([exact]);
  });

  it("every produced piece is within the 500-char cap", () => {
    const sentences = Array.from(
      { length: 80 },
      (_, i) => `이것은 길이 제한을 확인하기 위한 ${i}번째 문장입니다.`
    ).join(" ");
    expect(countChars(sentences)).toBeGreaterThan(MAX_POST_CHARS);

    const pieces = splitToLimit(sentences);
    expect(pieces.length).toBeGreaterThan(1);
    for (const p of pieces) {
      expect(countChars(p)).toBeLessThanOrEqual(MAX_POST_CHARS);
    }
  });

  it("loses no characters (content is preserved, only whitespace at seams differs)", () => {
    const sentences = Array.from(
      { length: 80 },
      (_, i) => `이것은 길이 제한을 확인하기 위한 ${i}번째 문장입니다.`
    ).join(" ");
    const pieces = splitToLimit(sentences);
    expect(noWs(pieces.join(""))).toBe(noWs(sentences));
  });

  it("ends each piece on a complete sentence when splitting prose", () => {
    const sentences = Array.from(
      { length: 80 },
      (_, i) => `이것은 길이 제한을 확인하기 위한 ${i}번째 문장입니다.`
    ).join(" ");
    for (const p of splitToLimit(sentences)) {
      expect(p.trimEnd().endsWith(".")).toBe(true);
    }
  });

  it("splits multi-paragraph text at blank-line boundaries first", () => {
    const para = (n: number) =>
      Array.from({ length: 12 }, (_, i) => `${n}-${i}번 문장입니다.`).join(" ");
    const text = [para(1), para(2), para(3), para(4)].join("\n\n");
    expect(countChars(text)).toBeGreaterThan(MAX_POST_CHARS);
    const pieces = splitToLimit(text);
    for (const p of pieces) {
      expect(countChars(p)).toBeLessThanOrEqual(MAX_POST_CHARS);
    }
    expect(noWs(pieces.join(""))).toBe(noWs(text));
  });

  it("Given 한 문장이 살짝 넘치는 게시물 When 분할하면 Then 고아 꼬리(초단문 칸) 대신 균형 분할한다", () => {
    // 08-11 실사고: 514자 게시물이 480자+34자로 쪼개져 34자짜리 칸이 게시됨.
    const sentences = Array.from(
      { length: 16 },
      (_, i) => `이것은 게시물 분할 균형을 확인하기 위한 ${i}번째 문장입니다.`
    ).join(" ");
    const tail = "그 정도의 고생을 다시는 안 겪을 경로까지요.";
    const text = `${sentences} ${tail}`;
    expect(countChars(text)).toBeGreaterThan(MAX_POST_CHARS);
    const pieces = splitToLimit(text);
    expect(pieces.length).toBeGreaterThan(1);
    for (const p of pieces) {
      expect(countChars(p)).toBeLessThanOrEqual(MAX_POST_CHARS);
      expect(countChars(p)).toBeGreaterThanOrEqual(100); // 고아 꼬리 금지
    }
    expect(noWs(pieces.join(""))).toBe(noWs(text)); // 내용 보존
  });

  it("hard-cuts a single boundary-less token (e.g. a long URL) as a last resort", () => {
    const giant = "x".repeat(1200);
    const pieces = splitToLimit(giant);
    expect(pieces.length).toBe(3);
    for (const p of pieces) {
      expect(countChars(p)).toBeLessThanOrEqual(MAX_POST_CHARS);
    }
    expect(pieces.join("")).toBe(giant);
  });
});

describe("buildRevisionSnapshot (DAS-38)", () => {
  const prev = ["칸1", "칸2"];
  const at = "2026-06-15T00:00:00.000Z";

  it("makes a bare snapshot for a plain manual edit (no feedback)", () => {
    expect(buildRevisionSnapshot(prev, at)).toEqual({ at, posts: prev });
    // Empty / whitespace feedback is treated as no feedback.
    expect(buildRevisionSnapshot(prev, at, { feedback: "   " })).toEqual({
      at,
      posts: prev,
    });
  });

  it("attaches thread-scoped feedback as the learning signal", () => {
    const snap = buildRevisionSnapshot(prev, at, {
      feedback: "톤이 딱딱해요",
      scope: "thread",
    });
    expect(snap).toEqual({
      at,
      posts: prev,
      feedback: "톤이 딱딱해요",
      scope: "thread",
    });
    // No postIndex leaks in for thread scope.
    expect("postIndex" in snap).toBe(false);
  });

  it("keeps postIndex for post-scoped feedback that named a 칸", () => {
    const snap = buildRevisionSnapshot(prev, at, {
      feedback: "후크가 약해요",
      scope: "post",
      postIndex: 0,
    });
    expect(snap).toEqual({
      at,
      posts: prev,
      feedback: "후크가 약해요",
      scope: "post",
      postIndex: 0,
    });
  });

  it("trims feedback and omits postIndex when post scope named no 칸", () => {
    const snap = buildRevisionSnapshot(prev, at, {
      feedback: "  더 구체적으로  ",
      scope: "post",
    });
    expect(snap.feedback).toBe("더 구체적으로");
    expect("postIndex" in snap).toBe(false);
  });
});

describe("isGenerationMode", () => {
  it("accepts the two known modes", () => {
    expect(isGenerationMode("thread")).toBe(true);
    expect(isGenerationMode("single")).toBe(true);
  });

  it("rejects anything else (so the API can default to thread)", () => {
    expect(isGenerationMode("")).toBe(false);
    expect(isGenerationMode("multi")).toBe(false);
    expect(isGenerationMode(undefined)).toBe(false);
    expect(isGenerationMode(null)).toBe(false);
    expect(isGenerationMode(1)).toBe(false);
  });
});

describe("isXUrl (link-thread 잡 분기)", () => {
  it("accepts a single x.com/twitter.com status link, with or without query", () => {
    expect(isXUrl("https://x.com/addyosmani/status/2074927530482835916")).toBe(true);
    expect(isXUrl("  https://x.com/levie/status/2074719479377109312?s=20  ")).toBe(true);
    expect(isXUrl("https://twitter.com/someone/status/123")).toBe(true);
  });

  it("rejects pasted text that merely contains a link, and non-status URLs", () => {
    expect(isXUrl("이 글 봐줘 https://x.com/a/status/123")).toBe(false);
    expect(isXUrl("https://x.com/a/status/123\n본문 텍스트")).toBe(false);
    expect(isXUrl("https://x.com/addyosmani")).toBe(false); // 프로필
    expect(isXUrl("https://example.com/status/123")).toBe(false);
    expect(isXUrl("")).toBe(false);
  });
});

describe("detectLinkTopic (수집 경로 라우팅)", () => {
  it("routes X status links to the browser path, general articles to web fetch", () => {
    expect(detectLinkTopic("https://x.com/a/status/123")).toBe("x");
    expect(detectLinkTopic("https://simonwillison.net/2026/Jul/8/rewriting-bun/")).toBe("web");
    expect(detectLinkTopic("  https://blog.example.com/post?utm=1  ")).toBe("web");
  });

  it("returns null for plain text, youtube (미지원), and non-status X links", () => {
    expect(detectLinkTopic("그냥 텍스트 소재")).toBe(null);
    expect(detectLinkTopic("https://www.youtube.com/watch?v=abc")).toBe(null);
    expect(detectLinkTopic("https://youtu.be/abc")).toBe(null);
    expect(detectLinkTopic("https://x.com/addyosmani")).toBe(null); // 프로필
    expect(detectLinkTopic("링크 포함 텍스트 https://a.com/b")).toBe(null);
  });
});

describe("repairLinkTopic (겹쳐 붙은 링크 복구)", () => {
  it("recovers the embedded status URL from an interleaved double paste (실사고 2026-08-10)", () => {
    const mangled =
      "https://x.com/thedankhttps://x.com/thedankoe/status/2086197754452377955oe/status/2086197754452377955";
    expect(repairLinkTopic(mangled)).toBe(
      "https://x.com/thedankoe/status/2086197754452377955"
    );
    expect(detectLinkTopic(repairLinkTopic(mangled))).toBe("x");
    // 단순 이어붙임(커서가 맨 끝)도 첫 완전한 URL로 복구된다.
    expect(
      repairLinkTopic("https://x.com/a/status/123https://x.com/a/status/123")
    ).toBe("https://x.com/a/status/123");
  });

  it("leaves valid links, plain text, and body-with-link topics untouched", () => {
    expect(repairLinkTopic("https://x.com/a/status/123")).toBe("https://x.com/a/status/123");
    expect(repairLinkTopic("https://blog.example.com/post")).toBe(
      "https://blog.example.com/post"
    );
    expect(repairLinkTopic("그냥 텍스트 소재")).toBe("그냥 텍스트 소재");
    expect(repairLinkTopic("이 글 봐줘 https://x.com/a/status/123")).toBe(
      "이 글 봐줘 https://x.com/a/status/123"
    );
    expect(repairLinkTopic("")).toBe("");
  });
});
