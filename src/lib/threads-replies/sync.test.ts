import { describe, expect, it } from "vitest";
import { createRepliesLedger } from "./model";
import { mergeConversations, type FetchedConversation } from "./sync";

// 가짜 대화 — 실제 계정의 댓글은 공유 저장소에 넣지 않는다.
const post = { id: "p1", text: "노션 AI 한 달 써 본 후기", timestamp: "2026-09-20T00:00:00+0000" };
const conv: FetchedConversation = {
  post,
  replies: [
    { id: "c1", text: "좋은 글 감사합니다", username: "kim", timestamp: "2026-09-20T01:00:00+0000", replied_to: { id: "p1" } },
    { id: "m1", text: "봐 주셔서 감사해요 !", username: "me", timestamp: "2026-09-20T02:00:00+0000", replied_to: { id: "c1" }, is_reply_owned_by_me: true },
    { id: "c2", text: "무료 요금제로도 되나요?", username: "lee", timestamp: "2026-09-20T03:00:00+0000", replied_to: { id: "p1" } },
    { id: "m2", text: "저라면 무료로 먼저 써 볼 것 같아요", username: "me", timestamp: "2026-09-20T04:00:00+0000", replied_to: { id: "c2" }, is_reply_owned_by_me: true },
    { id: "c3", text: "좋은 글 감사합니다 ㅎㅎ", username: "lee", timestamp: "2026-09-20T05:00:00+0000", replied_to: { id: "m2" } },
    { id: "c4", text: "ㅋㅋㅋ 공감돼요", username: "park", timestamp: "2026-09-20T06:00:00+0000", replied_to: { id: "p1" } },
  ],
};

describe("mergeConversations", () => {
  it("남의 댓글만 남기고 내 답은 myReply 로 잇는다", () => {
    const ledger = mergeConversations(createRepliesLedger(), [conv], "2026-09-27T00:00:00.000Z");
    expect(ledger.replies.map((r) => r.id).sort()).toEqual(["c1", "c2", "c3", "c4"]);
    expect(ledger.replies.find((r) => r.id === "c1")?.myReply?.id).toBe("m1");
    expect(ledger.sync.lastSyncAt).toBe("2026-09-27T00:00:00.000Z");
  });

  it("내 답에 이어 단 말은 대화 줄기로, 내 답 문구를 같이 들고 있다", () => {
    const ledger = mergeConversations(createRepliesLedger(), [conv], "now");
    const followUp = ledger.replies.find((r) => r.id === "c3")!;
    expect(followUp.repliedToId).toBe("m2");
    expect(followUp.repliedToText).toMatch(/^저라면/);
  });

  it("건너뜀·초안은 이어받고, 사라진 댓글은 뺀다", () => {
    const first = mergeConversations(createRepliesLedger(), [conv], "t1");
    const target = first.replies[0];
    const answer = { verdict: "answerable" as const, verdictReason: "r", sources: [], sentences: [], draft: "d", model: "m", generatedAt: "t", styleExamples: 0 };
    const edited = {
      ...first,
      replies: [
        ...first.replies.map((r) => (r.id === target.id ? { ...r, skipped: true, answer } : r)),
        { ...target, id: "gone", postId: "p1" },
        { ...target, id: "other-post", postId: "not-fetched" },
      ],
    };
    const second = mergeConversations(edited, [conv], "t2");
    const kept = second.replies.find((r) => r.id === target.id)!;
    expect(kept.skipped).toBe(true);
    expect(kept.answer?.draft).toBe("d");
    expect(second.replies.some((r) => r.id === "gone")).toBe(false);
    expect(second.replies.some((r) => r.id === "other-post")).toBe(true);
  });

  it("질문은 question 으로 가른다", () => {
    const ledger = mergeConversations(createRepliesLedger(), [conv], "now");
    expect(ledger.replies.find((r) => r.id === "c2")?.intent).toBe("question");
  });
});
