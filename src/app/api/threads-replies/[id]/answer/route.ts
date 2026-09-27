// 답 초안 다시 쓰기: 붙인 링크(근거로 추가)·지시·henry 메모·웹 검색 허용을 얹어 바로 다시 만든다.
import { NextResponse } from "next/server";
import { regenerateAnswer, type RegenerateOptions } from "@/lib/threads-replies/answer-job";
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
    myNote: text(body.myNote),
    allowWeb: body.allowWeb === true,
  };
}

export async function POST(request: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const opts = readOptions(body);
  if (typeof opts === "string") return NextResponse.json({ error: opts }, { status: 400 });
  try {
    // 초안 아래 질문에 답했으면 그 답을 내 자료에 남겨 다음 질문에도 쓴다 (같이 만든 답)
    if (opts.myNote) {
      const reply = (await readRepliesLedger()).replies.find((r) => r.id === id);
      if (reply) await saveMyNote({ question: reply.text, ask: reply.answer?.myAsk, answer: opts.myNote }).catch(() => {});
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
