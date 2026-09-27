// 근거 후보 문서 모으기 (I/O) — 색인 한 장에 올릴 자료 전부.
//
//   내 자료 폴더의 .md·.txt (하위 폴더 포함)   kind 내 자료
//     └ "같이 만든 답" 하위 폴더: 초안 아래 질문에 답한 내용이 쌓인다 (my-notes.ts)
//   내 지난 스레드 글 (threads-archive)       kind 지난 글
//
// 자료가 하나도 없어도 돈다 — 그땐 내 글 본문과 웹 검색만 근거가 되고,
// 근거가 없는 질문은 초안 아래 "이거 알려주세요" 질문으로 받는 사람에게 묻는다.
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { listPosts } from "@/lib/threads-archive/storage";
import { localDateKey } from "@/lib/date";
import type { EvidenceDoc } from "./evidence-index";
import { myDocsDir } from "./my-docs-path";

const MEMO_MS = 60_000;
const MIN_POST_CHARS = 60;
const MAX_DOC_CHARS = 20_000;
const MAX_FILES = 500;

function dateKeyOf(iso: string | undefined): string {
  if (!iso) return "";
  const t = Date.parse(iso.replace(/\+0000$/, "+00:00"));
  if (Number.isFinite(t)) return localDateKey(new Date(t));
  const m = iso.match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : "";
}

async function walk(dir: string, out: string[]): Promise<void> {
  if (out.length >= MAX_FILES) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // 폴더가 없으면 자료 0개
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full, out);
    else if (/\.(md|markdown|txt)$/i.test(e.name)) out.push(full);
    if (out.length >= MAX_FILES) return;
  }
}

/** 파일 첫 제목 줄(# …) 또는 파일 이름을 제목으로 */
function titleOf(file: string, text: string): string {
  const heading = text.split("\n").find((l) => /^#\s+\S/.test(l));
  return (heading ? heading.replace(/^#\s+/, "") : path.basename(file).replace(/\.\w+$/, "")).trim().slice(0, 90);
}

async function myDocs(): Promise<EvidenceDoc[]> {
  const root = myDocsDir();
  const files: string[] = [];
  await walk(root, files);
  const docs = await Promise.all(
    files.map(async (file) => {
      const [raw, s] = await Promise.all([readFile(file, "utf8"), stat(file)]);
      const text = raw.normalize("NFC").trim().slice(0, MAX_DOC_CHARS);
      if (!text) return null;
      const rel = path.relative(root, file).normalize("NFC");
      return {
        id: `doc:${rel}`,
        kind: "내 자료" as const,
        title: titleOf(file, text),
        text,
        origin: `내 자료/${rel}`,
        date: localDateKey(s.mtime),
      } satisfies EvidenceDoc;
    })
  );
  return docs.filter((d): d is NonNullable<typeof d> => d !== null);
}

async function pastPostDocs(): Promise<EvidenceDoc[]> {
  const posts = await listPosts();
  return posts
    .map((p) => ({ p, text: [p.text, ...(p.cards ?? [])].join("\n\n").trim() }))
    .filter(({ text }) => text.length >= MIN_POST_CHARS)
    .map(({ p, text }) => ({
      id: `post:${p.id}`,
      kind: "지난 글" as const,
      title: p.text.split("\n").find((l) => l.trim())?.trim().slice(0, 90) ?? p.id,
      text,
      url: p.permalink,
      origin: `threads-archive ${p.id}`,
      date: dateKeyOf(p.timestamp),
    }));
}

export interface EvidenceCorpus {
  docs: EvidenceDoc[];
  /** 원천별 수 · 실패 메모 (trace 용) */
  counts: Record<string, number>;
  errors: string[];
}

let memo: { at: number; value: EvidenceCorpus } | null = null;

/** 색인 한 장에 올릴 문서 전부. 한 원천이 실패해도 나머지로 돈다. */
export async function loadEvidenceCorpus(opts: { fresh?: boolean } = {}): Promise<EvidenceCorpus> {
  if (!opts.fresh && memo && Date.now() - memo.at < MEMO_MS) return memo.value;
  const loaders: [string, () => Promise<EvidenceDoc[]>][] = [
    ["docs", myDocs],
    ["posts", pastPostDocs],
  ];
  const settled = await Promise.allSettled(loaders.map(([, fn]) => fn()));
  const docs: EvidenceDoc[] = [];
  const counts: Record<string, number> = {};
  const errors: string[] = [];
  settled.forEach((r, i) => {
    const name = loaders[i][0];
    if (r.status === "fulfilled") {
      docs.push(...r.value);
      counts[name] = r.value.length;
    } else {
      counts[name] = 0;
      errors.push(`${name}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
    }
  });
  const value = { docs, counts, errors };
  memo = { at: Date.now(), value };
  return value;
}

/** 자료를 새로 쌓았을 때 다음 조회가 바로 보이게 */
export function forgetEvidenceCorpus(): void {
  memo = null;
}
