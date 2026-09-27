import { describe, expect, it } from "vitest";
import { formatVoiceStats, measureVoice } from "./voice-stats";

describe("말투 숫자 재기", () => {
  it("길이·끝맺음·이모지·띄운 느낌표를 잰다", () => {
    const s = measureVoice(["네 맞아요 !", "감사해요 💌", "헐 대박..", "좋아요"], [{ comment: "좋아요", reply: "네 맞아요 !" }]);
    expect(s.replies).toBe(4);
    expect(s.withEmoji).toBe(1);
    expect(s.spacedBang).toBe(1);
    expect(s.emojis[0][0]).toBe("💌");
    expect(formatVoiceStats(s)).toContain("내 답글 4개");
  });

  it("답글이 없어도 깨지지 않는다", () => {
    expect(formatVoiceStats(measureVoice([], []))).toContain("없음");
  });
});
