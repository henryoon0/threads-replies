// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReplyAnswer } from "@/lib/threads-replies/model";
import { DraftChecks } from "./threads-answer-draft";

const base: ReplyAnswer = {
  verdict: "answerable",
  verdictReason: "",
  sources: [],
  sentences: [],
  draft: "릴스는 아침에 올리세요.",
  model: "m",
  generatedAt: "2026-09-30T00:00:00Z",
  styleExamples: 0,
  dropped: [{ text: "조회수가 40% 올라요.", reason: "자료에 없는 말: 40" }],
  consistency: [{ sentenceStart: 0, sentenceEnd: 13, past: { text: "저녁에 올리는 게 좋아요" }, note: "예전엔 저녁이라고 했어요" }],
  consistencyFor: "릴스는 아침에 올리세요.",
};

vi.mock("@/lib/sound/events", () => ({ playUi: vi.fn() }));
vi.mock("@/lib/sound", () => ({ playSound: vi.fn() }));

describe("DraftChecks", () => {
  afterEach(cleanup);
  it("뺀 문장과 예전 답 어긋남을 보여준다", () => {
    render(<DraftChecks answer={base} draft={base.draft} />);
    expect(screen.getByText(/근거 없어 뺀 문장/)).toBeTruthy();
    expect(screen.getByText(/예전 답과 다름/)).toBeTruthy();
  });
  it("글을 고치면 옛 어긋남은 숨긴다", () => {
    render(<DraftChecks answer={{ ...base, dropped: [] }} draft="다른 글" />);
    expect(screen.queryByText(/예전 답과 다름/)).toBeNull();
  });
});
