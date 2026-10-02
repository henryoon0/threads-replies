import { describe, expect, it } from "vitest";
import { DEFAULT_PERSONAS } from "@/lib/personas/model";
import { autoDraftPolicy } from "./auto-draft-policy";

describe("자동으로 AI 를 돌리는 범위 (10-02 비용 줄이기 1~3)", () => {
  it("근거 캡처를 안 쓰는 계정(박약사)은 답 초안 잡을 돌리지 않는다 — 화면은 버전 글만 보여 준다", () => {
    expect(autoDraftPolicy(DEFAULT_PERSONAS.glp1).answerJob).toBe(false);
  });

  it("AICC 도 답 초안 잡을 돌리지 않는다 (10-02 henry \"AICC 만 돌릴 필요 없어\") — 근거 캡처 자동 첨부는 함께 꺼진다", () => {
    expect(autoDraftPolicy(DEFAULT_PERSONAS.aicc).answerJob).toBe(false);
  });

  it("목록을 열 때 대기 댓글 전부를 미리 쓰지 않는다 — 화면이 보내는 '지금 보는 댓글부터 10개'만", () => {
    expect(autoDraftPolicy(DEFAULT_PERSONAS.glp1).prefetchAllOnOpen).toBe(false);
    expect(autoDraftPolicy(DEFAULT_PERSONAS.aicc).prefetchAllOnOpen).toBe(false);
  });

  it("예전 답 대조는 자동으로 돌리지 않는다 — 보여 주는 화면이 없다", () => {
    expect(autoDraftPolicy(DEFAULT_PERSONAS.aicc).autoConsistency).toBe(false);
  });
});
