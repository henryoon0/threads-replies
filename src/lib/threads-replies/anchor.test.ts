import { describe, expect, it } from "vitest";
import type { ContentIdea } from "@/lib/content-ideas-model";
import { candidateIdeas, findSourceIdea, parseRunSource, runIdCandidates } from "./anchor";

describe("runIdCandidates", () => {
  it("prefers variantGroup and falls back to the base run id without the variant suffix", () => {
    expect(runIdCandidates({ id: "threads-run-2026-09-02-x-1-0724-b", variantGroup: undefined })).toEqual([
      "2026-09-02-x-1-0724-b",
      "2026-09-02-x-1-0724",
    ]);
    expect(runIdCandidates({ id: "threads-run-r-a", variantGroup: "r" })).toEqual(["r", "r-a"]);
  });
});

describe("parseRunSource", () => {
  it("reads a single post source as one section with its URL and author", () => {
    const md = "# 원문 수집\n- URL: https://x.com/nutlope/status/1\n- 작성자: Hassan (@nutlope)\n---\nIntroducing Inspo.\n\nMore.";
    const [s] = parseRunSource(md);
    expect(s.index).toBe(0);
    expect(s.url).toBe("https://x.com/nutlope/status/1");
    expect(s.title).toBe("Hassan (@nutlope) · Introducing Inspo.");
    expect(s.text).toBe(md);
  });

  it("splits a roundup source into one section per case with the case URL", () => {
    const md =
      "# 사례 모음\n\n---\n\n## 사례 1 — x@theo · 게임\n출처 URL: https://x.com/theo/status/1\n\nbody1\n\n## 사례 2 — x@shneural · 쇼릴\n출처 URL: https://x.com/shneural/status/2\n\nbody2\n";
    const got = parseRunSource(md);
    expect(got.map((s) => [s.index, s.title, s.url])).toEqual([
      [1, "x@theo · 게임", "https://x.com/theo/status/1"],
      [2, "x@shneural · 쇼릴", "https://x.com/shneural/status/2"],
    ]);
    expect(got[1].text).toContain("body2");
    expect(got[0].text).not.toContain("body2");
  });
});

const idea = (id: string, createdAt: string, posts: string[], variantGroup?: string) =>
  ({ id, createdAt, posts, variantGroup }) as unknown as ContentIdea;

describe("findSourceIdea / candidateIdeas", () => {
  const post = { id: "p", text: "Inspo MCP인데요. 레퍼런스 800개 넘게 모인 무료 MCP 입니다.", timestamp: "2026-09-14T22:56:38+0000" };

  it("pairs by whole-draft similarity within the window", () => {
    const ideas = [
      idea("far", "2026-08-01T00:00:00Z", [post.text]),
      idea("near", "2026-09-14T20:00:00Z", ["Inspo MCP인데요. 레퍼런스 800개 넘게 모인 무료 MCP 소개"]),
    ];
    expect(findSourceIdea(post, ideas)?.id).toBe("near");
  });

  it("falls back to a single matching 칸 when the hook was rewritten", () => {
    const ideas = [idea("x", "2026-09-14T20:00:00Z", ["완전히 다른 첫 칸 문장 하나", "또 다른 칸", post.text])];
    expect(findSourceIdea(post, ideas)?.id).toBe("x");
  });

  it("returns window candidates one per variant group, newest first", () => {
    const ideas = [
      idea("g1-a", "2026-09-13T00:00:00Z", ["a"], "g1"),
      idea("g1-b", "2026-09-13T00:00:00Z", ["b"], "g1"),
      idea("g2", "2026-09-14T00:00:00Z", ["c"]),
      idea("old", "2026-09-01T00:00:00Z", ["d"]),
    ];
    expect(candidateIdeas(post, ideas).map((i) => i.id)).toEqual(["g2", "g1-a"]);
  });
});
