"use client";

// 스레드 답 패널의 데이터: 댓글 한 건 읽기 · 초안 저장(600ms 디바운스) · 다시 쓰기 · 원문 캡처 캐시.
// 요청은 replyId 로 묶는다. 다른 댓글로 넘어간 뒤 늦게 온 응답은 화면에 쓰지 않는다.

import { useCallback, useEffect, useRef, useState } from "react";
import type { AnswerSource, EvidenceShot, ReplyAnswer, SourceKind, ThreadsPostRef, ThreadsReply } from "@/lib/threads-replies/model";

export interface ThreadsReplyView {
  reply: ThreadsReply;
  post: ThreadsPostRef | null;
  conversation: { username: string; text: string }[];
  drafting: boolean;
}

export interface RegenerateInput {
  allowWeb?: boolean;
}

const DRAFT_SAVE_MS = 600;
const DRAFTING_POLL_MS = 5000;

async function readJson<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `요청 실패 (HTTP ${res.status})`);
  return body;
}

export function patchReply(body: Record<string, unknown>): Promise<{ reply: ThreadsReply }> {
  return fetch("/api/threads-replies", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => readJson<{ reply: ThreadsReply }>(r));
}

function fetchView(replyId: string): Promise<ThreadsReplyView> {
  return fetch(`/api/threads-replies/${encodeURIComponent(replyId)}`, { cache: "no-store" }).then((r) =>
    readJson<ThreadsReplyView>(r)
  );
}

/** 초안 칸 저장: 마지막 입력 600ms 뒤 PATCH. 댓글이 바뀌면 남은 저장을 바로 보낸다. */
function useDraftSaver(replyId: string) {
  const pending = useRef<{ replyId: string; draft: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const job = pending.current;
    pending.current = null;
    if (job) void patchReply(job).catch(() => {});
  }, []);

  const schedule = useCallback(
    (draft: string) => {
      pending.current = { replyId, draft };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, DRAFT_SAVE_MS);
    },
    [replyId, flush]
  );

  /** 남은 저장을 버린다 (3벌 중 다른 벌을 고르면 옛 초안을 덮어쓰지 않게) */
  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    pending.current = null;
  }, []);

  useEffect(() => flush, [replyId, flush]);
  return { schedule, flush, cancel };
}

export function useThreadsAnswer(replyId: string, onChanged: () => void) {
  const [view, setView] = useState<ThreadsReplyView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraftState] = useState("");
  const [regenerating, setRegenerating] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);
  const current = useRef(replyId);
  const saver = useDraftSaver(replyId);

  const apply = useCallback((id: string, next: ThreadsReplyView) => {
    if (current.current !== id) return;
    setView(next);
    setError(null);
    setDraftState((d) => (d.trim() ? d : next.reply.answer?.draft ?? ""));
  }, []);
  const fail = useCallback((id: string, e: unknown) => {
    if (current.current === id) setError(e instanceof Error ? e.message : String(e));
  }, []);
  const load = useCallback(() => {
    const id = replyId;
    return fetchView(id).then((next) => apply(id, next), (e: unknown) => fail(id, e));
  }, [replyId, apply, fail]);

  // 댓글이 바뀌면 렌더 중에 비운다 (effect 안 setState 는 한 번 더 그린다).
  const [forId, setForId] = useState(replyId);
  if (forId !== replyId) {
    setForId(replyId);
    setView(null);
    setError(null);
    setDraftState("");
    setRegenerating(false);
    setRegenError(null);
  }

  useEffect(() => {
    current.current = replyId;
    fetchView(replyId).then((next) => apply(replyId, next), (e: unknown) => fail(replyId, e));
  }, [replyId, apply, fail]);

  // 백그라운드 잡이 이 댓글을 쓰는 중이면 초안이 들어올 때까지 가볍게 다시 읽는다.
  const drafting = Boolean(view?.drafting && !view.reply.answer);
  useEffect(() => {
    if (!drafting) return;
    const t = setInterval(() => void load(), DRAFTING_POLL_MS);
    return () => clearInterval(t);
  }, [drafting, load]);

  const setDraft = useCallback(
    (next: string) => {
      setDraftState(next);
      saver.schedule(next);
    },
    [saver]
  );

  const applyAnswer = useCallback((id: string, answer: ReplyAnswer) => {
    if (current.current !== id) return;
    setView((v) => (v ? { ...v, drafting: false, reply: { ...v.reply, answer } } : v));
    setDraftState(answer.draft);
  }, []);

  const regenerate = useCallback(
    async (input: RegenerateInput = {}) => {
      const id = replyId;
      saver.flush();
      setRegenerating(true);
      setRegenError(null);
      try {
        const res = await fetch(`/api/threads-replies/${encodeURIComponent(id)}/answer`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        const body = await readJson<{ answer: ReplyAnswer }>(res);
        applyAnswer(id, body.answer);
        onChanged();
      } catch (e) {
        if (current.current === id) setRegenError(e instanceof Error ? e.message : String(e));
      } finally {
        if (current.current === id) setRegenerating(false);
      }
    },
    [replyId, saver, applyAnswer, onChanged]
  );

  /** 3벌 중 n번째를 고른다: 화면은 바로 바꾸고, 서버(PATCH chosen)가 draft·aiDraft 를 그 벌로 맞춘다. */
  const choose = useCallback(
    async (n: number) => {
      const id = replyId;
      const opt = view?.reply.answer?.options?.[n];
      if (!opt) return;
      saver.cancel();
      setDraftState(opt.draft);
      setView((v) => {
        const a = v?.reply.answer;
        return v && a ? { ...v, reply: { ...v.reply, answer: { ...a, chosen: n, draft: opt.draft, aiDraft: opt.draft, sentences: opt.sentences } } } : v;
      });
      try {
        const { reply } = await patchReply({ replyId: id, chosen: n });
        if (current.current === id) setView((v) => (v ? { ...v, reply } : v));
      } catch (e) {
        if (current.current === id) setRegenError(e instanceof Error ? e.message : String(e));
      }
    },
    [replyId, view, saver]
  );

  /** 다른 버전이 붙은 answer 에서 options 만 받아 온다 (고른 벌·편집 중 초안은 그대로). */
  const mergeOptions = useCallback((id: string, answer: ReplyAnswer) => {
    if (current.current !== id) return;
    setView((v) => {
      const a = v?.reply.answer;
      return v && a ? { ...v, reply: { ...v.reply, answer: { ...a, options: answer.options } } } : v;
    });
  }, []);

  const replaceReply = useCallback((reply: ThreadsReply) => {
    if (current.current !== reply.id) return;
    setView((v) => (v ? { ...v, reply } : v));
  }, []);

  return { view, error, draft, setDraft, flushDraft: saver.flush, regenerating, regenError, regenerate, choose, mergeOptions, reload: load, drafting, replaceReply };
}

/* ── 원문 형광 캡처 ─────────────────────────────────── */

const SHOT_KINDS: ReadonlySet<SourceKind> = new Set<SourceKind>(["원글 원본", "수집한 원문", "웹", "붙인 링크"]);

/** 원본 화면을 찍을 수 있는 근거인가. henry 노트(수집노트·강의 자료·FAQ·지난 글·henry 경험)는 찍지 않는다. */
export function isShootableSource(s: AnswerSource): boolean {
  return SHOT_KINDS.has(s.kind) && /^https?:\/\//i.test(s.url ?? "") && Boolean(s.quote?.trim());
}

/** 다시 쓰기로 같은 id(s1…)가 다른 근거를 가리킬 수 있어 주소·인용까지 키에 넣는다. */
export function shotKey(replyId: string, s: AnswerSource): string {
  return `${replyId}:${s.id}:${s.url ?? ""}:${s.quote.length}`;
}

export type ShotState = { status: "loading" } | { status: "done"; shot: EvidenceShot } | { status: "failed"; error: string };

// 패널은 댓글마다 새로 그려지므로(key=replyId) 캡처 결과는 모듈에 남겨 다시 찍지 않는다.
// 실패한 것만 지워서 [다시 찍기]가 되게 한다. 한 번에 하나씩 찍는다 (크로미움·X 로그인 프로필 공유).
const shotMemo = new Map<string, ShotState>();
let shotChain: Promise<unknown> = Promise.resolve();

/** 캡처 캐시. 결과는 컴포넌트 상태로 그리고, 같은 키의 재요청은 모듈 메모로 막는다. */
export function useEvidenceShots() {
  const [shots, setShots] = useState<Record<string, ShotState>>(() => Object.fromEntries(shotMemo));

  const put = useCallback((key: string, state: ShotState) => {
    shotMemo.set(key, state);
    setShots((s) => ({ ...s, [key]: state }));
  }, []);

  const request = useCallback(
    (replyId: string, source: AnswerSource) => {
      const key = shotKey(replyId, source);
      const known = shotMemo.get(key);
      if (known && known.status !== "failed") {
        setShots((s) => (s[key] === known ? s : { ...s, [key]: known }));
        return;
      }
      put(key, { status: "loading" });
      const run = async () => {
        try {
          const res = await fetch(`/api/threads-replies/${encodeURIComponent(replyId)}/evidence`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sourceId: source.id }),
          });
          const body = await readJson<{ shot: EvidenceShot }>(res);
          put(key, { status: "done", shot: body.shot });
        } catch (e) {
          put(key, { status: "failed", error: e instanceof Error ? e.message : String(e) });
        }
      };
      shotChain = shotChain.then(run, run);
    },
    [put]
  );

  return { shots, request };
}
