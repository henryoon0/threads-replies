"use client";

// 가져온 자료 (henry 09-29: "어떤 자료를 가져왔고, 유튜브 대본에서는 어떤 말을 했었는지 보이게").
// 예전 좌우 연결선 대신, 초안이 쓴 자료를 한 장씩 보여준다. 카드마다 "초안의 몇 번째 문장에 썼는지"를 붙인다.
//   팟캐스트·유튜브 발언(박약사) = 말한 사람 · 원문 발언 그대로 · 한국어 요약 · 영상 제목 · 그 초에서 여는 링크
//   성분 페이지(박약사)          = 성분 설명 원문 · 근거 강도
//   원본 주소가 있는 글(AICC)     = 형광 캡처를 크게 + 원문 인용 + 링크. 없으면 열 때 자동으로 찍는다
//   메모·FAQ 처럼 못 찍는 자료     = 원문 인용만
// 근거 인용에 없는 사실이라 초안에서 뺀 문장은 맨 아래 "근거 없어 뺀 문장"으로 남긴다.

import { useMemo, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowPathIcon, ArrowTopRightOnSquareIcon, ChevronDownIcon, PlayCircleIcon } from "@heroicons/react/16/solid";
import type { AnswerSource, DraftSentence, EvidenceShot, ReplyAnswer } from "@/lib/threads-replies/model";
import { cn } from "@/lib/utils";
import { Lightbox, useAutoShots } from "./threads-answer-evidence";
import { SourceKindChip, press } from "./threads-answer-verdict";
import { isShootableSource, shotKey, type ShotState } from "./use-threads-answer";
import { parseBrainPage, type BrainItem, type BrainPage } from "@/lib/threads-replies/brain-page";

const VERDICT_LINE: Record<ReplyAnswer["verdict"], { text: string; tone: string }> = {
  answerable: { text: "자료로 답했어요", tone: "text-emerald-800" },
  partial: { text: "일부만 자료로 답할 수 있어요", tone: "text-amber-800" },
  unknown: { text: "자료에 없어요 · 모른다고 답해요", tone: "text-neutral-700" },
};

/** 근거 id → 그 근거를 쓴 초안 문장 번호(1부터) */
function usesOf(sentences: readonly DraftSentence[]): Map<string, number[]> {
  const out = new Map<string, number[]>();
  sentences.forEach((s, i) => s.sourceIds.forEach((id) => out.set(id, [...(out.get(id) ?? []), i + 1])));
  return out;
}

function clock(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

function UsedBy({ nums, sentences }: { nums: number[]; sentences: readonly DraftSentence[] }) {
  if (!nums.length) return <p className="mt-2 text-[11px] text-neutral-400">초안에는 쓰지 않았어요</p>;
  return (
    <ul className="mt-2 space-y-0.5">
      {nums.map((n) => (
        <li key={n} className="flex gap-1.5 text-[11.5px] leading-relaxed text-emerald-800">
          <span className="shrink-0 font-semibold tabular-nums">문장 {n}</span>
          <span className="min-w-0 truncate text-neutral-600">{sentences[n - 1]?.text}</span>
        </li>
      ))}
    </ul>
  );
}

function OpenLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 text-[11.5px] font-medium text-emerald-700 hover:text-emerald-800 hover:underline">
      {children}
      <ArrowTopRightOnSquareIcon className="size-3 shrink-0" />
    </a>
  );
}

/** 팟캐스트·유튜브 발언: 누가, 원문 그대로 무슨 말을, 영상 어디서 */
function SpokenCard({ s }: { s: AnswerSource }) {
  const ingredient = s.title.split(" · ")[1]?.replace(/\s*\(.*\)$/, "");
  return (
    <>
      <p className="flex items-center gap-1.5">
        <PlayCircleIcon className="size-4 shrink-0 text-amber-700" aria-hidden />
        <span className="text-[12.5px] font-semibold text-neutral-900">{s.speaker ?? s.title.split(" · ")[0]}</span>
        {ingredient ? <span className="text-[11.5px] text-neutral-500">· {ingredient}</span> : null}
        <span className="ml-auto shrink-0 text-[10.5px] text-neutral-400">관점일 뿐, 추천 근거 아님</span>
      </p>
      <blockquote className="mt-2 rounded-[10px] bg-neutral-950/[0.03] px-3 py-2 text-[13px] leading-[1.6] text-neutral-800 break-keep">“{s.quote}”</blockquote>
      {s.claimKo ? <p className="mt-1.5 px-1 text-[12px] leading-relaxed text-neutral-600 break-keep">한국어 요약: {s.claimKo}</p> : null}
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 px-1">
        {s.videoTitle ? <span className="min-w-0 truncate text-[11.5px] text-neutral-500">{s.videoTitle}</span> : null}
        {s.url ? <OpenLink href={s.url}>{s.startSec != null ? `${clock(s.startSec)}부터 보기` : "영상 열기"}</OpenLink> : null}
      </div>
    </>
  );
}

// ── 성분 페이지: 마크다운 대신 제목 · 찾는 말 · 앞 말 2개 (2026-09-30 시안 digest) ──

function TagChips({ tags }: { tags: string[] }) {
  if (!tags.length) return null;
  return (
    <ul aria-label="이럴 때 찾는다" className="mt-2 flex flex-wrap gap-1">
      {tags.map((t) => (
        <li key={t} className="rounded-full bg-neutral-950/[0.04] px-2 py-0.5 text-[11px] text-neutral-600">
          {t}
        </li>
      ))}
    </ul>
  );
}

function ItemLine({ it }: { it: BrainItem }) {
  return (
    <li className="text-[12px] leading-relaxed text-neutral-700">
      {it.label ? <span className="mr-1.5 inline-block rounded bg-neutral-950/[0.05] px-1 py-px align-[1px] text-[10px] font-medium text-neutral-600">{it.label}</span> : null}
      {it.speaker ? <span className="mr-1 font-semibold text-neutral-900">{it.speaker}</span> : null}
      <span>{it.text}</span>
      {it.link && /^https?:\/\//i.test(it.link.url) ? (
        <a href={it.link.url} target="_blank" rel="noreferrer" className="ml-1.5 whitespace-nowrap text-[11.5px] font-medium text-emerald-700 hover:text-emerald-800 hover:underline">
          {it.link.label}
        </a>
      ) : null}
    </li>
  );
}

function BrainHeader({ s, page }: { s: AnswerSource; page: BrainPage }) {
  const name = page.heading ?? (s.strength ? s.title.replace(` · ${s.strength}`, "") : s.title);
  return (
    <p className="flex flex-wrap items-center gap-1.5">
      <SourceKindChip kind={s.kind} />
      <span className="text-[12.5px] font-semibold text-neutral-900">{name}</span>
      {s.strength ? <span className="text-[11px] text-neutral-500">근거 강도: {s.strength}</span> : null}
    </p>
  );
}

function BrainPageCard({ s }: { s: AnswerSource }) {
  const page = useMemo(() => parseBrainPage(s.quote), [s.quote]);
  const items = page.sections.flatMap((x) => x.items);
  return (
    <>
      <BrainHeader s={s} page={page} />
      <TagChips tags={page.tags} />
      {items.length ? (
        <>
          <ul className="mt-2 space-y-1.5">{items.slice(0, 2).map((it, i) => <ItemLine key={i} it={it} />)}</ul>
          {items.length > 2 ? <p className="mt-1 text-[11px] text-neutral-400">외 {items.length - 2}개</p> : null}
        </>
      ) : null}
      {page.rest ? <p className="mt-2 line-clamp-4 whitespace-pre-line text-[12px] leading-relaxed text-neutral-700 break-keep">{page.rest}</p> : null}
      {!page.rest && !items.length && !page.tags.length && !page.heading ? <p className="mt-2 line-clamp-4 text-[12px] text-neutral-700">{s.quote}</p> : null}
    </>
  );
}

function ShotBlock({ state, s, onOpen, onRetry }: { state: ShotState | undefined; s: AnswerSource; onOpen: (shot: EvidenceShot) => void; onRetry: () => void }) {
  const reduce = useReducedMotion();
  if (state?.status === "done") {
    return (
      <motion.button
        type="button"
        layoutId={reduce ? undefined : `th-shot-${state.shot.image}`}
        onClick={() => onOpen(state.shot)}
        aria-label={`${s.title} 원문 캡처 크게 보기`}
        className={cn("mt-2 block w-full overflow-hidden rounded-[10px] bg-neutral-50 outline outline-1 -outline-offset-1 outline-black/10", press)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- public/ 아래 방금 찍은 PNG */}
        <img src={state.shot.image} alt="원문에서 인용을 형광펜으로 칠한 캡처" className="max-h-[420px] w-full object-cover object-top" />
      </motion.button>
    );
  }
  if (state?.status === "failed") {
    return (
      <p className="mt-2 flex items-center gap-2 rounded-[10px] bg-neutral-950/[0.03] px-3 py-2 text-[11.5px] text-neutral-600">
        <span className="min-w-0 flex-1 truncate">캡처하지 못했어요 · {state.error}</span>
        <button type="button" onClick={onRetry} className={cn("inline-flex shrink-0 items-center gap-1 font-medium text-emerald-700 hover:text-emerald-800", press)}>
          <ArrowPathIcon className="size-3" />
          다시 찍기
        </button>
      </p>
    );
  }
  return <span className="mt-2 flex h-40 animate-pulse items-center justify-center rounded-[10px] bg-neutral-100 text-[11px] text-neutral-500">원문 캡처 중 · 10~25초</span>;
}

/** 원본 글 (캡처할 수 있으면 캡처를 크게) · 메모·FAQ (인용만) */
function TextCard({ s, shot, onOpen, onRetry }: { s: AnswerSource; shot: ShotState | undefined | null; onOpen: (x: EvidenceShot) => void; onRetry: () => void }) {
  return (
    <>
      <p className="flex items-center gap-1.5">
        <SourceKindChip kind={s.kind} />
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-neutral-800">{s.title}</span>
      </p>
      {shot !== null ? <ShotBlock state={shot} s={s} onOpen={onOpen} onRetry={onRetry} /> : null}
      <p className="mt-2 line-clamp-5 whitespace-pre-line text-[12.5px] leading-relaxed text-neutral-700 break-keep">“{s.quote}”</p>
      {s.url ? (
        <div className="mt-1.5">
          <OpenLink href={s.url}>{s.url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 60)}</OpenLink>
        </div>
      ) : s.origin ? (
        <p className="mt-1.5 truncate text-[10.5px] text-neutral-400">{s.origin}</p>
      ) : null}
    </>
  );
}

interface CardProps {
  replyId: string;
  s: AnswerSource;
  nums: number[];
  sentences: readonly DraftSentence[];
  shots: Record<string, ShotState>;
  request: (replyId: string, source: AnswerSource) => void;
  onOpen: (shot: EvidenceShot) => void;
}

function SourceEvidence({ replyId, s, nums, sentences, shots, request, onOpen }: CardProps) {
  const body =
    s.kind === "팟캐스트 발언" ? (
      <SpokenCard s={s} />
    ) : s.kind === "성분 페이지" ? (
      <BrainPageCard s={s} />
    ) : (
      <TextCard s={s} shot={isShootableSource(s) ? shots[shotKey(replyId, s)] : null} onOpen={onOpen} onRetry={() => request(replyId, s)} />
    );
  return (
    <li data-source={s.id} className="rounded-[14px] bg-white p-3 ring-1 ring-neutral-950/5">
      {body}
      <UsedBy nums={nums} sentences={sentences} />
    </li>
  );
}

function Dropped({ items }: { items: NonNullable<ReplyAnswer["dropped"]> }) {
  return (
    <div className="rounded-[14px] bg-amber-50/70 p-3">
      <p className="text-[12px] font-semibold text-amber-900">근거 없어 뺀 문장 {items.length}</p>
      <ul className="mt-1.5 space-y-1.5">
        {items.map((d, i) => (
          <li key={i} className="text-[12px] leading-relaxed break-keep">
            <span className="text-neutral-500 line-through decoration-amber-700/40">{d.text}</span>
            <span className="ml-1.5 text-[11px] text-amber-800">{d.reason}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 펼쳤을 때만 캡처를 찍는다 (안 쓴 자료까지 미리 찍으면 크로미움이 오래 붙잡힌다) */
function UnusedList({ replyId, sources, request, card }: { replyId: string; sources: AnswerSource[]; request: CardProps["request"]; card: (s: AnswerSource) => ReactNode }) {
  useAutoShots(replyId, sources, request);
  return <ul className="mt-1 space-y-2">{sources.map(card)}</ul>;
}

export function AnswerSources({
  replyId,
  answer,
  shots,
  request,
}: {
  replyId: string;
  answer: ReplyAnswer;
  shots: Record<string, ShotState>;
  request: (replyId: string, source: AnswerSource) => void;
}) {
  const [big, setBig] = useState<EvidenceShot | null>(null);
  const [showUnused, setShowUnused] = useState(false);
  const { sentences, sources } = answer;
  const uses = useMemo(() => usesOf(sentences), [sentences]);
  const used = sources.filter((s) => uses.has(s.id));
  const unused = sources.filter((s) => !uses.has(s.id));
  useAutoShots(replyId, used, request);
  const v = VERDICT_LINE[answer.verdict];
  const card = (s: AnswerSource) => (
    <SourceEvidence key={s.id} replyId={replyId} s={s} nums={uses.get(s.id) ?? []} sentences={sentences} shots={shots} request={request} onOpen={setBig} />
  );

  return (
    <section aria-label="가져온 자료" className="space-y-2">
      <div className="flex items-baseline gap-2 px-1">
        <h3 className="text-[12.5px] font-semibold text-neutral-900">가져온 자료 {used.length}</h3>
        {answer.model !== "henry" ? <p className={cn("text-[11.5px]", v.tone)}>{v.text}</p> : null}
      </div>
      {used.length ? <ul className="space-y-2">{used.map(card)}</ul> : <p className="px-1 text-[12px] text-neutral-500">초안이 쓴 자료가 없어요</p>}
      {answer.dropped?.length ? <Dropped items={answer.dropped} /> : null}
      {unused.length ? (
        <div>
          <button
            type="button"
            aria-expanded={showUnused}
            onClick={() => setShowUnused((x) => !x)}
            className={cn("inline-flex h-8 items-center gap-1 rounded-[10px] px-2 text-[11.5px] text-neutral-500 hover:bg-neutral-950/[0.03] hover:text-neutral-800", press)}
          >
            <ChevronDownIcon className={cn("size-3.5 transition-transform duration-150", showUnused && "rotate-180")} />
            찾았지만 안 쓴 자료 {unused.length}
          </button>
          {showUnused ? <UnusedList replyId={replyId} sources={unused} request={request} card={card} /> : null}
        </div>
      ) : null}
      <Lightbox shot={big} onClose={() => setBig(null)} />
    </section>
  );
}
