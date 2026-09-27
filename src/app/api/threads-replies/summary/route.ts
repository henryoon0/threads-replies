// 레일·질문 띠 숫자. 원장 파일만 읽는다 (동기화·AI 없음).
import { NextResponse } from "next/server";
import { readThreadsSummary } from "@/lib/threads-replies/summary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await readThreadsSummary());
}
