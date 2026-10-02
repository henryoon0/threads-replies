import { describe, expect, it } from "vitest";
import type { ThreadsReply } from "@/lib/threads-replies/model";
import type { PostGroup, ReplyThread } from "@/lib/threads-replies/summary";
import { chainOf, filteredQueue, focusOrder, isExpandedThread, nextId, splitByReady, urgentReplies, visibleGroups } from "./threads-view";

function reply(id: string, extra: Partial<ThreadsReply> = {}): ThreadsReply {
  return {
    id,
    postId: "p1",
    username: `u${id}`,
    text: `text ${id}`,
    timestamp: "2026-09-27T00:00:00Z",
    repliedToId: "p1",
    intent: "chat",
    ...extra,
  };
}

function thread(root: ThreadsReply, followUps: ThreadsReply[] = []): ReplyThread {
  const all = [root, ...followUps];
  return { root, followUps, pending: all.filter((r) => !r.myReply && !r.skipped).length };
}

function group(threads: ReplyThread[], id = "p1"): PostGroup {
  return { post: { id, text: "첫 줄\n둘째 줄", timestamp: "2026-09-26T00:00:00Z" }, threads, pending: 0, questions: 0 };
}

const mine = (id: string, text: string) => ({ id, text, timestamp: "2026-09-27T01:00:00Z" });

describe("chainOf — 댓글 → 내 답 → 상대 재답", () => {
  it("내 답글을 사이에 끼워 펴고, 같은 내 답이 두 번 오면 한 번만 그린다", () => {
    const root = reply("a", { myReply: mine("m1", "내 답") });
    const follow = reply("b", { repliedToId: "m1", repliedToText: "내 답", intent: "question" });
    const nodes = chainOf(thread(root, [follow]));
    expect(nodes.map((n) => (n.kind === "me" ? `me:${n.text}` : n.reply.id))).toEqual(["a", "me:내 답", "b"]);
  });

  it("원장에 없는 내 답에 단 댓글이면 그 답을 먼저 보여 준다", () => {
    const orphan = reply("c", { repliedToId: "m9", repliedToText: "예전 내 답" });
    expect(chainOf(thread(orphan)).map((n) => n.kind)).toEqual(["me", "them"]);
  });
});

describe("레일 칸별 보기", () => {
  const answered = thread(reply("a", { myReply: mine("m1", "답") }));
  const convo = thread(reply("b", { myReply: mine("m2", "답2") }), [
    reply("c", { repliedToId: "m2", repliedToText: "답2", intent: "question", answer: { verdict: "answerable" } as ThreadsReply["answer"] }),
  ]);
  const single = thread(reply("d", { intent: "question" }));
  const skipped = thread(reply("e", { skipped: true }));
  const groups = [group([convo, single, answered, skipped])];

  it("댓글 칸은 답할 차례가 있는 줄기만, 질문 칸은 답 안 한 질문이 있는 줄기만", () => {
    expect(visibleGroups(groups, "comments")[0].threads.map((t) => t.root.id)).toEqual(["b", "d"]);
    expect(focusOrder(visibleGroups(groups, "questions"), "questions")).toEqual(["c", "d"]);
  });

  it("기록 칸은 답했거나 건너뛴 댓글을 고를 수 있다", () => {
    expect(focusOrder(visibleGroups(groups, "history"), "history")).toEqual(["b", "a", "e"]);
  });

  it("글 머리 숫자는 거르기 전 댓글 수를 센다", () => {
    expect(visibleGroups(groups, "questions")[0].total).toBe(5);
  });

  it("내 차례인 대화 줄기만 펴고 한 줄 댓글은 접는다", () => {
    expect(isExpandedThread(convo, "comments")).toBe(true);
    expect(isExpandedThread(single, "comments")).toBe(false);
  });

  it("지금 답할 목록은 질문 → 관문 걸림 → 오래 기다린 순이고 이유를 붙인다", () => {
    const now = Date.parse("2026-09-29T00:00:00Z");
    const old = thread(reply("o", { timestamp: "2026-09-20T00:00:00Z" }));
    const gated = thread(reply("g", { answer: { draft: "막을 말" } as ThreadsReply["answer"] }));
    const gs = [group([convo, single, old, gated, answered])];
    const items = urgentReplies(gs, "comments", (r) => r.id === "g" || r.id === "d", 5, now);
    expect(items.map((i) => i.reply.id)).toEqual(["d", "c", "g", "o"]);
    expect(items[0].reasons).toEqual(["질문", "관문", "오래 기다림"]);
    expect(urgentReplies(gs, "comments", () => false, 2, now).map((i) => i.reply.id)).toEqual(["c", "d"]);
  });
});

describe("nextId — 다음 댓글로", () => {
  it("다음 것, 끝이면 앞 것", () => {
    expect(nextId(["a", "b", "c"], "a")).toBe("b");
    expect(nextId(["a", "b", "c"], "c")).toBe("b");
    expect(nextId(["a"], "a")).toBeNull();
  });

  it("답해서 빠진 댓글은 옛 순서에서 그 뒤에 있던 것을 고른다", () => {
    expect(nextId(["a", "c"], "b", ["a", "b", "c"])).toBe("c");
    expect(nextId(["a"], "b", ["a", "b"])).toBe("a");
  });
});

describe("filteredQueue — 한 버튼 메뉴(오래된 순·최근 순 · 질문만)", () => {
  const old = reply("old", { timestamp: "2026-09-20T00:00:00Z", intent: "question" });
  const mid = reply("mid", { timestamp: "2026-09-25T00:00:00Z" });
  const recent = reply("new", { timestamp: "2026-09-30T00:00:00Z", intent: "question" });
  const done = reply("done", { timestamp: "2026-09-19T00:00:00Z", myReply: mine("m", "답") });
  const groups = [group([thread(mid), thread(recent)]), group([thread(old), thread(done)], "p2")];

  it("오래된 순: 답 안 한 댓글을 글과 상관없이 가장 오래 기다린 것부터 한 줄로", () => {
    expect(filteredQueue(groups, { sort: "old", questionsOnly: false }).map((r) => r.id)).toEqual(["old", "mid", "new"]);
  });

  it("최근 순은 방금 달린 것부터", () => {
    expect(filteredQueue(groups, { sort: "new", questionsOnly: false }).map((r) => r.id)).toEqual(["new", "mid", "old"]);
  });

  it("질문만 켜면 질문 댓글만 남긴다", () => {
    expect(filteredQueue(groups, { sort: "old", questionsOnly: true }).map((r) => r.id)).toEqual(["old", "new"]);
  });
});

describe("splitByReady — 완성된 순서대로 배달 (10-02 henry)", () => {
  const at = (id: string, ts: string, done?: string) =>
    reply(id, { timestamp: ts, ...(done ? { answer: { draft: `답 ${id}`, generatedAt: done } as ThreadsReply["answer"] } : {}) });
  const list = [
    at("a", "2026-09-20T00:00:00Z", "2026-10-02T00:00:30Z"),
    at("b", "2026-09-21T00:00:00Z"),
    at("c", "2026-09-22T00:00:00Z", "2026-10-02T00:00:10Z"),
    at("d", "2026-09-23T00:00:00Z", "2026-10-02T00:00:20Z"),
  ];

  it("답이 있는 댓글은 위 칸, 없는 댓글은 아래 칸 — 두 칸 다 목록 순서 그대로 (새로 완성된 답은 위 칸 제자리로 들어간다)", () => {
    // 완성 시각 순으로 세우면 예전에 써 둔 답 수백 개 뒤로 새 답이 밀린다 (10-02 실데이터: 421개 중 ~400개가 이미 답 있음)
    const { ready, preparing } = splitByReady(list, new Set());
    expect(ready.map((r) => r.id)).toEqual(["a", "c", "d"]);
    expect(preparing.map((r) => r.id)).toEqual(["b"]);
  });

  it("다시 쓰는 중(줄에 있음)이면 옛 답이 있어도 준비 중 칸", () => {
    const { ready, preparing } = splitByReady(list, new Set(["d"]));
    expect(ready.map((r) => r.id)).toEqual(["a", "c"]);
    expect(preparing.map((r) => r.id)).toEqual(["b", "d"]);
  });

});
