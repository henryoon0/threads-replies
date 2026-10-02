import { describe, expect, it } from "vitest";
import type { ThreadsReply } from "./model";
import { oldestPendingIds } from "./prep-batch";

const r = (id: string, min: number, extra: Partial<ThreadsReply> = {}): ThreadsReply =>
  ({ id, postId: "p", username: "u", text: "", timestamp: new Date(Date.UTC(2026, 8, 1, 0, min)).toISOString(), repliedToId: "p", intent: "chat", ...extra }) as ThreadsReply;

describe("oldestPendingIds (10-02)", () => {
  it("답할 차례인 것만, 오래된 순으로 n 개", () => {
    const replies = [r("new", 9), r("done", 0, { myReply: { id: "m", text: "", timestamp: "" } }), r("skip", 1, { skipped: true }), r("ctx", 2, { settled: "continued" }), r("old", 3), r("mid", 5)];
    expect(oldestPendingIds({ replies }, 2)).toEqual(["old", "mid"]);
  });
});
