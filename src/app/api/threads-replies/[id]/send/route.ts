// 답글 실제 발송 (픽 6). 5초 되돌리기는 화면이 끝낸 뒤에 부른다. POST { message, image? } → { reply }.
// image 는 data URL(JPG·PNG), evidenceImage 는 근거 캡처 경로. 서버가 잠깐 공개해 스레드에 넘기고 발행 뒤 지운다.
// 실패는 kind 로 나눠 준다: permission(권한 추가·폴백) · token(재인증) · rate(잠시 뒤) · other.
import { NextResponse } from "next/server";
import { parseReplyImage, readEvidenceImage, sendThreadsReply, type ReplyImage, type SendResult } from "@/lib/threads-replies/send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Failure = Extract<SendResult, { ok: false }>;

const STATUS: Record<Failure["kind"], number> = {
  empty: 400,
  "not-found": 404,
  already: 409,
  busy: 409,
  permission: 403,
  token: 401,
  rate: 429,
  other: 502,
};

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { message?: unknown; image?: unknown; evidenceImage?: unknown };
  const message = typeof body.message === "string" ? body.message : "";
  // 직접 붙인 이미지가 우선, 없으면 근거 캡처
  let image: ReplyImage | string | undefined;
  if (typeof body.image === "string" && body.image) image = parseReplyImage(body.image);
  else if (typeof body.evidenceImage === "string" && body.evidenceImage) image = await readEvidenceImage(id, body.evidenceImage);
  if (typeof image === "string") return NextResponse.json({ error: image, kind: "empty" }, { status: 400 });
  const result = await sendThreadsReply(id, message, image);
  if (result.ok) return NextResponse.json({ reply: result.reply });
  return NextResponse.json(
    { error: result.message, kind: result.kind, reauthUrl: result.reauthUrl },
    { status: STATUS[result.kind] }
  );
}
