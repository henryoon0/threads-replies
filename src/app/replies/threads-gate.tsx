"use client";

// 안전 관문 칠하기 (시안 픽 7·11). 빨간 배지 대신 걸린 표현 글자 위에 옅게 색을 칠하고,
// 손을 올리거나 초점을 주면 이유(+바꿀 표현)를 보여준다. 목록·3벌·완성된 답 모두 이 모양 하나를 쓴다.
// 규칙은 GET /api/personas/gate-rules 로 한 번 읽고, 검사는 순수 함수 checkGate 로 화면에서 바로 한다.
// 보내기 직전 판정은 서버가 다시 한다 (send 라우트) — 여기 결과는 미리 보기다.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Tooltip } from "@/components/ui/tooltip";
import { applyGateMode, checkGate, EMPTY_GATE_RULES, parseGateRules, type GateRules } from "@/lib/personas/gate";
import { PAST_HIT_KIND } from "@/lib/threads-replies/consistency-spans";
import { FACT_HIT_KIND } from "@/lib/threads-replies/fact-check";
import type { GateHit, GateResult } from "@/lib/threads-replies/model";
import { cn } from "@/lib/utils";
import { focusPast } from "./past-focus";

export type GateMode = "light" | "strict";

export interface GateChecker {
  mode: GateMode;
  check: (text: string) => GateResult;
}

const PASS: GateResult = { status: "pass", hits: [] };

// 계정마다 한 번만 읽는다 (패널은 댓글마다 새로 그려진다)
const memo = new Map<string, Promise<{ mode: GateMode; rules: GateRules }>>();

function loadRules(persona: string) {
  const known = memo.get(persona);
  if (known) return known;
  const p = fetch("/api/personas/gate-rules", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((d: { gate?: string; rules?: unknown } | null) => ({
      mode: (d?.gate === "strict" ? "strict" : "light") as GateMode,
      rules: parseGateRules(d?.rules) ?? EMPTY_GATE_RULES,
    }))
    .catch(() => {
      memo.delete(persona);
      return { mode: "light" as GateMode, rules: EMPTY_GATE_RULES };
    });
  memo.set(persona, p);
  return p;
}

/** 지금 계정의 관문 검사기. 규칙을 읽기 전엔 모두 통과로 본다. */
export function useGate(persona = "current"): GateChecker {
  const [state, setState] = useState<{ mode: GateMode; rules: GateRules }>({ mode: "light", rules: EMPTY_GATE_RULES });
  useEffect(() => {
    let alive = true;
    loadRules(persona).then((s) => {
      if (alive) setState(s);
    });
    return () => {
      alive = false;
    };
  }, [persona]);
  return useMemo(
    () => ({
      mode: state.mode,
      check: (text: string) => (state.rules.rules.length && text ? applyGateMode(checkGate(text, state.rules), state.mode) : PASS),
    }),
    [state]
  );
}

/** 칠하는 색: 예전 답과 다름은 옅은 하늘색, 근거 없음·막음은 호박색, 확인은 옅은 돌색. 빨강은 쓰지 않는다 (henry 09-29). */
export function hitTone(hit: GateHit): string {
  if (hit.kind === PAST_HIT_KIND) return "bg-sky-100 text-sky-950";
  if (hit.kind === FACT_HIT_KIND) return "bg-amber-100 text-amber-950";
  return hit.action === "block" ? "bg-amber-200/80 text-amber-950" : "bg-stone-200/80 text-stone-900";
}

function PastReason({ hit, past }: { hit: GateHit; past: NonNullable<GateHit["past"]> }) {
  return (
    <span className="block max-w-[18rem] text-left">
      <span className="block text-[11px] font-semibold">예전 답과 다름</span>
      <span className="mt-0.5 block text-[10.5px] opacity-70">예전에 이렇게 답했어요</span>
      <span className="mt-1 block rounded-md bg-white/10 px-2 py-1 text-[11.5px] leading-relaxed break-keep">“{past.text}”</span>
      {past.comment ? <span className="mt-1 block text-[10.5px] leading-snug opacity-70 break-keep">받은 댓글: {past.comment}</span> : null}
      <span className="mt-1 block text-[11.5px] leading-relaxed break-keep">{hit.reason}</span>
      <span className="mt-1 flex items-center gap-2 text-[10.5px] opacity-80">
        {past.date ? <span className="tabular-nums">{past.date}</span> : null}
        {past.permalink ? (
          <a href={past.permalink} target="_blank" rel="noreferrer" className="pointer-events-auto underline underline-offset-2">
            그 답 열기
          </a>
        ) : null}
      </span>
    </span>
  );
}

/** 근거 없음 말풍선: ① 자료에서 못 찾은 말 ② 할 일. 상관없는 자료 목록은 믿음만 깎아서 보여주지 않는다 (henry 09-30). 제목 한 줄로 무엇 때문에 칠했는지 바로 읽힌다. */
function FactReason({ hit }: { hit: GateHit }) {
  const missing = hit.missing ?? [];
  return (
    <span className="block max-w-[19rem] text-left">
      <span className="block text-[11px] font-semibold">
        {missing.length ? "가져온 자료에 이 숫자·이름이 없어요" : "가져온 자료에 이 내용이 없어요"}
      </span>
      {missing.length ? (
        <span className="mt-1.5 flex flex-wrap gap-1">
          {missing.map((w) => (
            <span key={w} className="rounded bg-amber-100 px-1.5 py-0.5 text-[11.5px] font-semibold text-amber-950 tabular-nums">
              {w}
            </span>
          ))}
        </span>
      ) : (
        <span className="mt-0.5 block text-[11.5px] leading-relaxed break-keep">{hit.reason}</span>
      )}
      <span className="mt-1.5 block text-[11.5px] leading-relaxed break-keep">
        {missing.length ? "맞는 값인지 확인해요. 모르면 빼거나 자료에 있는 값으로 바꿔요." : "자료에 있는 말로 바꾸거나 빼요."}
      </span>
    </span>
  );
}

export function HitReason({ hit }: { hit: GateHit }) {
  if (hit.past) return <PastReason hit={hit} past={hit.past} />;
  if (hit.kind === FACT_HIT_KIND) return <FactReason hit={hit} />;
  return (
    <span className="block max-w-[16rem] text-left">
      <span className="block text-[11px] font-semibold">{hit.action === "block" ? "고쳐야 보낼 수 있어요" : "한 번 더 확인해요"}</span>
      <span className="mt-0.5 block text-[11.5px] leading-relaxed break-keep">{hit.reason}</span>
      {hit.suggest ? <span className="mt-1 block text-[11px] opacity-80">누르면 “{hit.suggest}”(으)로 바꿔요</span> : null}
    </span>
  );
}

/** text 를 걸린 구간과 아닌 구간으로 자른다. hits 는 겹치지 않고 앞에서부터 정렬돼 있다. */
export function segmentsOf(text: string, hits: readonly GateHit[]): { text: string; hit?: GateHit }[] {
  const out: { text: string; hit?: GateHit }[] = [];
  let at = 0;
  for (const hit of hits) {
    if (hit.start < at || hit.end > text.length) continue;
    if (hit.start > at) out.push({ text: text.slice(at, hit.start) });
    out.push({ text: text.slice(hit.start, hit.end), hit });
    at = hit.end;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

function Painted({ hit, children, onPick, className }: { hit: GateHit; children: ReactNode; onPick?: (hit: GateHit) => void; className?: string }) {
  return (
    <Tooltip content={<HitReason hit={hit} />} side="top" delayDuration={80}>
      <mark
        tabIndex={0}
        data-gate={hit.kind === PAST_HIT_KIND ? "past" : hit.action}
        aria-label={`${hit.phrase}: ${hit.reason}`}
        onClick={onPick ? (e) => (e.stopPropagation(), onPick(hit)) : undefined}
        onKeyDown={
          onPick
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onPick(hit);
                }
              }
            : undefined
        }
        className={cn(
          "rounded-[3px] box-decoration-clone px-[1px] outline-none focus-visible:ring-2",
          hit.kind === PAST_HIT_KIND ? "focus-visible:ring-sky-500/50" : "focus-visible:ring-amber-500/50",
          hitTone(hit),
          onPick && "cursor-pointer",
          className
        )}
      >
        {children}
      </mark>
    </Tooltip>
  );
}

/** 읽기 전용 글에 관문 칠하기 (목록 초안 한 줄·3벌 카드) */
export function GateText({ text, hits, className, onPick }: { text: string; hits: readonly GateHit[]; className?: string; onPick?: (hit: GateHit) => void }) {
  if (!hits.length) return <span className={className}>{text}</span>;
  return (
    <span className={className}>
      {segmentsOf(text, hits).map((s, i) =>
        s.hit ? (
          <Painted key={i} hit={s.hit} onPick={onPick}>
            {s.text}
          </Painted>
        ) : (
          <span key={i}>{s.text}</span>
        )
      )}
    </span>
  );
}

/** 걸린 구간을 제안 표현으로 바꾼 새 글 */
export function applySuggest(text: string, hit: GateHit): string {
  return hit.suggest === undefined ? text : text.slice(0, hit.start) + hit.suggest + text.slice(hit.end);
}

/**
 * 한 곳에서 고치는 입력칸 + 칠하기. 입력칸 위에 같은 글을 투명하게 겹쳐 걸린 구간만 칠하고 손을 받는다.
 * 칠한 곳을 누르면 제안이 있으면 바꾸고, 없으면 그 구간을 골라 두어 바로 고쳐 쓰게 한다.
 */
export function GateEditor({
  value,
  onChange,
  result,
  readOnly,
  placeholder,
  onSubmit,
  className,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  result: GateResult;
  readOnly?: boolean;
  placeholder?: string;
  onSubmit?: () => void;
  className: string;
  label: string;
}) {
  const [area, setArea] = useState<HTMLTextAreaElement | null>(null);
  const pick = (hit: GateHit) => {
    // 예전 답과 다름: 오른쪽 "비슷한 맥락에서 남긴 글"에 그 예전 답을 맨 위로 올려 칠한다 (읽기 전용이어도)
    if (hit.past) focusPast(hit.past);
    if (readOnly) return;
    if (hit.suggest !== undefined) {
      onChange(applySuggest(value, hit));
      return;
    }
    area?.focus();
    area?.setSelectionRange(hit.start, hit.end);
  };
  return (
    <div className="relative">
      <textarea
        ref={setArea}
        value={value}
        readOnly={readOnly}
        aria-label={label}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (onSubmit && e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
            e.preventDefault();
            onSubmit();
          }
        }}
        rows={3}
        className={cn("field-sizing-content block min-h-20 w-full resize-none bg-transparent focus:outline-none", className)}
      />
      {result.hits.length ? (
        <div aria-hidden={false} className={cn("pointer-events-none absolute inset-0 text-transparent", className)}>
          {segmentsOf(value, result.hits).map((s, i) =>
            s.hit ? (
              // 겹친 층은 입력칸 글자와 한 글자도 어긋나면 안 된다 — 칠하기 여백(px)을 없앤다 (09-29 겹쳐 보임 사고)
              <Painted key={i} hit={s.hit} onPick={pick} className="pointer-events-auto px-0 text-transparent mix-blend-multiply">
                {s.text}
              </Painted>
            ) : (
              <span key={i}>{s.text}</span>
            )
          )}
          {"​"}
        </div>
      ) : null}
    </div>
  );
}

function noteLine(notes: readonly GateHit[]): string {
  const first = notes[0];
  return `보낼 수 없는 표현 ${notes.length}개 (${first.phrase.slice(0, 24)}: ${first.reason})`;
}

/**
 * 칸 아래 한 줄 (완성된 답·확인 시트·일괄 칸). 칠한 것은 예전 답과 다름·근거 없음 둘뿐이라 그 둘을 센다.
 * 관문 막음(링크 등)은 칠하지 않고 여기에만 적는다.
 */
export function gateLine(result: GateResult): { text: string; tone: string } {
  const facts = result.hits.filter((h) => h.kind === FACT_HIT_KIND).length;
  const past = result.hits.filter((h) => h.kind === PAST_HIT_KIND).length;
  const other = result.hits.length - facts - past;
  const notes = result.notes ?? [];
  const parts = [
    notes.length ? noteLine(notes) : "",
    past ? `예전 답과 다름 ${past}문장(하늘색)` : "",
    facts ? `근거 없음 ${facts}문장(호박색)` : "",
    other ? `확인할 표현 ${other}개` : "",
  ].filter(Boolean);
  // 칠하기를 뺐으니(10-01) 알릴 게 없으면 줄을 비운다
  if (!parts.length) return { text: "", tone: "text-neutral-500" };
  const hint = result.hits.length ? " · 칠한 곳에 손을 올리면 이유가 보여요" : "";
  return { text: `${parts.join(" · ")}${hint}`, tone: result.status === "block" ? "text-amber-800" : "text-stone-600" };
}
