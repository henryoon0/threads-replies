import { describe, expect, it } from "vitest";
import type { AnswerSource } from "./model";
import { dropUnsupported, factKind, removeFromDraft, sourceCorpus, unsupportedSpans, trustedContext, withFactHits } from "./fact-check";

// 실제 원장(2026-09-29)의 근거와 초안 문장
const claudeDevs: AnswerSource = {
  id: "s2",
  kind: "수집한 원문",
  title: "ClaudeDevs · Starting September 14, we're permanently raising standard weekly limits in Claud",
  quote: "Compared to today, this works out to a 17% reduction in weekly limits on Claude Code.",
  url: "https://x.com/ClaudeDevs/status/2093742321473065266",
};
const faq: AnswerSource = {
  id: "s1",
  kind: "FAQ",
  title: "한도에 걸리는 이유부터 나눠야, 100달러인지 200달러인지가 정해집니다",
  quote: "맞는 경우: 저녁이나 주말에 몰아서 2~4시간씩, 주 3~4회 작업하는 분. 수업 실습 기간에 만들 것이 쌓여 있는 분.",
};
const corpora = [claudeDevs, faq].map(sourceCorpus);

describe("factKind", () => {
  it("숫자·영문 이름 = 굳은 사실, 권유 = 사실 아님, 효과 주장 = 말랑한 사실", () => {
    expect(factKind("Claude Code 주간 한도가 17% 줄어든다고 하더라고요")).toBe("hard");
    expect(factKind("지금 요금제로 한 주 써보시고 어디서 한도에 걸리는지 보고 정해도 늦지 않을 것 같아요 ㅎㅎ")).toBe("none");
    expect(factKind("내가 알기론 베타카로틴 고용량이 흡연자한테 안 좋다는 얘기가 있어.")).toBe("soft");
    expect(factKind("1/ 성분표에 베타카로틴 있는지만 확인해봐.")).toBe("none");
  });
});

describe("dropUnsupported", () => {
  it("인용에 17%·Claude Code 가 있으면 남긴다", () => {
    const { kept, dropped } = dropUnsupported([{ text: "Claude Code 주간 한도가 17% 줄어든다고 하더라고요", sourceIds: ["s2"] }], corpora, "");
    expect(dropped).toEqual([]);
    expect(kept).toHaveLength(1);
  });

  it("사실이 아닌 권유 문장은 근거 없이도 남긴다", () => {
    const s = { text: "지금 요금제로 한 주 써보시고 어디서 한도에 걸리는지 보고 정해도 늦지 않을 것 같아요 ㅎㅎ", sourceIds: [] };
    expect(dropUnsupported([s], corpora, "").dropped).toEqual([]);
  });

  it("인용에 없는 숫자는 뺀다", () => {
    const { kept, dropped } = dropUnsupported([{ text: "Max 요금제는 한도가 40% 더 넉넉해요.", sourceIds: ["s2"] }], corpora, "");
    expect(kept).toEqual([]);
    expect(dropped[0].reason).toMatch(/40/);
  });

  it("FAQ 의 2~4시간·주 3~4회·제목의 100달러는 근거 있음", () => {
    const s = { text: "저녁이나 주말에 몰아서 2~4시간씩 주 3~4회 작업하시면 100달러가 맞는 경우라고 봐요.", sourceIds: ["s1"] };
    expect(dropUnsupported([s], corpora, "").dropped).toEqual([]);
  });

  it("근거 id 없이 효과를 말하면 뺀다 (박약사 실제 초안)", () => {
    const s = { text: "내가 알기론 베타카로틴 고용량이 흡연자한테 안 좋다는 얘기가 있어.", sourceIds: [] };
    expect(dropUnsupported([s], corpora, "").dropped).toHaveLength(1);
  });

  it("댓글이 먼저 말한 숫자를 되풀이하는 건 지어낸 게 아니다", () => {
    const s = { text: "2.5로 3개월이면 아직 몸이 적응하는 중일 수 있어.", sourceIds: [] };
    expect(dropUnsupported([s], corpora, "마운자로 2.5로 3개월 가까이 했는데").dropped).toEqual([]);
  });
});

describe("removeFromDraft", () => {
  it("뺀 문장만 지우고 줄 모양은 남긴다", () => {
    const draft = "지금 조합 잘 짰어.\n\n1/ 베타카로틴 고용량이 안 좋대. 성분표 확인해봐.\n\n금연이 최고야!";
    const out = removeFromDraft(draft, [{ text: "1/ 베타카로틴 고용량이 안 좋대.", reason: "" }], []);
    expect(out).toBe("지금 조합 잘 짰어.\n\n성분표 확인해봐.\n\n금연이 최고야!");
  });
});

describe("unsupportedSpans", () => {
  it("완성된 답에 다시 써 넣은 근거 없는 숫자 문장을 칠한다", () => {
    const text = "Claude Code 한도가 17% 줄었대요. 다음 달엔 50% 더 줄어요.";
    const spans = unsupportedSpans(text, [claudeDevs], "");
    expect(spans.map((s) => text.slice(s.start, s.end))).toEqual(["다음 달엔 50% 더 줄어요."]);
  });
});

describe("withFactHits", () => {
  const text = "Claude Code 한도가 17% 줄었대요. 다음 달엔 50% 더 줄어요.";
  const spans = unsupportedSpans(text, [claudeDevs], "");
  it("strict 계정은 막고, 아니면 확인만", () => {
    expect(withFactHits({ status: "pass", hits: [] }, spans, true).status).toBe("block");
    expect(withFactHits({ status: "pass", hits: [] }, spans, false)).toMatchObject({ status: "check", hits: [{ kind: "근거 없는 사실", action: "check" }] });
  });
  it("관문이 칠한 구간과 겹치면 관문 쪽만 남긴다", () => {
    const gate = { status: "check" as const, hits: [{ start: text.indexOf("50%"), end: text.indexOf("50%") + 3, phrase: "50%", kind: "x", action: "check" as const, reason: "r" }] };
    expect(withFactHits(gate, spans, true)).toBe(gate);
  });
});

describe("trustedContext", () => {
  const sources = [{ id: "s1", title: "소화효소", quote: "소화효소는 식후에", url: "", kind: "web" }] as unknown as Parameters<typeof unsupportedSpans>[1];
  const draft = "직구는 쏜 아이언 25mg이야. 셀렉스 한 통 3만원이야.";

  it("주인이 예전에 단 답·제품 창고에 있는 숫자·이름은 칠하지 않고, 어디에도 없는 것만 칠한다", () => {
    const context = trustedContext({
      thread: ["철분 뭐 먹어?"],
      pastSaid: [{ text: "나는 25mg짜리 먹어" }],
      products: [{ name: "쏜 아이언 비스글리시네이트", brand: "Thorne", ingredient: "철분", note: "" }],
    });
    const painted = unsupportedSpans(draft, sources, context).map((s) => s.text);
    expect(painted).toEqual(["셀렉스 한 통 3만원이야."]);
  });
});

describe("화면 스크린샷 사례 (09-30)", () => {
  const sources = [{ id: "s1", title: "소화효소", quote: "소화효소는 식후에", url: "", kind: "web" }] as unknown as Parameters<typeof unsupportedSpans>[1];
  it("2.5·20~30g 안에서 문장을 자르지 않고, 못 찾은 말을 낱말째 보여준다", () => {
    const text = "2.5는 4주짜리 적응용이라 이번에도 2.5로 4주 하고 제때 5로 올려. 단백질은 끼니마다 20~30g씩 챙겨.";
    const spans = unsupportedSpans(text, sources, "2.5 맞고 있어요");
    expect(spans.map((s) => s.text)).toEqual(["2.5는 4주짜리 적응용이라 이번에도 2.5로 4주 하고 제때 5로 올려."]);
    expect(spans[0].missing).toEqual(["4주짜리", "5로"]);
  });
});

describe("위험한 말만 칠한다 (09-30)", () => {
  const sources = [{ id: "s1", title: "소화효소", quote: "소화효소는 식후에", url: "", kind: "web" }] as unknown as Parameters<typeof unsupportedSpans>[1];
  it("약 용량 문장은 칠하고 영양·제품 그램 수는 칠하지 않는다", () => {
    const text =
      "2.5는 4주짜리 적응용이라 이번에도 2.5로 4주 하고 제때 5로 올려. 단백질은 끼니마다 20~30g씩 챙겨. 한 병에 20g이라 밥 거른 끼니에 하나. 1스쿱 24g, 아침에 물에 타서 먹어.";
    const painted = unsupportedSpans(text, sources, "2.5 맞고 있어요").map((s) => s.text);
    expect(painted).toEqual(["2.5는 4주짜리 적응용이라 이번에도 2.5로 4주 하고 제때 5로 올려."]);
  });
  it("돈·mg 단위가 붙으면 약 문장이 아니어도 칠한다", () => {
    expect(unsupportedSpans("철분은 하루 90mg 먹어.", sources, "")).toHaveLength(1);
    expect(unsupportedSpans("한 통에 3만원이야.", sources, "")).toHaveLength(1);
  });
});
