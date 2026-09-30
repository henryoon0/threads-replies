// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ThreadsReply } from "@/lib/threads-replies/model";
import { ThreadsClient } from "./threads-client";
import { setThreadsWide } from "./use-wide";

// 오른쪽 답 패널은 다른 파일이 맡는다. 여기서는 "어느 댓글이 열렸나"만 본다.
vi.mock("./threads-answer-panel", () => ({
  ThreadsAnswerPanel: ({ replyId }: { replyId: string }) => <div data-testid="panel">{replyId}</div>,
}));

const reply = (id: string, extra: Partial<ThreadsReply> = {}): ThreadsReply => ({
  id,
  postId: "p1",
  username: `user_${id}`,
  text: `댓글 ${id}`,
  timestamp: "2026-09-27T00:00:00Z",
  repliedToId: "p1",
  intent: "chat",
  ...extra,
});

const body = {
  groups: [
    {
      post: { id: "p1", text: "내 글 첫 줄\n본문", timestamp: "2026-09-26T00:00:00Z" },
      pending: 3,
      questions: 1,
      threads: [
        { root: reply("a"), followUps: [], pending: 1 },
        { root: reply("b", { answer: { draft: "마운자로 강추해요" } as ThreadsReply["answer"] }), followUps: [], pending: 1 },
        { root: reply("q", { intent: "question", text: "이건 어떻게 하나요?" }), followUps: [], pending: 1 },
      ],
    },
  ],
  summary: { pending: 3, questions: 1, questionsReady: 0, history: 0 },
  sync: {},
  job: null,
  persona: { id: "glp1", name: "박약사", handle: "glp1.pharmacy", send: "copy", gate: "strict" },
};

const rules = {
  persona: "glp1",
  gate: "strict",
  rules: { version: 1, rules: [{ id: "d", kind: "drug-choice", action: "block", pattern: "마운자로 강추", reason: "처방약 선택은 답하지 않아요" }] },
};

describe("ThreadsClient — 지금 답할 5개와 나머지", () => {
  beforeEach(() => {
    // 이 묶음은 목록을 편 상태(넓게 보기 끔)를 본다. 기본(넓게)은 아래 따로
    setThreadsWide(false);
    Element.prototype.scrollIntoView = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (u: string) => new Response(JSON.stringify(String(u).includes("gate-rules") ? rules : body), { status: 200 }))
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("질문이 맨 위라 처음엔 질문이 열리고, 첫 로드만 답 잡을 깨운다", async () => {
    render(<ThreadsClient view="comments" />);
    expect((await screen.findByTestId("panel")).textContent).toBe("q");
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("/api/threads-replies");
    const top = screen.getByRole("region", { name: "지금 답할 댓글" });
    expect(within(top).getByText("지금 답할 3개")).toBeTruthy();
  });

  it("위 목록에서 고르면 그 댓글이 패널에 열린다", async () => {
    render(<ThreadsClient view="comments" />);
    const top = await screen.findByRole("region", { name: "지금 답할 댓글" });
    fireEvent.click(top.querySelector<HTMLElement>('[data-reply-id="b"]')!);
    await waitFor(() => expect(screen.getByTestId("panel").textContent).toBe("b"));
    expect(top.querySelector('[data-reply-id="b"]')?.getAttribute("aria-current")).toBe("true");
  });

  it("지금 답할 5개는 초안 글 대신 준비 상태만 보인다 — 관문에 걸린 초안은 '확인 필요', 빨간색 없이", async () => {
    render(<ThreadsClient view="comments" />);
    await screen.findByTestId("panel");
    const top = await screen.findByRole("region", { name: "지금 답할 댓글" });
    await waitFor(() => expect(top.textContent).toContain("확인 필요"));
    expect(top.textContent).not.toContain("마운자로 강추");
    expect(top.querySelector("mark")).toBeNull();
    expect(document.querySelector('[class*="bg-red"],[class*="text-red"]')).toBeNull();
  });

  it("질문 칸은 질문만 보여 준다", async () => {
    render(<ThreadsClient view="questions" />);
    await screen.findByTestId("panel");
    expect([...document.querySelectorAll("[data-reply-id]")].map((el) => el.getAttribute("data-reply-id"))).toEqual(["q"]);
  });
});

describe("ThreadsClient — 나머지 접기", () => {
  const many = {
    ...body,
    persona: { id: "aicc", name: "AI Coffee Chat", handle: "aicoffeechat", send: "api", gate: "light" },
    groups: [
      {
        ...body.groups[0],
        threads: ["1", "2", "3", "4", "5", "6", "7"].map((id) => ({ root: reply(id), followUps: [], pending: 1 })),
      },
    ],
  };
  beforeEach(() => {
    // 이 묶음은 목록을 편 상태(넓게 보기 끔)를 본다. 기본(넓게)은 아래 따로
    setThreadsWide(false);
    Element.prototype.scrollIntoView = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(many), { status: 200 })));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("5개만 위에 두고 나머지 수를 보여 주며, 펴면 글별 목록이 나온다", async () => {
    render(<ThreadsClient view="comments" />);
    await screen.findByTestId("panel");
    const fold = screen.getByRole("button", { name: /나머지 2개/ });
    expect(fold.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("내 글 첫 줄")).toBeNull();
    fireEvent.click(fold);
    expect(await screen.findByText("내 글 첫 줄")).toBeTruthy();
  });
});

describe("ThreadsClient — 넓게 보기(기본)", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (u: string) => new Response(JSON.stringify(String(u).includes("gate-rules") ? rules : body), { status: 200 }))
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("목록 대신 지금 답할 댓글 가로 띠를 두고, 띠에서 고르면 패널이 바뀐다", async () => {
    setThreadsWide(true);
    render(<ThreadsClient view="comments" nav={<span>계정막대</span>} />);
    expect(await screen.findByText("계정막대")).toBeTruthy();
    const strip = await screen.findByRole("navigation", { name: "지금 답할 댓글" });
    expect(screen.queryByRole("region", { name: "지금 답할 댓글" })).toBeNull();
    fireEvent.click(within(strip).getByRole("button", { name: /user_a/ }));
    await waitFor(() => expect(screen.getByTestId("panel").textContent).toBe("a"));
    expect(screen.getByRole("button", { name: "목록 펴기" })).toBeTruthy();
  });
});
