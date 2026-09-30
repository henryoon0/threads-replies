import { describe, expect, it } from "vitest";
import { pinFocused, type FocusedPast } from "./past-focus";
import type { SimilarItem } from "@/lib/threads-replies/similar";

const items: SimilarItem[] = [
  { id: "a", text: "철분은 공복에 먹어.", product: false },
  { id: "b", text: "볼그레는 원료 수급이 안된다고 종근당이 단종시킴.\n다른 걸로 가.", product: true },
];
const focus = (text: string): FocusedPast => ({ text, comment: "볼그레 왜 품귀야?", seq: 1 });

describe("pinFocused", () => {
  it("누른 구절이 든 예전 답을 맨 위로 올리고 그 칸을 칠한다 (띄어쓰기 차이는 무시)", () => {
    const got = pinFocused(items, focus("원료 수급이 안된다고  종근당이 단종시킴."));
    expect(got.items.map((i) => i.id)).toEqual(["b", "a"]);
    expect(got.focusedId).toBe("b");
  });

  it("목록에 없으면 구절로 만든 칸을 맨 앞에 끼운다", () => {
    const got = pinFocused(items, focus("리베이트 없이 내가 먹는 거"));
    expect(got.items).toHaveLength(3);
    expect(got.items[0]).toMatchObject({ text: "리베이트 없이 내가 먹는 거", comment: "볼그레 왜 품귀야?" });
    expect(got.focusedId).toBe(got.items[0].id);
  });

  it("누른 게 없으면 순서 그대로", () => {
    expect(pinFocused(items, null)).toEqual({ items, focusedId: null });
  });
});
