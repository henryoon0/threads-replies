"use client";

// 스레드 답 화면을 넓게 쓰기 (09-29 요청 4 "최대한 넓게"). 왼쪽 레일·댓글 목록을 접으면 답 칸이 화면 폭을 다 쓴다.
// 레일은 workbench 가, 목록은 threads-client 가 그려서 둘이 같은 값을 보게 모듈 저장소 + localStorage 로 둔다.

import { useSyncExternalStore } from "react";

const KEY = "threads-wide";
const listeners = new Set<() => void>();
let wide: boolean | null = null;

function read(): boolean {
  if (wide !== null) return wide;
  try {
    // 넓게 보기가 기본 (henry 09-29). 목록 펴기를 고른 적 있을 때만("0") 좁게
    wide = window.localStorage.getItem(KEY) !== "0";
  } catch {
    wide = true;
  }
  return wide;
}

export function setThreadsWide(next: boolean): void {
  wide = next;
  try {
    window.localStorage.setItem(KEY, next ? "1" : "0");
  } catch {
    // 저장이 막힌 창 — 이번 화면에서만 기억한다
  }
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useThreadsWide(): boolean {
  return useSyncExternalStore(subscribe, read, () => true);
}
