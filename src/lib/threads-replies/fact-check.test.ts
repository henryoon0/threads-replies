import { describe, expect, it } from "vitest";
import type { AnswerSource } from "./model";
import { dropUnsupported, factKind, removeFromDraft, sourceCorpus, trustedContext, unsupportedSpans } from "./fact-check";

const limits: AnswerSource = {
  id: "s2",
  kind: "수집한 원문",
  title: "Weekly limits update",
  quote: "Compared to today, this works out to a 17% reduction in weekly limits on Claude Code.",
};
const faq: AnswerSource = {
  id: "s1",
  kind: "내 자료",
  title: "한도에 걸리는 이유부터 나눠야, 100달러인지 200달러인지가 정해집니다",
  quote: "맞는 경우: 저녁이나 주말에 몰아서 2~4시간씩, 주 3~4회 작업하는 분.",
};
const corpora = [limits, faq].map(sourceCorpus);

describe("factKind", () => {
  it("숫자·영문 이름 = 굳은 사실, 권유 = 사실 아님, 효과 주장 = 말랑한 사실", () => {
    expect(factKind("Claude Code 주간 한도가 17% 줄어든다고 하더라고요")).toBe("hard");
    expect(factKind("지금 요금제로 한 주 써보시고 정해도 늦지 않을 것 같아요 ㅎㅎ")).toBe("none");
    expect(factKind("내가 알기론 그 설정이 속도 개선에 효과가 있다는 얘기가 있어.")).toBe("soft");
    expect(factKind("1/ 설정 화면에 그 메뉴가 있는지만 확인해봐.")).toBe("none");
  });
});

describe("dropUnsupported", () => {
  it("인용에 17%·Claude Code 가 있으면 남긴다", () => {
    const { kept, dropped } = dropUnsupported([{ text: "Claude Code 주간 한도가 17% 줄어든다고 하더라고요", sourceIds: ["s2"] }], corpora, "");
    expect(dropped).toEqual([]);
    expect(kept).toHaveLength(1);
  });

  it("사실이 아닌 권유 문장은 근거 없이도 남긴다", () => {
    const s = { text: "지금 요금제로 한 주 써보시고 정해도 늦지 않을 것 같아요 ㅎㅎ", sourceIds: [] };
    expect(dropUnsupported([s], corpora, "").dropped).toEqual([]);
  });

  it("인용에 없는 숫자는 뺀다", () => {
    const { kept, dropped } = dropUnsupported([{ text: "Max 요금제는 한도가 40% 더 넉넉해요.", sourceIds: ["s2"] }], corpora, "");
    expect(kept).toEqual([]);
    expect(dropped[0].reason).toMatch(/40/);
  });

  it("근거 id 없이 효과를 말하면 뺀다", () => {
    const s = { text: "내가 알기론 그 설정이 속도 개선에 효과가 있다는 얘기가 있어.", sourceIds: [] };
    expect(dropUnsupported([s], corpora, "").dropped).toHaveLength(1);
  });

  it("댓글이나 예전 답이 먼저 말한 숫자를 되풀이하는 건 지어낸 게 아니다", () => {
    const s = { text: "3개월이면 아직 익숙해지는 중일 수 있어요.", sourceIds: [] };
    const context = trustedContext({ thread: ["배운 지 3개월 됐는데 아직 어렵네요"] });
    expect(dropUnsupported([s], corpora, context).dropped).toEqual([]);
  });
});

describe("removeFromDraft", () => {
  it("뺀 문장만 지우고 줄 모양은 남긴다", () => {
    const draft = "좋은 질문이에요.\n\n1/ 그 기능은 40% 빨라요. 설정 확인해봐요.\n\n화이팅!";
    const out = removeFromDraft(draft, [{ text: "1/ 그 기능은 40% 빨라요.", reason: "" }], []);
    expect(out).toBe("좋은 질문이에요.\n\n설정 확인해봐요.\n\n화이팅!");
  });
});

describe("unsupportedSpans", () => {
  it("완성된 답의 근거 없는 숫자 문장을 찾는다", () => {
    const text = "Claude Code 한도가 17% 줄었대요. 다음 달엔 50% 더 줄어요.";
    const spans = unsupportedSpans(text, [limits], "");
    expect(spans.map((s) => text.slice(s.start, s.end))).toEqual(["다음 달엔 50% 더 줄어요."]);
  });
});
