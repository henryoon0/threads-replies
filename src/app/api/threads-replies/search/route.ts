// 스레드 계정 검색: GET ?q= → { query, comments, posts, past }. 지금 페르소나(쿠키·?persona=)의 원장·지식에서 찾는다.
import { NextResponse } from "next/server";
import { currentPersona, withPersonaRequest } from "@/lib/personas/context";
import { searchAccount } from "@/lib/threads-replies/search";
import { readRepliesLedger } from "@/lib/threads-replies/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_QUERY = 80;

async function handleGET(request: Request) {
  const q = (new URL(request.url).searchParams.get("q") ?? "").slice(0, MAX_QUERY).trim();
  if (!q) return NextResponse.json({ query: "", comments: [], posts: [], past: [] });
  const ledger = await readRepliesLedger();
  return NextResponse.json(await searchAccount(currentPersona().id, ledger, q));
}

export async function GET(request: Request) {
  return withPersonaRequest(request, () => handleGET(request));
}
