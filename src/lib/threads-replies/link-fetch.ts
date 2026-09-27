// 붙인 링크·웹 결과 → 근거 문서 (2026-09-27).
//
// x.com 글은 FxTwitter(스레드·아티클 전문까지)로, 나머지는 기사 추출 체인(Defuddle→Jina)
// 으로 읽는다. 파일을 쓰지 않는다 — 근거 찾기는 읽기만 한다 (링크 잡 수집 fastIngestXStatus
// 는 미디어까지 내려받아 폴더를 만들므로 여기에 맞지 않는다).
import { extractArticle } from "@/lib/article-extract";
import { extractTweetId, fetchTwitterContent } from "@/lib/learn/twitter";
import type { SourceKind } from "./model";
import type { EvidenceDoc } from "./evidence-index";

const MIN_TEXT_CHARS = 40;

function withTimeout<T>(p: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`링크 읽기 ${Math.round(ms / 1000)}초 초과`)), ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("취소됨"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    p.then(
      (v) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        reject(e);
      }
    );
  });
}

/** URL 하나를 읽어 근거 문서로. 못 읽으면 null (던지지 않는다). */
export async function fetchLinkDoc(
  url: string,
  opts: { kind: SourceKind; idPrefix: string; timeoutMs: number; signal?: AbortSignal }
): Promise<EvidenceDoc | null> {
  try {
    if (extractTweetId(url)) {
      const tw = await withTimeout(fetchTwitterContent(url), opts.timeoutMs, opts.signal);
      if (!tw || tw.content.length < MIN_TEXT_CHARS) return null;
      return {
        id: `${opts.idPrefix}:${url}`,
        kind: opts.kind,
        title: `${tw.author} · ${tw.title}`,
        text: tw.content,
        url,
        origin: url,
      };
    }
    const art = await withTimeout(extractArticle(url), opts.timeoutMs, opts.signal);
    if (art.via === "none" || art.content.length < MIN_TEXT_CHARS) return null;
    return {
      id: `${opts.idPrefix}:${url}`,
      kind: opts.kind,
      title: art.title || url,
      text: art.content,
      url,
      origin: url,
    };
  } catch {
    return null;
  }
}
