// 주간 학습 돌리기: POST → { job, started }. 팩 폴더에서 backpass 전체 패스 → 주인 패턴 분석을 뒤에서 돌린다.
// 이미 돌고 있으면 새로 띄우지 않고 그 잡을 돌려준다(started:false). 규칙책은 바꾸지 않는다.
import { NextResponse } from "next/server";
import { currentPersona, withPersonaRequest } from "@/lib/personas/context";
import { startLearningRun } from "@/lib/personas/learning/job";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST() {
  try {
    const { job, started } = await startLearningRun(currentPersona());
    return NextResponse.json({ job, started }, { status: started ? 202 : 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `학습을 시작하지 못했어요: ${message}` }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return withPersonaRequest(request, handlePOST);
}
