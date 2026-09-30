import { describe, expect, it } from "vitest";
import type { KnowledgeHit } from "@/lib/personas/knowledge/rows";
import {
  buildStancePrompt,
  clampCitations,
  excerptAround,
  fallbackTopic,
  hasSubstance,
  normalizeStance,
  pickStanceHits,
  toStanceItems,
} from "./stance";

function hit(over: Partial<KnowledgeHit> & { id: string; body: string }): KnowledgeHit {
  return { kind: "reply", learn: true, score: 1, ...over };
}

describe("clampCitations", () => {
  it("keeps citations inside 1..n and drops the rest", () => {
    expect(clampCitations("low 를 써요 [1][3]. 가끔 high [0] [7].", 3)).toBe("low 를 써요 [1][3]. 가끔 high.");
  });

  it("spreads a comma list and still checks each number", () => {
    expect(clampCitations("medium 이 기본이에요 [1, 2, 9].", 2)).toBe("medium 이 기본이에요 [1][2].");
  });
});

describe("normalizeStance", () => {
  it("cuts the topic to 12 characters and the summary to two sentences", () => {
    const raw = JSON.stringify({
      topic: "클로드 effort 설정과 속도 이야기",
      summary: "medium 을 기본으로 써 왔어요 [1]. 긴 글에만 high 를 권했어요 [2]. 세 번째 문장 [1].",
    });
    const out = normalizeStance(raw, 2);
    expect(Array.from(out.topic).length).toBeLessThanOrEqual(12);
    expect(out.summary).toBe("medium 을 기본으로 써 왔어요 [1]. 긴 글에만 high 를 권했어요 [2].");
  });

  it("drops a summary whose citations are all out of range", () => {
    const raw = '```json\n{"topic":"주제","summary":"근거 없는 말이에요 [5]."}\n```';
    expect(normalizeStance(raw, 2)).toEqual({ topic: "주제", summary: "" });
  });

  it("returns empty fields for output that is not JSON", () => {
    expect(normalizeStance("모르겠어요", 3)).toEqual({ topic: "", summary: "" });
  });

  it("does not split between a sentence and its trailing citation", () => {
    const raw = JSON.stringify({ topic: "t", summary: "첫 문장이에요. [1] 둘째 문장이에요. [2] 셋째. [1]" });
    expect(normalizeStance(raw, 2).summary).toBe("첫 문장이에요. [1] 둘째 문장이에요. [2]");
  });
});

describe("pickStanceHits", () => {
  const terms = ["effort", "설정", "medium"];

  it("drops learn=false rows, excluded ids, thank-you replies and one-term matches", () => {
    const replies = [
      hit({ id: "a", body: "effort 설정은 medium 이 제일 무난해요" }),
      hit({ id: "b", body: "effort 설정 올리면 느려져요 그래도 좋아요", learn: false }),
      hit({ id: "c", body: "감사합니다 ㅎㅎ", commentBody: "effort 설정 뭐로 하세요?" }),
      hit({ id: "d", body: "저는 effort 만 바꿔 써요 요즘은요" }),
      hit({ id: "e", body: "저는 low 로 써요 ㅎㅎ 빠르거든요", commentBody: "effort 설정 뭐로 하세요?" }),
      hit({ id: "f", body: "effort 설정 medium 으로 둬요 지금도요" }),
    ];
    const got = pickStanceHits(replies, [], terms, { excludeIds: ["f"] }).map((h) => h.id);
    expect(got).toEqual(["a", "e"]);
  });

  it("puts replies first and caps replies at 4, posts at 2, total at 5", () => {
    const replies = Array.from({ length: 6 }, (_, i) => hit({ id: `r${i}`, body: `effort 설정 이야기 번호 ${i} 입니다` }));
    const posts = Array.from({ length: 3 }, (_, i) => hit({ id: `p${i}`, kind: "post", body: `effort 설정 글 번호 ${i} 입니다` }));
    const got = pickStanceHits(replies, posts, terms);
    expect(got.map((h) => h.kind)).toEqual(["reply", "reply", "reply", "reply", "post"]);
  });

  it("ranks rare-word matches above common-word matches and drops duplicate paragraphs", () => {
    const weights = new Map([["결과", 1], ["회사", 2], ["프롬프트", 3]]);
    const replies = [
      hit({ id: "common", body: "회사 결과 이야기 조금 길게 씁니다", score: 9 }),
      hit({ id: "rare", body: "프롬프트 결과 차이는 맥락에서 와요", score: 1 }),
      hit({ id: "dup", body: "프롬프트 결과 차이는 맥락에서 와요!", score: 1 }),
    ];
    const got = pickStanceHits(replies, [], ["회사", "프롬프트", "결과"], { weights }).map((h) => h.id);
    expect(got).toEqual(["rare", "common"]);
  });

  it("drops items that only share a common word when a rare word defines the topic", () => {
    const weights = new Map([["클로드", 3.9], ["100달러", 8.4]]);
    const replies = [
      hit({ id: "skill", body: "클로드 스킬은 계속 정리해야 해요" }),
      hit({ id: "price", body: "클로드 맥스 100달러 요금제로 바꿨어요" }),
    ];
    expect(pickStanceHits(replies, [], ["클로드", "100달러"], { weights }).map((h) => h.id)).toEqual(["price"]);
  });

  it("accepts a single matched term when the query has only two terms", () => {
    const got = pickStanceHits([hit({ id: "x", body: "effort 는 low 로 두고 써요" })], [], ["effort", "설정"]);
    expect(got).toHaveLength(1);
  });
});

describe("items and prompt", () => {
  it("numbers items from 1 and keeps date and permalink", () => {
    const items = toStanceItems(
      [hit({ id: "a", body: "effort 이야기", postedAt: "2026-09-03T01:00:00.000Z", permalink: "https://t/1" }), hit({ id: "b", body: "둘째" })],
      ["effort"]
    );
    expect(items).toEqual([
      { n: 1, text: "effort 이야기", date: "2026-09-03", permalink: "https://t/1" },
      { n: 2, text: "둘째" },
    ]);
  });

  it("shows the matched part of a long post", () => {
    const long = `${"가".repeat(400)} 핵심은 effort 설정입니다 ${"나".repeat(400)}`;
    const out = excerptAround(long, ["effort"], 80);
    expect(out).toContain("effort");
    expect(out.startsWith("…")).toBe(true);
    expect(out.endsWith("…")).toBe(true);
  });

  it("builds a prompt that lists every item with its number and the owner name", () => {
    const hits = [hit({ id: "a", body: "medium 이 기본이에요", commentBody: "effort 뭐로 해요?" }), hit({ id: "b", kind: "post", body: "긴 글은 high" })];
    const prompt = buildStancePrompt({ ownerName: "henry", commentText: "effort 설정 궁금해요", hits, items: toStanceItems(hits, []) });
    expect(prompt).toContain("henry이(가)");
    expect(prompt).toContain("[1] (내 답글 — 받은 댓글(맥락일 뿐): «effort 뭐로 해요?»)");
    expect(prompt).toContain("[2] (내 글)");
    expect(prompt).toContain("12자 이내");
  });

  it("hasSubstance rejects emoji and thanks, keeps real sentences", () => {
    expect(hasSubstance("감사합니다!! ㅎㅎ")).toBe(false);
    expect(hasSubstance("ㅋㅋㅋㅋ 🙏")).toBe(false);
    expect(hasSubstance("저는 low 로 써요 ㅎㅎ")).toBe(true);
  });

  it("fallbackTopic joins the first two terms within 12 characters", () => {
    expect(fallbackTopic(["effort", "설정", "medium"])).toBe("effort 설정");
    expect(Array.from(fallbackTopic(["아주아주긴낱말하나", "또긴낱말둘셋넷"])).length).toBe(12);
  });
});
