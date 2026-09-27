// 스레드 질문 댓글 근거 찾기 — 색인 한 장(one-sheet index) 의 순수 부분 (2026-09-27).
//
// 왜 색인 한 장인가: 09-24 수집 검색 실험(44문항)에서 단어 AND 검색은 38/44 가 0건이었고,
// "id · 제목 · 별칭 · 종류 · 날짜" 한 줄씩을 모델에게 통째로 보여주고 고르게 한 방식이
// R@5 0.78~0.83, "없음" 6/6 으로 1위였다. 별칭을 빼면 0.83→0.54 로 떨어졌다 — 댓글 말투
// ("클코", "아스트라")와 자료 제목("Claude Code", "GPT-6 Astra")이 다르기 때문이다.
// 그래서 별칭은 문서 내용 해시로 캐시해 두고 바뀐 문서만 다시 만든다.
//
// Pure — I/O 없음. 파일 읽기·모델 호출은 evidence-docs.ts / evidence-aliases.ts 가 한다.
import { createHash } from "node:crypto";
import type { SourceKind } from "./model";

/** 근거 후보 문서 한 건. quote 는 반드시 text 의 부분 문자열이어야 한다. */
export interface EvidenceDoc {
  /** 저장소 안에서 안정적인 id (note:<경로>, card:<url>, run:<runId>#2, post:<id> …) */
  id: string;
  kind: SourceKind;
  title: string;
  /** 인용을 찾을 원문 전체. 형광 캡처도 이 글자를 원문에서 찾는다. */
  text: string;
  url?: string;
  /** 사람이 따라가 확인할 출처 (파일 경로·id) */
  origin: string;
  /** YYYY-MM-DD (모르면 비움) */
  date?: string;
  /** 별칭 만들 때 본문 앞부분 대신 쓸 짧은 설명 (카드의 what·키워드 등) */
  seed?: string;
  /** 캐시 별칭이 없을 때 쓸 즉석 별칭 (후보 원본의 한국어 시안 첫 줄 등) */
  aliases?: string[];
}

export interface IndexRow {
  /** 색인 한 장 안에서만 쓰는 짧은 번호 (모델이 id 를 베껴 쓰다 틀리지 않게) */
  key: string;
  docId: string;
  kind: SourceKind;
  date: string;
  title: string;
  aliases: string[];
}

export interface AliasCacheEntry {
  aliases: string[];
  at: string;
}

export interface AliasCache {
  version: 1;
  entries: Record<string, AliasCacheEntry>;
}

export function emptyAliasCache(): AliasCache {
  return { version: 1, entries: {} };
}

const HASH_TEXT_CHARS = 6000;
const TITLE_CHARS = 72;
const ALIAS_MAX = 10;
const ALIAS_CHARS = 32;

/** 별칭 캐시 열쇠. 제목·종류·본문 앞부분이 같으면 같은 별칭을 다시 쓴다. */
export function docContentHash(doc: Pick<EvidenceDoc, "kind" | "title" | "text" | "seed">): string {
  return createHash("sha1")
    .update(`${doc.kind}\n${doc.title}\n${doc.seed ?? ""}\n${doc.text.slice(0, HASH_TEXT_CHARS)}`)
    .digest("hex")
    .slice(0, 16);
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** 모델이 준 별칭을 다듬는다: 한 줄 · 길이 제한 · 대소문자 무시 중복 제거 · 제목과 같은 것 제외. */
export function cleanAliases(raw: unknown, title = ""): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>([oneLine(title).toLowerCase()]);
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const a = oneLine(v).replace(/[|]/g, "/").slice(0, ALIAS_CHARS);
    const k = a.toLowerCase();
    if (!a || seen.has(k)) continue;
    seen.add(k);
    out.push(a);
    if (out.length >= ALIAS_MAX) break;
  }
  return out;
}

/** 문서 + 별칭 캐시 → 색인 줄. 캐시에 없으면 별칭 없이 제목만으로 줄을 만든다. */
export function buildIndexRows(
  docs: readonly EvidenceDoc[],
  cache: AliasCache
): IndexRow[] {
  return docs.map((doc, i) => ({
    key: `r${i + 1}`,
    docId: doc.id,
    kind: doc.kind,
    date: doc.date ?? "",
    title: oneLine(doc.title).slice(0, TITLE_CHARS),
    aliases: cache.entries[docContentHash(doc)]?.aliases ?? cleanAliases(doc.aliases ?? [], doc.title),
  }));
}

/** 색인 줄에 쓰는 짧은 종류 표시 (한 장이 1천 줄을 넘어 글자 수가 곧 지연이다). */
export const KIND_TAG: Record<SourceKind, string> = {
  "원글 원본": "원본",
  "수집한 원문": "원문",
  수집노트: "노트",
  "강의 자료": "강의",
  FAQ: "FAQ",
  "지난 글": "글",
  웹: "웹",
  "내 경험": "경험",
  "붙인 링크": "링크",
  "내 자료": "자료",
};

/** 모델에게 보여줄 색인 한 장. 한 줄 = 한 문서: "r12 [노트] 26.09 제목 | 별칭, …". */
export function formatIndexSheet(rows: readonly IndexRow[]): string {
  return rows
    .map((r) => {
      const date = r.date ? ` ${r.date.slice(2, 7).replace("-", ".")}` : "";
      const aliases = r.aliases.length ? ` | ${r.aliases.join(", ")}` : "";
      return `${r.key} [${KIND_TAG[r.kind]}]${date} ${r.title}${aliases}`;
    })
    .join("\n");
}

/** 캐시에 별칭이 없는 문서만 (증분 생성 대상). 같은 해시는 한 번만. */
export function docsMissingAliases(
  docs: readonly EvidenceDoc[],
  cache: AliasCache
): EvidenceDoc[] {
  const seen = new Set<string>();
  const out: EvidenceDoc[] = [];
  for (const d of docs) {
    const h = docContentHash(d);
    if (cache.entries[h] || seen.has(h)) continue;
    seen.add(h);
    out.push(d);
  }
  return out;
}

/** 더 이상 어떤 문서에도 안 쓰이는 캐시 항목을 버린다 (파일이 끝없이 크지 않게). */
export function pruneAliasCache(cache: AliasCache, docs: readonly EvidenceDoc[]): AliasCache {
  const live = new Set(docs.map(docContentHash));
  const entries: Record<string, AliasCacheEntry> = {};
  for (const [h, e] of Object.entries(cache.entries)) if (live.has(h)) entries[h] = e;
  return { version: 1, entries };
}

/** 별칭 생성에 넣을 문서 요약 (제목 + seed 또는 본문 앞부분). */
export function aliasSeedText(doc: EvidenceDoc, chars = 700): string {
  const body = oneLine(doc.seed || doc.text).slice(0, chars);
  return `${oneLine(doc.title).slice(0, TITLE_CHARS)} :: ${body}`;
}
