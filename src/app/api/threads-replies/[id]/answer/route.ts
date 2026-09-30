// 답 초안 다시 쓰기: 붙인 링크(근거로 추가)·지시·주인 메모·웹 검색 허용을 얹어 바로 다시 만든다.
// 이전 초안의 팩 세션이 있으면 같은 세션에 이어 쓰고, 결과는 3벌(options)로 돌아온다.
import { NextResponse } from "next/server";
import { regenerateAnswer, type RegenerateOptions } from "@/lib/threads-replies/answer-job";
import { withPersonaRequest } from "@/lib/personas/context";
import { saveMyNote } from "@/lib/threads-replies/my-notes";
import { readRepliesLedger } from "@/lib/threads-replies/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

const MAX_LINKS = 5;

function readOptions(body: Record<string, unknown>): RegenerateOptions | string {
  const links = body.extraLinks;
  if (links !== undefined && !(Array.isArray(links) && links.every((l) => typeof l === "string"))) {
    return "extraLinks 는 주소 문자열 배열이어야 합니다";
  }
  const extraLinks = (links as string[] | undefined)?.map((l) => l.trim()).filter((l) => /^https?:\/\//i.test(l));
  if (extraLinks && extraLinks.length > MAX_LINKS) return `링크는 한 번에 ${MAX_LINKS}개까지 붙일 수 있어요`;
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  return {
    extraLinks: extraLinks?.length ? extraLinks : undefined,
    instruction: text(body.instruction),
    // 주인 메모: 새 이름 ownerNote, 예전 이름 henryNote 도 받는다
    henryNote: text(body.ownerNote) ?? text(body.henryNote),
    allowWeb: body.allowWeb === true,
  };
}

async function handlePOST(request: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const opts = readOptions(body);
  if (typeof opts === "string") return NextResponse.json({ error: opts }, { status: 400 });
  try {
    // 주인 메모는 내 자료에 노트로 남겨 다음 비슷한 질문에도 근거로 쓴다 (같이 만든 답)
    if (opts.henryNote) {
      const reply = (await readRepliesLedger()).replies.find((r) => r.id === id);
      if (reply) await saveMyNote({ question: reply.text, ask: reply.answer?.henryAsk, answer: opts.henryNote }).catch(() => {});
    }
    const result = await regenerateAnswer(id, opts);
    if (!result) return NextResponse.json({ error: "해당 댓글이 원장에 없습니다" }, { status: 404 });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /시간 초과|timed? ?out/i.test(message) ? 504 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

// 요청마다 지금 페르소나(?persona= 또는 쿠키)로 감싼다 — 원장·토큰·규칙책이 그 계정 것으로 갈린다.
export async function POST(request: Request, ctx: RouteCtx) {
  return withPersonaRequest(request, () => handlePOST(request, ctx));
}
