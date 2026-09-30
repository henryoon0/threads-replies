import { describe, expect, it } from "vitest";
import { PAST_HIT_KIND } from "./consistency-spans";
import { editorPaint, notesOnly } from "./editor-paint";
import { FACT_HIT_KIND } from "./fact-check";
import type { AnswerSource, ConsistencyHit, GateResult } from "./model";

const text = "위고비는 처방약이야. 철분은 하루 90mg 먹어. 링크는 https://x.co 봐.";
const gate: GateResult = {
  status: "block",
  hits: [
    { start: 0, end: 3, phrase: "위고비", kind: "처방약", action: "check", reason: "처방약 이름" },
    { start: 38, end: 51, phrase: "https://x.co", kind: "링크", action: "block", reason: "링크는 못 보내요" },
  ],
};
const factAt = text.indexOf("철분");
const facts = [{ start: factAt, end: factAt + 16, text: "철분은 하루 90mg 먹어.", reason: "자료에 없는 말: 90mg" }];
const source: AnswerSource = { id: "s1", kind: "paper", title: "철분 논문", quote: "철분 25mg", url: "https://doi.org/x" } as unknown as AnswerSource;
const past: ConsistencyHit[] = [
  { sentenceStart: 0, sentenceEnd: 11, note: "예전엔 처방약 얘기를 안 했어", past: { text: "처방은 병원에서", date: "2026-09-01" } } as ConsistencyHit,
];

describe("완성된 답 칠하기", () => {
  it("관문 확인은 칠하지 않고, 막음은 칸 아래 알림으로만", () => {
    const r = editorPaint({ text, gate, facts: [], sources: [], past: [], strict: true });
    expect(r.hits).toEqual([]);
    expect(r.notes?.map((n) => n.phrase)).toEqual(["https://x.co"]);
    expect(r.status).toBe("block");
  });
  it("근거 없음은 자료가 있을 때만, 자료 제목을 달고 칠한다", () => {
    expect(editorPaint({ text, gate: { status: "pass", hits: [] }, facts, sources: [], past: [], strict: false }).hits).toEqual([]);
    const r = editorPaint({ text, gate: { status: "pass", hits: [] }, facts, sources: [source], past: [], strict: false });
    expect(r.hits).toHaveLength(1);
    expect(r.hits[0]).toMatchObject({ kind: FACT_HIT_KIND });
    expect(r.hits[0].sources).toBeUndefined();
    expect(r.status).toBe("check");
  });
  it("예전 답과 다른 문장을 칠한다 (보내기는 막지 않음)", () => {
    const r = editorPaint({ text, gate: { status: "pass", hits: [] }, facts: [], sources: [], past, strict: true });
    expect(r.hits.map((h) => h.kind)).toEqual([PAST_HIT_KIND]);
    expect(r.status).toBe("check");
  });
  it("아무것도 없으면 통과", () => {
    expect(editorPaint({ text, gate: { status: "pass", hits: [] }, facts: [], sources: [], past: [], strict: true })).toEqual({ status: "pass", hits: [] });
    expect(notesOnly({ status: "check", hits: [gate.hits[0]] })).toEqual({ status: "pass", hits: [] });
  });
});
