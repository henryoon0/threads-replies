"use client";

// 답 버전 버튼 (2026-09-29 henry: "토글 느낌이 아니라, 버튼 하나에 여러 조각이 섞인 버전들이 여러 개").
//  GET  /api/threads-replies/[id]/compose            → { presets }   이 계정의 버전 (댓글에 맞는 순서, 위 둘 추천)
//  GET  /api/threads-replies/[id]/compose/variants   → { variants }  미리 써 둔 버전별 글 (열쇠 = 버전 id)
//  POST /api/threads-replies/[id]/compose { toggles, preset } → { draft, products }  아직 없는 버전 · [새로 쓰기]
// 버튼을 누르면 미리 쓴 글로 바로 바뀐다. 아직 쓰는 중이면 다 되는 대로 바뀌고, 없으면 그 버전 하나만 새로 쓴다.

import { useCallback, useEffect, useRef, useState } from "react";

export type ComposeToggles = Record<string, unknown>;

export interface ComposePresetView {
  id: string;
  name: string;
  /** 든 조각 한 줄 (AICC 는 언제 쓰는 유형인지) */
  parts: string;
  count: number;
  recommended: boolean;
  toggles: ComposeToggles;
}

export type ComposeStatus = "loading" | "ready" | "working" | "missing";

export interface VariantProduct {
  id: string;
  name: string;
  url?: string;
  kind?: string;
  capture?: string;
}

export interface ComposeVariant {
  key: string;
  draft: string;
  products?: VariantProduct[];
}

type VariantsState = { status: "loading" | "missing" } | { status: "ready"; variants: ComposeVariant[]; pending: string[] };

function url(replyId: string) {
  return `/api/threads-replies/${encodeURIComponent(replyId)}/compose`;
}

/** GET 응답에서 버전 목록만 (모양이 틀린 칸은 버린다) */
export function readPresets(body: unknown): ComposePresetView[] {
  const list = (body as { presets?: unknown } | null)?.presets;
  if (!Array.isArray(list)) return [];
  return list
    .filter((p): p is ComposePresetView => !!p && typeof p.id === "string" && typeof p.name === "string")
    .map((p) => ({ id: p.id, name: p.name, parts: String(p.parts ?? ""), count: Number(p.count) || 0, recommended: p.recommended === true, toggles: p.toggles ?? {} }));
}

/** 지금 글이 어느 버전 글인가 (앞뒤 공백 무시) */
export function variantOfDraft(variants: readonly ComposeVariant[], draft: string): ComposeVariant | undefined {
  const t = draft.trim();
  return t ? variants.find((v) => v.draft.trim() === t) : undefined;
}

type PostResult = { draft: string; products: VariantProduct[] };
type ComposeFail = { error: string; missing: boolean };

/** POST compose. 404 = 초안기 없음(missing), 그 밖의 실패는 이유 한 줄. */
export async function requestCompose(replyId: string, preset: ComposePresetView): Promise<PostResult | ComposeFail> {
  try {
    const r = await fetch(url(replyId), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ toggles: preset.toggles, preset: preset.id }) });
    if (r.status === 404) return { error: "", missing: true };
    const body = (await r.json().catch(() => ({}))) as { draft?: string; products?: VariantProduct[]; error?: string };
    if (r.ok && typeof body.draft === "string") return { draft: body.draft, products: body.products ?? [] };
    return { error: body.error ?? `다시 쓰지 못했어요 (HTTP ${r.status})`, missing: false };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e), missing: false };
  }
}

async function fetchVariants(replyId: string, signal?: AbortSignal): Promise<VariantsState> {
  try {
    const r = await fetch(`${url(replyId)}/variants`, { signal, cache: "no-store" });
    if (!r.ok) return { status: "missing" };
    const body = (await r.json()) as { variants?: ComposeVariant[]; pending?: string[]; status?: string };
    if (!Array.isArray(body.variants)) return { status: "missing" };
    const pending = Array.isArray(body.pending) ? body.pending : [];
    // 잡이 줄 서 있거나 도는 중이면 아직 이름 없는 벌도 곧 온다 — 기다린다
    const busy = body.status === "queued" || body.status === "running";
    return { status: "ready", variants: body.variants, pending: pending.length || !busy ? pending : ["*"] };
  } catch {
    return { status: "missing" };
  }
}

async function fetchPresets(replyId: string, signal: AbortSignal): Promise<ComposePresetView[] | null> {
  const r = await fetch(url(replyId), { signal, cache: "no-store" });
  if (!r.ok) return null;
  return readPresets(await r.json());
}

/** 이 버전을 아직 쓰는 중인가 (이름 모를 벌 "*" 이 있으면 곧 온다고 본다) */
export function stillWriting(pending: readonly string[], id: string): boolean {
  return pending.includes(id) || pending.includes("*");
}

const VARIANT_POLL_MS = 2500;
const VARIANT_WAIT_MS = 90_000;

/** 미리 쓴 벌 목록. 아직 쓰는 벌이 있으면 계속 다시 읽는다 (버튼에 "쓰는 중"을 띄우고, 기다리는 버전이 오면 바꾼다). */
function useVariants(replyId: string, onFresh: (s: VariantsState) => void) {
  const [state, setState] = useState<{ id: string; s: VariantsState }>({ id: replyId, s: { status: "loading" } });
  const cur = state.id === replyId ? state.s : ({ status: "loading" } as VariantsState);
  const busy = cur.status === "ready" && cur.pending.length > 0;
  useEffect(() => {
    const ctrl = new AbortController();
    void fetchVariants(replyId, ctrl.signal).then((s) => {
      if (!ctrl.signal.aborted) setState({ id: replyId, s });
    });
    return () => ctrl.abort();
  }, [replyId]);
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => {
      void fetchVariants(replyId).then((s) => {
        if (s.status === "ready") setState({ id: replyId, s });
        onFresh(s);
      });
    }, VARIANT_POLL_MS);
    return () => clearInterval(t);
  }, [replyId, busy, onFresh]);
  /** 새로 쓰기를 시작한 뒤: 바로 다시 읽고, 서버가 아직 잡을 안 보여도 쓰는 중으로 두어 폴링을 잇는다 */
  const kick = useCallback(async () => {
    const s = await fetchVariants(replyId);
    if (s.status !== "ready") return;
    setState({ id: replyId, s: { ...s, pending: s.pending.length ? s.pending : ["*"] } });
  }, [replyId]);
  return { cur, kick };
}

/** 댓글 여러 개의 버전을 전부 버리고 다시 쓰게 한다 (POST prefetch fresh). busy = 이미 쓰는 중이라 그대로 둔 것 */
export async function restartFresh(ids: readonly string[]): Promise<{ queued: string[]; busy: string[] } | { error: string }> {
  try {
    const r = await fetch("/api/threads-replies/prefetch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids, fresh: true }) });
    const body = (await r.json().catch(() => ({}))) as { queued?: string[]; busy?: string[]; error?: string };
    if (!r.ok) return { error: body.error ?? `다시 쓰지 못했어요 (HTTP ${r.status})` };
    return { queued: body.queued ?? [], busy: body.busy ?? [] };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

function chooseVariant(replyId: string, key: string) {
  // 고른 벌을 원장에 남긴다. 실패해도 화면은 그대로 (보낼 때 draft 가 정본)
  void fetch(`${url(replyId)}/variants`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }) }).catch(() => {});
}

function usePresets(replyId: string) {
  const [state, setState] = useState<{ id: string; presets: ComposePresetView[]; status: ComposeStatus }>({ id: replyId, presets: [], status: "loading" });
  useEffect(() => {
    const ctrl = new AbortController();
    fetchPresets(replyId, ctrl.signal)
      .then((presets) => setState({ id: replyId, presets: presets ?? [], status: presets?.length ? "ready" : "missing" }))
      .catch(() => {
        if (!ctrl.signal.aborted) setState({ id: replyId, presets: [], status: "missing" });
      });
    return () => ctrl.abort();
  }, [replyId]);
  return state.id === replyId ? state : { presets: [], status: "loading" as ComposeStatus };
}

type Waiting = { id: string; since: number };

const NO_VARIANTS: ComposeVariant[] = [];

/** 지금 고른 버전과 그 버전의 제품: 방금 보여준 글이 그대로면 그것, 아니면 글이 같은 미리 쓴 벌 */
export function selectionOf(shown: Shown | null, variants: readonly ComposeVariant[], draft: string): { selected: string | null; products: VariantProduct[] } {
  if (shown && shown.draft.trim() === draft.trim()) return { selected: shown.key, products: shown.products };
  const matched = variantOfDraft(variants, draft);
  return { selected: matched?.key ?? null, products: matched?.products ?? [] };
}
export type Shown = { replyId: string; key: string; draft: string; products: VariantProduct[] };

export function useCompose(replyId: string, draft: string, setDraft: (v: string) => void) {
  const { presets, status: presetStatus } = usePresets(replyId);
  const [working, setWorking] = useState(false);
  const [note, setNote] = useState("");
  const [shown, setShown] = useState<Shown | null>(null);
  const [waiting, setWaiting] = useState<Waiting | null>(null);
  const waitingRef = useRef<Waiting | null>(null);
  const current = useRef(replyId);
  useEffect(() => {
    waitingRef.current = waiting;
    current.current = replyId;
  }, [waiting, replyId]);

  const show = useCallback(
    (key: string, text: string, products: VariantProduct[], label: string) => {
      setDraft(text);
      setShown({ replyId, key, draft: text, products });
      setNote(label);
    },
    [replyId, setDraft]
  );

  const post = useCallback(
    async (preset: ComposePresetView, label: string) => {
      const id = replyId;
      setWorking(true);
      setNote("");
      const got = await requestCompose(id, preset);
      if (current.current !== id) return;
      setWorking(false);
      if ("draft" in got) show(preset.id, got.draft, got.products, label);
      else setNote(got.missing ? "초안기를 준비하는 중이에요" : got.error);
    },
    [replyId, show]
  );

  const nameOf = useCallback((id: string) => presets.find((p) => p.id === id)?.name ?? "이", [presets]);

  // 기다리던 버전이 도착하면 바로 바꾼다. 너무 오래 걸리거나 쓰는 벌이 없으면 그 버전 하나만 새로 쓴다
  const onFresh = useCallback(
    (fresh: VariantsState) => {
      const w = waitingRef.current;
      if (!w || fresh.status !== "ready") return;
      const v = fresh.variants.find((x) => x.key === w.id);
      if (!v && stillWriting(fresh.pending, w.id) && Date.now() - w.since < VARIANT_WAIT_MS) return;
      waitingRef.current = null;
      setWaiting(null);
      const preset = presets.find((p) => p.id === w.id);
      if (v) {
        show(v.key, v.draft, v.products ?? [], `${nameOf(v.key)} 버전이에요`);
        chooseVariant(replyId, v.key);
      } else if (preset) void post(preset, `${preset.name} 버전을 새로 썼어요`);
    },
    [presets, nameOf, show, post, replyId]
  );
  const { cur: variants, kick } = useVariants(replyId, onFresh);
  const list = variants.status === "ready" ? variants.variants : NO_VARIANTS;

  const pick = useCallback(
    (id: string) => {
      const preset = presets.find((p) => p.id === id);
      if (!preset) return;
      const ready = list.find((v) => v.key === id);
      if (ready) {
        setWaiting(null);
        show(ready.key, ready.draft, ready.products ?? [], `${preset.name} 버전이에요`);
        chooseVariant(replyId, ready.key);
        return;
      }
      if (variants.status === "ready" && stillWriting(variants.pending, id)) {
        setNote(`${preset.name} 버전을 쓰는 중이에요. 다 되면 바로 바뀌어요`);
        setWaiting({ id, since: Date.now() });
        return;
      }
      setWaiting(null);
      void post(preset, `${preset.name} 버전을 새로 썼어요`);
    },
    [presets, list, variants, show, post, replyId]
  );

  const { selected, products } = selectionOf(shown?.replyId === replyId ? shown : null, list, draft);

  /** 지금 버전(없으면 첫 버전) 그대로 처음부터 다시 쓰기 */
  const rewrite = useCallback(() => {
    const preset = presets.find((p) => p.id === (selected ?? "")) ?? presets[0];
    if (preset) void post(preset, `${preset.name} 버전을 새로 썼어요`);
  }, [presets, selected, post]);

  /** 이 댓글의 버전 전부를 버리고 다시 쓰기 */
  const [restarting, setRestarting] = useState(false);
  const restartAll = useCallback(async () => {
    const id = replyId;
    setRestarting(true);
    setWaiting(null);
    setNote("");
    const got = await restartFresh([id]);
    if (current.current !== id) return;
    setRestarting(false);
    if ("error" in got) {
      setNote(got.error);
      return;
    }
    setNote(got.busy.includes(id) ? "이미 쓰는 중이에요. 다 되면 바뀌어요" : "버전 전부 다시 쓰는 중이에요. 1분쯤 걸려요");
    await kick();
  }, [replyId, kick]);
  const writingAll = restarting || (variants.status === "ready" && variants.pending.includes("*"));

  const ready = new Set(list.map((v) => v.key));
  return { restartAll, restarting, writingAll, presets, selected, ready, status: working ? ("working" as const) : presetStatus, note, pick, rewrite, products, loadingId: waiting ? waiting.id : null, hasVariants: list.length > 0 };
}
