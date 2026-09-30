import { describe, expect, it } from "vitest";
import { composeSimilar, isProductReply, looseFill, withoutSelf } from "./similar";

const p = (id: string, text: string, comment?: string) => ({ id, text, ...(comment ? { comment } : {}) });

describe("비슷한 맥락에서 남긴 글", () => {
  it("제품 이름이 든 답을 제품 답으로 본다", () => {
    expect(isProductReply("쏜 아이언 비스글리시네이트 추천. 아이허브에서 팔아")).toBe(false || isProductReply("나우푸드 D3 2000IU 먹어"));
    expect(isProductReply("나우푸드 D3 2000IU 먹어")).toBe(true);
    expect(isProductReply("잠부터 확보해 봐")).toBe(false);
  });

  it("제품 답에 표시를 붙이고 최대 개수에서 자른다", () => {
    const topic = [p("t0", "잠부터 챙겨"), p("x1", "나우푸드 D3 먹어"), ...Array.from({ length: 8 }, (_, i) => p(`t${i + 1}`, `잠 ${i}`))];
    const out = composeSimilar([], topic, 8);
    expect(out).toHaveLength(8);
    expect(out.filter((o) => o.product).map((o) => o.id)).toEqual(["x1"]);
  });

  it("같은 사람에게 한 답이 맨 앞", () => {
    const out = composeSimilar([{ ...p("s", "지난번 말한 대로 해"), sameCommenter: true }], [p("t", "철분은 이틀에 한 번")]);
    expect(out[0].id).toBe("s");
  });

  it("지금 댓글에 이미 단 답은 뺀다", () => {
    expect(withoutSelf([p("a", "답", "철분 뭐 먹어?"), p("b", "답2", "다른 댓글")], { text: "철분  뭐 먹어?" }).map((x) => x.id)).toEqual(["b"]);
  });

  it("문턱 못 넘은 검색 결과도 후보로 넣되 짧은 답·제외 id 는 뺀다", () => {
    const hits = [
      { kind: "reply" as const, id: "a", body: "짧아", learn: true, score: 1 },
      { kind: "reply" as const, id: "b", body: "이건 충분히 길게 쓴 예전 답이에요 정말로", learn: true, score: 1, postedAt: "2026-09-01T00:00:00Z" },
      { kind: "reply" as const, id: "c", body: "이것도 충분히 길게 쓴 예전 답이에요 정말로", learn: true, score: 1 },
    ];
    expect(looseFill(hits, ["c"], 5)).toEqual([{ id: "b", text: hits[1].body, date: "2026-09-01" }]);
  });
});
