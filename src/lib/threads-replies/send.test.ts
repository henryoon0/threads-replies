import { mkdtemp, rm } from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThreadsPublishError } from "@/lib/publish/threads";
import type { ThreadsRepliesLedger } from "./model";
import { removeEphemeralMedia, uploadEphemeralMedia } from "@/lib/share/ephemeral-media";
import { mkdir, writeFile } from "fs/promises";
import { classifySendError, parseReplyImage, readEvidenceImage, sendThreadsReply } from "./send";
import { restoreSkippedReplies, skipPendingReplies } from "./skip-all";
import { readRepliesLedger, writeRepliesLedger } from "./storage";

// 네트워크는 fetch 를 가짜로 바꿔 막는다. 실제 스레드로는 절대 나가지 않는다.
vi.mock("./graph", () => ({ readyToken: vi.fn(async () => "TEST_TOKEN") }));
// Cloudflare 업로드·정리도 가짜 — 실제 배포·삭제는 일어나지 않는다.
vi.mock("@/lib/share/ephemeral-media", () => ({
  uploadEphemeralMedia: vi.fn(async () => ({ url: "https://abc12345.x.pages.dev/tmp-media/a.png", key: "tmp-media/a.png", deploymentPrefix: "abc12345" })),
  removeEphemeralMedia: vi.fn(async () => ({ ok: true })),
}));

type Call = { url: string; body: URLSearchParams | null };
let calls: Call[] = [];
let dir = "";

function ledger(): ThreadsRepliesLedger {
  return {
    posts: [{ id: "p1", text: "글", timestamp: "2026-09-27T00:00:00+0000" }],
    replies: [
      { id: "c1", postId: "p1", username: "kim", text: "질문?", timestamp: "2026-09-27T01:00:00+0000", repliedToId: "p1", intent: "question" },
      {
        id: "c2",
        postId: "p1",
        username: "lee",
        text: "고마워요",
        timestamp: "2026-09-27T02:00:00+0000",
        repliedToId: "p1",
        intent: "chat",
        myReply: { id: "m", text: "네", timestamp: "2026-09-27T03:00:00+0000" },
      },
    ],
    sync: {},
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function stubFetch(publish: () => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, body: init?.body instanceof URLSearchParams ? init.body : null });
      if (url.endsWith("/me/threads")) return publish();
      if (url.includes("/container-1?")) return json({ status: "FINISHED" });
      if (url.endsWith("/me/threads_publish")) return json({ id: "posted-9" });
      return json({ error: { message: "unexpected" } }, 500);
    })
  );
}

beforeEach(async () => {
  calls = [];
  dir = await mkdtemp(path.join(os.tmpdir(), "threads-send-"));
  process.env.THREADS_REPLIES_DIR = dir;
  await writeRepliesLedger(ledger());
});

afterEach(async () => {
  vi.unstubAllGlobals();
  delete process.env.THREADS_REPLIES_DIR;
  await rm(dir, { recursive: true, force: true });
});

describe("sendThreadsReply", () => {
  it("댓글 id 를 reply_to_id 로 달고, 성공하면 원장에 myReply 를 남긴다", async () => {
    stubFetch(() => json({ id: "container-1" }));
    const result = await sendThreadsReply("c1", "  답이에요  ");
    expect(result.ok).toBe(true);
    const create = calls.find((c) => c.url.endsWith("/me/threads"));
    expect(create?.body?.get("reply_to_id")).toBe("c1");
    expect(create?.body?.get("text")).toBe("답이에요");
    expect(create?.body?.get("media_type")).toBe("TEXT");
    const saved = (await readRepliesLedger()).replies.find((r) => r.id === "c1");
    expect(saved?.myReply).toMatchObject({ id: "posted-9", text: "답이에요" });
  });

  it("권한이 없으면 permission 으로 나누고 재인증 주소에 threads_manage_replies 를 넣는다", async () => {
    stubFetch(() =>
      json({ error: { message: "Application does not have permission for this action", type: "OAuthException", code: 10 } }, 403)
    );
    const result = await sendThreadsReply("c1", "답");
    expect(result).toMatchObject({ ok: false, kind: "permission" });
    if (!result.ok) expect(decodeURIComponent(result.reauthUrl ?? "")).toContain("threads_manage_replies");
    expect((await readRepliesLedger()).replies.find((r) => r.id === "c1")?.myReply).toBeUndefined();
  });

  it("이미 답한 댓글·빈 답·없는 댓글은 네트워크를 부르지 않는다", async () => {
    stubFetch(() => json({ id: "container-1" }));
    expect(await sendThreadsReply("c2", "또")).toMatchObject({ ok: false, kind: "already" });
    expect(await sendThreadsReply("c1", "   ")).toMatchObject({ ok: false, kind: "empty" });
    expect(await sendThreadsReply("nope", "답")).toMatchObject({ ok: false, kind: "not-found" });
    expect(calls).toHaveLength(0);
  });
});

describe("classifySendError", () => {
  const err = (status: number, body: unknown) => new ThreadsPublishError("x", status, JSON.stringify(body));
  it("토큰 만료 · 레이트 리밋 · 그 밖을 가른다", () => {
    expect(classifySendError(err(400, { error: { message: "Error validating access token: Session has expired", code: 190 } }))).toBe("token");
    expect(classifySendError(err(429, { error: { message: "Too many calls" } }))).toBe("rate");
    expect(classifySendError(err(400, { error: { message: "Application request limit reached", code: 4 } }))).toBe("rate");
    expect(classifySendError(err(500, { error: { message: "Service unavailable", code: 2 } }))).toBe("other");
    expect(classifySendError(new Error("THREADS_ACCESS_TOKEN 이 .env.local 에 없습니다. 스레드 재인증이 필요해요."))).toBe("token");
  });
});

const PNG = `data:image/png;base64,${Buffer.from("png").toString("base64")}`;

describe("답글 이미지", () => {
  it("이미지를 붙이면 IMAGE 로 올리고, 발행 뒤 Cloudflare 에서 지운다", async () => {
    vi.mocked(removeEphemeralMedia).mockClear();
    stubFetch(() => json({ id: "container-1" }));
    const image = parseReplyImage(PNG);
    if (typeof image === "string") throw new Error(image);
    const result = await sendThreadsReply("c1", "사진 봐 주세요", image);
    expect(result.ok).toBe(true);
    const create = calls.find((c) => c.url.endsWith("/me/threads"))?.body;
    expect(create?.get("media_type")).toBe("IMAGE");
    expect(create?.get("image_url")).toContain("/tmp-media/");
    expect(create?.get("reply_to_id")).toBe("c1");
    expect(removeEphemeralMedia).toHaveBeenCalledTimes(1);
  });

  it("발행이 실패해도 이미지는 지운다", async () => {
    vi.mocked(removeEphemeralMedia).mockClear();
    stubFetch(() => json({ error: { message: "boom" } }, 500));
    const image = parseReplyImage(PNG);
    if (typeof image === "string") throw new Error(image);
    const result = await sendThreadsReply("c1", "x", image);
    expect(result.ok).toBe(false);
    expect(uploadEphemeralMedia).toHaveBeenCalled();
    expect(removeEphemeralMedia).toHaveBeenCalledTimes(1);
  });

  it("JPG·PNG 가 아니면 거절한다", () => {
    expect(typeof parseReplyImage("data:image/gif;base64,AAAA")).toBe("string");
  });
});

describe("모두 건너뛰기", () => {
  it("답할 차례인 댓글만 건너뛰고, 되돌리면 그 목록만 살아난다", async () => {
    const ids = await skipPendingReplies();
    expect(ids).toEqual(["c1"]); // c2 는 이미 답함
    expect((await readRepliesLedger()).replies.find((r) => r.id === "c1")?.skipped).toBe(true);
    expect(await restoreSkippedReplies(ids)).toBe(1);
    expect((await readRepliesLedger()).replies.find((r) => r.id === "c1")?.skipped).toBeUndefined();
  });
});

describe("근거 캡처 붙이기", () => {
  it("그 댓글 폴더의 캡처만 읽고, 다른 곳 경로는 거절한다", async () => {
    process.env.THREADS_EVIDENCE_DIR = path.join(dir, "ev");
    await mkdir(path.join(dir, "ev", "c1"), { recursive: true });
    await writeFile(path.join(dir, "ev", "c1", "s1.png"), "png");
    const ok = await readEvidenceImage("c1", "/threads-evidence/c1/s1.png");
    expect(typeof ok).not.toBe("string");
    expect(typeof (await readEvidenceImage("c1", "/threads-evidence/c2/s1.png"))).toBe("string");
    expect(typeof (await readEvidenceImage("c1", "/threads-evidence/c1/../../ledger.json"))).toBe("string");
    delete process.env.THREADS_EVIDENCE_DIR;
  });
});
