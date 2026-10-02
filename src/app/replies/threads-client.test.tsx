// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ThreadsReply } from "@/lib/threads-replies/model";
import { ThreadsClient } from "./threads-client";

// 오른쪽 답 패널은 다른 파일이 맡는다. 여기서는 "어느 댓글이 열렸나"만 본다.
vi.mock("./threads-answer-panel", () => ({
  ThreadsAnswerPanel: ({ replyId }: { replyId: string }) => <div data-testid="panel">{replyId}</div>,
}));

const toastSuccess = vi.hoisted(() => vi.fn());
vi.mock("@/components/toast", () => ({ toast: { success: toastSuccess, error: vi.fn() } }));

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

  it("목록은 오래된 순 한 줄 — 답이 있어도 위로 올리지 않는다. 첫 로드만 답 잡을 깨운다 (10-02 henry)", async () => {
    render(<ThreadsClient view="comments" />);
    expect((await screen.findByTestId("panel")).textContent).toBe("a");
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("/api/threads-replies");
    expect(ids()).toEqual(["a", "b", "q"]);
    expect(screen.getByRole("button", { name: /오래된 순/ })).toBeTruthy();
  });

  it("메뉴는 정렬 둘뿐(질문만 없음) — 최근 순을 고르면 방금 달린 것부터 (10-02 henry)", async () => {
    render(<ThreadsClient view="comments" />);
    await screen.findByTestId("panel");
    fireEvent.click(screen.getByRole("button", { name: /오래된 순/ }));
    expect(screen.queryByRole("menuitemcheckbox", { name: "질문만" })).toBeNull();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "최근 순" }));
    expect(ids()).toEqual(["q", "b", "a"]);
  });

  it("최근 순은 자동으로 쓰지 않고 [답 20개 만들기]로 — 위에서부터 답이 없는 댓글만 맡긴다 (10-02 henry)", async () => {
    const posted: string[][] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (u: string, init?: RequestInit) => {
        if (String(u).includes("gate-rules")) return new Response(JSON.stringify(rules), { status: 200 });
        if (String(u).includes("/prefetch")) {
          posted.push((JSON.parse(String(init?.body)) as { ids: string[] }).ids);
          return new Response(JSON.stringify({ queued: [] }), { status: 200 });
        }
        return new Response(JSON.stringify(body), { status: 200 });
      })
    );
    render(<ThreadsClient view="comments" />);
    await screen.findByTestId("panel");
    await waitFor(() => expect(posted).toHaveLength(1)); // 오래된 순 자동 묶음
    expect(screen.queryByRole("button", { name: /답 20개 만들기/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /오래된 순/ }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "최근 순" }));
    await act(async () => {});
    expect(posted).toHaveLength(1); // 최근 순으로 바꿔도 새로 맡기지 않는다
    fireEvent.click(screen.getByRole("button", { name: /답 20개 만들기/ }));
    await waitFor(() => expect(posted).toHaveLength(2));
    expect(posted[1]).toEqual(["q", "a"]); // b 는 이미 답이 있다
    await waitFor(() => expect(screen.getByRole("region", { name: "답할 댓글" }).textContent).toContain("답 준비 0/2"));
  });

  it("목록에서 고르면 그 댓글이 패널에 열린다", async () => {
    render(<ThreadsClient view="comments" />);
    await screen.findByTestId("panel");
    const list = screen.getByRole("region", { name: "답할 댓글" });
    fireEvent.click(list.querySelector<HTMLElement>('[data-reply-id="b"]')!);
    await waitFor(() => expect(screen.getByTestId("panel").textContent).toBe("b"));
    expect(list.querySelector('[data-reply-id="b"]')?.getAttribute("aria-current")).toBe("true");
  });

  it("줄에는 댓글과 준비 상태만 — 답 내용은 안 보인다. 관문에 걸린 초안은 '확인 필요', 빨간색 없이 (10-02 henry)", async () => {
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

  it("보고 있는 사이 답이 생겨도 '새 답' 표시는 붙지 않는다 (10-02 henry: 뺌)", async () => {
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
    await waitFor(() => expect(screen.getByRole("button", { name: "새로고침" })).toBeTruthy());
    await act(async () => {});
    expect(screen.queryByText("새 답")).toBeNull();
  });

  it("미리 쓰기는 늘 가장 오래된 20개 — 고른 댓글·정렬과 상관없고, 답이 생겨도 밀리지 않는다 (10-02 henry)", async () => {
    const day = (i: number) => new Date(Date.UTC(2026, 8, 1, 0, i)).toISOString();
    const make = (ready: number[]) => [
      {
        ...body.groups[0],
        threads: Array.from({ length: 30 }, (_, i) => i).filter((i) => !answered.includes(i)).map((i) => ({
          root: reply(`r${i}`, { timestamp: day(i), ...(ready.includes(i) ? { answer: { draft: `답 ${i}` } as ThreadsReply["answer"] } : {}) }),
          followUps: [],
          pending: 1,
        })),
      },
    ];
    let ready: number[] = [];
    let answered: number[] = [];
    const posted: string[][] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (u: string, init?: RequestInit) => {
        if (String(u).includes("gate-rules")) return new Response(JSON.stringify(rules), { status: 200 });
        if (String(u).includes("/prefetch")) {
          posted.push((JSON.parse(String(init?.body)) as { ids: string[] }).ids);
          return new Response(JSON.stringify({ queued: [] }), { status: 200 });
        }
        return new Response(JSON.stringify({ ...body, groups: make(ready) }), { status: 200 });
      })
    );
    render(<ThreadsClient view="comments" />);
    await screen.findByTestId("panel");
    await waitFor(() => expect(posted).toHaveLength(1));
    // 미리 쓰기는 오래된 r0 … r19
    expect(posted[0]).toEqual(Array.from({ length: 20 }, (_, i) => `r${i}`));
    // 답이 준비돼도 목록 순서·묶음은 그대로 — 새로 보내지 않는다
    ready = [3, 25, 26, 27];
    fireEvent.click(screen.getByRole("button", { name: "새로고침" }));
    await act(async () => {});
    expect(posted).toHaveLength(1);
    // 20개 밖 댓글(r27)을 눌러도 줄은 그대로
    fireEvent.click(document.querySelector<HTMLElement>('[data-reply-id="r27"]')!);
    await act(async () => {});
    expect(posted).toHaveLength(1);
    // 가장 오래된 r0 에 답하면(목록에서 빠지면) r20 이 들어온다
    answered = [0];
    fireEvent.click(screen.getByRole("button", { name: "새로고침" }));
    await waitFor(() => expect(posted).toHaveLength(2));
    expect(posted[1]).toEqual(Array.from({ length: 20 }, (_, i) => `r${i + 1}`));
  });

  it("저장된 목록을 먼저 보여 주고, 뒤에서 동기화하는 동안 '동기화 중…', 끝나면 알림 한 줄 (10-02 henry)", { timeout: 15_000 }, async () => {
    toastSuccess.mockClear();
    let syncing = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (u: string) => {
        if (String(u).includes("gate-rules")) return new Response(JSON.stringify(rules), { status: 200 });
        const groups = syncing
          ? body.groups
          : [{ ...body.groups[0], threads: [...body.groups[0].threads, { root: reply("n", { timestamp: "2026-09-30T00:00:00Z" }), followUps: [], pending: 1 }] }];
        return new Response(JSON.stringify({ ...body, groups, syncing }), { status: 200 });
      })
    );
    render(<ThreadsClient view="comments" />);
    await screen.findByTestId("panel");
    expect(screen.getByText("동기화 중…")).toBeTruthy();
    expect(toastSuccess).not.toHaveBeenCalled();
    // 동기화 중엔 5초마다 다시 읽는다
    syncing = false;
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("동기화 완료 · 새 댓글 1개"), { timeout: 8000 });
    expect(screen.queryByText("동기화 중…")).toBeNull();
  });

  it("오래된 순은 진행 숫자 없이 알아서, 쓰는 중인 줄은 글자·테두리 빛 없이 점만 깜빡인다 (10-02 henry)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (u: string) =>
        new Response(JSON.stringify(String(u).includes("gate-rules") ? rules : { ...body, variantsQueue: { running: ["a"], queued: ["q"] } }), { status: 200 })
      )
    );
    render(<ThreadsClient view="comments" />);
    const list = await screen.findByRole("region", { name: "답할 댓글" });
    expect(list.textContent).not.toContain("답 준비");
    const row = list.querySelector<HTMLElement>('[data-reply-id="a"]')!;
    expect(row.querySelector(".animate-pulse.rounded-full")).toBeTruthy();
    // 화면 읽기용 글자(sr-only)만 남는다
    expect(within(row).getByText("쓰는 중").className).toContain("sr-only");
    expect(within(list.querySelector<HTMLElement>('[data-reply-id="q"]')!).getByText("차례 기다림").className).toContain("sr-only");
    expect(document.querySelector("[data-border-beam], .border-beam")).toBeNull();
  });
});
