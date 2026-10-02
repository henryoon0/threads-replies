"use client";

// 스레드 쪽 위 가로 막대 왼쪽 (10-02 픽 "목록 + 스레드 모양 답"): [계정 ▾] 남은 N.
// 질문 칸은 목록의 "질문만" 필터로, 기록·학습은 오른쪽 ··· 메뉴(threadsPlaceMenu)로 옮겼다.
// 댓글이 아닌 칸에 있을 땐 [← 댓글로] 를 띄워 돌아올 길을 둔다.

import { ArrowLeftIcon } from "@heroicons/react/16/solid";
import type { ThreadsSummary } from "@/lib/threads-replies/summary";
import { cn } from "@/lib/utils";
import { PersonaCard } from "./persona-card";
import { press } from "./threads-answer-verdict";
import type { MoreSection } from "./threads-more-menu";
import { type LearnView, type ThreadsPlace } from "./threads-place";
import type { PersonaListItem } from "./use-persona";

const LEARN_ITEMS: readonly { view: LearnView; label: string }[] = [
  { view: "review", label: "주간 검토" },
  { view: "rules", label: "규칙 정리" },
  { view: "progress", label: "성과" },
  { view: "voice", label: "말투 재료" },
];

const PLACE_LABEL: Record<ThreadsPlace, string> = {
  comments: "댓글",
  questions: "질문",
  history: "기록",
  review: "학습 · 주간 검토",
  rules: "학습 · 규칙 정리",
  progress: "학습 · 성과",
  voice: "학습 · 말투 재료",
};

/** ··· 메뉴의 칸 이동 섹션: 학습 4개 + 기록 */
export function threadsPlaceMenu(place: ThreadsPlace, go: (p: ThreadsPlace) => void, s: ThreadsSummary | null): MoreSection[] {
  return [
    { title: "학습", items: LEARN_ITEMS.map((i) => ({ label: i.label, checked: place === i.view, onSelect: () => go(i.view) })) },
    { items: [{ label: `답한 기록${s?.history != null ? ` ${s.history.toLocaleString()}` : ""}`, checked: place === "history", onSelect: () => go("history") }] },
  ];
}

/** 계정 · 남은 수 (댓글이 아닌 칸이면 · 그 칸 이름 + 댓글로 돌아가기). 오른쪽 도구는 답 화면(threads-mode-bar)이 이어 붙인다. */
export function ThreadsNav({
  summary,
  place,
  go,
  persona,
}: {
  summary: ThreadsSummary | null;
  place: ThreadsPlace;
  go: (p: ThreadsPlace) => void;
  persona: { current: PersonaListItem | null; list: PersonaListItem[]; onSwitch: (id: string) => void };
}) {
  const away = place !== "comments";
  return (
    <nav aria-label="스레드 채널" className="flex flex-wrap items-center gap-3">
      <PersonaCard compact current={persona.current} list={persona.list} onSwitch={persona.onSwitch} />
      {away ? (
        <>
          <button
            type="button"
            onClick={() => go("comments")}
            className={cn("inline-flex h-9 items-center gap-1.5 rounded-[10px] px-2.5 text-[12.5px] font-medium text-neutral-600 hover:bg-neutral-950/[0.04] hover:text-neutral-900", press)}
          >
            <ArrowLeftIcon className="size-3.5" aria-hidden />
            댓글로
          </button>
          <span className="text-[13px] font-medium text-neutral-900">{PLACE_LABEL[place]}</span>
        </>
      ) : summary?.pending != null ? (
        <span className="text-[13px] tabular-nums text-neutral-500">남은 {summary.pending.toLocaleString()}</span>
      ) : null}
    </nav>
  );
}
