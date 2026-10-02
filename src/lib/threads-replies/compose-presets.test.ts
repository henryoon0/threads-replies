import { describe, expect, it } from "vitest";
import type { ComposeKind } from "./compose-kinds";
import { countMixes, derivePresets, mixKey, presetName, presetSet, presetsFromCategories, rankByNeighbors, rankByOrder } from "./compose-presets";

const L = (...kinds: ComposeKind[]) => ({ kinds });
const many = (n: number, ...kinds: ComposeKind[]) => Array.from({ length: n }, () => L(...kinds));

describe("조각 조합 세기", () => {
  it("순서와 상관없이 같은 조합으로 센다, 많은 순", () => {
    const mixes = countMixes([L("product", "ingredient"), L("ingredient", "product"), L("principle")]);
    expect(mixes[0]).toEqual({ kinds: ["ingredient", "product"], count: 2 });
    expect(mixKey(["product", "empathy", "principle"])).toBe("empathy+principle+product");
  });
});

describe("버전 뽑기", () => {
  const labels = [
    ...many(20, "product"),
    ...many(17, "ingredient", "product"),
    ...many(11, "principle"),
    ...many(11, "principle", "ingredient", "product"),
    ...many(9, "empathy", "principle", "ingredient"),
    ...many(7, "empathy", "principle", "ingredient", "product"),
    ...many(4, "empathy", "joke", "principle", "ingredient", "product"),
    ...many(1, "joke"),
  ];
  it("많이 쓴 조합 순, 최대 6개, 버전에 안 든 조각(드립)은 도드라진 조합으로 채운다", () => {
    const presets = derivePresets(labels);
    expect(presets).toHaveLength(6);
    expect(presets.map((p) => p.id)).toEqual(["product", "ingredient+product", "principle", "principle+ingredient+product", "empathy+principle+ingredient", "joke"]);
    expect(presets.map((p) => p.name)).toEqual(["제품만 추천", "성분 + 제품 추천", "이유 설명", "이유부터 제품까지", "자세히 길게", "짧게 농담으로"]);
    expect(presets[4].parts).toBe("공감+이유+성분");
  });
  it("조각이 다 들어 있으면 채우지 않는다", () => {
    expect(derivePresets(labels, 8).map((p) => p.id)).toContain("empathy+principle+ingredient+product");
  });
  it("이름 규칙", () => {
    expect(presetName(["empathy", "principle", "ingredient", "product"])).toBe("자세히 길게 + 제품");
    expect(presetName(["joke", "principle"])).toBe("농담 + 이유");
    expect(presetName(["empathy", "product"])).toBe("공감 + 제품 추천");
  });
  it("제품이 든 버전은 늘 세 경로", () => {
    expect(presetSet({ kinds: ["product", "ingredient"] })).toEqual({ kinds: ["ingredient", "product"], channels: ["pharmacy", "online", "overseas"] });
    expect(presetSet({ kinds: ["joke"] }).channels).toEqual([]);
  });
});

describe("댓글에 맞는 순서", () => {
  const presets = derivePresets([...many(5, "product"), ...many(3, "joke"), ...many(4, "principle", "ingredient")]);
  it("비슷한 댓글에 주인이 쓴 조합과 겹치는 버전이 앞, 위 둘 추천", () => {
    const pool = [
      { comment: "철분제 뭐 먹어야 해 추천 좀", label: { kinds: ["product"] as ComposeKind[], primary: "product" as const, channels: [], segments: [] } },
      { comment: "남편이 술 먹고 영양제 먹어", label: { kinds: ["joke"] as ComposeKind[], primary: "joke" as const, channels: [], segments: [] } },
    ];
    const ranked = rankByNeighbors("철분제 추천 좀 해줘", presets, pool);
    expect(ranked[0].id).toBe("product");
    expect(ranked.filter((p) => p.recommended)).toHaveLength(2);
  });
  it("유형 점수 순서로 줄 세우기", () => {
    const cats = [
      { id: "joke-back", name: "농담 받아치기", when: "장난", share: 15, prompt: "같이 놀아요" },
      { id: "link-guide", name: "링크 붙여 안내하기", when: "링크", share: 4, prompt: "링크" },
    ];
    const ps = presetsFromCategories(cats);
    expect(ps[0]).toMatchObject({ id: "joke-back", kinds: ["joke"], guide: "같이 놀아요" });
    expect(ps[1].kinds).not.toContain("product");
    expect(rankByOrder(ps, ["link-guide", "joke-back"]).map((p) => p.id)).toEqual(["link-guide", "joke-back"]);
  });
});
