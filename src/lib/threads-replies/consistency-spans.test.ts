import { describe, expect, it } from "vitest";
import { findConflicts, withConsistency } from "./consistency";
import { isVerbatim, normalizeConflicts, PAST_HIT_KIND, remapHits, sentenceSpans, withPastHits } from "./consistency-spans";
import type { PastSaid, ReplyAnswer } from "./model";

const past: PastSaid[] = [
  { id: "r1", text: "마그네슘은 저녁에 드시는 게 좋아요. 잠드는 데 도움이 돼요.", date: "2026-08-01", permalink: "https://threads.com/p/1" },
  { id: "r2", text: "클로드 프로는 월 20달러예요" },
];

describe("sentenceSpans", () => {
  it("문장 위치를 원문 그대로 돌려준다", () => {
    const text = "네 맞아요!  아침에 드세요.\n궁금하면 또 물어봐요";
    const spans = sentenceSpans(text);
    expect(spans.map((s) => s.text)).toEqual(["네 맞아요!", "아침에 드세요.", "궁금하면 또 물어봐요"]);
    for (const s of spans) expect(text.slice(s.start, s.end)).toBe(s.text);
  });
  it("글자 없는 조각(이모지·물결만)은 버린다", () => {
    expect(sentenceSpans("~~ 좋아요 ㅎㅎ").map((s) => s.text)).toEqual(["좋아요 ㅎㅎ"]);
  });
});

describe("isVerbatim", () => {
  it("예전 답에 그대로 있는 구절만 인정한다 (공백·따옴표 차이는 봐준다)", () => {
    expect(isVerbatim("“저녁에   드시는 게 좋아요”", past[0].text)).toBe(true);
    expect(isVerbatim("아침에 드시는 게 좋아요", past[0].text)).toBe(false);
    expect(isVerbatim("저녁", past[0].text)).toBe(false); // 너무 짧음
  });
});

describe("normalizeConflicts", () => {
  const drafts = [
    { key: "A", text: "네! 마그네슘은 아침 공복에 드세요. 흡수가 좋아요." },
    { key: "B", text: "짧게 말하면 아침이요" },
  ];
  it("있는 문장·있는 예전 답·원문 구절만 남긴다", () => {
    const raw = {
      conflicts: [
        { sentence: "A2", past: "P1", quote: "저녁에 드시는 게 좋아요", note: "예전엔 저녁이라고 했어요" },
        { sentence: "A2", past: "P1", quote: "저녁에 드시는 게 좋아요", note: "중복" },
        { sentence: "B1", past: "P1", quote: "아침이 좋다고 했어요", note: "지어낸 예전 답" },
        { sentence: "A9", past: "P1", quote: "저녁에 드시는 게 좋아요" },
        { sentence: "B1", past: "P7", quote: "저녁에 드시는 게 좋아요" },
      ],
    };
    const out = normalizeConflicts(raw, drafts, past);
    expect(out.B).toEqual([]);
    expect(out.A).toHaveLength(1);
    const hit = out.A[0];
    expect(drafts[0].text.slice(hit.sentenceStart, hit.sentenceEnd)).toBe("마그네슘은 아침 공복에 드세요.");
    expect(hit.past).toEqual({ text: "저녁에 드시는 게 좋아요", date: "2026-08-01", permalink: "https://threads.com/p/1" });
    expect(hit.note).toBe("예전엔 저녁이라고 했어요");
  });
  it("모양이 틀린 답은 빈 결과", () => {
    expect(normalizeConflicts(null, drafts, past)).toEqual({ A: [], B: [] });
    expect(normalizeConflicts({ conflicts: "x" }, drafts, past)).toEqual({ A: [], B: [] });
  });
});

describe("칠하기", () => {
  const text = "네! 마그네슘은 아침 공복에 드세요.";
  const hit = { sentenceStart: 3, sentenceEnd: text.length, past: { text: "저녁에 드시는 게 좋아요" }, note: "다름" };
  it("관문 칠하기와 겹치면 관문을 살리고, 보내기 상태는 바꾸지 않는다", () => {
    const pass = withPastHits({ status: "pass", hits: [] }, [hit], text);
    expect(pass.status).toBe("pass");
    expect(pass.hits[0]).toMatchObject({ kind: PAST_HIT_KIND, start: 3, action: "check", past: hit.past });
    const gated = withPastHits({ status: "block", hits: [{ start: 5, end: 8, phrase: "x", kind: "k", action: "block", reason: "r" }] }, [hit], text);
    expect(gated.hits).toHaveLength(1);
  });
  it("글이 바뀌면 같은 문장을 새 위치로 옮기고, 사라진 문장은 버린다", () => {
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
    draft: "마그네슘은 아침에 드세요.",
    model: "m",
    generatedAt: "2026-09-29T00:00:00Z",
    styleExamples: 0,
    chosen: 0,
    options: [
      { categoryId: "a", categoryName: "a", draft: "마그네슘은 아침에 드세요.", sentences: [] },
      { categoryId: "b", categoryName: "b", draft: "저녁이 좋아요", sentences: [] },
    ],
    pastSaid: past,
  };
  it("예전 답이 없으면 모델을 부르지 않는다", async () => {
    let called = false;
    const out = await findConflicts("주인", [{ key: "A", text: "글" }], [], async () => ((called = true), "{}"));
    expect(called).toBe(false);
    expect(out).toEqual({ A: [] });
  });
  it("벌마다 붙이고, 고른 벌 결과를 완성된 답에도 둔다. 실패하면 초안 그대로", async () => {
    const run = async () => JSON.stringify({ conflicts: [{ sentence: "A1", past: "P1", quote: "저녁에 드시는 게 좋아요", note: "다름" }] });
    const out = await withConsistency(answer, "주인-테스트1", run);
    expect(out.options![0].consistency).toHaveLength(1);
    expect(out.options![1].consistency).toEqual([]);
    expect(out.consistency).toHaveLength(1);
    expect(out.consistencyFor).toBe(answer.draft);
    const failed = await withConsistency(answer, "주인-테스트2", async () => Promise.reject(new Error("x")));
    expect(failed).toBe(answer);
  });
});
