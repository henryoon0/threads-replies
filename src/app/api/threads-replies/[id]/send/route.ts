// 답글 보내기 (픽 6·14). POST { message, image?, evidenceImage?, delayMs? }
//   delayMs 가 있으면(api 팩) 서버 대기열에 넣고 바로 202 { queued } — 그 시간이 지나면 서버가 보낸다.
//     화면을 떠나도·앱이 다시 켜져도 보낸다 (2026-10-02 henry "한번 발송된 건 발송이 되어야 한다"). send-queue.ts
//   DELETE → 보내기 시작 전이면 대기열에서 뺀다(되돌리기). 늦었으면 409.
//   GET    → 이 댓글의 대기·결과 { item } (없으면 null)
// 응답은 페르소나에 따라 둘:
//   - api 팩(AICC):  200 { mode: "api", reply, log } — 실제로 스레드에 올렸다. log = 학습 기록 한 줄
//   - copy 팩(박약사): 200 { mode: "copy", text, permalink } — 올리지 않았다. 화면이 복사하고 스레드를 연다.
//     주인이 단 뒤 [달았어요]는 PATCH /api/threads-replies { markedAnswered } 로 기록한다.
// 서버가 보낼 글로 안전 관문을 다시 돈다. strict 팩에 막는 표현이 있으면 409 { error, kind: "gate", gate }.
// 그 밖의 실패는 kind 로 나눠 준다: permission(권한 추가·폴백) · token(재인증) · rate(잠시 뒤) · other.
import { NextResponse } from "next/server";
import { parseReplyImage, readEvidenceImage, sendThreadsReply, type ReplyImage, type SendResult } from "@/lib/threads-replies/send";
import { currentPersona, withPersonaRequest } from "@/lib/personas/context";
import { cancelSend, enqueueSend, sendStatus } from "@/lib/threads-replies/send-queue";

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

const MAX_DELAY_MS = 30_000;

/** 대기열에 넣을 지연(양수·유한·상한). 없거나 틀리면 null = 바로 보낸다. */
function delayOf(raw: unknown): number | null {
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? Math.min(raw, MAX_DELAY_MS) : null;
}

type SendBody = { message?: unknown; image?: unknown; evidenceImage?: unknown; delayMs?: unknown };

/** 대기열에 맡길 글과 첨부. 글도 첨부도 없으면 null. */
function queuePayloadOf(body: SendBody, message: string) {
  const image = typeof body.image === "string" && body.image ? body.image : undefined;
  const evidenceImage = typeof body.evidenceImage === "string" && body.evidenceImage ? body.evidenceImage : undefined;
  if (!message.trim() && !image && !evidenceImage) return null;
  return { message, ...(image ? { image } : {}), ...(evidenceImage ? { evidenceImage } : {}) };
}

async function handlePOST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as SendBody;
  const message = typeof body.message === "string" ? body.message : "";
  const delay = delayOf(body.delayMs);
  // 복사 팩은 서버가 올리지 않으니 대기열이 필요 없다
  if (delay !== null && currentPersona().send !== "copy") {
    const payload = queuePayloadOf(body, message);
    if (!payload) return NextResponse.json({ error: "보낼 답글이 비어 있어요.", kind: "empty" }, { status: 400 });
    return NextResponse.json({ queued: await enqueueSend(id, payload, delay) }, { status: 202 });
  }
  const image = await imageOf(id, body);
  if (typeof image === "string") return NextResponse.json({ error: image, kind: "empty" }, { status: 400 });
  return respond(await sendThreadsReply(id, message, image));
}

async function handleDELETE({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (await cancelSend(id)) return NextResponse.json({ cancelled: true });
  return NextResponse.json({ cancelled: false, error: "이미 보내는 중이라 되돌릴 수 없어요" }, { status: 409 });
}

async function handleGET({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = await sendStatus(id);
  if (!item) return NextResponse.json({ item: null });
  const { image: _image, ...rest } = item;
  void _image;
  return NextResponse.json({ item: rest });
}

// 요청마다 지금 페르소나(?persona= 또는 쿠키)로 감싼다 — 원장·토큰·관문·전송 방식이 그 계정 것으로 갈린다.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return withPersonaRequest(request, () => handlePOST(request, ctx));
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return withPersonaRequest(request, () => handleDELETE(ctx));
}

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return withPersonaRequest(request, () => handleGET(ctx));
}
