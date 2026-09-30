import { describe, expect, it } from "vitest";
import { parseProfileHtml } from "./commenter-profile";
import { buildComposePrompt } from "./compose-prompts";
import { buildReadingPrompt, isLightNeed, parseReading, readingBlock, type ReadingExample } from "./reading";
import { parseReadingBank, pickReadingExamples } from "./reading-bank";

const RAW = {
  who: "모름",
  focus: "'8월6일 몸무게랑 지금이랑 같아'와 '증량을 해야할까?'",
  need: "consult",
  needNote: "박약사가 직접 판단해 주길 바란다",
  core: "정체기",
  approach: ["12.5로 올릴 타이밍", "웨이트·단백질"],
  missing: [],
  humor: "",
  needProfile: false,
};

describe("parseReading", () => {
  it("모양이 맞으면 읽는다", () => {
    expect(parseReading(RAW)).toMatchObject({ need: "consult", approach: ["12.5로 올릴 타이밍", "웨이트·단백질"], missing: [] });
  });

  it("모르는 니즈나 빈 지점이면 null (초안은 읽기 없이 쓴다)", () => {
    expect(parseReading({ ...RAW, need: "advice" })).toBeNull();
    expect(parseReading({ ...RAW, focus: "" })).toBeNull();
    expect(parseReading(null)).toBeNull();
  });

  it("who 가 비면 모름, needProfile 은 true 일 때만", () => {
    expect(parseReading({ ...RAW, who: "", needProfile: "yes" })).toMatchObject({ who: "모름", needProfile: false });
  });
});

describe("readingBlock", () => {
  it("상담이면 떠넘기지 말라고 싣는다", () => {
    const r = parseReading(RAW)!;
    const block = readingBlock("박약사", r);
    expect(block).toContain("<reading>");
    expect(block).toContain("모자란 정보: 없음");
    expect(block).toMatch(/돌려보내지 않는다/);
  });

  it("가벼운 말 걸기면 짧게 받으라고 싣는다", () => {
    const r = parseReading({ ...RAW, need: "chat" })!;
    expect(isLightNeed(r.need)).toBe(true);
    expect(readingBlock("박약사", r)).toMatch(/한두 문장만/);
    expect(readingBlock("박약사", r)).not.toMatch(/돌려보내지 않는다/);
  });
});

describe("buildReadingPrompt", () => {
  it("프로필을 봤으면 판단에만 쓰라고 하고, 예시는 주인 실제 답까지 싣는다", () => {
    const ex: ReadingExample = { pairId: "v1", comment: "c", reply: "실제 답", focus: "f", need: "info", approach: "a" };
    const p = buildReadingPrompt({ owner: "박약사", ownerLine: "약사", post: "글", comment: "댓글", commenter: "u", safety: "- 규칙", examples: [ex], profile: { username: "u", name: "게장", bio: "주부입니다", fetchedAt: "t" } });
    expect(p).toContain("주부입니다");
    expect(p).toContain("판단에만 쓴다");
    expect(p).toContain("실제 답");
  });
});

describe("reading-bank", () => {
  const bank: ReadingExample[] = [
    { pairId: "a", comment: "마운자로 증량 해야 할까 몸무게 그대로", reply: "r", focus: "f", need: "consult", approach: "x" },
    { pairId: "b", comment: "비염 유산균 추천", reply: "r", focus: "f", need: "info", approach: "x" },
    { pairId: "c", comment: "마운자로 증량 고민", reply: "r", focus: "f", need: "consult", approach: "x" },
  ];

  it("모양이 틀린 칸은 버린다", () => {
    expect(parseReadingBank({ examples: [...bank, { pairId: "z", comment: "x", reply: "y", need: "nope" }] })).toHaveLength(3);
    expect(parseReadingBank(null)).toEqual([]);
  });

  it("비슷한 댓글 먼저, 시험 쌍은 뺀다", () => {
    const picked = pickReadingExamples(bank, { comment: "마운자로 증량 해야 할까", exclude: new Set(["c"]), n: 2 });
    expect(picked[0].pairId).toBe("a");
    expect(picked.map((e) => e.pairId)).not.toContain("c");
  });
});

describe("parseProfileHtml", () => {
  it("og 태그에서 이름·소개를 뽑는다", () => {
    const html = `<meta property="og:title" content="큰손한끼게장 (@hanggigejang) &#x2022; Threads, Say more" /><meta property="og:description" content="146 Followers &#x2022; 90 Threads &#x2022; 엄마의 양념게장이 맛있어 일을 시작한 주부입니다. See the latest conversations with @hanggigejang." />`;
    expect(parseProfileHtml("hanggigejang", html, "t")).toEqual({ username: "hanggigejang", name: "큰손한끼게장", bio: "엄마의 양념게장이 맛있어 일을 시작한 주부입니다.", fetchedAt: "t" });
  });

  it("태그가 없거나 로그인 페이지면 null", () => {
    expect(parseProfileHtml("x", "<html></html>", "t")).toBeNull();
    expect(parseProfileHtml("x", `<meta property="og:title" content="Threads &#x2022; Log in" />`, "t")).toBeNull();
  });
});

describe("초안 요청문에 읽기 싣기 (2026-09-30 실경로 떠넘기기)", () => {
  const reading = readingBlock("박약사", parseReading(RAW)!);
  const base = { owner: "박약사", ownerLine: "약사", context: "<comment>c</comment>", kinds: ["principle" as const], channels: [], segments: {}, reading };

  it("이어 쓰는 턴에도 읽기 결과 전체를 다시 싣는다", () => {
    const p = buildComposePrompt({ ...base, resumed: true });
    expect(p).toContain("<reading>");
    expect(p).toContain("진짜 니즈: 주인에게 직접 상담받고 싶다");
  });

  it("앞 초안이 판단과 어긋나면 고치라고 한다", () => {
    const p = buildComposePrompt({ ...base, resumed: true, base: { draft: "증량은 의사쌤한테 물어봐", kinds: ["principle"] } });
    expect(p).toMatch(/<reading>의 판단.*어긋나는 문장은 그대로 두지 않고/);
  });

  it("조각이 하나여도 생활 쪽 해결책 하나는 남긴다 (가벼운 말 걸기는 제외)", () => {
    expect(reading).toMatch(/생활 쪽 해결책/);
    expect(readingBlock("박약사", parseReading({ ...RAW, need: "chat" })!)).not.toMatch(/생활 쪽 해결책/);
  });
});
