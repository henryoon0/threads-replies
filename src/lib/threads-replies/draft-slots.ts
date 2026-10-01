// 토글(답 버전)별 초안 칸 (2026-10-01 henry: "토글을 보고 초안을 적어놨는데 다시 버튼을 누르면 초안 썼던 게 사라지면 안 된다").
//
// 버전마다 칸이 하나씩 있다. 칸에 손으로 고친 글이 있으면 그 버전을 다시 눌러도 고친 글이 나온다.
// 고친 글이 없으면 미리 써 둔 버전 글이 나온다. 지금 고른 버전은 글이 같은지로 추측하지 않고 칸에 적어 둔다.
// 순수 — I/O 없음.

export interface DraftSlots {
  /** 지금 고른 버전 id */
  selected: string | null;
  /** 버전 id → 손으로 고친 글 */
  edits: Record<string, string>;
}

/** 지금 고른 버전 칸에 고친 글을 적는다. 고른 버전이 없으면 그대로. */
export function editSlot(slots: DraftSlots, text: string): DraftSlots {
  if (!slots.selected) return slots;
  return { ...slots, edits: { ...slots.edits, [slots.selected]: text } };
}

/** 버전을 누른다: 고친 글이 있으면 그것, 없으면 미리 써 둔 글. */
export function pickSlot(slots: DraftSlots, key: string, variantText: string): { slots: DraftSlots; draft: string } {
  return { slots: { ...slots, selected: key }, draft: slots.edits[key] ?? variantText };
}

export interface OpenInput {
  /** 댓글에 맞는 순서의 버전 (추천이 앞) */
  presets: readonly { id: string; recommended: boolean }[];
  /** 미리 써 둔 버전 글 (버전 id → 글) */
  variants: Readonly<Record<string, string>>;
  /** 원장에 저장된 지금 초안. byHand = 주인이 손으로 쓰거나 고친 글 */
  saved: { draft: string; byHand: boolean; key?: string };
}

/**
 * 댓글을 열 때: 추천 1순위(없으면 첫 버전)를 고른다.
 * 저장된 초안이 어느 버전 글과 같으면 그 버전을 고른다.
 * 손으로 쓴 초안은 버리지 않는다 — 고쳤던 버전(모르면 추천 1순위) 칸에 넣고 그 버전을 고른다.
 * 손글이 아닌 옛 AI 초안(버전과 안 맞는 것)은 버리고 버전 글을 보여준다.
 */
export function openSlots(input: OpenInput): { slots: DraftSlots; draft: string } {
  const first = input.presets.find((p) => p.recommended) ?? input.presets[0];
  const { draft, byHand, key } = input.saved;
  if (!first) return { slots: { selected: null, edits: {} }, draft };
  const same = draft.trim() ? input.presets.find((p) => input.variants[p.id]?.trim() === draft.trim()) : undefined;
  if (same) return { slots: { selected: same.id, edits: {} }, draft };
  const own = key && input.presets.some((p) => p.id === key) ? key : first.id;
  if (byHand && draft.trim()) return { slots: { selected: own, edits: { [own]: draft } }, draft };
  return pickSlot({ selected: null, edits: {} }, first.id, input.variants[first.id] ?? "");
}

/**
 * 열 때 고른 결과(opened)에 브라우저에 남은 칸(stored)을 합친다. 브라우저 칸이 이긴다 (2026-10-02 codex 리뷰 4번):
 * 서버 저장이 실패하면 서버엔 옛 초안이 남는데, 그걸로 최신 고친 글을 덮으면 안 된다.
 */
export function mergeOpened(stored: DraftSlots, opened: { slots: DraftSlots; draft: string }): { slots: DraftSlots; draft: string } {
  const edits = { ...opened.slots.edits, ...stored.edits };
  const sel = opened.slots.selected;
  return { slots: { selected: sel, edits }, draft: sel && edits[sel] !== undefined ? edits[sel] : opened.draft };
}
