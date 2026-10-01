import { describe, expect, it, vi } from "vitest";
import { cancelItem, enqueueItem, processDue, type SendQueue } from "./send-queue-core";

const empty: SendQueue = { items: [] };
const T0 = Date.parse("2026-10-02T00:00:00.000Z");
const payload = { message: "답글이에요" };

describe("보내기 대기열", () => {
  it("5초가 지나기 전에는 보내지 않고, 지나면 화면과 상관없이 한 번 보낸다", async () => {
    const q = enqueueItem(empty, "c1", payload, T0, 5000);
    const send = vi.fn(async () => ({ ok: true as const }));
    const early = await processDue(q, T0 + 4000, send, () => false);
    expect(send).not.toHaveBeenCalled();
    expect(early.items[0].status).toBe("waiting");
    const done = await processDue(early, T0 + 5000, send, () => false);
    expect(send).toHaveBeenCalledTimes(1);
    expect(done.items[0].status).toBe("sent");
    await processDue(done, T0 + 9000, send, () => false);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("5초 안에 되돌리면 대기열에서 빠지고 보내지 않는다. 보내기 시작한 뒤에는 되돌릴 수 없다", async () => {
    const q = enqueueItem(empty, "c1", payload, T0, 5000);
    const undone = cancelItem(q, "c1");
    expect(undone.cancelled).toBe(true);
    expect(undone.queue.items).toHaveLength(0);
    const sending: SendQueue = { items: [{ ...q.items[0], status: "sending" }] };
    expect(cancelItem(sending, "c1").cancelled).toBe(false);
  });

  it("실패하면 이유를 남긴다", async () => {
    const q = enqueueItem(empty, "c1", payload, T0, 5000);
    const send = vi.fn(async () => ({ ok: false as const, kind: "token", message: "토큰이 만료됐어요" }));
    const done = await processDue(q, T0 + 5000, send, () => false);
    expect(done.items[0]).toMatchObject({ status: "failed", kind: "token", error: "토큰이 만료됐어요" });
  });

  it("보내던 중 앱이 꺼졌으면 다시 보내지 않는다: 이미 달렸으면 보냄, 아니면 확인 필요로 남긴다", async () => {
    const base = enqueueItem(empty, "c1", payload, T0, 5000).items[0];
    const q: SendQueue = { items: [{ ...base, status: "sending" }, { ...base, replyId: "c2", status: "sending" }] };
    const send = vi.fn(async () => ({ ok: true as const }));
    const done = await processDue(q, T0 + 60_000, send, (id) => id === "c1", { restarted: true });
    expect(send).not.toHaveBeenCalled();
    expect(done.items.find((i) => i.replyId === "c1")?.status).toBe("sent");
    expect(done.items.find((i) => i.replyId === "c2")).toMatchObject({ status: "failed", kind: "unknown" });
  });
});
