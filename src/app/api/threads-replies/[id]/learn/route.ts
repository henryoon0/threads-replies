// 학습에서 빼기 (시안 픽 15). 보낸 답 하나의 학습 기록(팩 private/reply-log.jsonl 마지막 줄)을 켜고 끈다.
//   GET   → { entry } — 영수증("초안에서 12자 고침 · 학습에 기록됨")용
//   PATCH { learn: boolean, reason?: string } → { entry, excludeTurn }
// 결과 기록 턴이 아직 안 돌았으면(유예 10분) 끄는 순간 취소되고, 이미 돌았으면 같은 세션에
// "[학습 제외]" 턴을 이어 쓴다(excludeTurn: "queued" — 스윕이 바로 쓴다). 관문에 걸린 답은 켤 수 없다(409).
import { NextResponse } from "next/server";
import { withPersonaRequest } from "@/lib/personas/context";
import { setReplyLearning } from "@/lib/personas/learning/outcome";
import { latestReplyLog } from "@/lib/personas/learning/reply-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function handleGET({ params }: Ctx) {
  const { id } = await params;
  const entry = await latestReplyLog(id);
  if (!entry) return NextResponse.json({ error: "이 답의 학습 기록이 없어요." }, { status: 404 });
  return NextResponse.json({ entry });
}

async function handlePATCH(request: Request, { params }: Ctx) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { learn?: unknown; reason?: unknown };
  if (typeof body.learn !== "boolean") return NextResponse.json({ error: "learn(true·false)이 필요해요." }, { status: 400 });
  const reason = typeof body.reason === "string" ? body.reason : undefined;
  const result = await setReplyLearning(id, body.learn, reason);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ entry: result.entry, excludeTurn: result.excludeTurn });
}

// 요청마다 지금 페르소나(?persona= 또는 쿠키)로 감싼다 — 그 팩의 학습 기록을 고친다.
export async function GET(request: Request, ctx: Ctx) {
  return withPersonaRequest(request, () => handleGET(ctx));
}

export async function PATCH(request: Request, ctx: Ctx) {
  return withPersonaRequest(request, () => handlePATCH(request, ctx));
}
