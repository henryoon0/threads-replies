import { describe, expect, it } from "vitest";
import {
  checkCategoryDraft,
  chooseExampleLabels,
  computeShares,
  endingOf,
  measureReplies,
  membersByCategory,
  parseCategoriesFile,
  statsLine,
} from "./categories";

const LONG_PROMPT = "목표: 짧게 받는다. ".repeat(40);

function cat(id: string, extra: Record<string, unknown> = {}) {
  return { id, name: `${id} 유형 이름`, when: "감사 댓글일 때", prompt: LONG_PROMPT, exampleIds: [], ...extra };
}

const SIX = ["a", "b", "c", "d", "e", "f"];

describe("measureReplies", () => {
  it("길이 중앙값·90%·첫 마디·끝맺음·버릇 비율을 잰다", () => {
    const s = measureReplies(["감사합니다 ㅎㅎ", "감사해요 💌", "네 맞아요 !", "헐 대박..", "감사합니다!!!"]);
    expect(s.count).toBe(5);
    expect(s.lengthMedian).toBe(7); // 6·6·7·8·8 → 중앙 7
    expect(s.lengthP90).toBe(8);
    expect(s.firstWords[0]).toEqual({ word: "감사합니다", count: 2 });
    expect(s.endings.map((e) => e.ending)).toContain("이모지");
    expect(s.habits["이모지"]).toBe(20);
    expect(s.habits["띄운 느낌표"]).toBe(20);
    expect(s.habits["ㅋㅋ·ㅎㅎ"]).toBe(20);
    expect(statsLine(s)).toContain("길이 중앙값 7자, 90%가 8자 안");
  });

  it("끝맺음 분류", () => {
    expect(endingOf("좋아요 🥰")).toBe("이모지");
    expect(endingOf("최고 !!!")).toBe("느낌표 셋 이상");
    expect(endingOf("참고해-")).toBe("끝 -");
    expect(endingOf("그렇죠..")).toBe("말줄임 ..");
    expect(endingOf("네 맞아요")).toBe("요");
  });

  it("빈 목록이면 0", () => {
    expect(measureReplies([])).toMatchObject({ count: 0, lengthMedian: 0, lengthP90: 0 });
  });
});

describe("checkCategoryDraft", () => {
  const labels = ["p001", "p002", "p003", "p004"];
  const all = (id = "a") => Object.fromEntries(labels.map((l) => [l, id]));

  it("6~12개 · 모든 답 배정이면 통과", () => {
    const c = checkCategoryDraft({ categories: SIX.map((id) => cat(id)), assignments: all() }, labels);
    expect(c.errors).toEqual([]);
    expect(c.categories).toHaveLength(6);
    expect(c.assignments.get("p001")).toBe("a");
  });

  it("개수가 모자라면 오류", () => {
    const c = checkCategoryDraft({ categories: [cat("a"), cat("b")], assignments: all() }, labels);
    expect(c.errors.join()).toMatch(/2개/);
  });

  it("id 중복·짧은 지시문은 오류, kebab 아닌 id 는 고치고 경고", () => {
    const c = checkCategoryDraft(
      { categories: [...SIX.map((id) => cat(id)), cat("a"), cat("Quick Thanks"), cat("g", { prompt: "짧음" })], assignments: all() },
      labels
    );
    expect(c.errors.join()).toMatch(/id 중복: a/);
    expect(c.errors.join()).toMatch(/지시문이 2자로 짧음/);
    expect(c.categories.map((x) => x.id)).toContain("quick-thanks");
    expect(c.warnings.join()).toMatch(/quick-thanks/);
  });

  it("10% 넘게 배정이 빠지면 오류, 그 이하는 경고", () => {
    const missing = checkCategoryDraft({ categories: SIX.map((id) => cat(id)), assignments: { p001: "a", p002: "zzz" } }, labels);
    expect(missing.errors.join()).toMatch(/분류 안 된 답 3\/4/);
    const many = Array.from({ length: 20 }, (_, i) => `p${i}`);
    const few = checkCategoryDraft(
      { categories: SIX.map((id) => cat(id)), assignments: Object.fromEntries(many.slice(1).map((l) => [l, "b"])) },
      many
    );
    expect(few.errors).toEqual([]);
    expect(few.warnings.join()).toMatch(/분류 안 된 답 1개/);
  });

  it("배정은 [라벨, id] 배열 모양도 받는다", () => {
    const c = checkCategoryDraft({ categories: SIX.map((id) => cat(id)), assignments: labels.map((l) => [l, "c"]) }, labels);
    expect(c.assignments.get("p004")).toBe("c");
    expect(c.errors).toEqual([]);
  });
});

describe("비율·예시", () => {
  it("비율 = 소속 수 / 전체 (소수 첫째 자리), 없는 카테고리를 가리킨 배정은 빠진다", () => {
    const assignments = new Map([
      ["p1", "a"],
      ["p2", "a"],
      ["p3", "b"],
      ["p4", "ghost"],
    ]);
    const members = membersByCategory(assignments, ["a", "b", "c"]);
    expect(members.get("a")).toEqual(["p1", "p2"]);
    expect(members.get("c")).toEqual([]);
    const shares = computeShares(members, 6);
    expect(shares.get("a")).toBe(33.3);
    expect(shares.get("b")).toBe(16.7);
    expect(shares.get("c")).toBe(0);
  });

  it("예시: 모델이 고른 소속 답 먼저, 모자라면 길이 중앙값 가까운 소속 답으로 4개까지", () => {
    const lens: Record<string, number> = { p1: 10, p2: 50, p3: 12, p4: 11, p5: 90, p6: 13 };
    const got = chooseExampleLabels(["p2", "p9"], ["p1", "p2", "p3", "p4", "p5", "p6"], (l) => lens[l]);
    expect(got[0]).toBe("p2");
    expect(got).toHaveLength(4);
    expect(got).not.toContain("p9");
    expect(got).not.toContain("p5");
  });

  it("소속이 4개보다 적으면 전부, 모델이 8개 넘게 고르면 8개", () => {
    expect(chooseExampleLabels([], ["p1", "p2"], () => 1)).toEqual(["p1", "p2"]);
    const ten = Array.from({ length: 10 }, (_, i) => `p${i}`);
    expect(chooseExampleLabels(ten, ten, () => 1)).toHaveLength(8);
  });
});

describe("parseCategoriesFile", () => {
  it("3개 미만이면 null (3벌을 못 만든다)", () => {
    expect(parseCategoriesFile({ categories: [cat("a"), cat("b")] })).toBeNull();
    expect(parseCategoriesFile(null)).toBeNull();
  });

  it("빠진 칸을 채운다", () => {
    const f = parseCategoriesFile({ categories: [cat("a", { share: "12.5" }), cat("b"), cat("c", { exampleIds: [1, 2] })] });
    expect(f?.categories[0].share).toBe(12.5);
    expect(f?.categories[1].share).toBe(0);
    expect(f?.categories[2].exampleIds).toEqual(["1", "2"]);
  });
});
