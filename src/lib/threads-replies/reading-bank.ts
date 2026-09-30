// "읽기→답" 예시 은행 — 주인의 과거 댓글-답 쌍을 읽기 틀(어느 지점 → 어떤 니즈 → 어떤 접근)로 풀어 둔 것.
//
// 파일: 팩 reading-examples.json (scripts/threads-replies/build-reading-bank.ts 가 만든다).
// 조각 은행(example-bank.ts)은 답의 모양(공감·원리·제품)만 보여준다. 이 은행은 "왜 그렇게 답했나"를 보여준다.
// 선택은 댓글마다 다르게: 비슷한 댓글 먼저, 나머지는 댓글 해시로 섞는다. 시험 쌍·이 댓글 자기 답은 뺀다.
// 순수 — I/O 없음.
import { createHash } from "node:crypto";
import { textSimilarity } from "@/lib/content-ideas-style-eval";
import { READING_NEEDS, type ReadingExample } from "./reading";

export interface ReadingBankFile {
  version: number;
  builtAt: string;
  examples: ReadingExample[];
}

export function parseReadingBank(raw: unknown): ReadingExample[] {
  const list = (raw as Partial<ReadingBankFile> | null)?.examples;
  if (!Array.isArray(list)) return [];
  return list.filter(
    (e): e is ReadingExample =>
      !!e && typeof e.pairId === "string" && typeof e.comment === "string" && typeof e.reply === "string" && (READING_NEEDS as readonly string[]).includes(e.need)
  );
}

function rank(seed: string, id: string): string {
  return createHash("sha1").update(`${seed}\u0000${id}`).digest("hex");
}

const NEAR_MIN_SIMILARITY = 0.1;

/** 이 댓글에 실을 읽기 예시 n 개: 비슷한 댓글 near 개 + 해시로 섞은 나머지 */
export function pickReadingExamples(
  bank: readonly ReadingExample[],
  input: { comment: string; exclude?: ReadonlySet<string>; n?: number; near?: number }
): ReadingExample[] {
  const n = input.n ?? 4;
  const self = input.comment.trim();
  const pool = bank.filter((e) => !input.exclude?.has(e.pairId) && e.comment.trim() !== self);
  const near = pool
    .map((e) => ({ e, w: textSimilarity(input.comment, e.comment) }))
    .filter((x) => x.w >= NEAR_MIN_SIMILARITY)
    .sort((a, b) => b.w - a.w)
    .slice(0, Math.min(input.near ?? 3, n))
    .map((x) => x.e);
  const rest = pool.filter((e) => !near.includes(e)).sort((a, b) => rank(self, a.pairId).localeCompare(rank(self, b.pairId)));
  return [...near, ...rest].slice(0, n);
}
