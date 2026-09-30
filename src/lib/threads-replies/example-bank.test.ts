import { describe, expect, it } from "vitest";
import { parseExampleBank, pickAsks, pickExamples, renderExampleBank, type BankEntry } from "./example-bank";

const e = (kind: BankEntry["kind"], i: number, comment: string, text: string, channel?: BankEntry["channel"]): BankEntry => ({
  kind,
  pairId: `v${kind}${i}`,
  comment,
  text,
  ...(channel ? { channel } : {}),
});

const bank: BankEntry[] = [
  e("empathy", 1, "육아하느라 너무 피곤해", "애 보면서 버틴 거면 몸이 먼저 신호 보내는 거야."),
  e("empathy", 2, "야근 때문에 잠을 못 자", "그 생활이면 영양제보다 잠이 먼저다-"),
  e("empathy", 3, "시험 준비 중인데 기운이 없어", "시험 끝날 때까지만 버티자. 밥은 꼭 챙겨 먹고, 커피는 오후 3시 전까지만 마셔. 그 이후엔 잠이 얕아져서 다음날 더 피곤해."),
  e("empathy", 4, "출산하고 머리가 빠져요", "출산 후 탈모는 대부분 돌아와."),
  e("empathy", 5, "요즘 우울해", "힘들면 병원도 같이 봐. 그건 약한 게 아니야."),
  e("empathy", 6, "다이어트 정체기야", "정체기는 다 와. 근육 지키는 게 이기는 거야."),
  e("product", 1, "철분 추천", "약국은 헤모큐.", "pharmacy"),
  e("product", 2, "철분 직구", "직구는 쏜 아이언 비스글리시네이트 25mg.", "overseas"),
];

describe("example bank md", () => {
  it("쓰고 읽으면 같은 조각이 돌아온다", () => {
    const md = renderExampleBank(bank, "# 은행");
    expect(parseExampleBank(md)).toEqual(bank);
  });

  it("줄바꿈 든 답은 한 줄로 적힌다", () => {
    const md = renderExampleBank([e("joke", 1, "댓글", "첫 줄\n둘째 줄")], "# x");
    expect(parseExampleBank(md)[0].text).toBe("첫 줄 / 둘째 줄");
  });
});

describe("pickExamples", () => {
  it("댓글마다 다른 묶음을 싣는다", () => {
    const a = pickExamples(bank, { comment: "회사 다니면서 늘 기운이 없어요", kinds: ["empathy"], perKind: 3 }).empathy ?? [];
    const b = pickExamples(bank, { comment: "애가 둘인데 체력이 바닥이야", kinds: ["empathy"], perKind: 3 }).empathy ?? [];
    expect(a).toHaveLength(3);
    expect(a.map((s) => s.pairId)).not.toEqual(b.map((s) => s.pairId));
  });

  it("같은 댓글은 늘 같은 묶음", () => {
    const x = pickExamples(bank, { comment: "피곤해", kinds: ["empathy"] });
    expect(pickExamples(bank, { comment: "피곤해", kinds: ["empathy"] })).toEqual(x);
  });

  it("비슷한 댓글에 단 조각을 먼저 싣는다", () => {
    const got = pickExamples(bank, { comment: "육아하느라 너무 피곤해요 영양제", kinds: ["empathy"], perKind: 3 }).empathy ?? [];
    expect(got[0].pairId).toBe("vempathy1");
  });

  it("짧은 조각과 긴 조각이 섞인다", () => {
    const got = pickExamples(bank, { comment: "아무 말", kinds: ["empathy"], perKind: 3, near: 0 }).empathy ?? [];
    const lens = got.map((s) => [...s.text].length);
    expect(Math.max(...lens) > 40 && Math.min(...lens) <= 40).toBe(true);
  });

  it("빼라는 쌍과 자기 댓글은 싣지 않는다", () => {
    const got = pickExamples(bank, { comment: "요즘 우울해", kinds: ["empathy"], exclude: new Set(["vempathy1"]), perKind: 6 }).empathy ?? [];
    expect(got.map((s) => s.pairId)).not.toContain("vempathy1");
    expect(got.map((s) => s.pairId)).not.toContain("vempathy5");
  });

  it("제품은 켠 경로 조각을 싣는다", () => {
    const got = pickExamples(bank, { comment: "철분", kinds: ["product"], channels: ["overseas"] }).product ?? [];
    expect(got.map((s) => s.channel)).toEqual(["overseas"]);
  });
});

describe("pickAsks", () => {
  const asks: BankEntry[] = [
    e("ask", 1, "철분 먹어도 돼?", "피검사는 해봤어?"),
    e("ask", 2, "애기 영양제", "애기 몇 개월이야?"),
    e("ask", 3, "피곤해", "몇달전부터 갑자기 그런거야?"),
    e("ask", 4, "다이어트약", "지금 먹는 약 있어?"),
  ];
  it("되묻기 문장은 은행 md 로 왕복하고, 댓글마다 다른 묶음", () => {
    expect(parseExampleBank(renderExampleBank(asks, "# x"))).toEqual(asks);
    const a = pickAsks(asks, { comment: "요즘 무기력해요" }, 2);
    const b = pickAsks(asks, { comment: "관절 영양제 추천" }, 2);
    expect(a).toHaveLength(2);
    expect(a.join()).not.toBe(b.join());
  });
  it("조각 선택에는 섞이지 않는다", () => {
    expect(pickExamples([...bank, ...asks], { comment: "피곤해", kinds: ["empathy"], perKind: 10 }).empathy?.every((s) => !s.text.includes("?"))).toBe(true);
  });
});
