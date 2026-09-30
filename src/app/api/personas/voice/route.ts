// 말투 만들기 · 제외 심사 (시안 픽 4 "vb-exclude"). 지금 페르소나의 주인 답 가운데 배우면 안 되는 것.
// GET  → { candidates:[{id, comment, reply, reasons:[{kind, phrase}], decision, locked, decidedBy}], stats:{ total, flagged, excluded, kept, masked } }
// POST { id, decision: "exclude"|"keep"|"mask" } → 결정 저장 (팩 private/voice-exclusions.json).
// 박약사 처방약 선택·용량 답은 잠겨 있어 exclude 만 받는다. 예시 고르기·카테고리 만들기가 이 결정을 따른다.
import { NextResponse } from "next/server";
import { currentPersona, withPersonaRequest } from "@/lib/personas/context";
import {
  exclusionStats,
  reviewPairs,
  saveOwnerDecision,
  validateDecision,
  type ExclusionDecision,
  type PairReview,
} from "@/lib/personas/voice-exclusions";
import { loadOwnerPairs } from "@/lib/threads-replies/voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DECISIONS: readonly ExclusionDecision[] = ["exclude", "keep", "mask"];

async function currentReviews(): Promise<PairReview[]> {
  const persona = currentPersona();
  return reviewPairs(persona, await loadOwnerPairs(persona));
}

function candidateView(r: PairReview) {
  return { id: r.id, comment: r.comment, reply: r.reply, reasons: r.reasons, decision: r.decision, locked: r.locked, decidedBy: r.decidedBy };
}

async function handleGET() {
  const reviews = await currentReviews();
  return NextResponse.json({
    persona: currentPersona().id,
    candidates: reviews.filter((r) => r.reasons.length > 0).map(candidateView),
    stats: exclusionStats(reviews),
  });
}

async function handlePOST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { id?: unknown; decision?: unknown };
  const id = typeof body.id === "string" ? body.id : "";
  const decision = body.decision as ExclusionDecision;
  if (!id || !DECISIONS.includes(decision)) {
    return NextResponse.json({ error: "id 와 decision(exclude·keep·mask)이 필요합니다" }, { status: 400 });
  }
  const review = (await currentReviews()).find((r) => r.id === id);
  if (!review) return NextResponse.json({ error: "해당 답이 말투 재료에 없습니다" }, { status: 404 });
  const invalid = validateDecision(review, decision);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 409 });
  await saveOwnerDecision(currentPersona().id, review, decision);
  const updated = (await currentReviews()).find((r) => r.id === id) ?? review;
  return NextResponse.json({ candidate: candidateView(updated) });
}

export async function GET(request: Request) {
  return withPersonaRequest(request, handleGET);
}

export async function POST(request: Request) {
  return withPersonaRequest(request, () => handlePOST(request));
}
