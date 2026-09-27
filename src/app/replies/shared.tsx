"use client";

// 목록·답 패널이 같이 쓰는 작은 조각: 아바타와 "n분 전" 표시.
import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowTopRightOnSquareIcon } from "@heroicons/react/16/solid";

const AVATAR_COLORS = [
  "bg-emerald-100 text-emerald-700",
  "bg-sky-100 text-sky-700",
  "bg-amber-100 text-amber-700",
  "bg-rose-100 text-rose-700",
  "bg-indigo-100 text-indigo-700",
];

function avatarColor(username: string) {
  let h = 0;
  for (let i = 0; i < username.length; i++) h = (h * 31 + username.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function Avatar({
  username,
  size = "md",
  photoUrl,
}: {
  username: string;
  size?: "sm" | "lg" | "md";
  photoUrl?: string;
}) {
  const cls = size === "lg" ? "size-10 text-sm" : size === "sm" ? "size-7 text-[11px]" : "size-8 text-xs";
  const [broken, setBroken] = useState(false);
  if (photoUrl && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={photoUrl}
        alt={username}
        onError={() => setBroken(true)}
        className={`shrink-0 rounded-full object-cover ring-1 ring-neutral-950/5 ${cls}`}
        loading="lazy"
      />
    );
  }
  const label = username.replace(/^\(|\)$/g, "").slice(0, 1).toUpperCase() || "?";
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold ${avatarColor(username)} ${cls}`}>
      {label}
    </span>
  );
}

export function relativeTime(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  const min = Math.floor(ms / 60000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  return `${Math.floor(hr / 24)}일 전`;
}

/**
 * 접힌 내용을 높이 스프링으로 편다. 상시 노출이던 칸(맥락·지시)을 접어두는 데 쓴다.
 * 튐 없이(bounce 0) 열리고, prefers-reduced-motion 이면 페이드만.
 */
