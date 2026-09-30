import { describe, expect, it } from "vitest";
import { fixLengths } from "./length-fix";
import { assignRoles, fitsRole, lengthMisses, lengthPlan, longMin, roleForLength, shortMax } from "./length-plan";
import type { DraftOption } from "./model";

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe("lengthPlan", () => {
  it("상황별 답이 충분하면 그 분포의 p25·p90 으로 잰다", () => {
    const plan = lengthPlan(range(10, 109), range(1, 5))!;
    expect(plan.short).toBe(35);
    expect(plan.long).toBe(105); // p90=99 이지만 짧게의 3배(105)보다는 길게
    expect(plan.n).toBe(100);
  });
  it("상황별 표본이 적으면 전체 답으로 잰다", () => {
    const plan = lengthPlan([200, 210], range(10, 109))!;
    expect(plan.n).toBe(100);
  });
  it("답이 거의 없으면 null", () => {
    expect(lengthPlan([], [10, 20])).toBeNull();
  });
  it("길게 목표는 420자를 넘지 않는다", () => {
    expect(lengthPlan(range(100, 900), [])!.long).toBe(420);
  });
});

describe("역할 판정", () => {
  const plan = { short: 20, mid: 43, long: 107, n: 35 };
  it("짧게는 p25 의 1.4배(또는 +10자)까지, 길게는 p90 의 70%부터", () => {
    expect(shortMax(plan)).toBe(30);
    expect(longMin(plan)).toBe(75);
    expect(fitsRole(30, "short", plan)).toBe(true);
    expect(fitsRole(31, "short", plan)).toBe(false);
    expect(fitsRole(74, "long", plan)).toBe(false);
    expect(fitsRole(75, "long", plan)).toBe(true);
    expect(roleForLength(50, plan)).toBe("mid");
  });
  it("카테고리 중앙 길이 순으로 짧게·중간·길게", () => {
    expect(assignRoles([37, 7, 106])).toEqual(["mid", "short", "long"]);
    expect(assignRoles([30, 10])).toEqual(["long", "short"]);
    expect(assignRoles([30])).toEqual(["mid"]);
  });
  it("역할을 못 지킨 벌만 고른다 (중간은 보지 않는다)", () => {
    expect(lengthMisses(["가".repeat(50), "나".repeat(10), "다".repeat(60)], ["short", "mid", "long"], plan)).toEqual([0, 2]);
  });
});

describe("fixLengths", () => {
  const plan = { short: 20, mid: 43, long: 107, n: 35 };
  const opt = (id: string, n: number): DraftOption => ({ categoryId: id, categoryName: id, draft: "가".repeat(n), sentences: [] });
  it("못 지킨 벌만 다시 쓰고, 더 가까워졌을 때만 바꾼다", async () => {
    const calls: number[] = [];
    const out = await fixLengths([opt("a", 50), opt("b", 40), opt("c", 60)], ["short", "mid", "long"], plan, async (i) => {
      calls.push(i);
      return i === 0 ? opt("a", 18) : opt("c", 40); // c 는 더 멀어짐
    });
    expect(calls).toEqual([0, 2]);
    expect(out[0].draft.length).toBe(18);
    expect(out[0].lengthRole).toBe("short");
    expect(out[2].draft.length).toBe(60);
  });
  it("다시 쓰기가 실패해도 앞 벌을 둔다, 시간 초과는 올린다", async () => {
    const out = await fixLengths([opt("a", 50)], ["short"], plan, async () => {
      throw new Error("세션 없음");
    });
    expect(out[0].draft.length).toBe(50);
    await expect(fixLengths([opt("a", 50)], ["short"], plan, async () => Promise.reject(new Error("시간 초과")))).rejects.toThrow("시간 초과");
  });
});
