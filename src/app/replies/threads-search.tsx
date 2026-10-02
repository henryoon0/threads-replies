"use client";

// 스레드 계정 검색 (09-29 요청 4). "/" 로 바로 가는 검색칸 — 이 계정의 댓글 · 내 글 · 내가 예전에 단 답.
// 댓글을 고르면 그 댓글이 오른쪽 답 패널에 열리고, 예전 답·글은 그 자리에서 펼쳐 읽고 복사한다.

import { HoverHint } from "./hover-hint";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowTopRightOnSquareIcon, ClipboardDocumentIcon, MagnifyingGlassIcon, XMarkIcon } from "@heroicons/react/16/solid";
import { toast } from "@/components/toast";
import type { AccountHit, AccountSearchResult } from "@/lib/threads-replies/search";
import { cn } from "@/lib/utils";

const DEBOUNCE_MS = 250;
const STATE_LABEL: Record<NonNullable<AccountHit["state"]>, string> = { open: "답할 차례", answered: "답함", skipped: "건너뜀" };

function useAccountSearch(q: string) {
  const [result, setResult] = useState<AccountSearchResult | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const query = q.trim();
    if (!query) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      setBusy(true);
      fetch(`/api/threads-replies/search?q=${encodeURIComponent(query)}`, { signal: ctrl.signal, cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<AccountSearchResult>) : null))
        .then((d) => {
          if (d) setResult(d);
        })
        .catch(() => {})
        .finally(() => {
          if (!ctrl.signal.aborted) setBusy(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);
  return { result: q.trim() ? result : null, busy: busy && Boolean(q.trim()) };
}

function copy(text: string) {
  void navigator.clipboard?.writeText(text).then(
    () => toast.success("복사했어요"),
    () => toast.error("복사하지 못했어요")
  );
}

function Group({ title, children, count }: { title: string; count: number; children: React.ReactNode }) {
  if (!count) return null;
  return (
    <div className="py-1.5 [&:not(:first-child)]:shadow-[0_-1px_0_0_rgba(10,10,10,0.05)]">
      <p className="px-3 pb-1 pt-1 text-[11px] font-medium text-neutral-500">
        {title} <span className="tabular-nums">{count}</span>
      </p>
      <ul>{children}</ul>
    </div>
  );
}

/** 스레드에서 열기 링크 (댓글 줄·읽기 줄 공용) */
function ThreadsLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[10.5px] text-neutral-500 hover:bg-neutral-950/[0.04] hover:text-neutral-800">
      {label} <ArrowTopRightOnSquareIcon className="size-3" />
    </a>
  );
}

function CommentRow({ hit, onPick }: { hit: AccountHit; onPick: (id: string) => void }) {
  return (
    <li className="relative">
      {hit.permalink ? (
        <span className="absolute bottom-1.5 right-2">
          <ThreadsLink href={hit.permalink} label="스레드에서 보기" />
        </span>
      ) : null}
      <button type="button" onClick={() => onPick(hit.id)} className={cn("block w-full rounded-[10px] px-3 py-2 text-left hover:bg-neutral-950/[0.03]", hit.permalink && "pb-8")}>
        <span className="flex items-center gap-1.5 text-[11px] text-neutral-500">
          <span className="font-medium text-neutral-700">@{hit.sub}</span>
          {hit.state ? <span className={cn("rounded-full px-1.5 py-px", hit.state === "open" ? "bg-emerald-50 text-emerald-800" : "bg-neutral-100")}>{STATE_LABEL[hit.state]}</span> : null}
          {hit.date ? <span className="ml-auto tabular-nums">{hit.date}</span> : null}
        </span>
        <span className="mt-0.5 line-clamp-2 block text-[12.5px] leading-snug text-neutral-800 break-keep">{hit.text}</span>
        {hit.myReply ? <span className="mt-1 line-clamp-2 block text-[11.5px] leading-snug text-neutral-500 break-keep">내 답 · {hit.myReply}</span> : null}
      </button>
    </li>
  );
}

function ReadRow({ hit }: { hit: AccountHit }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-[10px] px-3 py-2 hover:bg-neutral-950/[0.02]">
      {hit.sub ? <p className="line-clamp-1 text-[11px] text-neutral-500 break-keep">받은 댓글 · {hit.sub}</p> : null}
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="block w-full text-left">
        <span className={cn("block whitespace-pre-line text-[12.5px] leading-snug text-neutral-800 break-keep", !open && "line-clamp-3")}>{hit.text}</span>
      </button>
      <span className="mt-1 flex items-center gap-2 text-[10.5px] text-neutral-500">
        {hit.date ? <span className="tabular-nums">{hit.date}</span> : null}
        {hit.permalink ? <ThreadsLink href={hit.permalink} label="스레드에서 보기" /> : null}
        <button type="button" onClick={() => copy(hit.text)} className="ml-auto inline-flex h-6 items-center gap-1 rounded-md px-1.5 hover:bg-neutral-950/[0.04] hover:text-neutral-800">
          <ClipboardDocumentIcon className="size-3" /> 복사
        </button>
      </span>
    </li>
  );
}

/** 10-02 픽: 평소엔 돋보기 아이콘만. 누르거나 / 를 치면 펼쳐진다 */
function SearchField({ expanded, q, onClear, children }: { expanded: boolean; q: string; onClear: () => void; children: ReactNode }) {
  const field = (
    <label
      className={cn(
        "flex h-9 cursor-text items-center gap-2 rounded-[10px] transition-[width,background-color] duration-150",
        expanded ? "w-80 bg-white px-2.5 ring-2 ring-emerald-700/40" : "w-9 justify-center hover:bg-neutral-950/[0.04]"
      )}
    >
      <MagnifyingGlassIcon className={cn("size-4 shrink-0", expanded ? "text-neutral-400" : "text-neutral-500")} aria-hidden />
      {children}
      {q ? (
        <button type="button" aria-label="검색어 지우기" onClick={onClear} className="rounded p-0.5 text-neutral-400 hover:text-neutral-700">
          <XMarkIcon className="size-4" />
        </button>
      ) : expanded ? (
        <kbd className="shrink-0 rounded bg-neutral-950/[0.04] px-1.5 py-px text-[10.5px] text-neutral-500">/</kbd>
      ) : null}
    </label>
  );
  return expanded ? field : <HoverHint label="찾기 (/)">{field}</HoverHint>;
}

export function ThreadsSearch({ onPickComment }: { onPickComment: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const expanded = focused || Boolean(q);
  const box = useRef<HTMLDivElement>(null);
  const { result, busy } = useAccountSearch(q);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // ⌘K 는 앱 전체 명령 창이 쓴다 — 여기선 "/" (글 쓰는 칸 밖에서만)
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        input.current?.focus();
        setOpen(true);
      }
    };
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, []);

  const total = result ? result.comments.length + result.posts.length + result.past.length : 0;
  const pick = (id: string) => {
    onPickComment(id);
    setOpen(false);
  };

  return (
    <div ref={box} className="relative">
      <SearchField expanded={expanded} q={q} onClear={() => setQ("")}>
        <input
          ref={input}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            setOpen(true);
            setFocused(true);
          }}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setOpen(false);
              input.current?.blur();
            }
          }}
          placeholder="댓글·내 글·예전 답 찾기"
          aria-label="스레드 계정 검색"
          className={cn("min-w-0 bg-transparent text-[13px] text-neutral-900 placeholder:text-neutral-400 focus:outline-none", expanded ? "flex-1" : "w-0")}
        />
      </SearchField>
      {open && q.trim() ? (
        <div className="absolute right-0 top-11 z-30 max-h-[70dvh] w-[min(32rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain rounded-[14px] bg-white p-1 shadow-card ring-1 ring-neutral-950/5">
          {!result ? (
            <p className="px-3 py-4 text-[12px] text-neutral-500">{busy ? "찾는 중이에요" : " "}</p>
          ) : total === 0 ? (
            <p className="px-3 py-4 text-[12px] text-neutral-500">“{result.query}”(이)가 든 댓글·글·답이 없어요</p>
          ) : (
            <>
              <Group title="댓글" count={result.comments.length}>
                {result.comments.map((h) => (
                  <CommentRow key={h.id} hit={h} onPick={pick} />
                ))}
              </Group>
              <Group title="내가 단 답" count={result.past.length}>
                {result.past.map((h) => (
                  <ReadRow key={h.id} hit={h} />
                ))}
              </Group>
              <Group title="내 글" count={result.posts.length}>
                {result.posts.map((h) => (
                  <ReadRow key={h.id} hit={h} />
                ))}
              </Group>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
