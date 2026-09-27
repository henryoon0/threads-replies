// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ThreadsReply } from "@/lib/threads-replies/model";
import { ThreadsAnswerPanel } from "./threads-answer-panel";

// 답 패널이 "언제 무엇을 서버에 보내는가"만 고정한다. 실제 스레드 발송은 fetch 가짜로 막는다.
vi.mock("@/lib/sound/events", () => ({ playUi: vi.fn() }));
vi.mock("@/lib/sound", () => ({ playSound: vi.fn() }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

const question: ThreadsReply = {
  id: "c1",
  postId: "p1",
  username: "kim",
  text: "이거 어떻게 확인하세요?",
  timestamp: "2026-09-27T01:00:00+0000",
  repliedToId: "p1",
  intent: "question",
  answer: {
    verdict: "partial",
    verdictReason: "원칙은 자료에 있지만 단계는 없음",
    sources: [{ id: "s1", kind: "FAQ", title: "검증 원칙", quote: "실패만 직접 연다" }],
    sentences: [
      { text: "실패만 직접 열어봐요", sourceIds: ["s1"] },
      { text: "그럴듯할수록 더 봐요", sourceIds: [] },
    ],
    draft: "실패만 직접 열어봐요 그럴듯할수록 더 봐요",
    model: "claude",
    generatedAt: "2026-09-27T02:00:00Z",
    styleExamples: 0,
  },
};

type Handler = (url: string, init?: RequestInit) => Response | undefined;
let extra: Handler = () => undefined;
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

function fetchMock() {
  return fetch as unknown as ReturnType<typeof vi.fn>;
}
function callsTo(part: string, method?: string) {
  return fetchMock().mock.calls.filter(([u, init]) => String(u).includes(part) && (!method || (init as RequestInit | undefined)?.method === method));
}
async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  extra = () => undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const hit = extra(url, init);
      if (hit) return hit;
      if (url.endsWith("/api/threads-replies/c1") && !init?.method) {
        return json({ reply: question, post: { id: "p1", text: "내 글", permalink: "https://www.threads.com/p", timestamp: "" }, conversation: [], drafting: false });
      }
      return json({});
    })
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function mount(onNext = vi.fn()) {
  render(<ThreadsAnswerPanel replyId="c1" onChanged={vi.fn()} onNext={onNext} />);
  await flush();
  return onNext;
}

describe("ThreadsAnswerPanel", () => {
  it("판정 한 줄과 근거 칩을 보여주고, 칩을 누르면 그 근거를 쓴 문장을 칠한다", async () => {
    await mount();
    expect(screen.getByText("일부만 자료로 답할 수 있어요")).toBeTruthy();
    const sentence = screen.getByText("실패만 직접 열어봐요");
    expect(sentence.className).not.toContain("bg-emerald-50");
    fireEvent.click(screen.getByRole("button", { name: /검증 원칙/ }));
    expect(sentence.className).toContain("bg-emerald-50");
    // 펼친 카드 + 보내기 전 근거(노트는 글로만) 두 곳
    expect(screen.getAllByText("“실패만 직접 연다”")).toHaveLength(2);
  });

  it("[보내기] 뒤 5초 안에 [되돌리기]를 누르면 발송을 부르지 않는다", async () => {
    const onNext = await mount();
    fireEvent.click(screen.getByRole("button", { name: /^보내기/ }));
    await flush(2000);
    fireEvent.click(screen.getByRole("button", { name: "되돌리기" }));
    await flush(6000);
    expect(callsTo("/send")).toHaveLength(0);
    expect(onNext).not.toHaveBeenCalled();
  });

  it("5초가 지나면 초안을 보내고 다음 질문으로 넘긴다", async () => {
    extra = (url) => (url.endsWith("/c1/send") ? json({ reply: { ...question, myReply: { id: "x", text: "t", timestamp: "" } } }) : undefined);
    const onNext = await mount();
    fireEvent.click(screen.getByRole("button", { name: /^보내기/ }));
    await flush(4900);
    expect(callsTo("/send")).toHaveLength(0);
    await flush(200);
    const [, init] = callsTo("/send")[0];
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ message: question.answer!.draft });
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("권한이 없으면 폴백을 띄우고 [달았어요]는 markedAnswered 로 기록한다", async () => {
    extra = (url, init) => {
      if (url.endsWith("/c1/send")) return json({ error: "권한이 없어요", kind: "permission", reauthUrl: "https://threads.net/oauth" }, 403);
      if (init?.method === "PATCH") return json({ reply: { ...question, myReply: { id: "manual", text: "t", timestamp: "" } } });
      return undefined;
    };
    const onNext = await mount();
    fireEvent.click(screen.getByRole("button", { name: /^보내기/ }));
    await flush(5100);
    expect(screen.getByRole("button", { name: /복사하고 스레드에서 열기/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /달았어요/ }));
    await flush();
    const patch = callsTo("/api/threads-replies", "PATCH").map(([, i]) => JSON.parse(String((i as RequestInit).body)));
    expect(patch).toContainEqual({ replyId: "c1", markedAnswered: question.answer!.draft });
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("주소를 입력하고 Enter 를 누르면 그 링크를 근거로 붙여 다시 쓴다", async () => {
    await mount();
    const input = screen.getByLabelText("근거로 붙일 주소");
    fireEvent.change(input, { target: { value: "https://example.com/a" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await flush();
    const [, init] = callsTo("/c1/answer", "POST")[0];
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ extraLinks: ["https://example.com/a"] });
  });

  describe("답글 이미지 (09-27 버그: 붙였는데 이미지 없이 올라감)", () => {
    const png = () => new File([new Uint8Array([137, 80, 78, 71])], "shot.png", { type: "image/png" });
    const sentImage = () => {
      const [, init] = callsTo("/c1/send")[0] ?? [];
      return init ? (JSON.parse(String((init as RequestInit).body)) as { image?: string }).image : "보내기 안 됨";
    };
    async function sendNow() {
      fireEvent.click(screen.getByRole("button", { name: /^보내기/ }));
      await flush(5100);
    }
    async function settleReader() {
      // jsdom FileReader 는 타이머로 끝난다 — 가짜 시계를 돌려 준다
      await flush(50);
    }

    it("파일 고르기로 붙이면 보낼 때 image 가 같이 간다", async () => {
      await mount();
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      fireEvent.change(input, { target: { files: [png()] } });
      await settleReader();
      await sendNow();
      expect(sentImage()).toMatch(/^data:image\/png;base64,/);
    });

    it("초안을 손대지 않은 채(입력칸이 아닌 상태) ⌘V 해도 image 가 같이 간다", async () => {
      await mount();
      const target = screen.getByRole("button", { name: "초안 고치기" });
      fireEvent.paste(target, { clipboardData: { items: [{ kind: "file", getAsFile: png }], getData: () => "" } });
      await settleReader();
      await sendNow();
      expect(sentImage()).toMatch(/^data:image\/png;base64,/);
    });

    it("근거 캡처가 찍혀 있으면 보낼 때 그 캡처를 같이 보낸다 (henry 의도)", async () => {
      const withShot: ThreadsReply = {
        ...question,
        answer: {
          ...question.answer!,
          sources: [{ id: "s2", kind: "원글 원본", title: "OpenAI", quote: "Astra", url: "https://x.com/OpenAI/status/1" }],
        },
      };
      extra = (url, init) => {
        if (url.endsWith("/api/threads-replies/c1") && !init?.method)
          return json({ reply: withShot, post: null, conversation: [], drafting: false });
        if (url.endsWith("/c1/evidence"))
          return json({ shot: { sourceId: "s2", url: "u", image: "/threads-evidence/c1/s2.png", painted: 1, createdAt: "" } });
        return undefined;
      };
      await mount();
      await flush(50);
      expect(screen.getByText("근거 캡처가 같이 올라가요")).toBeTruthy();
      await sendNow();
      const [, init] = callsTo("/c1/send")[0];
      expect((JSON.parse(String((init as RequestInit).body)) as { evidenceImage?: string }).evidenceImage).toBe("/threads-evidence/c1/s2.png");
    });

    it("카드에 끌어 놓아도 image 가 같이 간다", async () => {
      await mount();
      const card = screen.getByRole("button", { name: "초안 고치기" });
      fireEvent.drop(card, { dataTransfer: { files: [png()], getData: () => "" } });
      await settleReader();
      await sendNow();
      expect(sentImage()).toMatch(/^data:image\/png;base64,/);
    });
  });
});
