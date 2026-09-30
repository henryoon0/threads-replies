// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LearnReview } from "./learn-review";

// jsdom 에선 퇴장 애니메이션이 끝나지 않으므로 motion 을 평범한 요소로 바꾼다.
vi.mock("motion/react", async () => {
  const React = await import("react");
  const plain = (tag: string) =>
    function Plain({ children, className }: { children?: React.ReactNode; className?: string }) {
      return React.createElement(tag, { className }, children);
    };
  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
    motion: { article: plain("article"), div: plain("div") },
    useReducedMotion: () => true,
  };
});

// 주간 검토가 "무엇을 언제 서버에 보내는가"만 고정한다.
const overview = () => ({
  cards: [
    {
      id: "e1",
      type: "proposal",
      status: "open",
      proposal: { id: "e1", plainTitle: "버릇 두 개까지 허용", plainWhy: "실제로 둘을 섞어 써요", title: "t", hunks: [{ find: "하나만", replace: "둘까지" }], deltaTokens: 10, applicable: true },
      patterns: [{ id: "pt-a", title: "되받아 돌려준다", insight: "들뜬 만큼 돌려줘요", when: "말장난 댓글", count: 7, examples: [{ comment: "냠냠", aiDraft: "맛있게 드세요", final: "뇸뇸" }], impliedRule: "r" }],
      evidence: [],
      safety: { locked: false },
    },
    { id: "pt-x", type: "pattern", status: "locked", proposal: null, patterns: [{ id: "pt-x", title: "잠긴 패턴", insight: "i", when: "w", count: 3, examples: [], impliedRule: "r" }], evidence: [], safety: { locked: true, reason: "안전 규칙과 부딪혀요" } },
  ],
  rules: [],
  stats: {},
  job: null,
  lastRunAt: null,
  budget: { tokens: 100, cap: 3500 },
  patternsError: null,
});

let calls: { url: string; body: unknown }[] = [];

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        calls.push({ url, body: JSON.parse(String(init.body)) });
        return new Response(JSON.stringify({ status: "rejected" }), { status: 200 });
      }
      return new Response(JSON.stringify(overview()), { status: 200 });
    })
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("LearnReview", () => {
  it("shows the owner pattern and triplet before the rule diff", async () => {
    render(<LearnReview persona="aicc" />);
    expect(await screen.findByText("버릇 두 개까지 허용")).toBeTruthy();
    const text = document.body.textContent ?? "";
    expect(text.indexOf("패턴 분석")).toBeLessThan(text.indexOf("규칙책에 이렇게 바뀌어요"));
    expect(screen.getByText("뇸뇸")).toBeTruthy();
    expect(screen.getByText("7건에서 이렇게 고쳤어요")).toBeTruthy();
  });

  it("R key rejects the proposal, then the locked card has no apply", async () => {
    render(<LearnReview persona="aicc" />);
    await screen.findByText("버릇 두 개까지 허용");
    await act(async () => {
      fireEvent.keyDown(window, { key: "r" });
    });
    expect(calls).toEqual([{ url: "/api/personas/learning/proposals/e1", body: { action: "reject" } }]);
    expect(await screen.findByText("잠긴 패턴")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /적용|규칙으로 더하기/ })).toBeNull();
    expect(screen.getByText(/안전 규칙과 부딪혀요/)).toBeTruthy();
    // a 는 잠긴 카드에서 아무것도 보내지 않는다
    await act(async () => {
      fireEvent.keyDown(window, { key: "a" });
    });
    expect(calls).toHaveLength(1);
  });

  it("ignores keys typed into inputs", async () => {
    render(
      <>
        <input aria-label="x" />
        <LearnReview persona="aicc" />
      </>
    );
    await screen.findByText("버릇 두 개까지 허용");
    fireEvent.keyDown(screen.getByLabelText("x"), { key: "a" });
    expect(calls).toHaveLength(0);
  });
});
