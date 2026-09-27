"use client";

import { createContext, useContext } from "react";

/** 연결된 내 스레드 아이디 — 목록의 "내 답" 칸이 쓴다. 서버가 /api/threads-replies 로 내려준다. */
export const MeContext = createContext("");
export const useMe = () => useContext(MeContext);

/** 이미지 첨부를 켤 수 있는지 (Cloudflare 로그인이 돼 있어야 스레드가 가져갈 공개 주소가 생긴다) */
export const AttachContext = createContext(true);
export const useCanAttach = () => useContext(AttachContext);

/** 스레드 글리프 (브랜드 로고 대신 선 두 개로 그린 표시) */
export function ThreadsMark({ size = 13, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden className={`shrink-0 ${className}`}>
      <path
        d="M11.2 7.3c-.2-2-1.5-3.1-3.3-3.1-2 0-3.3 1.5-3.3 3.8s1.4 3.8 3.4 3.8c1.9 0 3-1.2 3-2.6 0-1.6-1.3-2.4-3-2.4-1.3 0-2.1.7-2.1 1.6 0 .9.8 1.5 1.8 1.5 1.5 0 2.4-1.2 2.4-3.3"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path d="M8 14.2A6.2 6.2 0 1 1 14.2 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
