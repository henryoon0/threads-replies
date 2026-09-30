import { NextResponse } from "next/server";
import { accountStatus, connectAccount, ConnectError, disconnectAccount } from "@/lib/account";
import { capabilities } from "@/lib/capabilities";
import { writeProfile } from "@/lib/profile";
import { findOnce } from "@/lib/token-finder";

export const dynamic = "force-dynamic";

export async function GET() {
  let account = await accountStatus();
  // 연결 안 됐으면 이 컴퓨터에 남은 토큰을 한 번 찾아 붙인다. 못 찾으면 화면이 토큰 팝업을 띄운다.
  const found = account.connected ? null : await findOnce();
  if (found?.state === "connected") account = await accountStatus();
  const caps = await capabilities();
  return NextResponse.json({ ...account, caps, found });
}

/** 토큰 붙여넣기 → 검증 → 저장. intro 는 한 줄 소개(선택). */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { token?: unknown; intro?: unknown };
  if (typeof body.token !== "string") {
    return NextResponse.json({ error: "토큰을 붙여넣어 주세요." }, { status: 400 });
  }
  try {
    return NextResponse.json(await connectAccount(body.token, typeof body.intro === "string" ? body.intro : ""));
  } catch (error) {
    if (error instanceof ConnectError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

/** 한 줄 소개만 바꾸기 */
export async function PATCH(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { intro?: unknown };
  if (typeof body.intro !== "string") return NextResponse.json({ error: "intro 가 필요합니다" }, { status: 400 });
  return NextResponse.json(await writeProfile({ intro: body.intro.trim().slice(0, 80) }));
}

export async function DELETE() {
  await disconnectAccount();
  return NextResponse.json({ ok: true });
}
