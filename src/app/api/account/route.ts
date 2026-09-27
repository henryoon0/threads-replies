import { NextResponse } from "next/server";
import { accountStatus, connectAccount, ConnectError, disconnectAccount } from "@/lib/account";
import { capabilities } from "@/lib/capabilities";
import { writeProfile } from "@/lib/profile";

export const dynamic = "force-dynamic";

export async function GET() {
  const [account, caps] = await Promise.all([accountStatus(), capabilities()]);
  return NextResponse.json({ ...account, caps });
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
