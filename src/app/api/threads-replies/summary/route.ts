// 레일·질문 띠 숫자. 원장 파일만 읽는다 (동기화·AI 없음).
import { NextResponse } from "next/server";
import { readThreadsSummary } from "@/lib/threads-replies/summary";
import { withPersonaRequest } from "@/lib/personas/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET() {
  return NextResponse.json(await readThreadsSummary());
}

// 요청마다 지금 페르소나(?persona= 또는 쿠키)로 감싼다 — 원장·토큰·규칙책이 그 계정 것으로 갈린다.
export async function GET(request: Request) {
  return withPersonaRequest(request, () => handleGET());
}
