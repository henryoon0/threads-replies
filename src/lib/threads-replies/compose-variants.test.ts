import { describe, expect, it } from "vitest";
import {
  gitBlobSha,
  isFresh,
  isStale,
  keyOfToggles,
  newVariantsFile,
  pendingKeys,
  pendingOrder,
  planFromPresets,
  prefetchLimit,
  reorderQueue,
  variantKey,
  withFailure,
  withVariant,
  type ComposeVariant,
} from "./compose-variants";
import type { ThreadsReply } from "./model";

describe("조합 열쇠", () => {
  it("순서·경로 순서와 상관없이 같은 열쇠", () => {
    expect(variantKey({ kinds: ["product", "principle"], channels: ["overseas", "pharmacy"] })).toBe("principle+product:pharmacy,overseas");
    expect(keyOfToggles({ product: { overseas: true, pharmacy: true }, principle: true })).toBe("principle+product:pharmacy,overseas");
    expect(keyOfToggles({})).toBeNull();
  });
});

describe("미리 쓸 벌 = 버전", () => {
  const presets = [
    { id: "ingredient+product", name: "성분 + 제품 3분할", toggles: { ingredient: true, product: { pharmacy: true, online: true, overseas: true } } },
    { id: "joke", name: "뒤통수 한 방", toggles: { joke: true } },
    { id: "warm", name: "고마움 돌려주기", guide: "이름 불러 고마움", toggles: { empathy: true } },
  ];
  it("버전 id 가 열쇠, 순서 그대로, 이름·지시를 싣는다", () => {
    const planned = planFromPresets(presets, {});
    expect(planned.map((p) => p.key)).toEqual(["ingredient+product", "joke", "warm"]);
    expect(planned[2]).toMatchObject({ name: "고마움 돌려주기", guide: "이름 불러 고마움" });
    expect(planned[0].guide).toBeUndefined();
    expect(planFromPresets(presets, {}, 2)).toHaveLength(2);
  });
  it("버전이 없으면 기본 토글 한 벌, 그것도 없으면 빈 목록", () => {
    expect(planFromPresets([], { principle: true }).map((p) => p.key)).toEqual(["principle"]);
    expect(planFromPresets([], {})).toEqual([]);
  });
});

describe("부분 저장", () => {
  const planned = ["a", "b", "c"].map((key) => ({ key, toggles: { principle: true } }));
  const v = (key: string): ComposeVariant => ({ key, toggles: {}, draft: "글", sections: [], products: [], ms: 1 });
  it("쓴 것·실패한 것은 남은 목록에서 빠지고, 세션이 남는다", () => {
    let f = newVariantsFile("r1", "sha", planned, "2026-09-29T00:00:00Z");
    const [a, b, ...rest] = pendingKeys(f);
    f = withVariant(f, v(a), "sess-1", "t1");
    f = withFailure(f, b, "시간 초과", "t2");
    expect(f.sessionId).toBe("sess-1");
    expect(pendingKeys(f)).toEqual(rest);
    f = withVariant(f, { ...v(a), draft: "새 글" }, undefined, "t3");
    expect(f.variants.filter((x) => x.key === a)).toHaveLength(1);
    expect(f.sessionId).toBe("sess-1");
  });
  it("규칙책 sha 가 다르면 새로 쓴다, heartbeat 가 오래되면 멈춘 잡", () => {
    const f = newVariantsFile("r1", "abc", [], "2026-09-29T00:00:00Z");
    expect(isFresh(f, "abc")).toBe(true);
    expect(isFresh(f, "def")).toBe(false);
    expect(isFresh(null, "abc")).toBe(false);
    expect(isFresh({ ...f, version: 1 }, "abc")).toBe(false);
    expect(isStale(f, Date.parse("2026-09-29T00:01:00Z"))).toBe(false);
    expect(isStale(f, Date.parse("2026-09-29T00:10:00Z"))).toBe(true);
    expect(isStale({ ...f, status: "done" }, Date.parse("2026-09-29T00:10:00Z"))).toBe(false);
  });
  it("git hash-object 와 같은 sha", () => {
    expect(gitBlobSha("hello\n")).toBe("ce013625030ba8dba906f756967f9e9ca394464a");
  });
});

describe("미리 쓰기 범위·순서", () => {
  const r = (id: string, ts: string, intent: "question" | "chat" | "reaction" = "chat", extra = {}) =>
    ({ id, postId: "p", username: "u", text: id, timestamp: ts, repliedToId: "p", intent, ...extra }) as unknown as ThreadsReply;
  it("최신 댓글 먼저, 반응은 맨 뒤, 답했거나 넘긴 건 뺀다", () => {
    const order = pendingOrder([
      r("old-q", "2026-09-27T00:00:00Z", "question"),
      r("new-chat", "2026-09-29T00:00:00Z"),
      r("new-react", "2026-09-29T01:00:00Z", "reaction"),
      r("done", "2026-09-29T02:00:00Z", "question", { myReply: { text: "x" } }),
      r("skipped", "2026-09-29T02:00:00Z", "question", { skipped: true }),
    ]).map((x) => x.id);
    expect(order).toEqual(["new-chat", "old-q", "new-react"]);
  });
  it("상한은 env 가 양의 정수일 때만 바꾼다", () => {
    expect(prefetchLimit(undefined)).toBe(60);
    expect(prefetchLimit("200")).toBe(200);
    expect(prefetchLimit("0")).toBe(60);
    expect(prefetchLimit("abc")).toBe(60);
  });
  it("줄을 새 순서로 다시 세운다 (순서에 없는 건 뒤에 그대로)", () => {
    expect(reorderQueue(["a", "b", "c", "x"], (k) => k, ["c", "a"])).toEqual(["c", "a", "b", "x"]);
  });
});
