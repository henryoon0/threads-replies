// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ThreadsReply } from "@/lib/threads-replies/model";
import { ThreadsClient } from "./threads-client";

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
        { root: reply("b"), followUps: [], pending: 1 },
        { root: reply("q", { intent: "question", text: "이건 어떻게 하나요?" }), followUps: [], pending: 1 },
      ],
    },
  ],
  summary: { pending: 3, questions: 1, questionsReady: 0, history: 0 },
  sync: {},
  job: null,
};

describe("ThreadsClient — 질문 띠와 목록 선택", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }))
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("처음엔 목록 첫 댓글이 열리고, 첫 로드만 답 잡을 깨운다", async () => {
    render(<ThreadsClient view="comments" />);
    expect((await screen.findByTestId("panel")).textContent).toBe("a");
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("/api/threads-replies");
  });

  it("질문 띠 칩을 누르면 그 질문이 목록에서 골라지고 패널에 열린다", async () => {
    render(<ThreadsClient view="comments" />);
    const chip = await screen.findByRole("button", { name: /이건 어떻게 하나요/, pressed: false });
    fireEvent.click(chip);
    await waitFor(() => expect((screen.getByTestId("panel")).textContent).toBe("q"));
    expect(document.querySelector('[data-reply-id="q"]')?.getAttribute("aria-current")).toBe("true");
  });

  it("질문 칸은 질문만 보여 준다", async () => {
    render(<ThreadsClient view="questions" />);
    await screen.findByTestId("panel");
    expect([...document.querySelectorAll("[data-reply-id]")].map((el) => el.getAttribute("data-reply-id"))).toEqual(["q"]);
  });
});
