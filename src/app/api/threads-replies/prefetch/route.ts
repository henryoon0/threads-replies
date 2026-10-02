// 지금 답할 댓글의 버전 미리 쓰기를 줄 맨 앞으로 (2026-09-30 henry: "지금 답할 5개는 매번 초안이 완성돼 있어야").
//   POST { ids: string[] }              → { queued }        화면의 "지금 답할" 순서 그대로 앞에 세운다 (멱등, 다 쓴 댓글은 건너뜀).
//   비슷한 맥락 글(similar)도 앞 6개를 미리 계산해 둔다 — 처음 열 때 5~11초 걸리던 것 (10-02 실측).
//   POST { ids: string[], fresh: true } → { queued, busy }  미리 쓴 벌을 버리고 처음부터 다시 쓴다 ([5개 새로 돌리기]·[버전 전부 새로]).
// 목록 GET 의 미리 쓰기는 최신순 60개라, 오래 기다린 질문이 먼저인 "지금 답할 5개"와 순서가 어긋난다.
import { NextResponse } from "next/server";
import { bumpAnswers } from "@/lib/threads-replies/answer-job";
import { autoDraftPolicy } from "@/lib/threads-replies/auto-draft-policy";
import { requestVersions } from "@/lib/threads-replies/compose-variants";
import { currentPersona, withPersonaRequest } from "@/lib/personas/context";
import { warmSimilar } from "@/lib/threads-replies/similar";
import { readRepliesLedger } from "@/lib/threads-replies/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_IDS = 20;
const WARM_SIMILAR = 6;

async function handlePOST(request: Request) {
  const body = (await request.json().catch(() => null)) as { ids?: unknown; fresh?: unknown } | null;
  const ids = Array.isArray(body?.ids) ? body.ids.filter((x): x is string => typeof x === "string" && x.length > 0).slice(0, MAX_IDS) : [];
  if (!ids.length) return NextResponse.json({ error: "ids 가 필요해요" }, { status: 400 });
  if (body?.fresh === true) return NextResponse.json(await requestVersions(ids, "rewrite"));
  // 비슷한 글도 앞 몇 개는 미리 계산 (응답은 기다리지 않는다)
  const ledger = await readRepliesLedger();
  void warmSimilar(currentPersona().id, ledger, ids.slice(0, WARM_SIMILAR));
  // 초안이 아직 없는 댓글은 답 초안 잡의 줄 맨 앞으로 ("쓰는 중"이 오래 남던 원인, 10-02)
  if (autoDraftPolicy(currentPersona()).answerJob) await bumpAnswers(ids).catch(() => {});
  const { queued } = await requestVersions(ids, "prefetch", { front: true });
  return NextResponse.json({ queued });
}

export async function POST(request: Request) {
  return withPersonaRequest(request, () => handlePOST(request));
}
