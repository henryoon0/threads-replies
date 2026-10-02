import { describe, expect, it } from "vitest";
import { MINE, editSlot, mergeOpened, openSlots, pickSlot, type DraftSlots } from "./draft-slots";

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

describe("쓰는 중인 버전에 손으로 쓰면 '내 글' 칸으로 (10-02 henry)", () => {
  it("AI 글이 아직 없는 버전에서 친 글은 그 버전이 아니라 내 글 칸에 들어가고, 내 글이 골라진다", () => {
    const s = editSlot({ selected: "A", edits: {} }, "내가 먼저 쓴 글", { versionReady: false });
    expect(s.selected).toBe(MINE);
    expect(s.edits).toEqual({ [MINE]: "내가 먼저 쓴 글" });
  });

  it("그 뒤 AI 글이 도착하면 A 버튼은 AI 글을, 내 글 버튼은 내가 쓴 글을 보여준다", () => {
    const s = editSlot({ selected: "A", edits: {} }, "내가 먼저 쓴 글", { versionReady: false });
    expect(pickSlot(s, "A", "A 의 AI 글").draft).toBe("A 의 AI 글");
    expect(pickSlot(s, MINE, "").draft).toBe("내가 먼저 쓴 글");
  });

  it("내 글을 고르고 계속 쓰면 내 글 칸이 바뀐다", () => {
    const s = editSlot({ selected: MINE, edits: { [MINE]: "가" } }, "가나다", { versionReady: false });
    expect(s).toEqual({ selected: MINE, edits: { [MINE]: "가나다" } });
  });

  it("다 쓰인 버전을 고치는 건 예전처럼 그 버전 칸에 남는다", () => {
    expect(editSlot({ selected: "A", edits: {} }, "A 고침", { versionReady: true })).toEqual({ selected: "A", edits: { A: "A 고침" } });
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

describe("다시 열 때 브라우저에 남은 고친 글이 이긴다 (10-02 codex 4번)", () => {
  it("서버 저장이 실패해 서버엔 옛 초안이 있어도, 브라우저에 남은 최신 고친 글을 보여준다", () => {
    const stored: DraftSlots = { selected: "R1", edits: { R1: "브라우저의 최신 고친 글" } };
    const opened = { slots: { selected: "R1", edits: { R1: "서버의 옛 초안" } }, draft: "서버의 옛 초안" };
    const m = mergeOpened(stored, opened);
    expect(m.slots.edits.R1).toBe("브라우저의 최신 고친 글");
    expect(m.draft).toBe("브라우저의 최신 고친 글");
  });
});

describe("다시 열 때 마지막으로 고른 버전 (10-02)", () => {
  const presets = [{ id: "R1", recommended: true }, { id: "X", recommended: false }];
  const variants = { R1: "추천 글", X: "다른 글" };
  it("마지막으로 쓴 게 내 글이면 내 글을 고른 채로 연다", () => {
    const o = openSlots({ presets, variants, saved: { draft: "내 글이에요", byHand: true, key: MINE } });
    expect(o.slots).toEqual({ selected: MINE, edits: { [MINE]: "내 글이에요" } });
  });

  it("서버 초안이 다른 버전 글이어도(뒤에서 다 쓰인 버전) 마지막으로 고른 버전으로 연다", () => {
    const open = openSlots({ presets, variants, saved: { draft: "다른 글", byHand: false, key: "R1" } });
    expect(open.slots.selected).toBe("R1");
    expect(open.draft).toBe("추천 글");
  });
});
