import { describe, expect, it } from "vitest";
import type { ReplyAnswer } from "./model";
import { mergeLateConsistency } from "./late-consistency";

const base = { verdict: "answerable", verdictReason: "", sources: [], sentences: [], draft: "초안", model: "opus", generatedAt: "T1", styleExamples: 0 } as unknown as ReplyAnswer;
const hit = { sentenceStart: 0, sentenceEnd: 2, past: { text: "예전" }, note: "다름" } as never;

describe("mergeLateConsistency — 초안 먼저 저장, 대조는 나중에 붙인다 (10-02 속도)", () => {
  it("같은 초안이면 대조 결과를 붙인다", () => {
    const checked = { ...base, consistency: [hit], consistencyFor: "초안" };
    expect(mergeLateConsistency(base, checked)).toMatchObject({ consistency: [hit], consistencyFor: "초안" });
  });

  it("그사이 다시 써서 초안이 바뀌었으면 옛 대조를 붙이지 않는다", () => {
    const now = { ...base, generatedAt: "T2", draft: "새 초안" };
    const checked = { ...base, consistency: [hit], consistencyFor: "초안" };
    expect(mergeLateConsistency(now, checked)).toBe(now);
  });

  it("벌마다 붙은 대조는 같은 자리 벌에만 옮기고, 주인이 고친 draft 는 건드리지 않는다", () => {
    const now = { ...base, draft: "주인이 고친 글", options: [{ draft: "가" }, { draft: "나" }] } as unknown as ReplyAnswer;
    const checked = { ...base, options: [{ draft: "가", consistency: [hit] }, { draft: "나", consistency: [] }], consistency: [hit], consistencyFor: "초안" } as unknown as ReplyAnswer;
    const out = mergeLateConsistency(now, checked)!;
    expect(out.draft).toBe("주인이 고친 글");
    expect(out.options?.[0]).toMatchObject({ draft: "가", consistency: [hit] });
  });

  it("지금 답이 없으면(건너뜀·지움) 그대로", () => {
    expect(mergeLateConsistency(undefined, base)).toBeUndefined();
  });
});
