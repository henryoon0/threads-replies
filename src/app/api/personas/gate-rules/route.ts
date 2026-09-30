// 지금 페르소나의 안전 관문 규칙 — 화면이 초안·편집 중 글을 바로 칠하려고 읽는다 (시안 픽 7·11).
// GET → { persona, gate: "light"|"strict", rules: { version, rules[] } }. 검사 자체는 화면이 gate.ts checkGate 로 한다.
// 보내기 직전 판정은 서버가 다시 한다(send 라우트) — 이 규칙은 미리 보기용이다.
import { NextResponse } from "next/server";
import { currentPersona, withPersonaRequest } from "@/lib/personas/context";
import { readGateRules } from "@/lib/personas/gate-rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET() {
  const persona = currentPersona();
  return NextResponse.json({ persona: persona.id, gate: persona.gate, rules: await readGateRules(persona.id) });
}

export async function GET(request: Request) {
  return withPersonaRequest(request, handleGET);
}
