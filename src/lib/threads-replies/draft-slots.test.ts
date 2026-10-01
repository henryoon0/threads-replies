import { describe, expect, it } from "vitest";
import { editSlot, openSlots, pickSlot, type DraftSlots } from "./draft-slots";

const empty: DraftSlots = { selected: null, edits: {} };

describe("토글별 초안 보존", () => {
  it("A 를 고쳐 쓰고 B 를 봤다가 A 를 다시 누르면 고친 글이 돌아온다", () => {
    let s = pickSlot(empty, "A", "A 원래 글").slots;
    s = editSlot(s, "A 를 내가 고친 글");
    s = pickSlot(s, "B", "B 원래 글").slots;
    const back = pickSlot(s, "A", "A 원래 글");
    expect(back.draft).toBe("A 를 내가 고친 글");
    expect(back.slots.selected).toBe("A");
  });
});

describe("댓글을 열 때", () => {
  const presets = [
    { id: "R1", recommended: true },
    { id: "R2", recommended: true },
    { id: "X", recommended: false },
  ];
  const variants = { R1: "추천 1 글", R2: "추천 2 글", X: "다른 글" };

  it("버전과 안 맞는 옛 AI 초안이 남아 있으면 버리고 추천 1순위를 골라 보여준다", () => {
    const open = openSlots({ presets, variants, saved: { draft: "옛 답 초안", byHand: false } });
    expect(open.slots.selected).toBe("R1");
    expect(open.draft).toBe("추천 1 글");
  });

  it("손으로 쓴 초안은 버리지 않고, 고쳤던 버전 칸에 넣어 그 토글을 고른 채로 연다", () => {
    const open = openSlots({ presets, variants, saved: { draft: "내가 쓴 답", byHand: true, key: "R2" } });
    expect(open.slots.selected).toBe("R2");
    expect(open.draft).toBe("내가 쓴 답");
    const away = pickSlot(open.slots, "R1", "추천 1 글");
    expect(pickSlot(away.slots, "R2", "추천 2 글").draft).toBe("내가 쓴 답");
  });

  it("어느 버전에서 고쳤는지 모르는 손글은 추천 1순위 칸에 넣는다", () => {
    const open = openSlots({ presets, variants, saved: { draft: "내가 쓴 답", byHand: true } });
    expect(open.slots.selected).toBe("R1");
    expect(open.draft).toBe("내가 쓴 답");
  });

  it("저장된 초안이 어느 버전 글과 같으면 그 버전을 고른 채로 연다", () => {
    const open = openSlots({ presets, variants, saved: { draft: "다른 글", byHand: false } });
    expect(open.slots.selected).toBe("X");
    expect(open.draft).toBe("다른 글");
  });
});
