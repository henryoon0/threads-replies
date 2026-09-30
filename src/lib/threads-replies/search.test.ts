import { describe, expect, it } from "vitest";
import type { ThreadsReply } from "./model";
import { matchScore, queryTokens, searchComments, searchPastRows, searchPostsIn } from "./search";

const reply = (id: string, text: string, extra: Partial<ThreadsReply> = {}): ThreadsReply => ({
  id,
  postId: "p",
  username: `u_${id}`,
  text,
  timestamp: "2026-09-20T00:00:00Z",
  repliedToId: "p",
  intent: "chat",
  ...extra,
});

describe("스레드 계정 검색", () => {
  it("낱말이 모두 들어 있어야 걸리고, 대소문자·띄어쓰기 차이는 봐준다", () => {
    expect(queryTokens("  철분  D3 철분")).toEqual(["철분", "d3"]);
    expect(matchScore("철분이랑 D3 같이 먹어", ["철분", "d3"])).toBe(2);
    expect(matchScore("철분만 먹어", ["철분", "d3"])).toBe(0);
  });

  it("댓글은 글·아이디·내 답 어디에 걸려도 나오고 상태를 붙인다", () => {
    const ledger = {
      replies: [
        reply("a", "철분제 추천해줘", { myReply: { id: "m", text: "쏜 아이언", timestamp: "2026-09-21T00:00:00Z" } }),
        reply("b", "잠이 안 와", { skipped: true }),
        reply("c", "아무 말"),
      ],
    };
    expect(searchComments(ledger, ["쏜"]).map((h) => [h.id, h.state])).toEqual([["a", "answered"]]);
    expect(searchComments(ledger, ["u_b"]).map((h) => h.state)).toEqual(["skipped"]);
  });

  it("글은 원장과 보관함을 합치되 같은 id 는 한 번만", () => {
    const posts = [{ id: "p1", text: "철분 이야기", timestamp: "2026-09-01T00:00:00Z" }];
    const archive = [
      { id: "p1", body: "철분 이야기", permalink: null, posted_at: null } as never,
      { id: "p2", body: "철분 두 번째 철분", permalink: "https://x", posted_at: "2026-08-01T00:00:00Z" } as never,
    ];
    expect(searchPostsIn(posts, archive, ["철분"]).map((h) => h.id)).toEqual(["p2", "p1"]);
  });

  it("예전 답은 받은 댓글로도 찾는다", () => {
    const rows = [{ id: "r", body: "이틀에 한 번 먹어", comment_body: "철분 얼마나 먹어?", posted_at: null, permalink: null } as never];
    expect(searchPastRows(rows, ["철분"])[0]).toMatchObject({ kind: "past", id: "r", sub: "철분 얼마나 먹어?" });
  });
});
