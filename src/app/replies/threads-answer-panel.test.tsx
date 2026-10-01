// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearDraftSlots } from "./use-compose";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ThreadsReply } from "@/lib/threads-replies/model";
import { ThreadsAnswerPanel } from "./threads-answer-panel";
import type { GateChecker } from "./threads-gate";
import { checkGate, applyGateMode, type GateRules } from "@/lib/personas/gate";

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

// 가짜 서버 보내기 대기열: POST(delayMs) 로 맡기고, 시간이 지나면 GET 이 결과를 준다 (send-queue.ts 와 같은 흐름)
type FakeSend = { message: string; dueAt: number; cancelled: boolean };
let queued: FakeSend | null = null;
let sendResult: { status: "sent" } | { status: "failed"; kind: string; error: string; reauthUrl?: string } = { status: "sent" };
function fakeQueueStatus(): Response {
  if (!queued || queued.cancelled) return json({ item: null });
  const base = { replyId: "c1", message: queued.message, dueAt: new Date(queued.dueAt).toISOString() };
  return json({ item: Date.now() < queued.dueAt ? { ...base, status: "waiting" } : { ...base, ...sendResult } });
}
function fakeQueueCancel(): Response {
  if (!queued || Date.now() >= queued.dueAt) return json({ cancelled: false }, 409);
  queued.cancelled = true;
  return json({ cancelled: true });
}
function fakeSendQueue(url: string, init?: RequestInit): Response | undefined {
  if (!url.endsWith("/c1/send")) return undefined;
  if (init?.method === "DELETE") return fakeQueueCancel();
  if (init?.method !== "POST") return fakeQueueStatus();
  const body = JSON.parse(String(init.body)) as { message: string; delayMs?: number };
  if (!body.delayMs) return undefined;
  queued = { message: body.message, dueAt: Date.now() + body.delayMs, cancelled: false };
  return json({ queued: { dueAt: new Date(queued.dueAt).toISOString() } }, 202);
}
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
  clearDraftSlots();
  vi.useFakeTimers();
  extra = () => undefined;
  queued = null;
  sendResult = { status: "sent" };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const hit = extra(url, init) ?? fakeSendQueue(url, init);
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

const RULES: GateRules = {
  version: 1,
  rules: [{ id: "drug", kind: "drug-choice", action: "block", pattern: "마운자로[^.!?\\n]{0,10}?강추", reason: "처방약 선택은 답하지 않아요", suggest: "처방한 의사쌤께 물어봐" }],
};
const gateOf = (mode: "light" | "strict"): GateChecker => ({ mode, check: (t) => applyGateMode(checkGate(t, RULES), mode) });
const COPY = { id: "glp1", name: "박약사", handle: "glp1.pharmacy", send: "copy" as const };

async function mount(onNext = vi.fn(), props: Partial<React.ComponentProps<typeof ThreadsAnswerPanel>> = {}) {
  render(<ThreadsAnswerPanel replyId="c1" onChanged={vi.fn()} onNext={onNext} gate={gateOf("light")} {...props} />);
  await flush();
  return onNext;
}

const editor = () => screen.getByRole("textbox", { name: "완성된 답" }) as HTMLTextAreaElement;

/** [보내기] → 확인 시트 → 시트의 [보내기] */
async function confirmSend() {
  fireEvent.click(screen.getByRole("button", { name: /^보내기/ }));
  await flush();
  const sheet = screen.getByRole("dialog");
  fireEvent.click(within(sheet).getByRole("button", { name: /^보내기/ }));
  await flush();
}

const threeOptions: ThreadsReply = {
  ...question,
  answer: {
    ...question.answer!,
    chosen: 0,
    aiDraft: question.answer!.draft,
    options: [
      { categoryId: "short", categoryName: "짧게 확인", draft: question.answer!.draft, sentences: question.answer!.sentences },
      { categoryId: "how", categoryName: "방법 알려주기", draft: "두 번째 벌이에요", sentences: [{ text: "두 번째 벌이에요", sourceIds: ["s1"] }] },
      { categoryId: "warm", categoryName: "공감하고 답", draft: "세 번째 벌이에요", sentences: [{ text: "세 번째 벌이에요", sourceIds: [] }] },
    ],
  },
};

const PRESETS = [
  { id: "principle", name: "원리 썰", parts: "원리", count: 11, recommended: true, toggles: { principle: true } },
  { id: "ingredient+product", name: "성분 + 제품 3분할", parts: "성분+제품 3분할", count: 17, recommended: true, toggles: { ingredient: true, product: { pharmacy: true, online: true, overseas: true } } },
  { id: "joke", name: "뒤통수 한 방", parts: "드립", count: 1, recommended: false, toggles: { joke: true } },
];

describe("ThreadsAnswerPanel", () => {
  it("가져온 자료를 카드로 보여주고(쓴 문장 번호), 버전 초안기가 없으면(404) [새로 쓰기]가 옛 다시 쓰기로 간다", async () => {
    extra = (url) => (url.endsWith("/c1/compose") ? json({ error: "없음" }, 404) : undefined);
    await mount(vi.fn(), { persona: COPY });
    expect(screen.getByText(/버전 초안기를 준비하는 중/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /성분/ })).toBeNull();
    expect(screen.getByText("일부만 자료로 답할 수 있어요")).toBeTruthy();
    const card = screen.getByText("“실패만 직접 연다”").closest("li")!;
    expect(card.getAttribute("data-source")).toBe("s1");
    expect(within(card).getByText("문장 1")).toBeTruthy();
    expect(within(card).getByText("실패만 직접 열어봐요")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /새로 쓰기/ }));
    await flush();
    expect(callsTo("/c1/answer", "POST")).toHaveLength(1);
  });

  it("팟캐스트 발언은 말한 사람·원문 그대로·한국어 요약·그 초에서 여는 링크를 보여준다", async () => {
    const podcast: ThreadsReply = {
      ...question,
      answer: {
        ...question.answer!,
        sources: [
          {
            id: "s1",
            kind: "팟캐스트 발언",
            title: "Andrew Huberman · 마그네슘 (관점일 뿐, 추천 근거 아님)",
            quote: "neurons need sodium, they need magnesium",
            claimKo: "뉴런이 기능하려면 마그네슘이 필요하다",
            speaker: "Andrew Huberman",
            videoTitle: "Daily Tools",
            startSec: 1645,
            url: "https://www.youtube.com/watch?v=aXvDEmo6uS4&t=1645s",
          },
        ],
        dropped: [{ text: "마그네슘은 하루 400mg이 좋아", reason: "자료에 없는 말: 400, mg" }],
      },
    };
    extra = (url, init) => (url.endsWith("/api/threads-replies/c1") && !init?.method ? json({ reply: podcast, post: null, conversation: [], drafting: false }) : undefined);
    await mount();
    expect(screen.getByText("Andrew Huberman")).toBeTruthy();
    expect(screen.getByText("“neurons need sodium, they need magnesium”")).toBeTruthy();
    expect(screen.getByText(/뉴런이 기능하려면/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /27:25부터 보기/ }).getAttribute("href")).toBe("https://www.youtube.com/watch?v=aXvDEmo6uS4&t=1645s");
    expect(screen.getByText("근거 없어 뺀 문장 1")).toBeTruthy();
    expect(screen.getByText("마그네슘은 하루 400mg이 좋아")).toBeTruthy();
  });

  it("완성된 답 글 위에 형광펜을 칠하지 않는다 (근거 없는 숫자가 있어도 보내기는 열려 있다, 10-01)", async () => {
    await mount(vi.fn(), { gate: gateOf("strict") });
    fireEvent.change(editor(), { target: { value: "실패만 직접 열어봐요. 그러면 오류가 80% 줄어요." } });
    expect(document.querySelector("mark[data-gate]")).toBeNull();
    expect(screen.queryByText(/근거 없음/)).toBeNull();
    expect(screen.queryByText(/칠한 곳/)).toBeNull();
    expect((screen.getByRole("button", { name: /^보내기/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("따로 떨어진 다시 쓰기 도구(주소 붙이기·지시문)는 없다", async () => {
    await mount();
    expect(screen.queryByLabelText("근거로 붙일 주소")).toBeNull();
    expect(screen.queryByRole("button", { name: /웹에서 찾기/ })).toBeNull();
  });

  it("버전 버튼을 댓글에 맞는 순서로(추천 표시) 두고, 안 써 둔 버전을 누르면 compose 에 { toggles, preset } 를 보내 답을 바꾼다 (칠하지 않는다)", async () => {
    const next = "실패만 직접 열어봐요. 아연은 상처 회복을 돕는 성분이야.";
    extra = (url, init) => {
      if (url.endsWith("/c1/compose") && !init?.method) return json({ presets: PRESETS });
      if (url.endsWith("/c1/compose") && init?.method === "POST") return json({ draft: next, products: [{ id: "p1", name: "쏜 아이언", url: "https://iherb.com/x" }] });
      return undefined;
    };
    await mount(vi.fn(), { persona: COPY });
    const names = within(screen.getByRole("group", { name: "답 버전" })).getAllByRole("button").map((b) => b.textContent);
    expect(names.slice(0, 3)).toEqual(["원리 썰추천", "성분 + 제품 3분할추천", "뒤통수 한 방"]);
    fireEvent.click(screen.getByRole("button", { name: /성분 \+ 제품 3분할/ }));
    await flush();
    // 열 때 추천 1순위(원리 썰)를 먼저 쓰고, 누른 버전을 이어서 쓴다
    const bodies = callsTo("/c1/compose", "POST").map(([, init]) => JSON.parse(String((init as RequestInit).body)));
    expect(bodies[0].preset).toBe("principle");
    expect(bodies).toContainEqual({ toggles: PRESETS[1].toggles, preset: "ingredient+product" });
    expect(editor().value).toBe(next);
    expect(screen.getByRole("button", { name: /성분 \+ 제품 3분할/ }).getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector("mark[data-gate]")).toBeNull();
  });

  it("미리 써 둔 버전은 누르는 즉시 그 글로 바꾸고 고른 벌을 알린다 (compose POST 없음), 쓰는 중이면 버튼이 돌다가 도착하면 바뀐다", async () => {
    const withProduct = "철분은 약국은 훼럼포라, 직구는 쏜 아이언 비스글리시네이트 25mg.";
    const withJoke = "야식이나 끊어라.";
    let jokeReady = false;
    extra = (url, init) => {
      if (url.endsWith("/c1/compose") && !init?.method) return json({ presets: PRESETS });
      if (url.endsWith("/c1/compose/variants") && init?.method === "POST") return json({ ok: true });
      if (url.endsWith("/c1/compose/variants")) {
        const variants = [{ key: "ingredient+product", draft: withProduct, products: [] }];
        if (jokeReady) variants.push({ key: "joke", draft: withJoke, products: [] });
        return json({ variants, pending: jokeReady ? [] : ["joke"] });
      }
      return undefined;
    };
    await mount(vi.fn(), { persona: COPY });
    fireEvent.click(screen.getByRole("button", { name: /성분 \+ 제품 3분할/ }));
    expect(editor().value).toBe(withProduct);
    const composed = callsTo("/c1/compose", "POST").filter(([u]) => String(u).endsWith("/compose"));
    expect(composed.map(([, init]) => JSON.parse(String((init as RequestInit).body)).preset)).not.toContain("ingredient+product");
    await flush();
    expect(JSON.parse(String((callsTo("/compose/variants", "POST")[0][1] as RequestInit).body))).toEqual({ key: "ingredient+product" });
    fireEvent.click(screen.getByRole("button", { name: /뒤통수 한 방/ }));
    expect(screen.getByRole("button", { name: /뒤통수 한 방/ }).getAttribute("aria-busy")).toBe("true");
    jokeReady = true;
    await flush(2600);
    expect(editor().value).toBe(withJoke);
    expect(screen.getByRole("button", { name: /뒤통수 한 방/ }).getAttribute("aria-busy")).toBeNull();
    expect(screen.getByRole("button", { name: /뒤통수 한 방/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("버전 글을 고쳐 쓰고 다른 버전을 봤다가 다시 누르면 고친 글이 돌아온다 (10-01 초안 사라짐)", async () => {
    extra = (url, init) => {
      if (url.endsWith("/c1/compose") && !init?.method) return json({ presets: PRESETS });
      if (url.endsWith("/c1/compose/variants") && init?.method === "POST") return json({ ok: true });
      if (url.endsWith("/c1/compose/variants"))
        return json({ variants: [{ key: "principle", draft: "원리 글", products: [] }, { key: "ingredient+product", draft: "성분 글", products: [] }], pending: [] });
      return undefined;
    };
    await mount(vi.fn(), { persona: COPY });
    await flush();
    expect(editor().value).toBe("원리 글");
    expect(screen.getByRole("button", { name: /원리 썰/ }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.change(editor(), { target: { value: "원리 글을 내가 고쳤어" } });
    expect(screen.getByRole("button", { name: /원리 썰/ }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /성분 \+ 제품 3분할/ }));
    expect(editor().value).toBe("성분 글");
    // 고른 버전은 맨 앞에 온다
    expect(within(screen.getByRole("group", { name: "답 버전" })).getAllByRole("button")[0].textContent).toMatch(/^성분 \+ 제품 3분할/);
    fireEvent.click(screen.getByRole("button", { name: /원리 썰/ }));
    expect(editor().value).toBe("원리 글을 내가 고쳤어");
  });

  it("버전을 새로 쓰다 실패하면 이유를 보여주고 글은 그대로 둔다", async () => {
    extra = (url, init) => {
      if (url.endsWith("/c1/compose") && !init?.method) return json({ presets: PRESETS });
      if (url.endsWith("/c1/compose") && init?.method === "POST") return json({ error: "모델 오류" }, 502);
      return undefined;
    };
    await mount(vi.fn(), { persona: COPY });
    fireEvent.click(screen.getByRole("button", { name: /원리 썰/ }));
    await flush();
    expect(screen.getByText("모델 오류")).toBeTruthy();
    expect(editor().value).toBe(question.answer!.draft);
    expect(screen.getByRole("button", { name: /원리 썰/ }).getAttribute("aria-pressed")).toBe("false");
  });

  it("관문 막는 표현은 칠하지 않고 칸 아래 한 줄로 알리며, [바꾸기]로 제안 표현을 넣는다", async () => {
    await mount(vi.fn(), { gate: gateOf("strict") });
    fireEvent.change(editor(), { target: { value: "마운자로 강추해요" } });
    expect(document.querySelector("mark[data-gate]")).toBeNull();
    expect(screen.getByText(/보낼 수 없는 표현 1개/)).toBeTruthy();
    expect((screen.getByRole("button", { name: /^보내기/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /로 바꾸기/ }));
    expect(editor().value).toBe("처방한 의사쌤께 물어봐해요");
    expect((screen.getByRole("button", { name: /^보내기/ }) as HTMLButtonElement).disabled).toBe(false);
    await flush(700);
    const patch = callsTo("/api/threads-replies", "PATCH").map(([, i]) => JSON.parse(String((i as RequestInit).body)));
    expect(patch.at(-1)).toEqual({ replyId: "c1", draft: "처방한 의사쌤께 물어봐해요" });
  });

  it("[보내기]는 확인 시트를 열고, 취소하면 아무것도 보내지 않는다", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: /^보내기/ }));
    await flush();
    const sheet = screen.getByRole("dialog");
    expect(within(sheet).getByText("이대로 보낼까요")).toBeTruthy();
    expect(within(sheet).getByText("@kim 님에게 답글")).toBeTruthy();
    fireEvent.click(within(sheet).getByRole("button", { name: "취소" }));
    await flush(6000);
    expect(callsTo("/send", "POST")).toHaveLength(0);
  });

  it("시트에서 확정한 뒤 5초 안에 [되돌리기]를 누르면 서버 대기열에서 빼고 보내지 않는다", async () => {
    const onNext = await mount();
    await confirmSend();
    expect(callsTo("/send", "POST")).toHaveLength(1);
    await flush(2000);
    fireEvent.click(screen.getByRole("button", { name: "되돌리기" }));
    await flush(6000);
    expect(callsTo("/send", "DELETE")).toHaveLength(1);
    expect(queued?.cancelled).toBe(true);
    expect(onNext).not.toHaveBeenCalled();
  });

  it("확정하면 바로 서버 대기열에 맡기고, 5초 뒤 서버가 보낸 결과를 받아 다음 질문으로 넘긴다", async () => {
    const onNext = await mount();
    await confirmSend();
    const [, init] = callsTo("/send", "POST")[0];
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ message: question.answer!.draft, delayMs: 5000 });
    await flush(4000);
    expect(onNext).not.toHaveBeenCalled();
    await flush(2100);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("맡긴 뒤 패널이 닫혀도(다른 댓글로 이동) 되돌리기 요청을 보내지 않는다 — 보내기는 서버가 끝낸다 (10-02)", async () => {
    await mount();
    await confirmSend();
    cleanup();
    await flush(6000);
    expect(callsTo("/send", "DELETE")).toHaveLength(0);
    expect(queued?.cancelled).toBe(false);
  });

  it("복사 계정은 시트에서 복사하고 원글을 연 뒤 [달았어요]로 기록한다 (5초 대기 없음)", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    extra = (url, init) => {
      if (url.endsWith("/c1/send")) return json({ mode: "copy", text: "복사할 글", permalink: "https://www.threads.com/p" });
      if (init?.method === "PATCH") return json({ reply: { ...question, myReply: { id: "manual", text: "t", timestamp: "" } } });
      return undefined;
    };
    const onNext = await mount(vi.fn(), { persona: COPY });
    fireEvent.click(screen.getByRole("button", { name: /^보내기/ }));
    await flush();
    const sheet = screen.getByRole("dialog");
    expect(within(sheet).getByText("glp1.pharmacy")).toBeTruthy();
    fireEvent.click(within(sheet).getByRole("button", { name: /복사하고 스레드 열기/ }));
    await flush();
    expect(writeText).toHaveBeenCalledWith("복사할 글");
    expect(open).toHaveBeenCalledWith("https://www.threads.com/p", "_blank", "noopener,noreferrer");
    fireEvent.click(within(sheet).getByRole("button", { name: /달았어요/ }));
    await flush();
    const patch = callsTo("/api/threads-replies", "PATCH").map(([, i]) => JSON.parse(String((i as RequestInit).body)));
    expect(patch).toContainEqual({ replyId: "c1", markedAnswered: question.answer!.draft });
    expect(onNext).toHaveBeenCalledTimes(1);
    open.mockRestore();
  });

  it("권한이 없으면 폴백을 띄우고 [달았어요]는 markedAnswered 로 기록한다", async () => {
    extra = (url, init) => {
      if (url.endsWith("/c1/send")) sendResult = { status: "failed", error: "권한이 없어요", kind: "permission", reauthUrl: "https://threads.net/oauth" };
      if (init?.method === "PATCH") return json({ reply: { ...question, myReply: { id: "manual", text: "t", timestamp: "" } } });
      return undefined;
    };
    const onNext = await mount();
    await confirmSend();
    await flush(5100);
    expect(screen.getByRole("button", { name: /복사하고 스레드에서 열기/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /달았어요/ }));
    await flush();
    const patch = callsTo("/api/threads-replies", "PATCH").map(([, i]) => JSON.parse(String((i as RequestInit).body)));
    expect(patch).toContainEqual({ replyId: "c1", markedAnswered: question.answer!.draft });
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("질문이면 이 주제에 내가 해 온 말 카드를 번호 붙은 원 답과 함께 보여준다", async () => {
    extra = (url) =>
      url.endsWith("/c1/stance")
        ? json({ topic: "검증", summary: "실패만 직접 연다고 말해 왔어요 [1]", items: [{ n: 1, text: "실패한 것만 열어 봐요", date: "2026-09-01T00:00:00Z", permalink: "https://t/1" }], source: "local" })
        : undefined;
    await mount();
    // 덜 쓰는 칸이라 접혀 있고, 펼쳐야 서버를 부른다
    expect(callsTo("/c1/stance")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "이 주제에 내가 해 온 말" }));
    await flush();
    const card = screen.getByRole("region", { name: "이 주제에 내가 해 온 말" });
    expect(within(card).getByText("검증")).toBeTruthy();
    expect(within(card).getByText("실패한 것만 열어 봐요")).toBeTruthy();
    expect(within(card).getByRole("link", { name: "원 답 열기" }).getAttribute("href")).toBe("https://t/1");
  });

  describe("답글 이미지 (09-27 버그: 붙였는데 이미지 없이 올라감)", () => {
    const png = () => new File([new Uint8Array([137, 80, 78, 71])], "shot.png", { type: "image/png" });
    const sentImage = () => {
      const [, init] = callsTo("/c1/send", "POST")[0] ?? [];
      return init ? (JSON.parse(String((init as RequestInit).body)) as { image?: string }).image : "보내기 안 됨";
    };
    async function sendNow() {
      await confirmSend();
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

    it("입력칸 밖에서 ⌘V 해도 image 가 같이 간다", async () => {
      await mount();
      fireEvent.paste(window, { clipboardData: { items: [{ kind: "file", getAsFile: png }], getData: () => "" } });
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
          sentences: [{ text: "Astra 래요", sourceIds: ["s2"] }],
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
      const [, init] = callsTo("/c1/send", "POST")[0];
      expect((JSON.parse(String((init as RequestInit).body)) as { evidenceImage?: string }).evidenceImage).toBe("/threads-evidence/c1/s2.png");
    });

    it("완성된 답 카드에 끌어 놓아도 image 가 같이 간다", async () => {
      await mount();
      const card = screen.getByRole("region", { name: "완성된 답" });
      fireEvent.drop(card, { dataTransfer: { files: [png()], getData: () => "" } });
      await settleReader();
      await sendNow();
      expect(sentImage()).toMatch(/^data:image\/png;base64,/);
    });
  });
});
