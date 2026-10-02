"use client";

// 답글에 붙일 이미지 한 장. 고르기·붙여넣기·끌어 놓기로 받는다.
// 보낼 때 서버가 Cloudflare 에 잠깐 올려 스레드에 넘기고, 발행이 끝나면 지운다.

import { useCallback, useEffect, useRef, useState } from "react";
import { PhotoIcon, XMarkIcon } from "@heroicons/react/16/solid";
import { cn } from "@/lib/utils";
import { press } from "./threads-answer-verdict";

/** 스레드가 받는 형식·크기 (서버 parseReplyImage 와 같은 값) */
const TYPES = ["image/jpeg", "image/png"];
const MAX_BYTES = 8 * 1024 * 1024;

export interface ReplyImageState {
  dataUrl: string | null;
  error: string;
  pick: (file: File) => void;
  clear: () => void;
}

/**
 * enabled 동안 화면 어디서 ⌘V 해도 클립보드 이미지를 받는다.
 * 초안을 손대기 전엔 입력칸이 아니라 버튼이라 칸에 단 onPaste 가 안 불린다 (2026-09-27 실측: 이미지 없이 발송).
 */
export function useReplyImage(enabled = true): ReplyImageState {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const pick = useCallback((file: File) => {
    if (!TYPES.includes(file.type)) return setError("JPG·PNG 이미지만 붙일 수 있어요");
    if (file.size > MAX_BYTES) return setError("이미지는 8MB 까지 붙일 수 있어요");
    setError("");
    const reader = new FileReader();
    reader.onload = () => setDataUrl(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => setError("이미지를 읽지 못했어요");
    reader.readAsDataURL(file);
  }, []);
  useEffect(() => {
    if (!enabled) return;
    const onPaste = (e: ClipboardEvent) => {
      const file = imageFileOf(e.clipboardData?.items);
      if (!file) return; // 글자 붙여넣기는 원래 칸이 처리한다
      e.preventDefault();
      pick(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [enabled, pick]);
  const clear = useCallback(() => {
    setDataUrl(null);
    setError("");
  }, []);
  return { dataUrl, error, pick, clear };
}

/** 클립보드·끌어 놓기에서 첫 이미지 파일 */
export function imageFileOf(list: DataTransferItemList | FileList | null | undefined): File | null {
  if (!list) return null;
  // FileList 는 File 을, DataTransferItemList 는 item 을 준다 — 둘 다 받는다
  const files = Array.from(list as ArrayLike<File | DataTransferItem>, (item) =>
    item instanceof File ? item : item.kind === "file" ? item.getAsFile() : null
  );
  return files.find((f): f is File => Boolean(f?.type.startsWith("image/"))) ?? null;
}

/** 근거 캡처 자동 첨부 — 찍혀 있으면 기본으로 같이 보낸다. ✕로 이번 답에서만 뺀다. */
export interface EvidenceAttach {
  /** 붙을 캡처 경로 (/threads-evidence/...). 없으면 null */
  image: string | null;
  onExclude: () => void;
}

export function ReplyImageRow({ image, evidence, disabled }: { image: ReplyImageState; evidence: EvidenceAttach; disabled: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  // 직접 붙인 이미지가 우선. 없으면 근거 캡처가 올라간다.
  const shown = image.dataUrl ?? evidence.image;
  const fromEvidence = !image.dataUrl && Boolean(evidence.image);
  return (
    <div className="flex items-center gap-2 px-2 pb-1">
      {shown ? (
        <span className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element -- 로컬 data URL 미리보기 */}
          <img src={shown} alt="붙인 이미지" className="h-16 w-16 rounded-[10px] object-cover object-top ring-1 ring-neutral-950/5" />
          {disabled ? null : (
            <button
              type="button"
              onClick={fromEvidence ? evidence.onExclude : image.clear}
              aria-label="이미지 빼기"
              className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-neutral-900 text-white hover:bg-neutral-700"
            >
              <XMarkIcon className="size-3" />
            </button>
          )}
        </span>
      ) : (
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={disabled}
          aria-label="이미지 붙이기"
          title="이미지 붙이기 · 끌어 놓아도 돼요"
          className={cn("inline-flex size-8 items-center justify-center rounded-[10px] text-neutral-500 hover:bg-neutral-50 hover:text-neutral-700 disabled:opacity-40", press)}
        >
          <PhotoIcon className="size-4" />
        </button>
      )}
      <span className="min-w-0 truncate text-[11px] text-neutral-500">
        {image.error ? (
          <span className="text-rose-600">{image.error}</span>
        ) : fromEvidence ? (
          "근거 캡처가 같이 올라가요"
        ) : image.dataUrl ? (
          "보내면 올린 뒤 바로 지워요"
        ) : null}
      </span>
      <input
        ref={input}
        type="file"
        accept={TYPES.join(",")}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) image.pick(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}
