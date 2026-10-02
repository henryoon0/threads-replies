import { describe, expect, it } from "vitest";
import type { ReplyAnswer } from "./model";
import { isStaleJobDraft, usableDraft } from "./usable-draft";

const job = { draft: "옛 잡 글", aiDraft: "옛 잡 글", model: "claude", options: [{}, {}, {}] } as unknown as ReplyAnswer;

describe("usableDraft (10-02)", () => {
  it("옛 3벌 잡 글은 보여 주지 않는다", () => {
    expect(isStaleJobDraft(job)).toBe(true);
    expect(usableDraft(job)).toBe("");
  });
  it("버전 글(compose)·주인이 고친 글·주인이 쓴 글은 보여 준다", () => {
    expect(usableDraft({ ...job, compose: {} } as unknown as ReplyAnswer)).toBe("옛 잡 글");
    expect(usableDraft({ ...job, draft: "내가 고침" })).toBe("내가 고침");
    expect(usableDraft({ ...job, model: "henry" })).toBe("옛 잡 글");
  });
  it("3벌이 없는 한 벌짜리 답·답 없음", () => {
    expect(usableDraft({ draft: "한 벌" } as ReplyAnswer)).toBe("한 벌");
    expect(usableDraft(undefined)).toBe("");
  });
});
