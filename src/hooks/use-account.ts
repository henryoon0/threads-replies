"use client";

import { useCallback, useEffect, useState } from "react";

export interface AccountView {
  connected: boolean;
  username?: string;
  intro?: string;
  expiresAt?: string;
  caps?: { ai: { claude: boolean; codex: boolean; state?: "ready" | "logged-out" | "missing" }; capture: boolean; imageAttach: boolean };
  /** 켜질 때 이 컴퓨터에서 토큰을 찾아본 결과 */
  found?: { state: "connected"; username: string; from: string } | { state: "none"; tried: number } | null;
}

/** 연결된 스레드 계정과 이 컴퓨터에서 켤 수 있는 기능. null = 아직 모름(불러오는 중). */
export function useAccount(): [AccountView | null, () => Promise<void>] {
  const [account, setAccount] = useState<AccountView | null>(null);
  const reload = useCallback(async () => {
    const res = await fetch("/api/account", { cache: "no-store" });
    setAccount(res.ok ? ((await res.json()) as AccountView) : { connected: false });
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  return [account, reload];
}
