import { describe, expect, it } from "vitest";
import { readPresets, stillWriting, variantOfDraft } from "./use-compose";

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
