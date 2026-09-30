// 완성된 답이 예전 답과 어긋나는지: POST { text } → { consistency, text, pastCount }.
// 주인이 고치는 동안 화면이 잠깐 멈췄을 때 부른다 (디바운스). 글은 절대 고치지 않고 칠할 문장만 돌려준다.
// 초안 때 찾은 예전 답(answer.pastSaid)이 있으면 그걸 쓰고, 없으면 이번에 찾아서 원장에 남긴다.
import { NextResponse } from "next/server";
import { currentPersona, withPersonaRequest } from "@/lib/personas/context";
import { checkFinal } from "@/lib/threads-replies/consistency";
import type { ConsistencyHit, PastSaid, ThreadsRepliesLedger, ThreadsReply } from "@/lib/threads-replies/model";
import { pastSaidFor } from "@/lib/threads-replies/past-said";
import { readRepliesLedger, updateRepliesLedger } from "@/lib/threads-replies/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TEXT = 2000;

interface RouteCtx {
  params: Promise<{ id: string }>;
}

async function readText(request: Request): Promise<string | null> {
  const body = (await request.json().catch(() => null)) as { text?: unknown } | null;
  return typeof body?.text === "string" ? body.text.slice(0, MAX_TEXT) : null;
}

/** 잰 결과를 원장 답에 남긴다 (답이 있을 때만). 예전 답을 이번에 찾았으면 그것도. */
async function remember(replyId: string, text: string, hits: ConsistencyHit[], found: PastSaid[] | null): Promise<void> {
  await updateRepliesLedger((l) => ({
    ...l,
    replies: l.replies.map((r) =>
      r.id === replyId && r.answer ? { ...r, answer: { ...r.answer, consistency: hits, consistencyFor: text, ...(found ? { pastSaid: found } : {}) } } : r
    ),
  }));
}

/** 비교할 예전 답: 초안 때 찾은 것, 없으면 이번에 찾는다 (found = 새로 찾은 것, 원장에 남길 것) */
async function pastFor(ledger: ThreadsRepliesLedger, reply: ThreadsReply, personaId: string): Promise<{ past: PastSaid[]; found: PastSaid[] | null }> {
  if (reply.answer?.pastSaid) return { past: reply.answer.pastSaid, found: null };
  const found = await pastSaidFor(personaId, ledger, reply);
  return { past: found, found };
}

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const status = /시간 초과|timed? ?out/i.test(message) ? 504 : 502;
  return NextResponse.json({ error: `예전 답과 비교하지 못했어요: ${message}` }, { status });
}

async function handlePOST(request: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;
  const text = await readText(request);
  if (text === null) return NextResponse.json({ error: "text 가 필요해요" }, { status: 400 });
  const ledger = await readRepliesLedger();
  const reply = ledger.replies.find((r) => r.id === id);
  if (!reply) return NextResponse.json({ error: "해당 댓글이 원장에 없습니다" }, { status: 404 });
  const persona = currentPersona();
  const { past, found } = await pastFor(ledger, reply, persona.id);
  if (!text.trim() || !past.length) return NextResponse.json({ consistency: [], text, pastCount: past.length });
  try {
    const hits = await checkFinal(text, past, persona.ownerName);
    await remember(id, text, hits, found);
    return NextResponse.json({ consistency: hits, text, pastCount: past.length });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request, ctx: RouteCtx) {
  return withPersonaRequest(request, () => handlePOST(request, ctx));
}
