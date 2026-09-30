import { describe, expect, it } from "vitest";
import {
  firstSentenceDeclarative,
  hasContrastMove,
  insightNumberingRatio,
  maxFirstPostSimilarity,
  numbersNotInSource,
  politeEndingCount,
  textSimilarity,
} from "@/lib/content-ideas-style-eval";

describe("politeEndingCount", () => {
  it("한다체 선언문에서는 0", () => {
    const posts = [
      "AGI는 하나가 아니라 여럿이 될 가능성이 크다.",
      "1/ 앞으로는 처음과 끝이 훨씬 더 중요해진다. 프롬프트 작성과 결과 검토는 여전히 사람의 몫이다.",
    ];
    expect(politeEndingCount(posts)).toBe(0);
  });

  it("한다체 '아니다'를 존댓말로 오인하지 않는다 (아닙니다는 잡는다)", () => {
    expect(politeEndingCount(["코드가 안 돌아가서가 아니다. 잘 돌아간다."])).toBe(0);
    expect(politeEndingCount(["그건 사실이 아닙니다."])).toBe(1);
  });

  it("존댓말 종결을 문장 끝에서만 센다 (단어 속 '요'는 무시)", () => {
    const posts = [
      "요즘 다들 이 얘기를 합니다.",
      "중요한 건 요일이 아니라 흐름이다.",
      "이게 핵심이에요.",
    ];
    // "합니다." + "핵심이에요." = 2. "요즘"·"요일"은 세지 않는다.
    expect(politeEndingCount(posts)).toBe(2);
  });
});

describe("insightNumberingRatio", () => {
  it("첫 칸(후크)은 제외하고 본문 칸의 n/ 시작 비율을 잰다", () => {
    const posts = [
      "가장 센 선언으로 여는 후크다.",
      "1/ 첫 통찰이다.",
      "2/ 둘째 통찰이다.",
      "번호 없는 칸.",
    ];
    expect(insightNumberingRatio(posts)).toBeCloseTo(2 / 3);
  });

  it("본문이 없으면 0", () => {
    expect(insightNumberingRatio(["후크뿐"])).toBe(0);
  });
});

describe("firstSentenceDeclarative", () => {
  it("발행형 훅: 첫 문장이 한다체 선언이면 통과", () => {
    expect(
      firstSentenceDeclarative([
        "코드를 직접 안 짜는 시대일수록 코드를 아는 사람이 이긴다.\n\n앤드류응의 좋은 글이 나왔습니다.",
      ])
    ).toBe(true);
    expect(firstSentenceDeclarative(["코드를 아는 사람이 이깁니다. 본문."])).toBe(false);
    expect(firstSentenceDeclarative(["이거 봐야 하는 거 아니에요? 본문."])).toBe(false);
  });
});

describe("hasContrastMove", () => {
  it("'~가 아니라' 대조 무브를 잡는다", () => {
    expect(hasContrastMove(["AI는 직업을 빼앗는 게 아니라, 문을 연다."])).toBe(true);
    expect(hasContrastMove(["AI는 문을 연다."])).toBe(false);
  });
});

describe("textSimilarity / maxFirstPostSimilarity", () => {
  it("같은 글은 1, 무관한 글은 낮다", () => {
    const a = "어제까지 세 번 되묻던 클로드가 오늘은 한 번에 답을 내놓습니다.";
    expect(textSimilarity(a, a)).toBe(1);
    const b = "기획안 다섯 개를 받아든 팀장은 어디부터 봐야 할지 모른다.";
    expect(textSimilarity(a, b)).toBeLessThan(0.2);
    expect(maxFirstPostSimilarity([a, b, a])).toBe(1);
  });

  it("빈 배열·한 개는 0", () => {
    expect(maxFirstPostSimilarity([])).toBe(0);
    expect(maxFirstPostSimilarity(["하나"])).toBe(0);
  });
});

describe("numbersNotInSource", () => {
  it("소재에 없는 3자리 이상 숫자만 후보로 올린다", () => {
    const source = "조회수가 92만을 넘겼고, 1,000명에게 열렸다.";
    const posts = [
      "1/ 조회수 920000이 아니라 92만이다. 직원 1000명에게 열렸다.",
      "2/ 기획안 다섯 개, 30분 만에. 답변은 4500건이었다.",
    ];
    const out = numbersNotInSource(source, posts);
    // 92만(920000 표기)과 4500은 소재에 없다. 1000은 콤마 정규화로 소재와 일치.
    // 30(2자리)은 장면 소품으로 제외된다.
    expect(out).toContain("920000");
    expect(out).toContain("4500");
    expect(out).not.toContain("1000");
    expect(out).not.toContain("30");
  });
});
