import { NextResponse } from "next/server";
import { startVoiceBuild, voiceStatus } from "@/lib/voice-build";

export const dynamic = "force-dynamic";

// GET: 말투 만들기 진행 상태 · POST: 다시 만들기
export async function GET() {
  return NextResponse.json(await voiceStatus());
}

export async function POST() {
  startVoiceBuild();
  return NextResponse.json(await voiceStatus());
}
