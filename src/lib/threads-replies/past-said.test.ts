import { describe, expect, it } from "vitest";
import type { KnowledgeHit } from "@/lib/personas/knowledge/rows";
import { mergePast, pickTopicPast, sameCommenterPast } from "./past-said";
import type { ThreadsReply } from "./model";

const reply = (id: string, username: string, my?: string, ts = "2026-09-01T00:00:00Z"): ThreadsReply => ({
  id,
  postId: "p",
  username,
  text: `질문 ${id}`,
  timestamp: ts,
  repliedToId: "p",
  intent: "question",
  ...(my ? { myReply: { id: `m-${id}`, text: my, timestamp: ts } } : {}),
});

describe("sameCommenterPast", () => {
  it("같은 사람에게 한 내용 있는 답만, 최신 순", () => {
    const ledger = {
      replies: [
        reply("1", "kim", "마그네슘은 저녁에 드시는 게 좋아요", "2026-08-01T00:00:00Z"),
        reply("2", "kim", "감사해요", "2026-08-05T00:00:00Z"),
        reply("3", "lee", "비타민D 는 아침에 드세요 흡수가 좋아요"),
        reply("4", "kim", "오메가3 는 식후에 드시면 편해요", "2026-08-09T00:00:00Z"),
        reply("5", "kim"),
      ],
    };
    const out = sameCommenterPast(ledger, { id: "5", username: "kim" });
    expect(out.map((p) => p.id)).toEqual(["m-4", "m-1"]);
    expect(out[0]).toMatchObject({ sameCommenter: true, date: "2026-08-09", comment: "질문 4" });
  });
});

describe("pickTopicPast", () => {
  const hit = (id: string, body: string, learn = true): KnowledgeHit => ({ kind: "reply", id, body, learn, score: 1, postedAt: "2026-07-01T00:00:00Z" });
  it("학습 제외 답도 예전에 한 말로 남기고, 관련 약한 답·제외 id 는 뺀다", () => {
    const hits = [
      hit("a", "마그네슘 글리시네이트는 저녁 식후에 드세요", false),
      hit("b", "마그네슘 이야기 재밌네요 다음에 또 봐요"),
      hit("c", "마그네슘 글리시네이트 저녁 복용이 좋아요"),
      hit("d", "마그네슘 글리시네이트 저녁 복용이 좋아요"),
    ];
    const out = pickTopicPast(hits, ["마그네슘", "글리시네이트", "저녁"], { excludeIds: ["c"] });
    expect(out.map((p) => p.id)).toEqual(["a", "d"]);
    expect(out[0].date).toBe("2026-07-01");
  });
  it("mergePast 는 같은 사람 답을 앞에, 겹치는 답은 한 번만", () => {
    const out = mergePast([{ id: "x", text: "가" }], [{ id: "x", text: "가" }, { id: "y", text: "나" }]);
    expect(out.map((p) => p.id)).toEqual(["x", "y"]);
  });
});
