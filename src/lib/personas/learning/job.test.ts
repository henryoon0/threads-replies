import { describe, expect, it } from "vitest";
import { envPositiveMs, isOrphan, type LearningJob } from "./job";

function job(extra: Partial<LearningJob> = {}): LearningJob {
  return {
    id: "j",
    persona: "aicc",
    status: "running",
    phase: "backpass",
    done: ["config"],
    startedAt: "2026-09-29T00:00:00.000Z",
    updatedAt: "2026-09-29T00:00:00.000Z",
    deadlineAt: "2026-09-29T00:40:00.000Z",
    attempt: 1,
    progress: null,
    error: null,
    finishedAt: null,
    timings: {},
    ...extra,
  };
}

const T0 = Date.parse("2026-09-29T00:00:00.000Z");

describe("isOrphan", () => {
  it("이 프로세스에서 안 돌고 하트비트가 3분 넘게 끊긴 running 잡만 고아", () => {
    expect(isOrphan(job(), false, T0 + 4 * 60_000)).toBe(true);
    expect(isOrphan(job(), false, T0 + 60_000)).toBe(false); // 하트비트 최근
    expect(isOrphan(job(), true, T0 + 60 * 60_000)).toBe(false); // 이 프로세스에서 도는 중
    expect(isOrphan(job({ status: "done" }), false, T0 + 60 * 60_000)).toBe(false);
  });
});

describe("envPositiveMs", () => {
  it("양수·유한만 받는다", () => {
    expect(envPositiveMs(undefined, 5)).toBe(5);
    expect(envPositiveMs("", 5)).toBe(5);
    expect(envPositiveMs("0", 5)).toBe(5);
    expect(envPositiveMs("-1", 5)).toBe(5);
    expect(envPositiveMs("Infinity", 5)).toBe(5);
    expect(envPositiveMs("x", 5)).toBe(5);
    expect(envPositiveMs("120000", 5)).toBe(120_000);
  });
});
