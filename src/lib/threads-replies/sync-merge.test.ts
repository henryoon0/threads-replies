import { describe, expect, it } from "vitest";
import { isPending, type ThreadsRepliesLedger, type ThreadsReply } from "./model";
import { mergeConversations, shortcodeOf } from "./sync";

const post = { id: "1788", text: "안녕. 19년차 약사야", permalink: "https://www.threads.com/@glp1.pharmacy/post/DdvdAKek5at", timestamp: "2026-09-26T07:02:51+0000" };

const collectedReply = (id: string, extra: Partial<ThreadsReply> = {}): ThreadsReply => ({
  id,
  postId: "DdvdAKek5at",
  username: "idea_and_",
  text: "비타민씨 메가도스어때?",
  timestamp: "2026-09-27T00:00:00Z",
  repliedToId: "DdvdAKek5at",
  intent: "question",
  ...extra,
});

const ledger = (replies: ThreadsReply[]): ThreadsRepliesLedger => ({
  posts: [{ id: "DdvdAKek5at", text: "다여트주사 궁금한거", permalink: post.permalink, timestamp: "2026-09-26T07:27:45.000Z" }],
  replies,
  sync: { source: "collected" },
});

describe("mergeConversations — 수집본과 같은 글 (10-02)", () => {
  it("주소 코드를 뽑는다", () => {
    expect(shortcodeOf(post.permalink)).toBe("DdvdAKek5at");
    expect(shortcodeOf("https://www.threads.com/@a/post/Abc?x=1")).toBe("Abc");
    expect(shortcodeOf(undefined)).toBeUndefined();
  });

  it("API 로 받은 글과 같은 수집본 글·댓글은 빠지고, API 댓글이 내 답·주소를 가진다", () => {
    const fetched = [
      {
        post,
        replies: [
          { id: "c1", username: "idea_and_", text: "비타민씨 메가도스어때?", timestamp: "2026-09-27T00:00:00Z", permalink: "https://www.threads.com/@idea_and_/post/X1", replied_to: { id: "1788" } },
          { id: "m1", username: "glp1.pharmacy", text: "비추야", timestamp: "2026-09-27T01:00:00Z", replied_to: { id: "c1" }, is_reply_owned_by_me: true },
        ],
      },
    ];
    const next = mergeConversations(ledger([collectedReply("aside-1-idea_and_")]), fetched, "2026-10-02T00:00:00Z");
    expect(next.posts.map((p) => p.id)).toEqual(["1788"]);
    expect(next.replies.map((r) => r.id)).toEqual(["c1"]);
    expect(next.replies[0].myReply?.text).toBe("비추야");
    expect(next.replies[0].permalink).toBe("https://www.threads.com/@idea_and_/post/X1");
  });

  it("수집본 댓글의 건너뛰기·초안은 같은 사람·같은 글인 API 댓글이 이어받는다", () => {
    const old = collectedReply("aside-1-idea_and_", { skipped: true, answer: { draft: "초안" } as ThreadsReply["answer"] });
    const fetched = [{ post, replies: [{ id: "c1", username: "idea_and_", text: "비타민씨 메가도스어때? ", timestamp: "2026-09-27T00:00:00Z", replied_to: { id: "1788" } }] }];
    const [r] = mergeConversations(ledger([old]), fetched, "2026-10-02T00:00:00Z").replies;
    expect(r.skipped).toBe(true);
    expect(r.answer?.draft).toBe("초안");
  });

  it("주소가 다른 수집본 글은 그대로 둔다", () => {
    const other = { ...collectedReply("aside-2-x"), postId: "Other" };
    const l = { ...ledger([other]), posts: [{ id: "Other", text: "", timestamp: "" }] };
    const next = mergeConversations(l, [{ post, replies: [] }], "2026-10-02T00:00:00Z");
    expect(next.replies.map((r) => r.id)).toEqual(["aside-2-x"]);
    expect(next.posts.map((p) => p.id).sort()).toEqual(["1788", "Other"]);
  });
});

describe("답할 차례 — 상대가 남기고 끝난 댓글만 (10-02 henry)", () => {
  const me = (id: string, to: string) => ({ id, username: "glp1.pharmacy", text: "내 답", timestamp: "2026-09-28T00:00:00Z", replied_to: { id: to }, is_reply_owned_by_me: true });
  const them = (id: string, to: string, username = "x") => ({ id, username, text: `말 ${id}`, timestamp: "2026-09-27T00:00:00Z", replied_to: { id: to } });
  const merge = (replies: ReturnType<typeof them>[]) =>
    new Map(mergeConversations({ posts: [], replies: [], sync: {} }, [{ post, replies }], "2026-10-02T00:00:00Z").replies.map((r) => [r.id, r]));

  it("바로 아래에 내 답 → 답함", () => {
    const m = merge([them("a", "1788"), me("m1", "a")]);
    expect(m.get("a")!.myReply?.id).toBe("m1");
    expect(isPending(m.get("a")!)).toBe(false);
  });

  it("더 아래 대화에서 내가 답했으면 앞 댓글도 대기가 아니다 (answered)", () => {
    const m = merge([them("a", "1788"), them("b", "a"), me("m1", "b")]);
    expect(m.get("a")!.settled).toBe("answered");
    expect(isPending(m.get("a")!)).toBe(false);
    expect(isPending(m.get("b")!)).toBe(false);
  });

  it("같은 사람이 이어 쓰면 마지막 댓글만 대기 — 앞 댓글은 맥락 (continued)", () => {
    const m = merge([them("a", "1788"), them("b", "a")]);
    expect(m.get("a")!.settled).toBe("continued");
    expect(isPending(m.get("a")!)).toBe(false);
    expect(isPending(m.get("b")!)).toBe(true);
  });

  it("다른 사람이 이어 달아도 차례는 대화 끝으로", () => {
    const m = merge([them("a", "1788", "x"), them("b", "a", "y")]);
    expect(isPending(m.get("a")!)).toBe(false);
    expect(isPending(m.get("b")!)).toBe(true);
  });

  it("내가 답한 뒤 상대가 다시 말하면 그 새 말이 대기", () => {
    const m = merge([them("a", "1788"), me("m1", "a"), them("c", "m1")]);
    expect(isPending(m.get("a")!)).toBe(false);
    expect(isPending(m.get("c")!)).toBe(true);
  });

  it("아무도 답하지 않은 댓글은 대기", () => {
    expect(isPending(merge([them("a", "1788")]).get("a")!)).toBe(true);
  });
});
