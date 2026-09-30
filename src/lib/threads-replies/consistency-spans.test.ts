import { describe, expect, it } from "vitest";
import { findConflicts, withConsistency } from "./consistency";
import { isVerbatim, normalizeConflicts, remapHits, sentenceSpans } from "./consistency-spans";
import type { PastSaid, ReplyAnswer } from "./model";

const past: PastSaid[] = [
  { id: "r1", text: "릴스는 저녁에 올리는 게 좋아요. 반응이 더 빨리 와요.", date: "2026-08-01", permalink: "https://example.com/p/1" },
  { id: "r2", text: "그 도구는 월 20달러예요" },
];

describe("sentenceSpans", () => {
  it("문장 위치를 원문 그대로 돌려준다", () => {
    const text = "네 맞아요!  아침에 올려요.\n궁금하면 또 물어봐요";
    const spans = sentenceSpans(text);
    expect(spans.map((s) => s.text)).toEqual(["네 맞아요!", "아침에 올려요.", "궁금하면 또 물어봐요"]);
    for (const s of spans) expect(text.slice(s.start, s.end)).toBe(s.text);
  });
});

describe("isVerbatim", () => {
  it("예전 답에 그대로 있는 구절만 인정한다", () => {
    expect(isVerbatim("“저녁에   올리는 게 좋아요”", past[0].text)).toBe(true);
    expect(isVerbatim("아침에 올리는 게 좋아요", past[0].text)).toBe(false);
    expect(isVerbatim("저녁", past[0].text)).toBe(false);
  });
});

describe("normalizeConflicts", () => {
  const drafts = [{ key: "A", text: "네! 릴스는 아침에 올리세요. 반응이 좋아요." }];
  it("있는 문장·있는 예전 답·원문 구절만 남긴다", () => {
    const raw = {
      conflicts: [
        { sentence: "A2", past: "P1", quote: "저녁에 올리는 게 좋아요", note: "예전엔 저녁이라고 했어요" },
        { sentence: "A2", past: "P1", quote: "저녁에 올리는 게 좋아요", note: "중복" },
        { sentence: "A1", past: "P1", quote: "아침이 좋다고 했어요", note: "지어낸 예전 답" },
        { sentence: "A9", past: "P1", quote: "저녁에 올리는 게 좋아요" },
      ],
    };
    const out = normalizeConflicts(raw, drafts, past);
    expect(out.A).toHaveLength(1);
    expect(drafts[0].text.slice(out.A[0].sentenceStart, out.A[0].sentenceEnd)).toBe("릴스는 아침에 올리세요.");
    expect(out.A[0].past).toEqual({ text: "저녁에 올리는 게 좋아요", date: "2026-08-01", permalink: "https://example.com/p/1" });
  });
  it("모양이 틀린 답은 빈 결과", () => {
    expect(normalizeConflicts(null, drafts, past)).toEqual({ A: [] });
  });
  it("글이 바뀌면 같은 문장을 새 위치로 옮기고, 사라진 문장은 버린다", () => {
    const text = "네! 릴스는 아침에 올리세요.";
    const hit = { sentenceStart: 3, sentenceEnd: text.length, past: { text: "저녁에 올리는 게 좋아요" }, note: "다름" };
    expect(remapHits([hit], text, `안녕하세요. ${text}`)[0].sentenceStart).toBe(10);
    expect(remapHits([hit], text, "완전히 다른 글")).toEqual([]);
  });
});

describe("findConflicts · withConsistency", () => {
  const answer: ReplyAnswer = {
    verdict: "answerable",
    verdictReason: "",
    sources: [],
    sentences: [],
    draft: "릴스는 아침에 올리세요.",
    model: "m",
    generatedAt: "2026-09-29T00:00:00Z",
    styleExamples: 0,
    pastSaid: past,
  };
  it("예전 답이 없으면 모델을 부르지 않는다", async () => {
    let called = false;
    const out = await findConflicts("주인", [{ key: "A", text: "글" }], [], async () => ((called = true), "{}"));
    expect(called).toBe(false);
    expect(out).toEqual({ A: [] });
  });
  it("어긋남을 붙이고, 실패하면 초안 그대로", async () => {
    const run = async () => JSON.stringify({ conflicts: [{ sentence: "A1", past: "P1", quote: "저녁에 올리는 게 좋아요", note: "다름" }] });
    const out = await withConsistency(answer, "주인-테스트1", run);
    expect(out.consistency).toHaveLength(1);
    expect(out.consistencyFor).toBe(answer.draft);
    const failed = await withConsistency(answer, "주인-테스트2", async () => Promise.reject(new Error("x")));
    expect(failed).toBe(answer);
  });
});
