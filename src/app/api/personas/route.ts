// 답글 페르소나 목록 — 레일 위 계정 카드(시안 픽 1)용. 경로·토큰은 내보내지 않는다.
import { NextResponse } from "next/server";
import { personaOverview } from "@/lib/personas/overview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ personas: await personaOverview() });
}
