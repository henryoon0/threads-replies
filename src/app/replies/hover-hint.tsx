import type { ReactNode } from "react";

/** 아이콘 버튼 아래에 바로 뜨는 짧은 이름표. 브라우저 기본 title 툴팁은 늦게 뜨거나 안 떠서 따로 둔다 */
export function HoverHint({ label, children }: { label: string; children: ReactNode }) {
  if (!label) return children;
  return (
    <span className="group/hint relative inline-flex">
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full z-30 mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-neutral-900 px-2 py-1 text-[11.5px] font-medium text-white opacity-0 transition-opacity delay-0 group-hover/hint:opacity-100 group-hover/hint:delay-300 group-has-[:focus-visible]/hint:opacity-100"
      >
        {label}
      </span>
    </span>
  );
}
