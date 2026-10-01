"use client";

// 보내기 대기열 알림 (2026-10-02): [보내기]를 누르고 다른 댓글로 옮겨도 서버가 보낸다.
// 그 결과(달았어요·실패)를 지금 어느 댓글을 보고 있든 알리고 목록을 다시 읽는다.
// 열 때 이미 끝나 있던 결과는 알리지 않는다(새로 끝난 것만). 기다리는 게 없으면 천천히 본다.

import { useEffect, useRef } from "react";
import { toast } from "@/components/toast";
import { firstNotice } from "./threads-answer-send";

type Item = { replyId: string; status: "waiting" | "sending" | "sent" | "failed"; dueAt: string; error?: string };

const BUSY_MS = 2000;
const IDLE_MS = 15000;

async function readQueue(): Promise<Item[] | null> {
  try {
    const res = await fetch("/api/threads-replies/send-queue", { cache: "no-store" });
    return res.ok ? ((await res.json()) as { items: Item[] }).items : null;
  } catch {
    return null;
  }
}

const isDone = (s: Item["status"]) => s === "sent" || s === "failed";

/** 이번 읽기에서 새로 끝난 결과들. before 는 지난 상태를 기억하고 이 함수가 갱신한다. first = 처음 읽기(지난 일은 알리지 않는다) */
export function newlyDone(before: Map<string, string>, items: readonly Item[], first: boolean): { busy: boolean; done: Item[] } {
  const done: Item[] = [];
  for (const it of items) {
    const key = `${it.replyId}@${it.dueAt}`;
    const was = before.get(key);
    before.set(key, it.status);
    if (!first && was !== it.status && isDone(it.status)) done.push(it);
  }
  return { busy: items.some((it) => !isDone(it.status)), done };
}

function announce(it: Item) {
  if (!firstNotice(it)) return;
  if (it.status === "sent") toast.success("답글을 달았어요");
  else toast.error(it.error ?? "답글을 보내지 못했어요");
}

export function useSendNotices(onChanged: () => void) {
  const changed = useRef(onChanged);
  useEffect(() => {
    changed.current = onChanged;
  }, [onChanged]);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const before = new Map<string, string>();
    let first = true;
    const tick = async () => {
      const items = await readQueue();
      if (!alive) return;
      const { busy, done } = newlyDone(before, items ?? [], first);
      first = false;
      done.forEach(announce);
      if (done.length) changed.current();
      timer = setTimeout(tick, busy ? BUSY_MS : IDLE_MS);
    };
    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);
}
