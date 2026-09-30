import { describe, expect, it } from "vitest";
import type { CategoriesFile, ReplyCategory } from "@/lib/personas/categories";
import { DEFAULT_PERSONAS } from "@/lib/personas/model";
import {
  applyVerdictRules,
  buildAnswerPrompt,
  buildOptionsPrompt,
  pastSaidBlock,
  planForSituation,
  withRoles,
  chooseOption,
  detailedCategories,
  generateAnswer,
  generateMoreOption,
  normalizeAnswer,
  normalizeOptions,
  POST_SOURCE_ID,
  systemAppendFor,
  withOwnerDraft,
  type RunOptions,
} from "./draft";
import type { AnswerSource, ReplyAnswer, ThreadsPostRef, ThreadsReply } from "./model";
import type { VoiceExample } from "./voice";

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
    });
    expect(p).not.toContain("<sources>");
    expect(p).toContain("반응 댓글");
  });

  it("주인 메모와 요청을 중립 태그로 싣는다", () => {
    const p = buildAnswerPrompt({
      reply: reply("어떤 설정 쓰세요?"),
      post,
      sources: [],
      styleBook: "",
      examples: [],
      situation: "question_fact",
      henryNote: "나는 medium 을 기본으로 쓴다",
      instruction: "더 짧게",
    });
    expect(p).toContain("나는 medium 을 기본으로 쓴다");
    expect(p).toContain("<owner_note>");
    expect(p).toContain("<owner_instruction>");
    expect(p).toContain("더 짧게");
  });

  it("규칙책이 비면 팩 세션이 AGENTS.md 를 읽었다고 말하고 전문을 싣지 않는다", () => {
    const p = buildAnswerPrompt({ reply: reply("x?"), post, sources: [], styleBook: "", examples: [], situation: "question_fact" });
    expect(p).not.toContain("<style_book>");
    expect(p).toContain("AGENTS.md");
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

  it("근거 없는 숫자 문장은 초안에서 빼고 dropped 로 남긴다", () => {
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
    expect(a.draft).toBe("대부분 low로 쓴다고 하더라고요");
    expect(a.sentences.map((s) => s.text)).toEqual(["대부분 low로 쓴다고 하더라고요"]);
    expect(a.dropped).toEqual([{ text: "가격은 3배 싸요", reason: "자료에 없는 말: 3" }]);
  });

  it("근거 없는 사실 문장이 남아 있으면(여기선 근거가 받침) answerable 을 partial 로 내리는 규칙은 그대로", () => {
    const a = applyVerdictRules({ verdict: "answerable" }, true, new Set(["s1"]), [{ text: "가격은 3배 싸요", sourceIds: [] }]);
    expect(a.verdict).toBe("partial");
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
      { verdict: "unknown", sentences: [{ text: "감사합니다 💌", sourceIds: ["s1"] }], draft: "감사합니다 💌", henryAsk: "?" },
      { ...ctx(false), sources: [] }
    );
    expect(a).toMatchObject({ verdict: "answerable", verdictReason: "반응 댓글", sources: [] });
    expect(a.sentences[0].sourceIds).toEqual([]);
    expect(a.henryAsk).toBeUndefined();
  });

  it("판정 값이 이상하면 partial 로 두고 근거가 있으면 유지", () => {
    const a = normalizeAnswer({ verdict: "yes", sentences: [{ text: "a", sourceIds: ["s1"] }] }, ctx(true));
    expect(a.verdict).toBe("partial");
  });
});

const single = { categories: null, workspaceDir: null, safety: "", persona: DEFAULT_PERSONAS.aicc } as const;

describe("generateAnswer · 1벌 (categories.json 없음)", () => {
  it("주입한 실행기로 한 번 호출하고 JSON 을 정리해 options 한 개로 감싼다", async () => {
    const prompts: string[] = [];
    const a = await generateAnswer(
      { reply: reply("low는 언제 쓰나요?"), post, sources },
      {
        ...single,
        styleBook: "",
        examples: [],
        now: () => new Date("2026-09-27T00:00:00Z"),
        run: async (p) => {
          prompts.push(p);
          return '```json\n{"verdict":"answerable","verdictReason":"s1","sentences":[{"text":"대부분 low로 쓴다고 하더라고요 !","sourceIds":["s1"]}],"draft":"대부분 low로 쓴다고 하더라고요 !","henryAsk":""}\n```';
        },
      }
    );
    expect(prompts).toHaveLength(1);
    expect(a).toMatchObject({ verdict: "answerable", model: "claude-opus-5-5", styleExamples: 0, chosen: 0 });
    expect(a.generatedAt).toBe("2026-09-27T00:00:00.000Z");
    expect(a.henryAsk).toBeUndefined();
    expect(a.options).toEqual([{ categoryId: "default", categoryName: "기본 한 벌", draft: a.draft, sentences: a.sentences }]);
    expect(a.aiDraft).toBe(a.draft);
    expect(a.sessionId).toBeUndefined(); // 팩 폴더 없이 돌았으면 세션도 없다
  });

  it("반응 댓글이면 근거를 프롬프트에 싣지 않는다", async () => {
    let seen = "";
    const a = await generateAnswer(
      { reply: reply("감사합니다!!", "reaction"), post, sources },
      {
        ...single,
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

// ── 3벌 ──────────────────────────────────────────────────────────────

function category(id: string, exampleIds: string[] = [], share = 10): ReplyCategory {
  return {
    id,
    name: `${id} 이름`,
    when: `${id} 댓글일 때`,
    share,
    prompt: `${id} 지시문: 짧게 쓴다`,
    exampleIds,
    stats: { count: 1, lengthMedian: 10, lengthP90: 20, sentencesMedian: 1, firstWords: [], endings: [], habits: {} },
  };
}

const CATS: ReplyCategory[] = [
  category("quick-thanks", ["e1"], 30),
  category("fact-answer", ["e2"], 25),
  category("ask-back", ["e3"], 15),
  category("experience-share", [], 10),
];
const FILE: CategoriesFile = { version: 1, personaId: "aicc", builtAt: "", model: "", source: { pairs: 4, excluded: 0, unassigned: 0 }, categories: CATS };
const POOL: VoiceExample[] = [
  { id: "e1", comment: "좋은 글 감사합니다", reply: "감사합니다 ㅎㅎ", at: "", situation: "thanks" },
  { id: "e2", comment: "low는 언제 쓰나요?", reply: "대부분 low 로 써요 !", at: "", situation: "question_fact" },
  { id: "e3", comment: "이거 어디서 봐요?", reply: "어떤 거 말씀이세요?", at: "", situation: "question_fact" },
];

const optCtx = (question: boolean) => ({ ...ctx(question), categories: CATS, sessionId: "sess-1" });

describe("normalizeOptions", () => {
  it("모르는 카테고리·같은 카테고리 두 번·빈 초안을 버리고 3벌까지 남긴다", () => {
    const a = normalizeOptions(
      {
        verdict: "answerable",
        verdictReason: "s1",
        options: [
          { categoryId: "fact-answer", sentences: [{ text: "대부분 low로 쓴대요", sourceIds: ["s1", "s9"] }], draft: "대부분 low로 쓴대요 !" },
          { categoryId: "nope", sentences: [{ text: "x", sourceIds: [] }], draft: "x" },
          { categoryId: "fact-answer", sentences: [], draft: "중복" },
          { categoryId: "ask-back", sentences: [], draft: "" },
          { categoryId: "quick-thanks", sentences: [{ text: "감사해요 💌", sourceIds: [] }], draft: "" },
          { categoryId: "experience-share", sentences: [{ text: "effort 설정 11가지 정리해 뒀어요", sourceIds: ["p"] }], draft: "effort 설정 11가지 정리해 뒀어요" },
        ],
        ownerAsk: "직접 써보셨나요?",
      },
      optCtx(true)
    );
    expect(a.options?.map((o) => o.categoryId)).toEqual(["fact-answer", "quick-thanks", "experience-share"]);
    expect(a.options?.[0].sentences[0].sourceIds).toEqual(["s1"]);
    expect(a.options?.[1]).toMatchObject({ categoryName: "quick-thanks 이름", draft: "감사해요 💌" });
    expect(a).toMatchObject({ chosen: 0, draft: "대부분 low로 쓴대요 !", aiDraft: "대부분 low로 쓴대요 !", sessionId: "sess-1" });
    expect(a.sentences).toEqual(a.options?.[0].sentences);
    expect(a.henryAsk).toBe("직접 써보셨나요?");
    // 두 번째·세 번째 벌이 인용한 내 글(p)도 근거 목록에 들어간다
    expect(a.sources.map((s) => s.id)).toEqual(["p", "s1"]);
  });

  it("세 벌 어디에도 근거 달린 문장이 없으면 unknown", () => {
    const a = normalizeOptions(
      {
        verdict: "answerable",
        options: [
          { categoryId: "fact-answer", sentences: [{ text: "아마 그럴 거예요", sourceIds: ["s9"] }] },
          { categoryId: "ask-back", sentences: [{ text: "어떤 거요?", sourceIds: [] }] },
        ],
      },
      optCtx(true)
    );
    expect(a.verdict).toBe("unknown");
    expect(a.options).toHaveLength(2);
  });

  it("벌마다 근거 없는 사실 문장을 빼고, 고른 벌의 dropped 를 답에도 싣는다", () => {
    const a = normalizeOptions(
      {
        verdict: "answerable",
        options: [
          { categoryId: "fact-answer", sentences: [{ text: "low 쓴대요", sourceIds: ["s1"] }, { text: "3배 싸요", sourceIds: [] }] },
          { categoryId: "ask-back", sentences: [{ text: "low 쓴대요", sourceIds: ["s1"] }] },
        ],
      },
      optCtx(true)
    );
    expect(a.options?.[0]).toMatchObject({ draft: "low 쓴대요", dropped: [{ text: "3배 싸요" }] });
    expect(a.options?.[1].dropped).toBeUndefined();
    expect(a.dropped).toEqual(a.options?.[0].dropped);
    expect(chooseOption(a, 1)).not.toHaveProperty("dropped");
  });

  it("반응 댓글이면 근거를 비우고 answerable·반응 댓글", () => {
    const a = normalizeOptions(
      { verdict: "unknown", options: [{ categoryId: "quick-thanks", sentences: [{ text: "🥰", sourceIds: ["s1"] }], draft: "🥰" }], ownerAsk: "?" },
      { ...optCtx(false), sources: [] }
    );
    expect(a).toMatchObject({ verdict: "answerable", verdictReason: "반응 댓글", sources: [] });
    expect(a.options?.[0].sentences[0].sourceIds).toEqual([]);
    expect(a.henryAsk).toBeUndefined();
  });

  it("맞는 벌이 하나도 없으면 던진다 (잡이 실패로 기록)", () => {
    expect(() => normalizeOptions({ options: [{ categoryId: "nope", draft: "x" }] }, optCtx(true))).toThrow(/3벌/);
  });
});

describe("detailedCategories · buildOptionsPrompt", () => {
  it("댓글과 닮은 예시를 가진 카테고리가 먼저 오고, 풀에 없는 예시 id 는 건너뛴다", () => {
    const d = detailedCategories("low는 언제 쓰나요?", CATS, POOL, 2);
    expect(d[0].category.id).toBe("fact-answer");
    expect(d[0].examples.map((e) => e.id)).toEqual(["e2"]);
    expect(d).toHaveLength(2);
  });

  it("고른 카테고리 지시문 + 실측 목표 + 실제 예시 + 중립 태그, 3벌 스키마를 싣는다", () => {
    const p = buildOptionsPrompt({
      reply: reply("low는 언제 쓰나요?"),
      post,
      sources,
      styleBook: "",
      persona: DEFAULT_PERSONAS.glp1,
      question: true,
      categories: CATS,
      detailed: detailedCategories("low는 언제 쓰나요?", CATS, POOL, 2),
    });
    expect(p).toContain('<category id="fact-answer"');
    expect(p).toContain("<target>길이 10자 안팎");
    expect(p).toContain("fact-answer 지시문");
    expect(p).toContain("<owner_reply>대부분 low 로 써요 !</owner_reply>");
    expect(p).toContain('"options"');
    expect(p).toContain("정확히 3개");
    expect(p).toContain('<source id="s1"');
    expect(p).not.toMatch(/henry|aicoffeechat|<style_book>/i);
  });
});

describe("예전에 한 말 · 길이 역할", () => {
  it("예전 답과 벌마다 길이 목표(짧게·길게)를 싣는다", () => {
    const detailed = withRoles(
      detailedCategories("low는 언제 쓰나요?", CATS, POOL, 2).map((d, i) => ({ ...d, category: { ...d.category, stats: { ...d.category.stats, lengthMedian: i ? 80 : 10 } } })),
      { short: 20, mid: 43, long: 107, n: 35 }
    );
    const p = buildOptionsPrompt({
      reply: reply("low는 언제 쓰나요?"),
      post,
      sources,
      styleBook: "",
      persona: DEFAULT_PERSONAS.aicc,
      question: true,
      categories: CATS,
      detailed,
      plan: { short: 20, mid: 43, long: 107, n: 35 },
      pastSaid: [{ id: "r1", text: "대부분 low 로 써요", date: "2026-08-01", sameCommenter: true }],
    });
    expect(detailed.map((d) => d.role)).toEqual(["short", "long"]);
    expect(p).toContain("<length>짧게: 20자 안팎, 길어도 30자");
    expect(p).toContain("<length>길게: 107자 안팎, 적어도 75자");
    expect(p).toContain('<past date="2026-08-01" same_person="true">');
    expect(p).toContain("예전 답과 어긋나면 안 된다");
  });
  it("예전 답이 없으면 블록을 싣지 않는다", () => {
    expect(pastSaidBlock([], "주인")).toBe("");
  });
  it("상황별 길이 목표는 주인 답 길이에서 잰다", () => {
    const pool = Array.from({ length: 20 }, (_, i) => ({ comment: "q?", reply: "가".repeat(10 + i * 5), at: "", situation: "question_fact" as const }));
    expect(planForSituation(pool, "question_fact")).toMatchObject({ short: 35, n: 20 });
  });
});

describe("generateAnswer · 3벌", () => {
  const optionsJson = JSON.stringify({
    verdict: "answerable",
    verdictReason: "s1",
    options: [
      { categoryId: "fact-answer", sentences: [{ text: "대부분 low로 쓴대요", sourceIds: ["s1"] }], draft: "대부분 low로 쓴대요 !" },
      { categoryId: "ask-back", sentences: [{ text: "어떤 작업이세요?", sourceIds: [] }], draft: "어떤 작업이세요?" },
      { categoryId: "quick-thanks", sentences: [{ text: "좋은 질문 감사해요", sourceIds: [] }], draft: "좋은 질문 감사해요 💌" },
    ],
    ownerAsk: "",
  });

  it("팩 폴더 세션으로 한 번 호출하고 SAFETY 를 시스템 지시에 붙인다", async () => {
    const calls: { prompt: string; opts: RunOptions }[] = [];
    const a = await generateAnswer(
      { reply: reply("low는 언제 쓰나요?"), post, sources },
      {
        categories: FILE,
        pool: POOL,
        workspaceDir: "/packs/aicc",
        safety: "# 안전 규칙\n- 지어내지 않는다",
        sessionId: "11111111-1111-4111-8111-111111111111",
        persona: DEFAULT_PERSONAS.aicc,
        run: async (prompt, opts) => {
          calls.push({ prompt, opts });
          return optionsJson;
        },
      }
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].opts.workspace).toEqual({ dir: "/packs/aicc", sessionId: "11111111-1111-4111-8111-111111111111" });
    expect(calls[0].opts.systemAppend).toContain("한 번의 호출로 끝나는 텍스트 생성기");
    expect(calls[0].opts.systemAppend).toContain("지어내지 않는다");
    expect(calls[0].prompt).not.toContain("<style_book>");
    expect(a.options).toHaveLength(3);
    expect(a).toMatchObject({ chosen: 0, draft: "대부분 low로 쓴대요 !", aiDraft: "대부분 low로 쓴대요 !", sessionId: "11111111-1111-4111-8111-111111111111" });
    expect(a.styleExamples).toBeGreaterThan(0);
  });

  it("다시 쓰기는 앞 세션에 이어 쓰고, 실패하면 새 세션으로 처음부터", async () => {
    const calls: RunOptions[] = [];
    const deps = {
      categories: FILE,
      pool: POOL,
      workspaceDir: "/packs/aicc",
      safety: "",
      sessionId: "new-session",
      resumeSessionId: "old-session",
      persona: DEFAULT_PERSONAS.aicc,
    };
    const resumed = await generateAnswer(
      { reply: reply("low는 언제 쓰나요?"), post, sources, instruction: "더 짧게" },
      {
        ...deps,
        run: async (prompt, opts) => {
          calls.push(opts);
          expect(prompt).toContain("[다시 쓰기]");
          expect(prompt).toContain("더 짧게");
          return optionsJson;
        },
      }
    );
    expect(calls[0].workspace).toEqual({ dir: "/packs/aicc", sessionId: "old-session", resume: true });
    expect(resumed.sessionId).toBe("old-session");

    const fallback: RunOptions[] = [];
    const fresh = await generateAnswer(
      { reply: reply("low는 언제 쓰나요?"), post, sources },
      {
        ...deps,
        run: async (_p, opts) => {
          fallback.push(opts);
          if (opts.workspace?.resume) throw new Error("No conversation found with session ID: old-session");
          return optionsJson;
        },
      }
    );
    expect(fallback.map((o) => o.workspace?.sessionId)).toEqual(["old-session", "new-session"]);
    expect(fresh.sessionId).toBe("new-session");
  });

  it("다시 쓰기가 시간 초과면 처음부터 다시 돌지 않는다", async () => {
    let n = 0;
    await expect(
      generateAnswer(
        { reply: reply("low는 언제 쓰나요?"), post, sources },
        {
          categories: FILE,
          pool: POOL,
          workspaceDir: "/packs/aicc",
          safety: "",
          resumeSessionId: "old",
          persona: DEFAULT_PERSONAS.aicc,
          run: async () => {
            n += 1;
            throw new Error("Claude CLI 시간 초과(240초)");
          },
        }
      )
    ).rejects.toThrow(/시간 초과/);
    expect(n).toBe(1);
  });
});

describe("systemAppendFor", () => {
  it("SAFETY 가 없으면 단발 지시만", () => {
    expect(systemAppendFor("  ")).not.toContain("\n\n");
  });
});

// ── 주인 편집 (PATCH) ────────────────────────────────────────────────

function answerWithOptions(): ReplyAnswer {
  const opts = [
    { categoryId: "a", categoryName: "A", draft: "첫 벌", sentences: [{ text: "첫 벌", sourceIds: ["s1"] }] },
    { categoryId: "b", categoryName: "B", draft: "둘째 벌", sentences: [{ text: "둘째 벌", sourceIds: [] }] },
  ];
  return {
    verdict: "answerable",
    verdictReason: "x",
    sources,
    sentences: opts[0].sentences,
    draft: "첫 벌",
    model: "claude-opus-5-5",
    generatedAt: "t",
    styleExamples: 3,
    options: opts,
    chosen: 0,
    aiDraft: "첫 벌",
    sessionId: "s",
  };
}

describe("chooseOption · withOwnerDraft", () => {
  it("n번째 벌을 고르면 draft = aiDraft = 그 벌, 문장도 그 벌 것으로", () => {
    const a = chooseOption(answerWithOptions(), 1);
    expect(a).toMatchObject({ chosen: 1, draft: "둘째 벌", aiDraft: "둘째 벌", sessionId: "s" });
    expect(typeof a !== "string" && a.sentences).toEqual([{ text: "둘째 벌", sourceIds: [] }]);
  });

  it("범위 밖·정수 아님·벌 없음이면 이유 문자열", () => {
    expect(chooseOption(answerWithOptions(), 2)).toMatch(/0~1/);
    expect(chooseOption(answerWithOptions(), 0.5)).toMatch(/0~1/);
    expect(chooseOption(undefined, 0)).toMatch(/없어요/);
    expect(chooseOption({ ...answerWithOptions(), options: undefined }, 0)).toMatch(/없어요/);
  });

  it("손으로 고친 초안은 draft 만 바꾸고 aiDraft 는 그대로", () => {
    const picked = chooseOption(answerWithOptions(), 1) as ReplyAnswer;
    const edited = withOwnerDraft(picked, "내가 고친 답");
    expect(edited).toMatchObject({ draft: "내가 고친 답", aiDraft: "둘째 벌", chosen: 1 });
  });

  it("AI 초안이 없던 댓글이면 손으로 쓴 답을 만든다 (model henry = 화면의 손으로 쓴 답 표시)", () => {
    const a = withOwnerDraft(undefined, "직접 씀", new Date("2026-09-29T00:00:00Z"));
    expect(a).toMatchObject({ verdict: "unknown", draft: "직접 씀", model: "henry", generatedAt: "2026-09-29T00:00:00.000Z" });
    expect(a.aiDraft).toBeUndefined();
  });
});

describe("다양성 관문 · 다른 버전", () => {
  const deps = {
    categories: FILE,
    pool: POOL,
    workspaceDir: "/packs/aicc",
    safety: "",
    sessionId: "sess-d",
    persona: DEFAULT_PERSONAS.aicc,
  };
  const same = (id: string) => ({ categoryId: id, sentences: [{ text: "네 low로 쓰면 돼요 !", sourceIds: ["s1"] }], draft: "네 low로 쓰면 돼요 !" });

  it("두 벌이 너무 닮았으면 뒤 벌만 같은 세션에서 다시 쓴다", async () => {
    const calls: { prompt: string; opts: RunOptions }[] = [];
    const a = await generateAnswer(
      { reply: reply("low는 언제 쓰나요?"), post, sources },
      {
        ...deps,
        run: async (prompt, opts) => {
          calls.push({ prompt, opts });
          if (calls.length === 1) return JSON.stringify({ verdict: "answerable", options: [same("fact-answer"), same("ask-back"), { categoryId: "quick-thanks", sentences: [{ text: "고마워요 💌", sourceIds: [] }], draft: "고마워요 💌" }] });
          return JSON.stringify({ categoryId: "ask-back", sentences: [{ text: "어떤 작업에 쓰세요?", sourceIds: [] }], draft: "어떤 작업에 쓰세요?" });
        },
      }
    );
    expect(calls).toHaveLength(2);
    expect(calls[1].prompt).toContain("[한 벌만 다시] 2번 벌이 1번 벌과");
    expect(calls[1].opts.workspace).toEqual({ dir: "/packs/aicc", sessionId: "sess-d", resume: true });
    expect(a.options?.map((o) => o.draft)).toEqual(["네 low로 쓰면 돼요 !", "어떤 작업에 쓰세요?", "고마워요 💌"]);
  });

  it("다른 버전: 안 쓴 카테고리로 한 벌을 세션에 이어 쓴다", async () => {
    const answer = {
      verdict: "answerable",
      verdictReason: "",
      sources,
      sentences: [],
      draft: "",
      model: "m",
      generatedAt: "",
      styleExamples: 0,
      sessionId: "sess-old",
      options: ["quick-thanks", "fact-answer", "ask-back"].map((id) => ({ categoryId: id, categoryName: id, draft: id, sentences: [] })),
    } as ReplyAnswer;
    let seen: { prompt: string; opts: RunOptions } | null = null;
    const opt = await generateMoreOption(
      { reply: reply("low는 언제 쓰나요?"), post, sources, answer },
      {
        ...deps,
        run: async (prompt, opts) => {
          seen = { prompt, opts };
          return JSON.stringify({ categoryId: "experience-share", sentences: [{ text: "저는 low만 써요", sourceIds: [] }], draft: "저는 low만 써요" });
        },
      }
    );
    expect(opt).toMatchObject({ categoryId: "experience-share", draft: "저는 low만 써요" });
    expect(seen!.prompt).toContain("[다른 버전]");
    expect(seen!.opts.workspace).toEqual({ dir: "/packs/aicc", sessionId: "sess-old", resume: true });
  });

  it("근거 없는 문장을 빼고 빈 벌이면 다음 카테고리로 한 번 더", async () => {
    const answer = { sessionId: "s", options: CATS.slice(0, 2).map((c) => ({ categoryId: c.id, categoryName: c.name, draft: c.id, sentences: [] })) } as unknown as ReplyAnswer;
    const seen: string[] = [];
    const opt = await generateMoreOption(
      { reply: reply("low는 언제 쓰나요?"), post, sources, answer },
      {
        ...deps,
        run: async (prompt) => {
          const id = /"categoryId": "([^"]+)"/.exec(prompt)![1];
          seen.push(id);
          return seen.length === 1
            ? JSON.stringify({ categoryId: id, sentences: [{ text: "가격은 9만원이래요", sourceIds: [] }], draft: "가격은 9만원이래요" })
            : JSON.stringify({ categoryId: id, sentences: [{ text: "어떤 작업이세요?", sourceIds: [] }], draft: "어떤 작업이세요?" });
        },
      }
    );
    expect(seen).toHaveLength(2);
    expect(opt).toMatchObject({ categoryId: seen[1], draft: "어떤 작업이세요?" });
  });

  it("남은 카테고리가 없으면 null", async () => {
    const answer = { options: CATS.map((c) => ({ categoryId: c.id, categoryName: c.name, draft: c.id, sentences: [] })) } as unknown as ReplyAnswer;
    const opt = await generateMoreOption({ reply: reply("x"), post, sources, answer }, { ...deps, run: async () => "{}" });
    expect(opt).toBeNull();
  });
});
