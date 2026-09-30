"use client";

// 완성된 답이 예전 답과 어긋나는지 (고치는 동안). 초안 때 잰 결과(answer.consistency)가 지금 글과 같으면
// 그대로 쓰고, 주인이 고쳐서 글이 바뀌면 잠깐(1.5초) 멈췄을 때 POST .../consistency 로 다시 잰다.
// 기다리는 동안엔 옛 결과를 문장 위치만 옮겨 보여준다. 글은 절대 바꾸지 않는다.

import { useEffect, useState } from "react";
import { remapHits } from "@/lib/threads-replies/consistency-spans";
import type { ConsistencyHit, ReplyAnswer } from "@/lib/threads-replies/model";

const DEBOUNCE_MS = 1500;
/** 비교가 이보다 오래 걸리면 조용히 접는다 (09-29 "비교하는 중" 무한 표시) */
export const CHECK_TIMEOUT_MS = 20_000;

type Checked = { text: string; hits: ConsistencyHit[]; replyId?: string };

/** 이미 잰 결과 가운데 이 글에 맞는 것 (완성된 답 · 벌마다) */
export function knownFor(answer: ReplyAnswer | undefined, text: string): Checked | null {
  if (!answer) return null;
  if (answer.consistencyFor === text && answer.consistency) return { text, hits: answer.consistency };
  const opt = answer.options?.find((o) => o.draft === text && o.consistency);
  return opt?.consistency ? { text, hits: opt.consistency } : null;
}

/** 잴 필요가 없나: 답이 없음 · 빈 글 · 이미 잰 글 · 손으로 쓴 답인데 예전 답도 없음 */
function needless(answer: ReplyAnswer | undefined, draft: string, known: Checked | null): boolean {
  if (!answer || !draft.trim() || known) return true;
  return answer.model === "henry" && !answer.pastSaid;
}

/** 원장에 남아 있던 마지막 결과 (옮겨 칠하기용) */
function storedOf(answer: ReplyAnswer | undefined): Checked | null {
  return answer?.consistencyFor !== undefined ? { text: answer.consistencyFor, hits: answer.consistency ?? [] } : null;
}

function postCheck(replyId: string, text: string, signal: AbortSignal): Promise<Checked | null> {
  return fetch(`/api/threads-replies/${encodeURIComponent(replyId)}/consistency`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
    signal,
  })
    .then((r) => (r.ok ? r.json() : null))
    .then((d: { consistency?: ConsistencyHit[]; text?: string } | null) => (d && typeof d.text === "string" ? { text: d.text, hits: d.consistency ?? [], replyId } : null))
    .catch(() => null);
}

export function usePastCheck(replyId: string, answer: ReplyAnswer | undefined, draft: string) {
  const known = knownFor(answer, draft);
  const [last, setLast] = useState<Checked | null>(null);
  const [checking, setChecking] = useState(false);
  const skip = needless(answer, draft, known);
  const mine = last?.replyId === replyId ? last : null;
  const mineText = mine?.text;

  useEffect(() => {
    if (skip || mineText === draft) return;
    const ctrl = new AbortController();
    let limit: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      setChecking(true);
      limit = setTimeout(() => ctrl.abort(), CHECK_TIMEOUT_MS);
      void postCheck(replyId, draft, ctrl.signal).then((got) => {
        clearTimeout(limit);
        // 시간 초과로 끊겼어도 "비교하는 중"은 내린다. 옛 결과는 그대로 둔다.
        if (got) setLast(got);
        setChecking(false);
      });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      clearTimeout(limit);
      ctrl.abort();
      // 글이 바뀌어 이번 비교를 버리면 "비교하는 중"도 같이 내린다 — 안 내리면 다음 글이 잴 필요 없을 때 영영 남는다
      setChecking(false);
    };
  }, [replyId, draft, skip, mineText]);

  const base = known ?? mine ?? storedOf(answer);
  return { hits: base ? remapHits(base.hits, base.text, draft) : [], checking: checking && !skip };
}
