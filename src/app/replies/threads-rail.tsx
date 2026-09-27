"use client";

// 스레드 쪽 왼쪽 레일: 댓글(답할 차례) · 질문(그중 질문만) · 기록(답했거나 건너뜀).
// 레일 아래 한 줄로 앱이 뒤에서 하는 일(가져오기·초안)과 하지 않는 일(발송)을 알린다.

import { ChatBubbleOvalLeftIcon } from "@heroicons/react/16/solid";
import type { ThreadsSummary } from "@/lib/threads-replies/summary";
import { RailItem } from "./rail-item";
import type { ThreadsView } from "./threads-view";

const LAYOUT_ID = "th-rail-active";

export function ThreadsRail({
  summary: s,
  view,
  go,
}: {
  summary: ThreadsSummary | null;
  view: ThreadsView;
  go: (v: ThreadsView) => void;
}) {
  return (
    <nav aria-label="스레드 채널" className="sticky top-5 w-52 shrink-0 self-start">
      <div className="space-y-0.5">
        <RailItem
          active={view === "comments"}
          onClick={() => go("comments")}
          Icon={ChatBubbleOvalLeftIcon}
          label="댓글"
          count={s?.pending}
          layoutId={LAYOUT_ID}
        />
        <RailItem
          sub
          active={view === "questions"}
          onClick={() => go("questions")}
          label="질문"
          count={s?.questions}
          layoutId={LAYOUT_ID}
        />
        <RailItem
          sub
          active={view === "history"}
          onClick={() => go("history")}
          label="기록"
          count={s?.history}
          layoutId={LAYOUT_ID}
        />
      </div>
      <p className="mt-3 break-keep px-2.5 pt-3 text-[11px] leading-relaxed text-neutral-500 shadow-[0_-1px_0_0_rgba(10,10,10,0.05)]">
        10분마다 새 댓글을 가져와 초안을 미리 써 둬요. 보내기는 직접 누른 것만 나가요.
      </p>
    </nav>
  );
}
