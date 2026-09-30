import { describe, expect, it } from "vitest";
import { parseBrainPage } from "./brain-page";

const FULL = `# 저항운동(근력운동) (resistance-training)

이럴 때 찾는다: 근육, 근력, 골밀도, 다이어트

## 팟캐스트에서 나온 말 (관점일 뿐, 추천 근거 아님)
- [추천] Rhonda Patrick: Lift heavy things twice a week. ([영상 55분](https://youtu.be/abc?t=3305))
- [원리] unknown: Muscle is a metabolic organ. ([영상 3분](https://youtu.be/x?t=180))
- [주의점] guest: Ratio: 2 to 1 matters.`;

describe("parseBrainPage", () => {
  it("parses heading, slug, tags and items", () => {
    const p = parseBrainPage(FULL);
    expect(p.heading).toBe("저항운동(근력운동)");
    expect(p.slug).toBe("resistance-training");
    expect(p.tags).toEqual(["근육", "근력", "골밀도", "다이어트"]);
    expect(p.sections).toHaveLength(1);
    expect(p.sections[0].title).toBe("팟캐스트에서 나온 말 (관점일 뿐, 추천 근거 아님)");
    expect(p.sections[0].items[0]).toEqual({
      label: "추천",
      speaker: "Rhonda Patrick",
      text: "Lift heavy things twice a week.",
      link: { label: "영상 55분", url: "https://youtu.be/abc?t=3305" },
    });
    expect(p.sections[0].items[1].speaker).toBeUndefined();
    expect(p.sections[0].items[2]).toEqual({ label: "주의점", text: "Ratio: 2 to 1 matters." });
    expect(p.rest).toBe("");
  });

  it("handles a partial chunk with bullets only", () => {
    const p = parseBrainPage("- [용량·타이밍] Andy Galpin: Take 5 g daily. ([영상 1분](https://y.be/1))\n- plain bullet");
    expect(p.heading).toBeUndefined();
    expect(p.tags).toEqual([]);
    expect(p.sections[0].title).toBe("");
    expect(p.sections[0].items.map((i) => i.text)).toEqual(["Take 5 g daily.", "plain bullet"]);
  });

  it("skips frontmatter and keeps loose text in rest without markdown", () => {
    const p = parseBrainPage('---\ntype: other\ntitle: "x"\n---\n# 알코올 (alcohol)\n자유 문장 [링크](https://a.b) **굵게**');
    expect(p.heading).toBe("알코올");
    expect(p.rest).toBe("자유 문장 링크 굵게");
  });

  it("never leaks raw markdown tokens", () => {
    const p = parseBrainPage(FULL + "\n### 더 [보기](https://z)");
    const all = JSON.stringify([p.heading, p.tags, p.sections.map((s) => [s.title, s.items.map((i) => [i.label, i.speaker, i.text])]), p.rest]);
    expect(all).not.toMatch(/#|- \[|\]\(/);
  });

  it("drops non-http links but keeps text", () => {
    const p = parseBrainPage("- [추천] X: text ([영상 1분](javascript:alert(1)))");
    expect(p.sections[0].items[0]).toEqual({ label: "추천", speaker: "X", text: "text" });
  });

  it("returns empty structure for empty input", () => {
    expect(parseBrainPage("")).toEqual({ tags: [], sections: [], rest: "" });
  });
});
