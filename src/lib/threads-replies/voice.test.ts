import { describe, expect, it } from "vitest";
import { pairId } from "@/lib/personas/voice-exclusions";
import {
  classifySituation,
  parseOwnerPairs,
  pickStyleExamples,
  situationForReply,
  toVoiceExamples,
  type VoiceExample,
} from "./voice";

function ex(comment: string, reply: string, at: string, situation?: VoiceExample["situation"]): VoiceExample {
  return { comment, reply, at, situation: situation ?? classifySituation(comment, reply) };
}

describe("classifySituation", () => {
  it("가른다: 강의 문의·질문·감사·농담·공유", () => {
    expect(classifySituation("4기 신청이 가능한가요!?", "네 가능해요 !\n\nhttps://open.kakao.com/o/x")).toBe("class_inquiry");
    expect(classifySituation("오 warp에서도 되나요?", "네 그렇죠 ㅎㅎ")).toBe("question_fact");
    expect(
      classifySituation("이건 어떻게 되는 건가요?", "어려운 질문이네요 .. 저는 전문가가 아니라서요")
    ).toBe("question_unknown");
    expect(classifySituation("좋은 글 감사합니다!", "🥰")).toBe("thanks");
    expect(classifySituation("월요일 아침부터 난 왜 이걸 보고 있는가 ㅋㅋㅋ", "ㅋㅋㅋㅋ😁")).toBe("joke");
    expect(classifySituation("알려쥬구가", "요기요 ♡\n\nhttps://mesurer.ibelick.com/")).toBe("share");
  });

  it("놀람 물음표는 질문이 아니다", () => {
    expect(classifySituation("자비스가 현실이...?!!", "얼른 테스트해보고 싶다 ..")).not.toMatch(/question/);
  });
});

describe("situationForReply", () => {
  it("intent 를 먼저 믿고 강의 질문만 더 가른다", () => {
    expect(situationForReply({ text: "5월 강의도 신청 되나요?", intent: "question" })).toBe("class_inquiry");
    expect(situationForReply({ text: "이거 어디서 써요?", intent: "question" })).toBe("question_fact");
    expect(situationForReply({ text: "감사합니다!!", intent: "reaction" })).toBe("thanks");
  });
});

describe("pickStyleExamples", () => {
  const pool: VoiceExample[] = [
    ex("warp에서도 되나요?", "네 그렇죠 클로드 코드 켜서 쓰는 스킬이니깐요 ㅎㅎ", "2026-08-18T00:00:00Z", "question_fact"),
    ex("어떻게 사용해요?", "커넥터에서 연결하시면 됩니다.", "2026-04-29T00:00:00Z", "question_fact"),
    ex("3D 업계 어떻게 되려나요", "어려운 질문이네요 .. 전문가가 아니라서", "2026-04-25T00:00:00Z", "question_unknown"),
    ex("좋은 글 감사합니다", "감사합니다 ㅎㅎ", "2026-09-01T00:00:00Z", "thanks"),
    ex("잘보겠습니다", "감사합니다 ㅎㅎ", "2026-09-02T00:00:00Z", "thanks"),
    ex("감사해요", "감사합니다 ㅎㅎ!", "2026-09-03T00:00:00Z", "thanks"),
    ex("ㅋㅋㅋ 웃기다", "ㅋㅋㅋㅋ 아니 내용을 보셔야죠", "2026-08-09T00:00:00Z", "joke"),
  ];

  it("같은 상황 계열을 먼저 채운다 (질문은 사실·모름 둘 다)", () => {
    const got = pickStyleExamples(pool, { text: "cursor에서도 되나요?", situation: "question_fact" }, 3);
    expect(got.map((e) => e.situation)).toEqual(["question_fact", "question_fact", "question_unknown"]);
  });

  it("댓글 글자 유사도가 높은 예시가 앞선다", () => {
    const got = pickStyleExamples(pool, { text: "warp에서도 되나요", situation: "question_fact" }, 1);
    expect(got[0].comment).toBe("warp에서도 되나요?");
  });

  it("거의 같은 답글은 하나만 남긴다", () => {
    const got = pickStyleExamples(pool, { text: "감사합니다", situation: "thanks" }, 3);
    const thanks = got.filter((e) => e.situation === "thanks");
    expect(thanks).toHaveLength(1);
    expect(got).toHaveLength(3);
  });

  it("비슷하면 최근 것을 고른다", () => {
    const p = [
      ex("좋아요", "고마워요 💌", "2025-01-01T00:00:00Z", "thanks"),
      ex("좋아요", "최고예요 🥰", "2026-09-01T00:00:00Z", "thanks"),
    ];
    expect(pickStyleExamples(p, { text: "좋아요", situation: "thanks" }, 1)[0].reply).toBe("최고예요 🥰");
  });

  it("exclude 로 홀드아웃을 뺀다", () => {
    const got = pickStyleExamples(
      pool,
      { text: "warp에서도 되나요?", situation: "question_fact" },
      5,
      { exclude: (e) => e.comment === "warp에서도 되나요?" }
    );
    expect(got.some((e) => e.comment === "warp에서도 되나요?")).toBe(false);
  });

  it("k<=0 이면 빈 배열", () => {
    expect(pickStyleExamples(pool, { text: "x", situation: "thanks" }, 0)).toEqual([]);
  });
});

describe("toVoiceExamples", () => {
  it("댓글이나 답글이 빈 짝은 버린다", () => {
    const got = toVoiceExamples([
      { comment: "", reply: "a", at: "" },
      { comment: null, reply: "a", at: "" },
      { comment: "감사합니다", reply: "🥰", at: "2026-01-01" },
    ]);
    expect(got).toHaveLength(1);
    expect(got[0].situation).toBe("thanks");
  });
});

describe("parseOwnerPairs", () => {
  it("AICC 모양 [{comment, reply}] 과 박약사 모양 {pairs:[{q, a}]} 을 같은 쌍으로 읽는다", () => {
    const aicc = parseOwnerPairs([{ comment: "좋은 글 감사합니다", reply: "🥰", at: "2026-01-01", commenter: "x", root: "r1" }, { comment: "", reply: "a" }]);
    expect(aicc).toEqual([{ id: pairId("좋은 글 감사합니다", "🥰"), comment: "좋은 글 감사합니다", reply: "🥰", at: "2026-01-01", commenter: "x", root: "r1" }]);
    const glp1 = parseOwnerPairs({ source: "aside", pairs: [{ q: "마그네슘 뭐가 좋아?", a: "글리시네이트 형태 찾아봐-" }] });
    expect(glp1).toHaveLength(1);
    expect(glp1[0]).toMatchObject({ comment: "마그네슘 뭐가 좋아?", reply: "글리시네이트 형태 찾아봐-" });
    expect(parseOwnerPairs("nope")).toEqual([]);
  });

  it("예시에 쌍 id 가 붙는다 (카테고리 exampleIds 가 가리키는 값)", () => {
    const [e] = toVoiceExamples([{ comment: "감사합니다", reply: "🥰", at: "" }]);
    expect(e.id).toBe(pairId("감사합니다", "🥰"));
  });
});
