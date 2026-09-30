"use client";

// 완성된 답에서 "예전 답과 다름" 칠한 곳을 누르면 오른쪽 "비슷한 맥락에서 남긴 글"에 그 예전 답을 맨 위로 올려 칠한다
// (2026-09-30 henry: "클릭하면 오른쪽에 보여져야 해. 색칠된 형태로 보인다던지 제일 상단으로").
// 입력칸(GateEditor)과 오른쪽 패널이 멀리 떨어져 있어 작은 전역 저장소로 잇는다.

import { useSyncExternalStore } from "react";
import type { GateHit } from "@/lib/threads-replies/model";
import type { SimilarItem } from "@/lib/threads-replies/similar";

export type FocusedPast = NonNullable<GateHit["past"]> & { seq: number };

let state: FocusedPast | null = null;
let seq = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export function focusPast(past: NonNullable<GateHit["past"]>) {
  state = { ...past, seq: ++seq };
  emit();
}

export function clearPastFocus() {
  if (!state) return;
  state = null;
  emit();
}

export function usePastFocus(): FocusedPast | null {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => state,
    () => null
  );
}

const squash = (s: string) => s.replace(/\s+/g, "");

/**
 * 누른 예전 답을 맨 앞으로. 목록에 그 구절이 든 답이 있으면 그 답을 올리고, 없으면 구절만으로 만든 칸을 앞에 끼운다.
 * 돌려주는 focusedId = 칠할 칸.
 */
export function pinFocused(items: readonly SimilarItem[], focus: FocusedPast | null): { items: SimilarItem[]; focusedId: string | null } {
  if (!focus) return { items: [...items], focusedId: null };
  const q = squash(focus.text);
  const hit = q ? items.find((i) => squash(i.text).includes(q)) : undefined;
  if (hit) return { items: [hit, ...items.filter((i) => i !== hit)], focusedId: hit.id };
  const pinned: SimilarItem = {
    id: `focus-${focus.seq}`,
    text: focus.text,
    product: false,
    ...(focus.comment ? { comment: focus.comment } : {}),
    ...(focus.date ? { date: focus.date } : {}),
    ...(focus.permalink ? { permalink: focus.permalink } : {}),
  };
  return { items: [pinned, ...items], focusedId: pinned.id };
}
