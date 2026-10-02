"use client";

// 긴 글을 N줄로 자르고, 실제로 잘렸을 때만 [더 보기]를 단다 (10-02 henry "모든 글자가 다 보일 수 있을까").
// 자르기만 하면 내용을 잃는다 — 펼치면 원문 전체, 마우스를 올리면 풍선 글로도 볼 수 있게 둔다.
// 줄바꿈·연속 띄어쓰기는 pre-wrap 으로 그대로 (스레드에 달린 모양과 같게).

import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const CLAMP: Record<number, string> = { 2: "line-clamp-2", 3: "line-clamp-3", 4: "line-clamp-4", 6: "line-clamp-6" };

export function ClampText({ text, lines, className }: { text: string; lines: 2 | 3 | 4 | 6; className?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [cut, setCut] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && !open) setCut(el.scrollHeight > el.clientHeight + 1);
  }, [text, open]);
  return (
    <div>
      <p ref={ref} title={cut && !open ? text : undefined} className={cn("whitespace-pre-wrap break-keep [overflow-wrap:anywhere]", !open && CLAMP[lines], className)}>
        {text}
      </p>
      {cut || open ? (
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="mt-0.5 text-[11.5px] font-medium text-neutral-500 hover:text-neutral-900">
          {open ? "접기" : "더 보기"}
        </button>
      ) : null}
    </div>
  );
}
