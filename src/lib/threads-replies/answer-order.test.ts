import { describe, expect, it } from "vitest";
import { frontLoad, nextAnswerId } from "./answer-order";

const job = (replyIds: string[], done: string[] = [], failed: string[] = []) => ({
  replyIds,
  done,
  failed: failed.map((replyId) => ({ replyId, error: "x" })),
});

describe("nextAnswerId — 한 건 끝날 때마다 다음 차례를 다시 고른다", () => {
  it("끝났거나 실패한 것은 건너뛰고 줄의 맨 앞을 고른다", () => {
    expect(nextAnswerId(job(["a", "b", "c"], ["a"], ["b"]))).toBe("c");
  });
  it("다른 일꾼이 쓰고 있는 댓글은 건너뛴다 (동시에 여러 개 쓰기)", () => {
    expect(nextAnswerId(job(["a", "b", "c"]), new Set(["a", "b"]))).toBe("c");
  });
  it("다 끝났으면 null", () => {
    expect(nextAnswerId(job(["a"], ["a"]))).toBeNull();
  });
});

describe("frontLoad — 화면이 지금 볼 댓글을 줄 맨 앞으로 당긴다", () => {
  it("아직 안 쓴 것만 넘긴 순서대로 앞에 세우고 나머지 순서는 그대로", () => {
    expect(frontLoad(job(["a", "b", "c", "d", "e"], ["a"]), ["e", "a", "c"]).replyIds).toEqual(["a", "e", "c", "b", "d"]);
  });
  it("줄에 없던 댓글도 앞에 넣는다 (잡을 만든 뒤 새로 들어온 댓글)", () => {
    expect(frontLoad(job(["a", "b"]), ["z"]).replyIds).toEqual(["z", "a", "b"]);
  });
});
