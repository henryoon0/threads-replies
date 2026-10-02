import { describe, expect, it } from "vitest";
import {
  restartedFile,
  jobKeys,
  MAX_WRITES_PER_JOB,
  adoptAsDraft,
  variantsParallel,
  rememberIn,
  gitBlobSha,
  isFresh,
  isStale,
  keyOfToggles,
  newVariantsFile,
  pendingKeys,
  pendingOrder,
  planFromPresets,
  prefetchLimit,
  prefetchProgress,
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
  it("질문 먼저, 그 안에서 최신순, 반응은 맨 뒤, 답했거나 넘긴 건 뺀다", () => {
    const order = pendingOrder([
      r("old-q", "2026-09-27T00:00:00Z", "question"),
      r("new-chat", "2026-09-29T00:00:00Z"),
      r("new-react", "2026-09-29T01:00:00Z", "reaction"),
      r("done", "2026-09-29T02:00:00Z", "question", { myReply: { text: "x" } }),
      r("skipped", "2026-09-29T02:00:00Z", "question", { skipped: true }),
    ]).map((x) => x.id);
    expect(order).toEqual(["old-q", "new-chat", "new-react"]);
  });
  it("기본은 대기 댓글 전부, env 가 양의 정수일 때만 상한을 둔다", () => {
    expect(prefetchLimit(undefined)).toBe(Infinity);
    expect(prefetchLimit("200")).toBe(200);
    expect(prefetchLimit("0")).toBe(Infinity);
    expect(prefetchLimit("abc")).toBe(Infinity);
  });
  it("진행률: 규칙책이 같고 끝난 파일만 센다", () => {
    const done = { ...newVariantsFile("a", "sha", [], "t"), status: "done" as const };
    const running = newVariantsFile("b", "sha", [], "t");
    const oldBook = { ...newVariantsFile("c", "old", [], "t"), status: "done" as const };
    expect(prefetchProgress([done, running, oldBook, null], "sha")).toEqual({ done: 1, total: 4 });
  });
  it("줄을 새 순서로 다시 세운다 (순서에 없는 건 뒤에 그대로)", () => {
    expect(reorderQueue(["a", "b", "c", "x"], (k) => k, ["c", "a"])).toEqual(["c", "a", "b", "x"]);
  });
});

describe("누를 때 쓴 버전도 남긴다 (10-02 henry: 한번 생성한 결과물은 화면을 나가도 남아야)", () => {
  const v = { key: "joke", toggles: { joke: true }, draft: "드립 글", sections: [], products: [], ms: 0 };
  it("버전 파일이 없으면 끝난 파일을 새로 만들어 그 벌을 담는다", () => {
    const f = rememberIn(null, "c1", "sha1", v, "2026-10-02T00:00:00.000Z");
    expect(f.status).toBe("done");
    expect(f.variants.map((x) => x.draft)).toEqual(["드립 글"]);
  });
  it("있던 파일엔 다른 벌을 그대로 두고 더한다 (같은 열쇠면 바꾼다)", () => {
    const base = rememberIn(null, "c1", "sha1", { ...v, key: "principle", draft: "원리 글" }, "2026-10-02T00:00:00.000Z");
    const f = rememberIn(base, "c1", "sha1", v, "2026-10-02T00:01:00.000Z");
    expect(f.variants.map((x) => x.key).sort()).toEqual(["joke", "principle"]);
  });
});

describe("버전 글이 목록의 '준비됨'이 된다 (10-02 비용 1 — 답 초안 잡을 끈 계정)", () => {
  const reply = (extra: Partial<ThreadsReply> = {}): ThreadsReply => ({ id: "c1", postId: "p", username: "u", text: "q?", timestamp: "2026-10-01T00:00:00Z", repliedToId: "p", intent: "question", ...extra });
  it("첫 추천 버전이고 초안이 없는 대기 댓글이면 그 글을 초안으로 삼는다", () => {
    expect(adoptAsDraft(reply(), "principle", "principle")).toBe(true);
  });
  it("두 번째 버전·이미 초안이 있는 댓글·답했거나 넘긴 댓글은 건드리지 않는다", () => {
    expect(adoptAsDraft(reply(), "principle", "product")).toBe(false);
    expect(adoptAsDraft(reply({ answer: { draft: "있음" } as ThreadsReply["answer"] }), "principle", "principle")).toBe(false);
    expect(adoptAsDraft(reply({ skipped: true }), "principle", "principle")).toBe(false);
    expect(adoptAsDraft(undefined, "principle", "principle")).toBe(false);
  });
});

describe("동시에 미리 쓰는 댓글 수", () => {
  it("기본 10 (댓글마다 2벌 동시 = CLI 20), env 가 양의 정수면 그 값 (최대 10)", () => {
    expect(variantsParallel(undefined)).toBe(10);
    expect(variantsParallel("3")).toBe(3);
    expect(variantsParallel("99")).toBe(10);
    expect(variantsParallel("0")).toBe(10);
  });
});

describe("새로 쓰기는 추천 2벌만 (10-02 실측: 눌러서 늘어난 6벌을 전부 다시 써 109초·비용 3배)", () => {
  it("벌을 비우고, 계획은 앞의 추천 2개만 남긴다", () => {
    const planned = ["a", "b", "c", "d", "e", "f"].map((key) => ({ key, toggles: {} }));
    const file = { ...newVariantsFile("c1", "sha", planned as never, "t0"), status: "done" as const };
    const out = restartedFile(file, "t1");
    expect(out.planned.map((p) => p.key)).toEqual(["a", "b"]);
    expect(out).toMatchObject({ status: "running", variants: [], failed: [], updatedAt: "t1" });
    expect(out.sessionId).toBeUndefined();
  });
});

describe("비용 관문: 한 잡의 AI 호출은 상한을 넘지 않는다 (10-02 사고 재발 방지)", () => {
  const planned = ["a", "b", "c", "d", "e", "f"].map((key) => ({ key, toggles: {} }));
  it("6벌 계획이 남은 옛 파일이 와도 쓰는 건 상한만큼, 나머지는 버린 목록으로", () => {
    const file = newVariantsFile("c1", "sha", planned as never, "t0");
    const { write, dropped } = jobKeys(file);
    expect(write).toEqual(["a", "b"]);
    expect(write.length).toBeLessThanOrEqual(MAX_WRITES_PER_JOB);
    expect(dropped).toEqual(["c", "d", "e", "f"]);
  });
  it("이미 쓴 벌은 다시 쓰지 않고, 남은 것 중 앞에서부터", () => {
    const v = { key: "a", toggles: {}, draft: "x", sections: [], products: [], ms: 1 } as unknown as ComposeVariant;
    const file = withVariant(newVariantsFile("c1", "sha", planned.slice(0, 2) as never, "t0"), v, undefined, "t1");
    expect(jobKeys(file)).toEqual({ write: ["b"], dropped: [] });
  });
  it("새로 쓰기 파일 → 관문 통과 = 정확히 2번", () => {
    const file = { ...newVariantsFile("c1", "sha", planned as never, "t0"), status: "done" as const };
    expect(jobKeys(restartedFile(file, "t1")).write).toHaveLength(2);
  });
});
