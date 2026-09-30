import { describe, expect, it } from "vitest";
import { applyGateMode, checkCommentGate, checkGate, parseGateRules, type GateRules } from "./gate";
import { SEED_GATE_RULES } from "./gate-rules";

const glp1 = SEED_GATE_RULES.glp1;
const aicc = SEED_GATE_RULES.aicc;

// 구간이 원문과 정확히 맞고, 겹치지 않고, 앞에서부터 정렬돼 있는지
function expectSpansValid(text: string, rules: GateRules) {
  const { hits } = checkGate(text, rules);
  hits.forEach((h, i) => {
    expect(text.slice(h.start, h.end)).toBe(h.phrase);
    if (i > 0) expect(h.start).toBeGreaterThanOrEqual(hits[i - 1].end);
  });
  return hits;
}

describe("박약사 관문 (실제 답 문장)", () => {
  it.each([
    "담낭 제거했으면 담석 위험은 줄어서 마운자로가 더 맞을 수도 있어",
    "위고비 1mg 이랑 마운자로 5mg이 같다고 보면 돼",
    "2.5부터 시작하되 속도감있게 용량 올려봐. 마운자로 7.5까지 꽤 빠르게 가야될거야",
  ])("처방약 용량·증량 판단은 칠하지 않는다 (09-30 henry: 상황 판단으로 답한다): %s", (text) => {
    expect(checkGate(text, glp1)).toEqual({ status: "pass", hits: [] });
  });

  it.each([
    "제품은 비맥스 메타 추천이고",
    "쏜(Thorne)꺼 제품 아이허브에서 사",
    "철분은 쏜 아이언 비스글리시네이트. 이틀에 한 번도 괜찮아",
    "쿠팡에서 사면 돼",
    "난 사대주의 약사라서 해외 직구로 나우푸드 D3 2000IU 먹어",
    "약국에서 임팩타민 원스 달라고 해",
    "주사 고르는 건 처방 의사쌤이랑 정해야 해. 담낭 제거한 이력은 꼭 말씀드리고",
    "이노시톨은 다낭성 있는 사람한테만 효과가 확인된 성분이야",
  ])("제품·브랜드·구매처 추천은 통과한다: %s", (text) => {
    expect(checkGate(text, glp1)).toEqual({ status: "pass", hits: [] });
  });

  it("링크만 막는다", () => {
    const result = checkGate("여기 봐 https://example.com/a", glp1);
    expect(result.status).toBe("block");
    expect(result.hits[0]).toMatchObject({ kind: "link", phrase: "https://example.com/a" });
  });

  it("전문의약품·진단 표현은 확인(check)만 한다", () => {
    expect(checkGate("수면제 먹는 중이면 마그네슘은 저녁에", glp1).status).toBe("check");
    expect(checkGate("그건 갑상선 기능 저하증인 것 같아", glp1).status).toBe("check");
  });

  it("이모지가 앞에 있어도 구간은 String.slice 기준으로 맞다", () => {
    const text = "😀 불면이면 졸피뎀 말고 다른 방법부터";
    const [hit] = expectSpansValid(text, glp1);
    expect(hit.phrase).toBe("졸피뎀");
  });
});

describe("AICC 관문 (light, 확인만)", () => {
  it("가격·날짜·기수·약속을 칠하지만 막지 않는다", () => {
    const text = "3기는 10월 3일에 시작하고 29만 9천원이에요. 무조건 환불 보장이에요";
    const result = checkGate(text, aicc);
    expect(result.status).toBe("check");
    expect(result.hits.map((h) => h.kind)).toEqual(["cohort", "date", "price", "promise", "promise"]);
    expect(result.hits.find((h) => h.kind === "price")?.phrase).toBe("29만 9천원");
    expectSpansValid(text, aicc);
  });

  it("평범한 답은 통과한다", () => {
    expect(checkGate("그쵸 !! 저도 그래서 low 써요 ㅎㅎ", aicc).status).toBe("pass");
    expect(checkGate("원래 그렇게 쓰시면 돼요", aicc).status).toBe("pass");
  });
});

describe("관문 세기와 댓글 검사", () => {
  it("light 는 block 을 check 로 낮춘다", () => {
    const strict = checkGate("여기 봐 https://example.com/a", glp1);
    expect(applyGateMode(strict, "strict").status).toBe("block");
    const light = applyGateMode(strict, "light");
    expect(light.status).toBe("check");
    expect(light.hits.every((h) => h.action === "check")).toBe(true);
  });

  it("댓글은 막지 않고 안내(check)만 한다", () => {
    expect(checkCommentGate("수면제 추천해주세요", glp1).status).toBe("check");
  });
});

describe("규칙 파일 읽기", () => {
  it("모양이 틀린 규칙과 깨진 정규식은 버린다", () => {
    const parsed = parseGateRules({
      version: 1,
      rules: [
        { id: "ok", kind: "k", action: "check", pattern: "abc", reason: "r" },
        { id: "bad-re", kind: "k", action: "check", pattern: "(", reason: "r" },
        { id: "bad-action", kind: "k", action: "warn", pattern: "x", reason: "r" },
      ],
    });
    expect(parsed?.rules.map((r) => r.id)).toEqual(["ok"]);
    expect(parseGateRules({ nope: true })).toBeNull();
  });
});
