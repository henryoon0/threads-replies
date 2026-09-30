import { describe, expect, it } from "vitest";
import {
  idfWeights,
  isoOrNull,
  knowledgeTerms,
  learnAllowed,
  learnBlockReason,
  rankLocal,
  retrievalTerms,
  replyRowsFromMyReplies,
  replyRowsFromQaPairs,
  replyRowToHit,
  toGroongaQuery,
} from "./rows";

describe("learnBlockReason (박약사 학습 제외)", () => {
  it.each([
    ["마운자로 저용량 조금씩 조절해서 맞아보는거 강추야", "처방약"],
    ["GLP-1 탈모용으로 나온 글리프 비오틴도 괜찮아", "처방약"],
    ["원래 사용방법은 2.5 4주하고, 5.0 4주하고, 셋째달부터 7.5로", "용량"],
    ["주사 용량은 천천히 올려", "용량"],
    ["제품은 비맥스 메타 추천이고 최소 3개월", "제품·브랜드"],
    ["쏜(Thorne)꺼 제품 아이허브에서 사-", "제품·브랜드"],
    ["아연 있는 제품은 이걸로 추천!", "제품·브랜드"],
  ])("blocks %s", (text, reason) => {
    expect(learnBlockReason(text)).toBe(reason);
  });

  it.each([
    "비타민B군 부족이면 피검사부터 해봐",
    "오메가3는 두통이랑은 큰 상관이 없을텐데 혹시 산패된거 아냐?",
    "연령대와 성별 알려줘-",
  ])("keeps %s", (text) => {
    expect(learnBlockReason(text)).toBeNull();
  });

  it("only blocks under the strict gate", () => {
    expect(learnAllowed("이 제품 추천해요", "light")).toBe(true);
    expect(learnAllowed("이 제품 추천해요", "strict")).toBe(false);
  });
});

describe("row builders", () => {
  it("pairs a reply with its comment by text+time and never stores the commenter", () => {
    const rows = replyRowsFromMyReplies(
      "aicc",
      [
        { id: "1", text: "저는 low 써요", timestamp: "2026-09-27T14:01:14+0000", permalink: "https://t/1", rootPostId: "p" },
        { id: "2", text: "다른 답", timestamp: "2026-09-27T15:00:00+0000" },
      ],
      [{ comment: "effort 뭐로 해요?", reply: "저는 low 써요", at: "2026-09-27T14:01:14+0000" }],
      { commentByReplyId: new Map([["2", "원장 댓글"]]), syncedAt: "2026-09-29T00:00:00.000Z" }
    );
    expect(rows[0]).toMatchObject({ id: "1", comment_body: "effort 뭐로 해요?", posted_at: "2026-09-27T14:01:14.000Z", learn: true });
    expect(rows[1].comment_body).toBe("원장 댓글");
    expect(JSON.stringify(rows)).not.toContain("commenter");
  });

  it("gives Q&A pairs a stable id and marks unsafe answers learn=false", () => {
    const pairs = [
      { q: "구내염 자주 나", a: "제품은 비맥스 메타 추천이야" },
      { q: "두통", a: "산패된거 아냐? 확인해봐-" },
    ];
    const a = replyRowsFromQaPairs("glp1", pairs);
    const b = replyRowsFromQaPairs("glp1", pairs);
    expect(a.map((r) => r.id)).toEqual(b.map((r) => r.id));
    expect(a.map((r) => r.learn)).toEqual([false, true]);
    expect(a[0]).toMatchObject({ persona_id: "glp1", comment_body: "구내염 자주 나", source: "collected" });
  });

  it("reads Graph +0000 timestamps", () => {
    expect(isoOrNull("2025-12-18T23:33:59+0000")).toBe("2025-12-18T23:33:59.000Z");
    expect(isoOrNull("nope")).toBeNull();
  });
});

describe("search terms", () => {
  it("strips particles and chatter", () => {
    expect(knowledgeTerms("클로드 effort 설정은 뭐로 하세요? 감사합니다 ㅎㅎ")).toEqual(["클로드", "effort", "설정"]);
  });

  it("strips endings brain.ts leaves, keeps short nouns, and maps common typos", () => {
    expect(knowledgeTerms("터치패드와 마이크가 기본이겠네요")).toEqual(["터치패드", "마이크", "기본"]);
    expect(knowledgeTerms("회사 일할땐 프롬포트를 해도 결과가 이상한거죠")).toEqual(["회사", "프롬프트", "결과"]);
  });

  it("weights rare terms above common ones", () => {
    const docs = ["결과 a", "결과 b", "결과 effort", "결과 d"];
    const w = idfWeights(docs, ["결과", "effort"]);
    expect(w.get("effort")!).toBeGreaterThan(w.get("결과")!);
    expect(idfWeights(docs, ["없는말"]).get("없는말")).toBe(0);
  });

  it("sends only the distinctive terms to retrieval", () => {
    const w = new Map([["클로드", 3.9], ["100달러", 8.4], ["오타", 0]]);
    expect(retrievalTerms(["클로드", "100달러", "오타"], w)).toEqual(["100달러"]);
    expect(retrievalTerms(["effort", "설정"], new Map([["effort", 6], ["설정", 4.7]]))).toEqual(["effort", "설정"]);
    expect(retrievalTerms(["a", "b"], null)).toEqual(["a", "b"]);
  });

  it("quotes terms for pgroonga and escapes quotes", () => {
    expect(toGroongaQuery(["effort", 'a"b'])).toBe('"effort" OR "a\\"b"');
  });

  it("ranks local rows body-first, then by date", () => {
    const hits = [
      replyRowToHit({ persona_id: "aicc", id: "c", body: "딴 얘기", comment_body: "effort 설정", posted_at: "2026-09-02T00:00:00Z", replied_to_id: null, root_post_id: null, permalink: null, source: "api", learn: true, synced_at: "" }),
      replyRowToHit({ persona_id: "aicc", id: "b", body: "effort 설정 medium", comment_body: null, posted_at: "2026-09-01T00:00:00Z", replied_to_id: null, root_post_id: null, permalink: null, source: "api", learn: true, synced_at: "" }),
      replyRowToHit({ persona_id: "aicc", id: "z", body: "커피", comment_body: null, posted_at: null, replied_to_id: null, root_post_id: null, permalink: null, source: "api", learn: true, synced_at: "" }),
    ];
    expect(rankLocal(hits, ["effort", "설정"], 5).map((h) => h.id)).toEqual(["b", "c"]);
  });
});
