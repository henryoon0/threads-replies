import { describe, expect, it } from "vitest";
import type { ThreadsReply } from "./model";
import { hasSubstance, mergePast, pastSaidFor, sameCommenterPast, topicPast } from "./past-said";

function r(id: string, username: string, text: string, my?: string, ts = "2026-09-01T00:00:00Z"): ThreadsReply {
  return {
    id,
    postId: "p",
    username,
    text,
    timestamp: ts,
    repliedToId: "p",
    intent: "question",
    ...(my ? { myReply: { id: `m-${id}`, text: my, timestamp: ts } } : {}),
  };
}

const ledger = {
  replies: [
    r("a", "kim", "릴스 올리는 시간 언제가 좋아요?", "저는 저녁 8시쯤 올리는 게 반응이 제일 좋았어요", "2026-09-01T00:00:00Z"),
    r("b", "kim", "감사해요", "감사합니다 !", "2026-09-02T00:00:00Z"),
    r("c", "lee", "캡컷 편집 팁 있나요?", "캡컷은 자동 자막 기능부터 써보세요 편해요", "2026-09-03T00:00:00Z"),
    r("d", "park", "릴스 업로드 시간 추천해주세요", "점심시간 직후에 올리면 반응이 괜찮더라고요", "2026-09-04T00:00:00Z"),
  ],
};

describe("hasSubstance", () => {
  it("감사·짧은 답은 비교 대상이 아니다", () => {
    expect(hasSubstance("감사합니다 !")).toBe(false);
    expect(hasSubstance("저녁 8시쯤 올리는 게 반응이 좋았어요")).toBe(true);
  });
});

describe("sameCommenterPast", () => {
  it("같은 사람에게 한 내용 있는 답만", () => {
    const out = sameCommenterPast(ledger, { id: "new", username: "kim" });
    expect(out.map((p) => p.id)).toEqual(["m-a"]);
    expect(out[0].sameCommenter).toBe(true);
  });
});

describe("topicPast · pastSaidFor", () => {
  it("낱말이 겹치는 예전 답만, 같은 사람 답이 앞", () => {
    const now = r("new", "kim", "릴스 올리는 시간 다시 알려주세요");
    expect(topicPast(ledger, now).map((p) => p.id)).toContain("m-d");
    expect(topicPast(ledger, now).map((p) => p.id)).not.toContain("m-c");
    expect(pastSaidFor(ledger, now).map((p) => p.id)).toEqual(["m-a", "m-d"]);
  });
  it("mergePast 는 겹치는 답을 한 번만", () => {
    const p = { id: "x", text: "같은 말" };
    expect(mergePast([p], [p, { id: "y", text: "같은 말" }])).toHaveLength(1);
  });
});
