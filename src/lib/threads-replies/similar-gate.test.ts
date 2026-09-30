import { describe, expect, it } from "vitest";
import { gateRelevant, parseRelevant } from "./similar-gate";

const c = (id: string) => ({ id, text: `예전 답 ${id}`, comment: `예전 댓글 ${id}` });

describe("비슷한 글 관련성 게이트", () => {
  it("관련 있다고 판정된 후보만 원래 순서로 남긴다", async () => {
    const out = await gateRelevant("구내염 뭐 먹어", [c("a"), c("b"), c("c")], async () => '{"relevant": [3, 1]}');
    expect(out.map((x) => x.id)).toEqual(["a", "c"]);
  });

  it("관련 있는 후보가 없으면 빈 목록", async () => {
    expect(await gateRelevant("훈련소 상비약", [c("d")], async () => '{"relevant": []}')).toEqual([]);
  });

  it("판정이 실패하면 아무것도 띄우지 않는다", async () => {
    expect(await gateRelevant("실패 댓글", [c("e")], async () => Promise.reject(new Error("timeout")))).toEqual([]);
    expect(await gateRelevant("형식 틀림", [c("f")], async () => "모르겠어요")).toEqual([]);
  });

  it("후보가 없으면 판정을 부르지 않는다", async () => {
    let called = false;
    await gateRelevant("x", [], async () => {
      called = true;
      return "{}";
    });
    expect(called).toBe(false);
  });

  it("범위 밖 번호는 버린다", () => {
    expect([...(parseRelevant('앞말 {"relevant": [0, 2, 9, 1.5]}', 3) ?? [])]).toEqual([2]);
  });
});
