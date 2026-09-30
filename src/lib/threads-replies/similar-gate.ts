// "비슷한 맥락에서 남긴 글" 관련성 게이트 (09-29): 검색 후보를 AI 가 한 번에 보고 지금 댓글과 같은 주제인 것만 남긴다.
//
// 낱말 겹침 문턱만으로는 띄운 답의 2/3 가 무관했다 (scripts/threads-replies/similar-eval.ts 기준선 precision 22%).
// "훈련소 상비약" 댓글에 마운자로 사망 답이 뜨는 식. 관련 없으면 빈 패널이 정답이다.
// 판정이 실패하면 아무것도 띄우지 않는다 — 확인 못 한 답을 관련 있다고 보여주지 않는다.

import { generateText } from "@/lib/ai/generate";
import type { PastSaid } from "./model";
import { envMs } from "./storage";

export function similarGateTimeoutMs(): number {
  return envMs("SIMILAR_GATE_TIMEOUT_MS", 60_000);
}

export function gatePrompt(comment: string, candidates: readonly PastSaid[]): string {
  return `스레드 계정 주인이 받은 댓글에 답을 쓰려 한다. 옆에 "비슷한 맥락에서 예전에 남긴 답"을 띄울 후보가 있다.
후보마다 주인이 지금 답을 쓸 때 참고할 만한지 판정해라.

관련 있음: 예전 댓글이나 답이 지금 댓글과 같은 주제다 (같은 증상·성분·약·제품군·상황·질문 의도). 내용을 빌려 쓰거나 말을 맞출 수 있다.
관련 없음: 낱말 하나만 겹친다, 주제가 다르다, 인사·감사·잡담만 겹친다, 너무 일반적이라 지금 답에 쓸 게 없다.
애매하면 관련 없음.

<current_comment>
${comment}
</current_comment>

<candidates>
${candidates.map((c, i) => `[${i + 1}] 예전 댓글: ${c.comment?.slice(0, 300) ?? "(없음)"}\n    주인 답: ${c.text.slice(0, 400)}`).join("\n")}
</candidates>

JSON 으로만: {"relevant": [관련 있는 후보 번호들]}`;
}

/** 모델 응답에서 번호 목록을 읽는다. 형식이 틀리면 null (= 판정 실패). */
export function parseRelevant(raw: string, count: number): Set<number> | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as { relevant?: unknown };
    if (!Array.isArray(parsed.relevant)) return null;
    return new Set(parsed.relevant.filter((n): n is number => Number.isInteger(n) && n >= 1 && n <= count));
  } catch {
    return null;
  }
}

type Judge = (prompt: string) => Promise<string>;
const defaultJudge: Judge = (prompt) => generateText({ tier: "fast", prompt, json: true, timeoutMs: similarGateTimeoutMs() });

// 같은 댓글·같은 후보면 다시 묻지 않는다 (패널을 열 때마다 AI 를 부르지 않게). hot reload 에도 살아남게 globalThis.
function cache(): Map<string, string[]> {
  const g = globalThis as typeof globalThis & { __similarGateCache?: Map<string, string[]> };
  g.__similarGateCache ??= new Map();
  return g.__similarGateCache;
}

/** 관련 있는 후보만 원래 순서대로. 후보가 없으면 AI 를 부르지 않는다. 판정 실패면 빈 목록. */
export async function gateRelevant<T extends PastSaid>(comment: string, candidates: readonly T[], judge: Judge = defaultJudge): Promise<T[]> {
  if (!candidates.length) return [];
  const key = `${comment}\u0000${candidates.map((c) => c.id).join(",")}`;
  const hit = cache().get(key);
  if (hit) return candidates.filter((c) => hit.includes(c.id));
  try {
    const keep = parseRelevant(await judge(gatePrompt(comment, candidates)), candidates.length);
    if (!keep) throw new Error("판정 응답 형식이 틀렸습니다");
    const out = candidates.filter((_, i) => keep.has(i + 1));
    if (cache().size > 500) cache().clear();
    cache().set(key, out.map((c) => c.id));
    return out;
  } catch (error) {
    console.warn("[similar-gate] 관련성 판정 실패, 비슷한 글을 띄우지 않습니다:", error instanceof Error ? error.message : error);
    return [];
  }
}
