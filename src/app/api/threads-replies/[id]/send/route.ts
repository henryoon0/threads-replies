// 답글 보내기 (픽 6·14). 5초 되돌리기는 화면이 끝낸 뒤에 부른다. POST { message, image?, evidenceImage? }
// 응답은 페르소나에 따라 둘:
//   - api 팩(AICC):  200 { mode: "api", reply, log } — 실제로 스레드에 올렸다. log = 학습 기록 한 줄
//   - copy 팩(박약사): 200 { mode: "copy", text, permalink } — 올리지 않았다. 화면이 복사하고 스레드를 연다.
//     주인이 단 뒤 [달았어요]는 PATCH /api/threads-replies { markedAnswered } 로 기록한다.
// 서버가 보낼 글로 안전 관문을 다시 돈다. strict 팩에 막는 표현이 있으면 409 { error, kind: "gate", gate }.
// 그 밖의 실패는 kind 로 나눠 준다: permission(권한 추가·폴백) · token(재인증) · rate(잠시 뒤) · other.
import { NextResponse } from "next/server";
import { parseReplyImage, readEvidenceImage, sendThreadsReply, type ReplyImage, type SendResult } from "@/lib/threads-replies/send";
import { withPersonaRequest } from "@/lib/personas/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Failure = Extract<SendResult, { ok: false }>;

const STATUS: Record<Failure["kind"], number> = {
  empty: 400,
  "not-found": 404,
  already: 409,
  busy: 409,
  gate: 409,
  permission: 403,
  token: 401,
  rate: 429,
  other: 502,
};

/** 직접 붙인 이미지가 우선, 없으면 근거 캡처. 형식이 틀리면 오류 문구. */
async function imageOf(id: string, body: { image?: unknown; evidenceImage?: unknown }): Promise<ReplyImage | string | undefined> {
  if (typeof body.image === "string" && body.image) return parseReplyImage(body.image);
  if (typeof body.evidenceImage === "string" && body.evidenceImage) return readEvidenceImage(id, body.evidenceImage);
  return undefined;
}

function respond(result: SendResult) {
  if (result.ok && result.mode === "copy") return NextResponse.json({ mode: "copy", text: result.text, permalink: result.permalink });
  if (result.ok) return NextResponse.json({ mode: "api", reply: result.reply, log: result.log });
  return NextResponse.json(
    { error: result.message, kind: result.kind, reauthUrl: result.reauthUrl, gate: result.gate },
    { status: STATUS[result.kind] }
  );
}

async function handlePOST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { message?: unknown; image?: unknown; evidenceImage?: unknown };
  const message = typeof body.message === "string" ? body.message : "";
  const image = await imageOf(id, body);
  if (typeof image === "string") return NextResponse.json({ error: image, kind: "empty" }, { status: 400 });
  return respond(await sendThreadsReply(id, message, image));
}

// 요청마다 지금 페르소나(?persona= 또는 쿠키)로 감싼다 — 원장·토큰·관문·전송 방식이 그 계정 것으로 갈린다.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return withPersonaRequest(request, () => handlePOST(request, ctx));
}
