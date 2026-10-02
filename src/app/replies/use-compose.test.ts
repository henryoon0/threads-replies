import { describe, expect, it } from "vitest";
import { firstArrived, pickAction, readPresets, settleWaiting, stillWriting, variantOfDraft, type ComposePresetView } from "./use-compose";

describe("답 버전", () => {
  it("GET 응답에서 모양이 맞는 버전만 읽는다", () => {
    const got = readPresets({ presets: [{ id: "joke", name: "뒤통수 한 방", parts: "드립", count: 3, recommended: true, toggles: { joke: true } }, { id: 1 }, null] });
    expect(got).toEqual([{ id: "joke", name: "뒤통수 한 방", parts: "드립", count: 3, recommended: true, toggles: { joke: true } }]);
    expect(readPresets(null)).toEqual([]);
  });
  it("지금 글이 어느 버전인지 (공백 무시)", () => {
    const vs = [{ key: "a", draft: "첫 글" }, { key: "b", draft: "둘째 글" }];
    expect(variantOfDraft(vs, " 둘째 글\n")?.key).toBe("b");
    expect(variantOfDraft(vs, "")).toBeUndefined();
  });
  it("쓰는 중인 버전만 기다린다", () => {
    expect(stillWriting(["a"], "a")).toBe(true);
    expect(stillWriting(["a"], "b")).toBe(false);
    expect(stillWriting(["*"], "b")).toBe(true);
  });
});

const v = (key: string) => ({ key, draft: key, products: [] }) as never;
const p = (id: string, recommended: boolean) => ({ id, name: id, recommended }) as ComposePresetView;

describe("열 때 화면이 고른 버전: 먼저 써진 추천 버전을 바로 보여 준다 (10-02 henry)", () => {
  it("추천 1순위가 아직이면 먼저 도착한 추천 2순위를 고른다", () => {
    expect(firstArrived([v("b")], [p("a", true), p("b", true), p("c", false)])?.key).toBe("b");
  });
  it("둘 다 있으면 추천 순서대로", () => {
    expect(firstArrived([v("b"), v("a")], [p("a", true), p("b", true)])?.key).toBe("a");
  });
  it("아무것도 안 왔으면 없음", () => {
    expect(firstArrived([], [p("a", true)])).toBeUndefined();
  });
});

describe("기다리던 버전 처리", () => {
  const presets = [p("a", true), p("b", true)];
  it("열 때 고른 것(auto)은 다른 추천이 먼저 와도 바로 보여 준다, 직접 누른 것은 그 버전만 기다린다", () => {
    const fresh = { variants: [v("b")], pending: ["a"] };
    expect(settleWaiting({ id: "a", since: 0, auto: true }, fresh, presets, 1)).toEqual({ show: v("b") });
    expect(settleWaiting({ id: "a", since: 0 }, fresh, presets, 1)).toBeNull();
  });
  it("오래 기다렸거나 쓰는 벌이 없으면 그 버전 하나만 새로 쓴다", () => {
    expect(settleWaiting({ id: "a", since: 0 }, { variants: [], pending: [] }, presets, 1)).toEqual({ post: presets[0] });
  });
});

describe("버전 버튼을 누르면", () => {
  const ready = { status: "ready" as const, variants: [], pending: ["a"] };
  const base = { edited: false, ready: false, recommended: true, variants: ready, inFlight: [] as string[] };
  it("고친 글 > 써 둔 글 > 쓰는 중 기다림 > 이미 부름 > 새로 쓰기 순서", () => {
    expect(pickAction("a", { ...base, edited: true })).toBe("edited");
    expect(pickAction("a", { ...base, ready: true })).toBe("show");
    expect(pickAction("a", base)).toBe("wait");
    expect(pickAction("c", { ...base, recommended: false, inFlight: ["c"] })).toBe("busy");
    expect(pickAction("c", { ...base, recommended: false })).toBe("post");
  });
});
