import { describe, expect, it } from "vitest";
import { agoLabel, cardTriplets, groupBySection, heatOf, pendingDeck, phraseSegments, remainingMaterial, restat, type ReviewCard, type RuleRow } from "./learn-data";

const ex = (n: number) => ({ comment: `c${n}`, aiDraft: `d${n}`, final: `f${n}` });

function card(id: string, extra: Partial<ReviewCard> = {}): ReviewCard {
  return { id, type: "proposal", status: "open", proposal: null, patterns: [], evidence: [], safety: { locked: false }, ...extra } as ReviewCard;
}

describe("pendingDeck", () => {
  it("puts proposals first, patterns next, locked last and drops decided/skipped", () => {
    const cards = [
      card("pt-lock", { type: "pattern", status: "locked", safety: { locked: true, reason: "x" } }),
      card("pt-1", { type: "pattern" }),
      card("e1"),
      card("e2", { status: "applied" }),
      card("e3"),
    ];
    expect(pendingDeck(cards, new Set(["e3"])).map((c) => c.id)).toEqual(["e1", "pt-1", "pt-lock"]);
  });
});

describe("cardTriplets", () => {
  it("takes pattern examples first, fills from evidence, dedupes, caps at 3", () => {
    const c = card("e1", {
      patterns: [{ examples: [ex(1), ex(2)] } as never],
      evidence: [{ polarity: "negative", text: "", source: "", triplet: ex(2) }, { polarity: "positive", text: "", source: "", triplet: ex(3) }, { polarity: "positive", text: "", source: "", triplet: ex(4) }],
    });
    expect(cardTriplets(c).map((t) => t.final)).toEqual(["f1", "f2", "f3"]);
  });
});

describe("heatOf", () => {
  it("marks unused rules faint and colors by polarity", () => {
    expect(heatOf({ positive: 0, negative: 0, relevance: 0, sessions: 0 })).toMatchObject({ tone: "idle", faint: true });
    expect(heatOf({ positive: 3, negative: 0, relevance: 0.2, sessions: 3 })).toMatchObject({ tone: "positive", faint: false });
    expect(heatOf({ positive: 0, negative: 2, relevance: 0.02, sessions: 2 })).toMatchObject({ tone: "negative", faint: false });
    expect(heatOf({ positive: 1, negative: 1, relevance: 0.5, sessions: 2 }).tone).toBe("mixed");
  });
});

describe("groupBySection", () => {
  it("groups consecutive rules by last heading", () => {
    const r = (id: string, section: string) => ({ id, section }) as RuleRow;
    const g = groupBySection([r("a", "책 > 0. 숫자"), r("b", "책 > 0. 숫자"), r("c", "책 > 1. 말투")]);
    expect(g.map((s) => [s.title, s.rules.length])).toEqual([["0. 숫자", 2], ["1. 말투", 1]]);
  });
});

describe("phraseSegments", () => {
  it("splits reply around flagged phrases in order, ignoring missing/overlapping ones", () => {
    const segs = phraseSegments("이번 주 목요일 2024년", [
      { kind: "날짜·가격", phrase: "2024년" },
      { kind: "날짜·가격", phrase: "이번 주" },
      { kind: "날짜·가격", phrase: "주 목" },
      { kind: "날짜·가격", phrase: "없음" },
    ]);
    expect(segs.map((s) => [s.text, Boolean(s.reason)])).toEqual([["이번 주", true], [" 목요일 ", false], ["2024년", true]]);
  });
});

describe("voice stats", () => {
  it("recounts decisions and keeps masked replies as material", () => {
    const stats = restat({ total: 10, flagged: 3, excluded: 0, kept: 3, masked: 0 }, [{ decision: "exclude" }, { decision: "mask" }, { decision: "keep" }] as never);
    expect(stats).toMatchObject({ excluded: 1, kept: 1, masked: 1 });
    expect(remainingMaterial(stats)).toBe(9);
  });
});

describe("agoLabel", () => {
  it("formats relative time", () => {
    const now = Date.parse("2026-09-29T10:00:00Z");
    expect(agoLabel(null, now)).toBe("아직 안 돌렸어요");
    expect(agoLabel("2026-09-29T09:30:00Z", now)).toBe("30분 전");
    expect(agoLabel("2026-09-27T10:00:00Z", now)).toBe("2일 전");
  });
});
