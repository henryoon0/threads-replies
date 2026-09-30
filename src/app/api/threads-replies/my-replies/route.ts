import { NextResponse } from "next/server";
import { readMyReplies } from "@/lib/threads-replies/my-replies";
import { withPersonaRequest } from "@/lib/personas/context";

// 답을 쓸 때 옆에 띄우는 "전에 내가 한 말"의 원천. 읽기 전용.
async function handleGET() {
  return NextResponse.json(await readMyReplies());
}

// 요청마다 지금 페르소나(?persona= 또는 쿠키)로 감싼다 — 원장·토큰·규칙책이 그 계정 것으로 갈린다.
export async function GET(request: Request) {
  return withPersonaRequest(request, () => handleGET());
}
