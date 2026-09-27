import { describe, expect, it } from "vitest";
import { authorFollowUps, dedupeByUrl, isNonSourceRun, normalizeSourceUrl, parseRunSourceHeader, runSourceSeed } from "./run-source";

const TWEET = `# 원문 수집
- URL: https://x.com/lydiahallie/status/2096668098422272007
- 작성자: Lydia Hallie ✨ (@lydiahallie)
- 형식: 일반 글
- 수집: 2026-09-06T21:01:54.750Z
---
I've been running \`/claude-api prompt-audit\` when upgrading projects to Fable 5.1 and it's helped so much

It goes through your setup. Also works if you don't use the API!
`;

describe("parseRunSourceHeader", () => {
  it("X 원문: url · 작성자+첫 문장 제목 · 수집 시각의 로컬 날짜", () => {
    const h = parseRunSourceHeader(TWEET, "2026-09-07-x-2096668098422272007-0601");
    expect(h.url).toBe("https://x.com/lydiahallie/status/2096668098422272007");
    expect(h.author).toBe("Lydia Hallie ✨ (@lydiahallie)");
    expect(h.title).toMatch(/^Lydia Hallie · I've been running/);
    expect(h.date).toMatch(/^2026-09-0[67]$/);
  });

  it("웹 글은 - 제목, GitHub 은 - 레포 를 제목으로", () => {
    const web = `# 자료 수집 (블로그/웹 글)\n- URL: https://simonwillison.net/2026/x/\n- 제목: Three hidden costs\n- 수집: 2026-08-01T01:00:00Z\n---\n본문`;
    expect(parseRunSourceHeader(web, "r").title).toBe("Three hidden costs");
    const gh = `# 자료 수집 (GitHub 레포)\n- URL: https://github.com/anthropics/claude-code\n- 레포: anthropics/claude-code\n---\n[이미지 1: 헤더]`;
    expect(parseRunSourceHeader(gh, "2026-07-10-web-claude-code-1154")).toMatchObject({
      title: "anthropics/claude-code",
      date: "2026-07-10",
    });
  });

  it("사례 모음·리뷰: 본문 속 사례의 URL 은 머리로 읽지 않고, 주제를 제목으로", () => {
    const roundup = `# 사례 모음 재료: "Opus 5.5 creations"\n\n- 요청: 10가지\n\n---\n\n## 사례 1 — x@a · 신칸센\n출처 URL: https://x.com/a/status/1\n\n# 원문 수집\n- URL: https://x.com/a/status/1\n`;
    const h = parseRunSourceHeader(roundup, "2026-09-24-roundup-Opus55creations-1157");
    expect(h.url).toBeUndefined();
    expect(h.title).toBe("사례 모음 재료 · Opus 5.5 creations");
    expect(h.date).toBe("2026-09-24");
  });

  it("본문 앞 구분선이 두 번이어도 첫 문장을 제목으로", () => {
    const md = `# 원문 수집\n- URL: https://x.com/thsottiaux/status/2096688770523467947\n- 작성자: Tibo (@thsottiaux)\n---\n---\nTo calibrate you all on which reasoning effort to use for Astra.`;
    expect(parseRunSourceHeader(md, "r").title).toBe("Tibo · To calibrate you all on which reasoning effort to use for Astra.");
    expect(runSourceSeed(md)).toBe("To calibrate you all on which reasoning effort to use for Astra.");
  });

  it("질문 답변 재료는 원문이 아니다", () => {
    expect(isNonSourceRun("# 질문 답변 재료\n\n## 받은 질문")).toBe(true);
    expect(isNonSourceRun(TWEET)).toBe(false);
  });
});

describe("runSourceSeed", () => {
  it("머리를 빼고 본문 앞부분을 한 줄로", () => {
    expect(runSourceSeed(TWEET, 60)).toMatch(/^I.ve been running `\/claude-api prompt-audit` when upgrading/);
  });
});

describe("normalizeSourceUrl", () => {
  it("X 게시물은 상태 번호로 (도메인·핸들 대소문자·쿼리 무시)", () => {
    const k = "x:2096668098422272007";
    expect(normalizeSourceUrl("https://x.com/lydiahallie/status/2096668098422272007")).toBe(k);
    expect(normalizeSourceUrl("https://twitter.com/LydiaHallie/status/2096668098422272007?s=20")).toBe(k);
    expect(normalizeSourceUrl("https://x.com/i/web/status/2096668098422272007/")).toBe(k);
  });

  it("웹 주소는 스킴·www·쿼리·끝 슬래시를 뗀다", () => {
    expect(normalizeSourceUrl("https://www.Example.com/a/b/?utm=1#x")).toBe("example.com/a/b");
    expect(normalizeSourceUrl("http://example.com/a/b")).toBe("example.com/a/b");
    expect(normalizeSourceUrl(undefined)).toBe("");
  });
});

describe("dedupeByUrl", () => {
  it("같은 원문이면 본문이 긴 쪽만, url 없는 문서는 그대로", () => {
    const docs = [
      { id: "note:a", url: "https://x.com/a/status/1", text: "짧은 노트" },
      { id: "run:r1#0", url: "https://twitter.com/A/status/1?s=1", text: "원문 전체 본문이 더 길다" },
      { id: "run:r2#0", text: "url 없음" },
      { id: "run:r3#0", url: "https://x.com/a/status/1", text: "짧다" },
      { id: "card:b", url: "https://b.com/", text: "b" },
    ];
    expect(dedupeByUrl(docs).map((d) => d.id)).toEqual(["run:r1#0", "run:r2#0", "card:b"]);
  });
});

describe("authorFollowUps", () => {
  it("원글 작성자 셀프 답글 줄만 뽑는다", () => {
    const md = `# 답글 (관련도순 상위 20개)

- @someone (♥1): Is it free?
- @addyosmani (원글 작성자 셀프 답글) (♥1): Thanks a lot, Filippo!
- @addyosmani (원글 작성자 셀프 답글) (♥0):  `;
    expect(authorFollowUps(md)).toEqual(["@addyosmani (원글 작성자 셀프 답글) (♥1): Thanks a lot, Filippo!"]);
  });
});
