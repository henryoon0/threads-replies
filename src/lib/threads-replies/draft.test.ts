import { describe, expect, it } from "vitest";
import { buildAnswerPrompt, generateAnswer, normalizeAnswer, POST_SOURCE_ID } from "./draft";
import type { AnswerSource, ThreadsPostRef, ThreadsReply } from "./model";

const post: ThreadsPostRef = {
  id: "P1",
  text: "Claude Code effort 설정을 11가지로 정리했습니다.",
  timestamp: "2026-09-26T01:00:04+0000",
  permalink: "https://www.threads.com/@aicoffeechat/post/X",
};

function reply(text: string, intent: ThreadsReply["intent"] = "question"): ThreadsReply {
  return {
    id: "R1",
    postId: "P1",
    username: "someone",
    text,
    timestamp: "2026-09-26T02:00:00+0000",
    repliedToId: "P1",
    intent,
  };
}

const sources: AnswerSource[] = [
  { id: "s1", kind: "원글 원본", title: "Thariq 글", quote: "I use low effort for most edits.", url: "https://x.com/a/1" },
];

const ctx = (question: boolean) => ({
  question,
  sources,
  post,
  model: "claude-opus-5-5",
  generatedAt: "2026-09-27T00:00:00.000Z",
  styleExamples: 3,
});

describe("buildAnswerPrompt", () => {
  it("질문이면 근거 블록에 원문 인용과 내 글(p)을 번호로 싣는다", () => {
    const p = buildAnswerPrompt({
      reply: reply("low는 언제 쓰나요?"),
      post,
      sources,
      styleBook: "# 규칙책",
      examples: [{ comment: "되나요?", reply: "네 맞아요 !", at: "2026-01-01", situation: "question_fact" }],
      situation: "question_fact",
      owner: { username: "tester", intro: "" },
    });
    expect(p).toContain('<source id="s1"');
    expect(p).toContain("I use low effort for most edits.");
    expect(p).toContain(`<source id="${POST_SOURCE_ID}"`);
    expect(p).toContain("<owner_reply>네 맞아요 !</owner_reply>");
    expect(p).toContain("# 규칙책");
    expect(p).toContain('"verdict"');
  });

  it("반응 댓글이면 근거 블록 없이 짧은 답만 요구한다", () => {
    const p = buildAnswerPrompt({
      reply: reply("좋은 글 감사합니다!", "reaction"),
      post,
      sources,
      styleBook: "",
      examples: [],
      situation: "thanks",
      owner: { username: "tester", intro: "" },
    });
    expect(p).not.toContain("<sources>");
    expect(p).toContain("반응 댓글");
  });

  it("henry 메모와 요청을 싣는다", () => {
    const p = buildAnswerPrompt({
      reply: reply("어떤 설정 쓰세요?"),
      post,
      sources: [],
      styleBook: "",
      examples: [],
      situation: "question_fact",
      owner: { username: "tester", intro: "" },
      myNote: "나는 medium 을 기본으로 쓴다",
      instruction: "더 짧게",
    });
    expect(p).toContain("나는 medium 을 기본으로 쓴다");
    expect(p).toContain("더 짧게");
  });
});

describe("normalizeAnswer", () => {
  it("없는 근거 id 를 버린다", () => {
    const a = normalizeAnswer(
      {
        verdict: "answerable",
        verdictReason: "s1에 있음",
        sentences: [{ text: "대부분 low로 쓴다고 하더라고요", sourceIds: ["s1", "s9"] }],
        draft: "대부분 low로 쓴다고 하더라고요 !",
      },
      ctx(true)
    );
    expect(a.sentences[0].sourceIds).toEqual(["s1"]);
    expect(a.verdict).toBe("answerable");
    expect(a.sources.map((s) => s.id)).toEqual(["s1"]);
  });

  it("질문인데 근거 달린 문장이 없으면 unknown 으로 내린다", () => {
    const a = normalizeAnswer(
      { verdict: "answerable", sentences: [{ text: "아마 그럴 거예요", sourceIds: ["s9"] }], draft: "아마 그럴 거예요" },
      ctx(true)
    );
    expect(a.verdict).toBe("unknown");
    expect(a.verdictReason).toContain("근거 달린 문장 없음");
  });

  it("근거 없는 숫자 문장이 있으면 answerable 을 partial 로", () => {
    const a = normalizeAnswer(
      {
        verdict: "answerable",
        sentences: [
          { text: "대부분 low로 쓴다고 하더라고요", sourceIds: ["s1"] },
          { text: "가격은 3배 싸요", sourceIds: [] },
        ],
      },
      ctx(true)
    );
    expect(a.verdict).toBe("partial");
    expect(a.draft).toBe("대부분 low로 쓴다고 하더라고요 가격은 3배 싸요");
  });

  it("내 글(p)을 인용하면 근거 목록에 내 글을 더한다", () => {
    const a = normalizeAnswer(
      { verdict: "answerable", sentences: [{ text: "11가지로 정리해뒀어요 !", sourceIds: ["p"] }], draft: "x" },
      ctx(true)
    );
    expect(a.sources[0]).toMatchObject({ id: "p", kind: "지난 글", url: post.permalink });
  });

  it("반응 댓글은 근거를 비우고 answerable·반응 댓글로 고정", () => {
    const a = normalizeAnswer(
      { verdict: "unknown", sentences: [{ text: "감사합니다 💌", sourceIds: ["s1"] }], draft: "감사합니다 💌", myAsk: "?" },
      { ...ctx(false), sources: [] }
    );
    expect(a).toMatchObject({ verdict: "answerable", verdictReason: "반응 댓글", sources: [] });
    expect(a.sentences[0].sourceIds).toEqual([]);
    expect(a.myAsk).toBeUndefined();
  });

  it("판정 값이 이상하면 partial 로 두고 근거가 있으면 유지", () => {
    const a = normalizeAnswer({ verdict: "yes", sentences: [{ text: "a", sourceIds: ["s1"] }] }, ctx(true));
    expect(a.verdict).toBe("partial");
  });
});

describe("generateAnswer", () => {
  it("주입한 실행기로 한 번 호출하고 JSON 을 정리한다", async () => {
    const prompts: string[] = [];
    const a = await generateAnswer(
      { reply: reply("low는 언제 쓰나요?"), post, sources },
      {
        styleBook: "",
        examples: [],
        now: () => new Date("2026-09-27T00:00:00Z"),
        run: async (p) => {
          prompts.push(p);
          return '```json\n{"verdict":"answerable","verdictReason":"s1","sentences":[{"text":"대부분 low로 쓴다고 하더라고요 !","sourceIds":["s1"]}],"draft":"대부분 low로 쓴다고 하더라고요 !","myAsk":""}\n```';
        },
      }
    );
    expect(prompts).toHaveLength(1);
    expect(a).toMatchObject({ verdict: "answerable", model: "claude-opus-5-5", styleExamples: 0 });
    expect(a.generatedAt).toBe("2026-09-27T00:00:00.000Z");
    expect(a.myAsk).toBeUndefined();
  });

  it("반응 댓글이면 근거를 프롬프트에 싣지 않는다", async () => {
    let seen = "";
    const a = await generateAnswer(
      { reply: reply("감사합니다!!", "reaction"), post, sources },
      {
        styleBook: "",
        examples: [],
        run: async (p) => {
          seen = p;
          return '{"verdict":"answerable","verdictReason":"x","sentences":[{"text":"🥰","sourceIds":[]}],"draft":"🥰"}';
        },
      }
    );
    expect(seen).not.toContain("I use low effort");
    expect(a.sources).toEqual([]);
    expect(a.draft).toBe("🥰");
  });
});
