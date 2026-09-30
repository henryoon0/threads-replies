"use client";

// 주간 검토 카드 한 장의 몸통: 주인 패턴 분석 → 실제 기록 3개 → 규칙 변경(전/후) → 안전 잠금.
import { ArrowRightIcon, LockClosedIcon } from "@heroicons/react/16/solid";
import type { Pattern } from "@/lib/personas/learning/patterns";
import { cn } from "@/lib/utils";
import { cardTitle, changeLines, cardTriplets, isLockedCard, type PatternExample, type ReviewCard } from "./learn-data";

export function ReviewCardBody({ card }: { card: ReviewCard }) {
  const locked = isLockedCard(card);
  const [lead, ...more] = card.patterns;
  const triplets = cardTriplets(card);
  return (
    <div className={cn(locked && "text-neutral-500")}>
      <p className="text-[11.5px] font-medium text-neutral-500">{card.type === "proposal" ? "규칙 바꾸기 제안" : "새로 찾은 패턴"}</p>
      <h3 className={cn("mt-1.5 text-balance break-keep text-[22px] font-semibold leading-snug tracking-[-0.02em]", locked ? "text-neutral-500" : "text-neutral-900")}>
        {cardTitle(card)}
      </h3>
      {locked ? <LockNote reason={card.safety.reason ?? card.reason ?? "안전 규칙과 부딪혀서 자동으로 막았어요."} /> : null}
      {lead ? <PatternBlock p={lead} showTitle={lead.title !== cardTitle(card)} /> : null}
      {triplets.length ? <Triplets list={triplets} /> : null}
      {more.length ? <MorePatterns list={more} /> : null}
      <ChangeBlock card={card} />
    </div>
  );
}

function PatternBlock({ p, showTitle }: { p: Pattern; showTitle: boolean }) {
  return (
    <section className="mt-5">
      <SectionLabel>패턴 분석</SectionLabel>
      {showTitle ? <p className="mt-2 break-keep text-[14px] font-medium text-neutral-800">{p.title}</p> : null}
      <p className="mt-1.5 break-keep text-[13.5px] leading-relaxed text-neutral-700">{p.insight}</p>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
        <dt className="text-neutral-400">언제</dt>
        <dd className="break-keep text-neutral-700">{p.when || "상황 설명이 없어요"}</dd>
        <dt className="text-neutral-400">기록</dt>
        <dd className="tabular-nums text-neutral-700">{p.count}건에서 이렇게 고쳤어요</dd>
      </dl>
    </section>
  );
}

function Triplets({ list }: { list: PatternExample[] }) {
  return (
    <section className="mt-5">
      <SectionLabel>실제 기록 {list.length}개</SectionLabel>
      <ol className="mt-2 space-y-2">
        {list.map((t, i) => (
          <li key={i} className="grid gap-x-3 gap-y-1 rounded-xl bg-neutral-950/[0.025] px-3.5 py-3 text-[12.5px] leading-relaxed sm:grid-cols-[4.5rem_1fr]">
            <span className="text-neutral-400">댓글</span>
            <p className="break-keep text-neutral-600">{t.comment}</p>
            <span className="text-neutral-400">AI 초안</span>
            <p className="break-keep text-neutral-400 line-through decoration-neutral-300">{t.aiDraft || "초안 없음"}</p>
            <span className="font-medium text-emerald-700">보낸 답</span>
            <p className="break-keep font-medium text-neutral-900">{t.final}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function MorePatterns({ list }: { list: Pattern[] }) {
  return (
    <details className="group mt-3 text-[12.5px]">
      <summary className="cursor-pointer select-none rounded-lg py-1 text-neutral-500 hover:text-neutral-800">같이 찾은 패턴 {list.length}개 더 보기</summary>
      <ul className="mt-2 space-y-2">
        {list.map((p) => (
          <li key={p.id} className="rounded-xl bg-neutral-950/[0.025] px-3.5 py-2.5">
            <p className="break-keep font-medium text-neutral-800">{p.title}</p>
            <p className="mt-1 break-keep leading-relaxed text-neutral-600">{p.insight}</p>
            <p className="mt-1 tabular-nums text-neutral-400">{p.count}건</p>
          </li>
        ))}
      </ul>
    </details>
  );
}

function ChangeBlock({ card }: { card: ReviewCard }) {
  const lines = changeLines(card);
  if (!lines.length) return null;
  return (
    <section className="mt-6">
      <SectionLabel>규칙책에 이렇게 바뀌어요</SectionLabel>
      <WhyLine why={card.proposal?.plainWhy} />
      <div className="mt-2 space-y-2">
        {lines.map((l, i) => (
          <Diff key={i} before={l.before} after={l.after} />
        ))}
      </div>
      <StaleNote show={card.proposal?.applicable === false} />
    </section>
  );
}

function WhyLine({ why }: { why: string | null | undefined }) {
  return why ? <p className="mt-2 break-keep text-[12.5px] leading-relaxed text-neutral-600">{why}</p> : null;
}

function StaleNote({ show }: { show: boolean }) {
  return show ? <p className="mt-2 text-[12px] text-amber-700">규칙책 문장이 그 사이 바뀌어서 그대로 적용되지 않을 수 있어요.</p> : null;
}

function Diff({ before, after }: { before: string | null; after: string }) {
  return (
    <div className="overflow-hidden rounded-xl text-[12.5px] leading-relaxed ring-1 ring-neutral-950/5">
      {before ? (
        <p className="whitespace-pre-wrap break-keep bg-neutral-950/[0.03] px-3.5 py-2.5 text-neutral-500">
          <span className="mr-2 select-none font-medium text-neutral-400">전</span>
          <span className="line-through decoration-neutral-300">{before}</span>
        </p>
      ) : null}
      <p className="flex gap-2 whitespace-pre-wrap break-keep bg-emerald-50/70 px-3.5 py-2.5 text-neutral-900 shadow-[0_-1px_0_0_rgba(10,10,10,0.05)]">
        {before ? <ArrowRightIcon className="mt-[3px] size-3.5 shrink-0 text-emerald-700" aria-hidden /> : <span className="shrink-0 select-none font-medium text-emerald-700">새 규칙</span>}
        <span>{after}</span>
      </p>
    </div>
  );
}

function LockNote({ reason }: { reason: string }) {
  return (
    <p className="mt-4 flex gap-2 rounded-xl bg-neutral-950/[0.04] px-3.5 py-3 text-[12.5px] leading-relaxed text-neutral-700">
      <LockClosedIcon className="mt-[3px] size-3.5 shrink-0 text-neutral-500" aria-hidden />
      <span className="break-keep">
        <span className="font-medium text-neutral-900">안전 잠금 · 적용할 수 없어요. </span>
        {reason}
      </span>
    </p>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h4 className="text-[11.5px] font-medium tracking-[0.01em] text-neutral-400">{children}</h4>;
}
