import { describe, expect, it } from "vitest";
import type { BrainPage } from "@/lib/supplement/brain";
import type { Catalog, CatalogIngredient } from "@/lib/supplement/catalog";
import { bestClaim,
  rankClaims, brainSources, pageEvidenceText, retrieveFromBrain } from "./retrieve-brain";
import type { ThreadsPostRef, ThreadsReply } from "./model";

const PAGE_TEXT = `---
type: ingredient
title: 비타민 B군 (B Vitamins)
---

# 비타민 B군 (B Vitamins)

별칭: B군 비타민
이럴 때 찾는다: 피로, 구내염, 입병

## 근거
- NIH 영양제 안내서: 없음
- PubMed 체계적 문헌고찰: 84건

## 팟캐스트에서 나온 말 (관점일 뿐, 추천 근거 아님)
- [경험담] Joe Rogan: 비타민 B 복합체를 먹고 지구력이 좋아졌다고 느꼈다.

## 제품 데이터
가격·판매량은 카탈로그 표에 있다 (slug: b-vitamins, 아마존 예시 2개).`;

const page: BrainPage = { slug: "ingredients/b-vitamins", title: "비타민 B군 (B Vitamins)", text: PAGE_TEXT, hits: 2 };

const ingredient: CatalogIngredient = {
  slug: "b-vitamins",
  nameEn: "B Vitamins",
  nameKo: "비타민 B군",
  aliasesKo: [],
  evidence: { nihFactSheet: false, systematicReviews: 84 },
  podcast: [
    { speaker: "Joe Rogan", kind: "anecdote", claim: "B", claimKo: "지구력이 좋아졌다고 느꼈다", quote: "q", videoId: "vid1", t: 9672.4, title: "JRE", channel: "c", duration: 0 },
    { speaker: "Mark Hyman", kind: "caveat", claim: "C", claimKo: "구내염이 반복되면 B12 결핍을 먼저 확인한다", quote: "q", videoId: "vid2", t: 60, title: "Hyman", channel: "c", duration: 0 },
  ],
  reddit: "",
  products: [{ brand: "SecretBrand", title: "SecretBrand B", price: 10, rating: 5, reviews: 1, monthlySold: 1, form: null, servings: null, asin: "X" }],
};
const catalog: Catalog = { builtAt: "", ingredients: [ingredient] };

const post: ThreadsPostRef = { id: "P", text: "무엇이든 물어봐", timestamp: "" };
const reply: ThreadsReply = {
  id: "R",
  postId: "P",
  username: "yoomayyy",
  text: "조금만 피곤해도 설염 구내염 ㅠ 자주나.. 뭐가 좋아 ?",
  timestamp: "",
  repliedToId: "P",
  intent: "question",
};

describe("pageEvidenceText", () => {
  it("앞머리·팟캐스트·제품 칸을 떼고 성분 설명·근거 칸만 남긴다 (원문 연속 조각)", () => {
    const t = pageEvidenceText(PAGE_TEXT);
    expect(t.startsWith("# 비타민 B군")).toBe(true);
    expect(t).toContain("PubMed 체계적 문헌고찰: 84건");
    expect(t).not.toMatch(/팟캐스트|제품|아마존|type:/);
    expect(PAGE_TEXT).toContain(t);
  });
});

describe("brainSources", () => {
  it("성분 페이지(근거 강도 제목) + 팟캐스트 발언, 제품은 절대 없음", () => {
    const got = brainSources([page], catalog, ["구내염"]);
    expect(got.map((s) => [s.id, s.kind, s.speaker])).toEqual([
      ["s1", "성분 페이지", undefined],
      ["s2", "팟캐스트 발언", "Mark Hyman"],
      ["s3", "팟캐스트 발언", "Joe Rogan"],
    ]);
    expect(got[0].title).toBe("비타민 B군 (B Vitamins) · 문헌고찰 84건");
    expect(got[1]).toMatchObject({
      quote: "q",
      claimKo: "구내염이 반복되면 B12 결핍을 먼저 확인한다",
      speaker: "Mark Hyman",
      videoTitle: "Hyman",
      startSec: 60,
      url: "https://www.youtube.com/watch?v=vid2&t=60s",
    });
    expect(JSON.stringify(got)).not.toContain("SecretBrand");
  });

  it("카탈로그에 없는 페이지는 성분 페이지만", () => {
    const got = brainSources([{ ...page, slug: "topics/unknown" }], catalog, []);
    expect(got.map((s) => s.kind)).toEqual(["성분 페이지"]);
    expect(got[0].title).toBe("비타민 B군 (B Vitamins)");
  });

  it("bestClaim: 댓글 낱말이 걸린 발언 → 주의·원리 발언 먼저", () => {
    expect(bestClaim(ingredient.podcast, ["지구력"])?.speaker).toBe("Joe Rogan");
    expect(bestClaim(ingredient.podcast, [])?.speaker).toBe("Mark Hyman");
  });

  it("rankClaims: 모든 발언에 있는 말은 가르지 못하고, 고르기 질문은 권하는 말 먼저", () => {
    const claims = [
      { ...ingredient.podcast[1], kind: "caveat", claimKo: "단식 중엔 마그네슘 같은 전해질을 챙긴다" },
      { ...ingredient.podcast[0], kind: "recommendation", claimKo: "마그네슘 글리시네이트는 수면에 적합하다" },
    ];
    expect(rankClaims(claims, ["마그네슘"])[0].kind).toBe("caveat");
    expect(rankClaims(claims, ["마그네슘"], true)[0].kind).toBe("recommendation");
    expect(rankClaims(claims, ["마그네슘", "잠"])[0].claimKo).toContain("수면");
  });
});

describe("retrieveFromBrain", () => {
  it("검색·카탈로그를 주입받아 근거와 trace 를 돌려준다", async () => {
    const seen: string[] = [];
    const r = await retrieveFromBrain(
      { reply, post },
      {
        search: async (q) => {
          seen.push(q);
          return { terms: ["구내염", "피로"], pages: [page] };
        },
        catalog: async () => catalog,
      }
    );
    expect(seen[0]).toContain("구내염");
    expect(r.sources.map((s) => s.kind)).toEqual(["성분 페이지", "팟캐스트 발언", "팟캐스트 발언"]);
    expect(r.trace.map((t) => t.stage)).toEqual(["brain", "catalog", "rank"]);
  });

  it("검색이 실패해도 던지지 않는다", async () => {
    const r = await retrieveFromBrain(
      { reply, post },
      { search: async () => Promise.reject(new Error("gbrain 없음")), catalog: async () => catalog }
    );
    expect(r.sources).toEqual([]);
    expect(r.trace[0]).toMatchObject({ stage: "brain", count: 0, note: "gbrain 없음" });
  });

  it("붙인 링크가 있으면 링크 근거가 먼저 온다", async () => {
    const r = await retrieveFromBrain(
      { reply, post, extraLinks: ["https://example.com/a"] },
      {
        search: async () => ({ terms: [], pages: [page] }),
        catalog: async () => catalog,
        fetchLink: async (url) => ({ id: `link:${url}`, kind: "붙인 링크", title: "링크 글", text: "구내염은 비타민 B2 부족과 관련이 있다.", url, origin: url }),
      }
    );
    expect(r.sources.map((s) => `${s.id}:${s.kind}`)).toEqual(["s1:붙인 링크", "s2:성분 페이지", "s3:팟캐스트 발언", "s4:팟캐스트 발언"]);
  });
});
