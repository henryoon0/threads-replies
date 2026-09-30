import { describe, expect, it } from "vitest";
import {
  defaultDecisionFor,
  exclusionStats,
  flagReply,
  learnablePairs,
  maskReply,
  pairId,
  reviewPair,
  ruleSetFor,
  splitSentences,
  validateDecision,
  type OwnerPair,
} from "./voice-exclusions";

// 박약사 실제 답 (data/domains/wellness/threads-comments/glp1-pharmacy-qa-pairs.json)
const REAL = {
  dose: {
    comment: "나 마운자로 5맞는데 식탐이 강해 위고비로 바꾸려고 위고비 몃으로 바꾸면 비슷한 수준이아?",
    reply: "위고비 1mg 이랑 마운자로 5mg이 같다고 보면 돼",
  },
  vmax: {
    comment: "조금만 피곤해도 설염 구내염 ㅠ 자주나.. 항상 피곤해ㅠㅠ 뭐가 좋아 ?",
    reply: "비타민B군 부족이랑 철분/아연 챙겨먹어. 특히 비타민B2가 중요해. 제품은 비맥스 메타 추천이고 최소 3개월 꾸준히 먹어봐.",
  },
  thorne: {
    comment: "마그네슘  글리시네이트 성분 어디회사껄로 사야해?",
    reply: "성분을 찾는거야 제품을 찾는거야? 제품 찾는거면 쏜(Thorne)꺼 제품 아이허브에서 사- 우리집은 다 이거먹어-",
  },
  inositol: {
    comment: "다낭성이 없는 사람은 이노시톨 먹으면 생리주기 뒤틀리거나 부정출혈이 있다는 사람도 있고….",
    reply: "이노시톨은 다낭성 있는 사람에게만 효과가 검증된 약이야. 그렇다고 다낭성이 없다고 꼭 출혈로 연결되지는 않을꺼야. 다만 내가 스친이 상태를 알수가 없으니 꼭 의사쌤한테 가서 상담해봐-",
  },
  hairloss: {
    comment: "마운자로 땜에 머리빠지는 것 같은데 탈모약 먹어야해?",
    reply: "마운자로 맞고 탈모가 오는건, 몸에 영양분이 부족하니 그런거야. 사실 영양보충이 젤 중요해. 심하면 판시딜 먹고, 조금 빠지는 듯한 느낌이면 비오틴 정도 먹어줘.",
  },
  sideEffect: {
    comment: "남편이 마운자로 3펜 맞고 기립성 저혈압이 갑저기 생겨서 힘들오하고 있어 이 증상 없어져?",
    reply: "마운자로 맞으면 기본적으로 수분이 적어져서 혈액량이 줄어들고 혈압이 내려가. 그래서 저혈압 증세가 오는거야. 해결하려면 잘 안들어가도 물을 많이 먹어야돼.",
  },
  titrate: {
    comment: "마운자로5를 2개월전까지 해서 10키로쯤 빼고 쉬고있는데 다시 시작하면서7.5로 올려도 될까?",
    reply: "두달쉬었으면 바로 7.5가면 엄청 힘들어. 처음 맞았을때보다 힘들 수 있어서 5로만 시작해도 바로 느낌올꺼야. 천천히 올리는거 추천이야-",
  },
  askBack: {
    comment: "마운자로 3.16시작. 마운자로+런닝조합 좋습니다",
    reply: "진짜 교과서다. 스친이 훌륭해- 용량은 언제 올렸어?",
  },
};

const kinds = (comment: string, reply: string) => flagReply("pharmacy", comment, reply).map((r) => r.kind);

describe("flagReply · 박약사 (pharmacy)", () => {
  it("처방약 용량 비교를 표시하되 잠그지 않고 그대로 배운다 (09-30 henry: 용량도 상황 판단)", () => {
    const reasons = flagReply("pharmacy", REAL.dose.comment, REAL.dose.reply);
    expect(reasons[0]).toEqual({ kind: "처방약 용량·선택", phrase: "1mg" });
    const review = reviewPair({ id: "a", ...REAL.dose }, "pharmacy");
    expect(review).toMatchObject({ locked: false, decision: "keep", defaultDecision: "keep" });
  });

  it("제품 권유(비맥스)는 표시만 하고 그대로 배운다 (09-29 운영자: 제품 추천 허용)", () => {
    const reasons = flagReply("pharmacy", REAL.vmax.comment, REAL.vmax.reply);
    expect(reasons).toContainEqual({ kind: "제품·구매처", phrase: "비맥스" });
    expect(reviewPair({ id: "b", ...REAL.vmax }, "pharmacy").decision).toBe("keep");
  });

  it("브랜드·구매처(쏜·아이허브)를 잡는다", () => {
    const reasons = flagReply("pharmacy", REAL.thorne.comment, REAL.thorne.reply);
    expect(reasons.map((r) => r.kind)).toContain("제품·구매처");
    expect(reasons.map((r) => r.phrase).join(" ")).toMatch(/쏜|Thorne|아이허브/);
  });

  it("성분 설명만 한 답은 잡지 않는다 (이노시톨)", () => {
    expect(flagReply("pharmacy", REAL.inositol.comment, REAL.inositol.reply)).toEqual([]);
    const review = reviewPair({ id: "c", ...REAL.inositol }, "pharmacy");
    expect(review).toMatchObject({ decision: "keep", locked: false, reasons: [] });
  });

  it("약 이름 권유(판시딜)를 잡는다", () => {
    expect(kinds(REAL.hairloss.comment, REAL.hairloss.reply)).toContain("약 이름");
    expect(defaultDecisionFor(flagReply("pharmacy", REAL.hairloss.comment, REAL.hairloss.reply))).toBe("keep");
  });

  it("처방약 부작용 설명은 언급으로만 두고 그대로 배운다 (혈압이 '내려가' 는 용량이 아니다)", () => {
    const reasons = flagReply("pharmacy", REAL.sideEffect.comment, REAL.sideEffect.reply);
    expect(reasons).toEqual([{ kind: "처방약 언급", phrase: "마운자로" }]);
    expect(defaultDecisionFor(reasons)).toBe("keep");
  });

  it("답에 약 이름이 없어도 댓글이 처방약이면 용량 조언을 잡는다", () => {
    expect(kinds(REAL.titrate.comment, REAL.titrate.reply)).toContain("처방약 용량·선택");
  });

  it("되묻는 문장은 용량 조언으로 치지 않는다", () => {
    expect(kinds(REAL.askBack.comment, REAL.askBack.reply)).not.toContain("처방약 용량·선택");
  });
});

describe("flagReply · AICC (stale-facts)", () => {
  it("날짜·기수·가격을 확인 대상으로만 잡는다", () => {
    const reasons = flagReply("stale-facts", "언제 해요?", "5월 9일에 진행됩니다 !!!! 카톡으로 문의주세요 💌");
    expect(reasons).toEqual([{ kind: "날짜·가격", phrase: "5월 9일" }]);
    expect(defaultDecisionFor(reasons)).toBe("keep");
    expect(flagReply("stale-facts", "x", "4기는 이미 마감되었고 5기만 신청 가능해요 !!")[0].kind).toBe("날짜·가격");
    expect(flagReply("stale-facts", "x", "가격은 29,000원이에요")[0].phrase).toBe("29,000원");
  });

  it("날짜 없는 답은 잡지 않는다", () => {
    expect(flagReply("stale-facts", "좋은 글 감사합니다", "감사합니다 ㅎㅎ 💌")).toEqual([]);
  });

  it("관문 종류로 규칙을 고른다", () => {
    expect(ruleSetFor({ gate: "strict" })).toBe("pharmacy");
    expect(ruleSetFor({ gate: "light" })).toBe("stale-facts");
  });
});

describe("결정 · 가림 · 배울 답", () => {
  const pairs: OwnerPair[] = [
    { id: "dose", ...REAL.dose },
    { id: "vmax", ...REAL.vmax },
    { id: "ok", ...REAL.inositol },
  ];

  it("용량 답도 주인이 제외·가림을 고를 수 있고, 걸린 게 없는 답은 결정할 게 없다", () => {
    const dose = reviewPair(pairs[0], "pharmacy");
    expect(validateDecision(dose, "keep")).toBeNull();
    expect(validateDecision(dose, "exclude")).toBeNull();
    expect(validateDecision(reviewPair(pairs[2], "pharmacy"), "exclude")).toMatch(/대상이 아닌/);
  });

  it("주인이 뺀 용량 답은 빠진다", () => {
    const r = reviewPair(pairs[0], "pharmacy", { decision: "exclude", at: "t" });
    expect(r).toMatchObject({ decision: "exclude", decidedBy: "owner" });
  });

  it("주인 결정이 기본값을 이긴다 · mask 는 걸린 표현을 ○○ 로 가린다", () => {
    const vmax = reviewPair(pairs[1], "pharmacy", { decision: "mask", at: "t" });
    expect(vmax).toMatchObject({ decision: "mask", decidedBy: "owner" });
    const reviews = new Map([pairs[0], pairs[1], pairs[2]].map((p) => [p.id, p.id === "vmax" ? vmax : reviewPair(p, "pharmacy")]));
    const learn = learnablePairs(pairs, reviews);
    expect(learn.map((p) => p.id)).toEqual(["dose", "vmax", "ok"]);
    expect(learn[1].reply).toContain("제품은 ○○ 메타 추천");
    expect(learn[1].reply).not.toContain("비맥스");
  });

  it("maskReply 는 긴 표현부터 가린다", () => {
    expect(maskReply("쏜 Thorne Iron 좋아", [{ kind: "제품·구매처", phrase: "Thorne Iron" }, { kind: "제품·구매처", phrase: "쏜" }])).toBe("○○ ○○ 좋아");
  });

  it("통계: 전체·걸림·제외·유지·가림", () => {
    const rs = pairs.map((p) => reviewPair(p, "pharmacy"));
    expect(exclusionStats(rs)).toEqual({ total: 3, flagged: 2, excluded: 0, kept: 2, masked: 0 });
  });
});

describe("pairId · splitSentences", () => {
  it("내용이 같으면 같은 id, 다르면 다른 id", () => {
    expect(pairId("a", "b")).toBe(pairId(" a ", "b "));
    expect(pairId("a", "b")).not.toBe(pairId("a", "c"));
    expect(pairId("a", "b")).toMatch(/^v[0-9a-f]{10}$/);
  });

  it("2.5mg 의 점에서 자르지 않고, 물음표 문장을 표시한다", () => {
    const s = splitSentences("원래 약이 2.5mg 4주 맞고. 용량은 언제 올렸어? 알려줘-");
    expect(s.map((x) => x.text)).toEqual(["원래 약이 2.5mg 4주 맞고.", "용량은 언제 올렸어?", "알려줘-"]);
    expect(s.map((x) => x.question)).toEqual([false, true, false]);
  });
});
