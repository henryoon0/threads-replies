import { describe, expect, it } from "vitest";
import type { ReplyCategory } from "@/lib/personas/categories";
import { nextDistinctCategory, offendingIndex, pickDiverseCategories, samenessReport, targetTraits, tooSimilar } from "./diversity";

function cat(id: string, len: number, ending: string, emoji = 0, laugh = 0, sentences = 1): ReplyCategory {
  return {
    id,
    name: id,
    when: "",
    share: 10,
    prompt: "",
    exampleIds: [],
    stats: { count: 5, lengthMedian: len, lengthP90: len * 2, sentencesMedian: sentences, firstWords: [{ word: "네", count: 2 }], endings: [{ ending, pct: 50 }], habits: { 이모지: emoji, "ㅋㅋ·ㅎㅎ": laugh } },
  };
}

describe("diversity", () => {
  it("같은 길이 구간·첫 마디·끝맺음이면 닮았다", () => {
    expect(tooSimilar("네 가능해요 !", "네 됩니다 !")).toBe(true);
    expect(tooSimilar("네 가능해요 !", "ㅋㅋㅋ 저도 궁금했어요 🥺")).toBe(false);
    expect(tooSimilar("네 맞아요 API 대신 화면을 보고 클릭한대요!", "네 맞아요 🙂")).toBe(true);
    expect(offendingIndex(["네 가능해요 !", "ㅋㅋ 저도요 🥺", "네 됩니다 !"])).toBe(2);
    expect(offendingIndex(["a b c", "ㅋㅋ 저도요 🥺"])).toBe(-1);
  });

  it("닮음 지표", () => {
    const r = samenessReport(["네 가능해요 !", "네 됩니다 !", "ㅋㅋ 저도요 🥺"]);
    expect(r).toMatchObject({ sameFirstWordPairs: 1, sameEndingPairs: 1, emojiOptions: 1, laughOptions: 1, similarPairs: 1 });
  });

  it("가장 잘 맞는 것 + 말투가 먼 둘을 고른다", () => {
    const ranked = [cat("a", 30, "느낌표"), cat("b", 32, "느낌표"), cat("c", 8, "이모지", 80), cat("d", 150, "마침표", 0, 0, 5)];
    expect(pickDiverseCategories(ranked, 3).map((c) => c.id)).toEqual(["a", "d", "c"]);
    expect(nextDistinctCategory(ranked, ["a", "c", "d"])?.id).toBe("b");
    expect(nextDistinctCategory(ranked, ["a", "b", "c", "d"])).toBeNull();
  });

  it("목표 특징 한 줄", () => {
    expect(targetTraits(cat("c", 8, "이모지", 80))).toContain("이모지 하나를 쓴다");
    expect(targetTraits(cat("d", 150, "마침표"))).toContain("이모지는 쓰지 않는다");
  });
});
