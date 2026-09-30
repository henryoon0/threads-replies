// 주간 학습 화면 한 번에: GET → { cards, rules, stats, job, lastRunAt, budget, backpass, partial, patternsError }.
// 읽기만 한다. 끊긴(고아) 학습 잡이 있으면 여기서 다시 띄운다 (lib/personas/learning/job.ts).
import { NextResponse } from "next/server";
import { currentPersona, withPersonaRequest } from "@/lib/personas/context";
import { learningOverview } from "@/lib/personas/learning/job";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET() {
  try {
    return NextResponse.json(await learningOverview(currentPersona()));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `학습 화면을 읽지 못했어요: ${message}` }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return withPersonaRequest(request, handleGET);
}
