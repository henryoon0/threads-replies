"use client";

// 지금 답하는 계정(페르소나). 서버는 쿠키 reply-persona 나 ?persona= 로 계정을 가른다
// (src/lib/personas/context.ts). 화면은 둘 다 맞춰 두고, 바꾸면 스레드 쪽을 새로 그린다.

import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import type { ThreadsSummary } from "@/lib/threads-replies/summary";

export const PERSONA_COOKIE = "reply-persona";

export interface PersonaListItem {
  id: string;
  name: string;
  handle: string;
  register: "해요체" | "반말";
  gate: "light" | "strict";
  send: "api" | "copy";
  hasToken: boolean;
  summary: ThreadsSummary;
}

function writePersonaCookie(id: string) {
  document.cookie = `${PERSONA_COOKIE}=${encodeURIComponent(id)}; path=/; max-age=31536000; samesite=lax`;
}

function writePersonaToUrl(id: string) {
  const url = new URL(window.location.href);
  if (id === "glp1") url.searchParams.delete("persona");
  else url.searchParams.set("persona", id);
  window.history.replaceState(null, "", url);
}

export function usePersona(initial: string) {
  const [persona, setPersona] = useState(initial);
  const [list, setList] = useState<PersonaListItem[]>([]);

  // 자식 화면의 첫 요청(useEffect)보다 먼저 쿠키를 맞춘다 — 레이아웃 효과가 모든 일반 효과보다 먼저 돈다.
  useLayoutEffect(() => {
    writePersonaCookie(initial);
  }, [initial]);

  const loadList = useCallback(
    () =>
      fetch("/api/personas", { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<{ personas: PersonaListItem[] }>) : null))
        .then((d) => {
          if (d) setList(d.personas);
        })
        // 목록은 보조 정보 — 실패하면 지난 값을 둔다
        .catch(() => {}),
    []
  );

  useEffect(() => {
    loadList();
  }, [loadList]);

  const switchPersona = useCallback((id: string) => {
    writePersonaCookie(id);
    writePersonaToUrl(id);
    setPersona(id);
  }, []);

  const current = list.find((p) => p.id === persona) ?? null;
  return { persona, current, list, switchPersona, reloadList: loadList };
}
