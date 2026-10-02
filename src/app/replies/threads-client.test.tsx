// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
        { root: reply("a", { timestamp: "2026-09-27T00:00:00Z" }), followUps: [], pending: 1 },
        { root: reply("b", { timestamp: "2026-09-28T00:00:00Z", answer: { draft: "마운자로 강추해요" } as ThreadsReply["answer"] }), followUps: [], pending: 1 },
        { root: reply("q", { timestamp: "2026-09-29T00:00:00Z", intent: "question", text: "이건 어떻게 하나요?" }), followUps: [], pending: 1 },
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

describe("ThreadsClient — 한 줄 목록과 한 버튼 메뉴 (10-02 픽)", () => {
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

  const ids = () => [...document.querySelectorAll("[data-reply-id]")].map((el) => el.getAttribute("data-reply-id"));

  it("답이 준비된 댓글이 위 칸, 그다음 준비 중 칸 — 두 칸 안은 오래된 순. 첫 로드만 답 잡을 깨운다 (10-02)", async () => {
    render(<ThreadsClient view="comments" />);
    // b 만 답이 있다 → 준비됨 칸 b, 준비 중 칸 a·q
    expect((await screen.findByTestId("panel")).textContent).toBe("b");
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("/api/threads-replies");
    expect(ids()).toEqual(["b", "a", "q"]);
    expect(screen.getByRole("button", { name: /오래된 순/ })).toBeTruthy();
  });

  it("메뉴에서 최근 순을 고르면 방금 달린 것부터, 질문만을 켜면 질문만 남는다", async () => {
    render(<ThreadsClient view="comments" />);
    await screen.findByTestId("panel");
    fireEvent.click(screen.getByRole("button", { name: /오래된 순/ }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "최근 순" }));
    expect(ids()).toEqual(["b", "q", "a"]);
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "질문만" }));
    expect(ids()).toEqual(["q"]);
    expect(screen.getByRole("button", { name: /최근 순.*질문만/ })).toBeTruthy();
  });

  it("목록에서 고르면 그 댓글이 패널에 열린다", async () => {
    render(<ThreadsClient view="comments" />);
    await screen.findByTestId("panel");
    const list = screen.getByRole("region", { name: "답할 댓글" });
    fireEvent.click(list.querySelector<HTMLElement>('[data-reply-id="b"]')!);
    await waitFor(() => expect(screen.getByTestId("panel").textContent).toBe("b"));
    expect(list.querySelector('[data-reply-id="b"]')?.getAttribute("aria-current")).toBe("true");
  });

  it("줄에는 초안 글 대신 준비 상태만 — 관문에 걸린 초안은 '확인 필요', 빨간색 없이", async () => {
    render(<ThreadsClient view="comments" />);
    const list = await screen.findByRole("region", { name: "답할 댓글" });
    await waitFor(() => expect(list.textContent).toContain("확인 필요"));
    expect(list.textContent).not.toContain("마운자로 강추");
    expect(list.querySelector("mark")).toBeNull();
    expect(document.querySelector('[class*="bg-red"],[class*="text-red"]')).toBeNull();
  });

  it("질문 칸으로 들어오면 질문만이 켜진 채로 시작한다", async () => {
    render(<ThreadsClient view="questions" />);
    await screen.findByTestId("panel");
    expect(ids()).toEqual(["q"]);
  });

  it("머리줄에는 계정 막대·새로고침···· 만, 하나씩/5개와 모두 건너뛰기는 ··· 메뉴 안에", async () => {
    render(<ThreadsClient view="comments" nav={<span>계정막대</span>} />);
    expect(await screen.findByText("계정막대")).toBeTruthy();
    expect(screen.queryByRole("radio", { name: "하나씩" })).toBeNull();
    expect(screen.queryByText(/모두 건너뛰기/)).toBeNull();
    expect(screen.queryByText("목록 접기")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "더보기" }));
    expect(screen.getByRole("menuitemradio", { name: "하나씩" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("menuitem", { name: "남은 댓글 모두 건너뛰기" }));
    expect(await screen.findByText(/남은 3건을 모두 건너뛸까요/)).toBeTruthy();
  });

  it("보고 있는 사이 답이 생긴 댓글엔 '새 답'이 붙고, 열면 사라진다 — 처음부터 준비된 댓글엔 안 붙는다 (10-02)", async () => {
    let withDraft = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (u: string) => {
        if (String(u).includes("gate-rules")) return new Response(JSON.stringify(rules), { status: 200 });
        const groups = withDraft
          ? [{ ...body.groups[0], threads: body.groups[0].threads.map((t) => (t.root.id === "q" ? { ...t, root: { ...t.root, answer: { draft: "새로 쓴 답" } } } : t)) }]
          : body.groups;
        return new Response(JSON.stringify({ ...body, groups }), { status: 200 });
      })
    );
    render(<ThreadsClient view="comments" />);
    await screen.findByTestId("panel");
    expect(screen.queryByText("새 답")).toBeNull();
    withDraft = true;
    fireEvent.click(screen.getByRole("button", { name: "새로고침" }));
    expect(await screen.findByText("새 답")).toBeTruthy();
    fireEvent.click(document.querySelector<HTMLElement>('[data-reply-id="q"]')!);
    await waitFor(() => expect(screen.queryByText("새 답")).toBeNull());
  });
});
