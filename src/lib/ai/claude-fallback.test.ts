import { beforeEach, describe, expect, it, vi } from "vitest";

const execCodexMock = vi.hoisted(() => vi.fn());

class FakeCancelledError extends Error {
  constructor() {
    super("취소됨");
    this.name = "CancelledError";
  }
}

vi.mock("../codex-exec", () => ({
  execCodex: execCodexMock,
  CancelledError: FakeCancelledError,
  isCancelled: (e: unknown) => e instanceof FakeCancelledError,
}));

describe("runWithClaudeCodexFallback", () => {
  beforeEach(() => {
    vi.resetModules();
    execCodexMock.mockReset();
  });

  it("falls back to Codex when Claude reports a usage limit", async () => {
    const { runWithClaudeCodexFallback } = await import("./claude-fallback");
    const runClaude = vi.fn().mockRejectedValue(new Error("usage limit reached"));
    execCodexMock.mockResolvedValue("codex answer");

    const out = await runWithClaudeCodexFallback(
      "prompt",
      { tmpPrefix: "test-claude-", timeoutMs: 1234 },
      runClaude
    );

    expect(out).toBe("codex answer");
    expect(runClaude).toHaveBeenCalledOnce();
    expect(execCodexMock).toHaveBeenCalledWith("prompt", {
      tmpPrefix: "test-claude-",
      timeoutMs: 1234,
      noClaudeFallback: true,
    });
  });

  it("falls back to Codex when Claude exits with an opaque code 1", async () => {
    const { runWithClaudeCodexFallback } = await import("./claude-fallback");
    const runClaude = vi.fn().mockRejectedValue(new Error("종료 코드 1"));
    execCodexMock.mockResolvedValue("codex answer");

    const out = await runWithClaudeCodexFallback("prompt", {}, runClaude);

    expect(out).toBe("codex answer");
    expect(runClaude).toHaveBeenCalledOnce();
    expect(execCodexMock).toHaveBeenCalledWith("prompt", {
      tmpPrefix: "claude-fallback-",
      timeoutMs: undefined,
      noClaudeFallback: true,
    });
  });

  it("preserves Claude JSON stdout in exit-code errors", async () => {
    const { claudeCliExitErrorMessage } = await import("./claude-fallback");

    const message = claudeCliExitErrorMessage(
      1,
      '{"type":"result","is_error":true,"result":"usage limit reached"}',
      ""
    );

    expect(message).toBe("Claude CLI 종료 코드 1: usage limit reached");
  });

  it("keeps using Codex after Claude quota is marked unavailable", async () => {
    const { runWithClaudeCodexFallback } = await import("./claude-fallback");
    const firstClaude = vi
      .fn()
      .mockRejectedValue(new Error("Claude CLI 종료 코드 1: quota exceeded"));
    const secondClaude = vi.fn().mockResolvedValue("claude answer");
    execCodexMock.mockResolvedValue("codex answer");

    await runWithClaudeCodexFallback("first", {}, firstClaude);
    await runWithClaudeCodexFallback("second", {}, secondClaude);

    expect(firstClaude).toHaveBeenCalledOnce();
    expect(secondClaude).not.toHaveBeenCalled();
    expect(execCodexMock).toHaveBeenCalledTimes(2);
    expect(execCodexMock).toHaveBeenNthCalledWith(2, "second", {
      tmpPrefix: "claude-fallback-",
      timeoutMs: undefined,
      noClaudeFallback: true,
    });
  });

  it("retries Claude again after the fallback window expires", async () => {
    vi.useFakeTimers();
    try {
      const { runWithClaudeCodexFallback } = await import("./claude-fallback");
      const firstClaude = vi
        .fn()
        .mockRejectedValue(new Error("Claude CLI 종료 코드 1: quota exceeded"));
      const laterClaude = vi.fn().mockResolvedValue("claude answer");
      execCodexMock.mockResolvedValue("codex answer");

      await runWithClaudeCodexFallback("first", {}, firstClaude);
      vi.advanceTimersByTime(6 * 60_000);
      const out = await runWithClaudeCodexFallback("later", {}, laterClaude);

      expect(out).toBe("claude answer");
      expect(laterClaude).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to Claude when Codex-mode Codex fails", async () => {
    const { runWithClaudeCodexFallback } = await import("./claude-fallback");
    const firstClaude = vi
      .fn()
      .mockRejectedValue(new Error("Claude CLI 종료 코드 1: quota exceeded"));
    const secondClaude = vi.fn().mockResolvedValue("claude answer");
    execCodexMock
      .mockResolvedValueOnce("codex answer")
      .mockRejectedValueOnce(
        new Error(
          "종료 코드 1:  sending request for url (https://chatgpt.com/backend-api/codex/responses)\nERROR: stream disconnected before completion"
        )
      );

    await runWithClaudeCodexFallback("first", {}, firstClaude);
    const out = await runWithClaudeCodexFallback("second", {}, secondClaude);

    expect(out).toBe("claude answer");
    expect(secondClaude).toHaveBeenCalledOnce();
  });

  it("does not fall back for ordinary Claude failures", async () => {
    const { runWithClaudeCodexFallback } = await import("./claude-fallback");
    const runClaude = vi.fn().mockRejectedValue(new Error("JSON parse failed"));

    await expect(runWithClaudeCodexFallback("prompt", {}, runClaude)).rejects.toThrow(
      "JSON parse failed"
    );
    expect(execCodexMock).not.toHaveBeenCalled();
  });

  it("preserves cancellation when the first Codex fallback is cancelled", async () => {
    const { runWithClaudeCodexFallback } = await import("./claude-fallback");
    const runClaude = vi.fn().mockRejectedValue(new Error("usage limit reached"));
    const cancelled = new FakeCancelledError();
    execCodexMock.mockRejectedValue(cancelled);

    await expect(
      runWithClaudeCodexFallback("prompt", {}, runClaude)
    ).rejects.toBe(cancelled);
    expect(runClaude).toHaveBeenCalledOnce();
    expect(execCodexMock).toHaveBeenCalledOnce();
  });

  it.each(["text", "stream"])(
    "preserves combined failure details when %s recovery fails",
    async (mode) => {
      const fallback = await import("./claude-fallback");
      fallback.markClaudeUnavailableForCodexFallback(new Error("usage limit reached"));
      execCodexMock.mockRejectedValue(new Error("codex disconnected"));
      const runClaude = vi.fn().mockRejectedValue(new Error("claude disconnected"));

      const result = mode === "stream"
        ? fallback.runWithClaudeCodexFallbackStream("prompt", {}, vi.fn(), runClaude)
        : fallback.runWithClaudeCodexFallback("prompt", {}, runClaude);

      await expect(result).rejects.toThrow(
        "Codex 실패(codex disconnected), Claude 도 실패했습니다: claude disconnected"
      );
    }
  );

  it.each(["text", "stream"])(
    "preserves cancellation identity when %s recovery is cancelled",
    async (mode) => {
      const fallback = await import("./claude-fallback");
      fallback.markClaudeUnavailableForCodexFallback(new Error("usage limit reached"));
      execCodexMock.mockRejectedValue(new Error("codex disconnected"));
      const cancelled = new FakeCancelledError();
      const runClaude = vi.fn().mockRejectedValue(cancelled);

      const result = mode === "stream"
        ? fallback.runWithClaudeCodexFallbackStream("prompt", {}, vi.fn(), runClaude)
        : fallback.runWithClaudeCodexFallback("prompt", {}, runClaude);

      await expect(result).rejects.toBe(cancelled);
    }
  );

  it("emits the Codex fallback result for streaming callers", async () => {
    const { runWithClaudeCodexFallbackStream } = await import("./claude-fallback");
    const runClaude = vi.fn().mockRejectedValue(new Error("usage limit reached"));
    const onText = vi.fn();
    execCodexMock.mockResolvedValue("{\"posts\":[\"codex\"]}");

    const out = await runWithClaudeCodexFallbackStream(
      "prompt",
      {},
      onText,
      runClaude
    );

    expect(out).toBe("{\"posts\":[\"codex\"]}");
    expect(onText).toHaveBeenCalledWith("{\"posts\":[\"codex\"]}");
  });
});
