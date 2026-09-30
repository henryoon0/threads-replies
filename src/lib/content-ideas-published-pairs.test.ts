import { describe, it, expect } from "vitest";
import { matchPublishedToDrafts } from "@/lib/content-ideas-published-pairs";
import type { ContentIdea } from "@/lib/content-ideas-model";

// 실측 기반 표본 (2026-08-29 Buehler 건). henry 는 첫 줄을 통째로 바꿔 올렸는데도
// 소재의 고유명사·수치가 남아 유사도로 짝이 잡힌다 — 이 짝짓기의 전제다.
const DRAFT_POSTS = [
  "AI 에이전트 쓰시는 분들은 이 연구 꼭 보셔야 합니다. MIT의 Markus J. Buehler 교수가 대학원생 두 명과 함께 한 실험인데요. 똑같이 생긴 AI 에이전트 수백 개를 하나의 세계에 풀어놓고, 역할도 기술도 아무것도 정해주지 않았습니다.",
  "그런데 이들이 스스로 직업을 나누고, 남이 만든 코드를 물려받아 고치고, 결국 만든 사람이 사라진 뒤에도 계속 돌아가는 기술을 남겼습니다.",
];
const PUBLISHED_TEXT =
  "똑같은 AI 에이전트 수백 개를 한 세계에 풀어놓고 아무것도 시키지 않았습니다. MIT에서 나온 시뮬레이션 실험 결과가 꽤 충격적인데요. 가상의 무인도에 AI 수백 개를 풀어놨더니, 서로 말 한마디 없이 알아서 직업이 갈리고 남이 만든 걸 물려받아 고치고, 결국 자기들이 다 사라진 뒤에도 계속 돌아가는 시설을 지어버렸습니다.";

function idea(id: string, createdAt: string, posts: string[]): ContentIdea {
  return { id, createdAt, posts } as unknown as ContentIdea;
}

const post = (id: string, timestamp: string, text: string) => ({ id, timestamp, text });

describe("matchPublishedToDrafts", () => {
  it("첫 줄을 바꿔 올린 발행본도 같은 소재의 시안에 붙는다", () => {
    const pairs = matchPublishedToDrafts(
      [post("p1", "2026-08-29T22:00:00Z", PUBLISHED_TEXT)],
      [idea("i1", "2026-08-29T21:00:00Z", DRAFT_POSTS)]
    );
    expect(pairs).toHaveLength(1);
    expect(pairs[0].ideaId).toBe("i1");
    expect(pairs[0].draftFirstPost).toBe(DRAFT_POSTS[0]);
  });

  it("소재가 다르면 같은 날이라도 붙지 않는다", () => {
    const pairs = matchPublishedToDrafts(
      [post("p1", "2026-08-29T22:00:00Z", PUBLISHED_TEXT)],
      [
        idea("i1", "2026-08-29T21:00:00Z", [
          "노션이 새 데이터베이스 기능을 내놨습니다. 표를 여러 겹으로 쌓을 수 있게 됐어요.",
        ]),
      ]
    );
    expect(pairs).toEqual([]);
  });

  it("창 밖(3일 초과)이면 붙지 않는다", () => {
    const pairs = matchPublishedToDrafts(
      [post("p1", "2026-08-29T22:00:00Z", PUBLISHED_TEXT)],
      [idea("i1", "2026-08-20T21:00:00Z", DRAFT_POSTS)]
    );
    expect(pairs).toEqual([]);
  });

  it("시안 하나가 두 발행 글에 붙지 않는다 (더 닮은 쪽이 가져간다)", () => {
    const pairs = matchPublishedToDrafts(
      [
        post("p1", "2026-08-29T22:00:00Z", PUBLISHED_TEXT),
        post("p2", "2026-08-29T23:00:00Z", PUBLISHED_TEXT.slice(0, 90)),
      ],
      [idea("i1", "2026-08-29T21:00:00Z", DRAFT_POSTS)]
    );
    expect(pairs).toHaveLength(1);
    expect(pairs[0].postId).toBe("p1");
  });

  it("sinceISO 이전 발행은 건너뛴다 (이미 소화한 구간)", () => {
    const pairs = matchPublishedToDrafts(
      [post("p1", "2026-08-29T22:00:00Z", PUBLISHED_TEXT)],
      [idea("i1", "2026-08-29T21:00:00Z", DRAFT_POSTS)],
      { sinceISO: "2026-08-30T00:00:00Z" }
    );
    expect(pairs).toEqual([]);
  });
});
