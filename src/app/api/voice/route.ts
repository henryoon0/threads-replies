import { NextResponse } from "next/server";
import { packHasRulebook, startVoiceBuild, voiceStatus } from "@/lib/voice-build";

export const dynamic = "force-dynamic";

// GET: 말투 만들기 진행 상태 · POST: 다시 만들기
// pack: 팩 규칙책이 있어 말투 만들기가 필요 없다 → 화면이 말투 줄을 그리지 않는다
export async function GET() {
  return NextResponse.json({ ...(await voiceStatus()), pack: await packHasRulebook() });
}

export async function POST() {
  if (!(await packHasRulebook())) startVoiceBuild();
  return NextResponse.json(await voiceStatus());
}
