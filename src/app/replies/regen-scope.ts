"use client";

// 댓글 여러 개 새로 쓰기 (2026-09-30 henry 시안 픽 row: [5개 전부]·줄마다 새로 고침).
// 누른 뒤 무엇이 일어나는지(몇 개 다시 쓰는 중) 알리는 작은 전역 상태 — 확인 창 없이 알림 한 줄.

import { useSyncExternalStore } from "react";
import { restartFresh } from "./use-compose";

type TopFive = { note: string; busy: boolean };
let state: TopFive = { note: "", busy: false };
const subs = new Set<() => void>();
function set(next: Partial<TopFive>) {
  state = { ...state, ...next };
  subs.forEach((f) => f());
}
function subscribe(f: () => void) {
  subs.add(f);
  return () => subs.delete(f);
}

export function useTopFive(): TopFive {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

let clear: ReturnType<typeof setTimeout> | undefined;
/** 댓글 여러 개를 버리고 다시 쓴다. 무엇이 일어나는지 note 로 알린다 (확인 창 없음). */
export async function restartMany(ids: readonly string[]) {
  if (!ids.length || state.busy) return;
  clearTimeout(clear);
  set({ busy: true, note: `${ids.length}개 다시 쓰는 중` });
  const got = await restartFresh(ids);
  if ("error" in got) set({ busy: false, note: got.error });
  else {
    const skip = got.busy.length ? ` · ${got.busy.length}개는 이미 쓰는 중` : "";
    set({ busy: false, note: `${got.queued.length}개 다시 쓰는 중이에요. 1개에 1분쯤${skip}` });
  }
  clear = setTimeout(() => set({ note: "" }), 90_000);
}
