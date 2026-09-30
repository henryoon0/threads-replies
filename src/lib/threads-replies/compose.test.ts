import { describe, expect, it } from "vitest";
import { assembleSections, attachAsk, isRemovalOnly, parseToggles, readAskBack, previousComposed, readSections, removeSections, toToggles, withComposed } from "./compose";
import { checkLabelDraft, replyUnits, stripMarkers, suggestToggles, toPairLabel, voiceViolations } from "./compose-kinds";

describe("토글", () => {
  it("켠 종류를 정해진 순서로, 제품은 경로로", () => {
    expect(parseToggles({ product: { overseas: true }, ingredient: true })).toEqual({ kinds: ["ingredient", "product"], channels: ["overseas"] });
    expect(parseToggles({ product: true })).toEqual({ kinds: ["product"], channels: ["pharmacy"] });
    expect(parseToggles({ product: {} })).toMatch(/하나도/);
    expect(parseToggles(null)).toMatch(/필요/);
    expect(toToggles({ kinds: ["joke", "product"], channels: ["online"] })).toEqual({ joke: true, product: { online: true } });
  });
});

describe("조각 조립·제거", () => {
  const raw = { sections: [{ kind: "principle", text: "철분이 빠지면 피곤해.." }, { kind: "product", text: "쏜 아이언 이틀에 한 번 ㅋㅋ" }, { kind: "joke", text: "안 켠 조각" }] };
  it("안 켠 종류는 버리고 기호는 지운다", () => {
    const r = readSections(raw, ["principle", "product"]);
    expect(r.extra).toEqual(["joke"]);
    expect(r.missing).toEqual([]);
    expect(r.sections.map((s) => s.text)).toEqual(["철분이 빠지면 피곤해.", "쏜 아이언 이틀에 한 번"]);
    expect(readSections(raw, ["empathy"]).missing).toEqual(["empathy"]);
  });
  it("위치는 글과 정확히 맞고, 끄면 그 조각만 빠진다", () => {
    const c = assembleSections([{ kind: "principle", text: "a".repeat(60) }, { kind: "product", text: "b".repeat(40) }]);
    expect(c.draft).toContain("\n\n");
    for (const s of c.sections) expect(c.draft.slice(s.start, s.end)).toMatch(s.kind === "principle" ? /^a+$/ : /^b+$/);
    const r = removeSections(c, ["product"]);
    expect(r?.draft).toBe("b".repeat(40));
    expect(r?.sections).toEqual([{ kind: "product", start: 0, end: 40 }]);
    expect(removeSections(c, ["joke"])).toBeNull();
    expect(isRemovalOnly(["principle", "product"], ["product"])).toBe(true);
    expect(isRemovalOnly(["principle"], ["principle", "joke"])).toBe(false);
  });
  it("짧으면 한 줄로 잇는다", () => {
    expect(assembleSections([{ kind: "joke", text: "오. 사랑이 최고의 영양제야." }, { kind: "principle", text: "잠부터." }]).draft).toBe("오. 사랑이 최고의 영양제야. 잠부터.");
  });
  it("원장에 넣으면 고른 초안 = AI 초안, 다시 넣으면 같은 벌을 바꾼다", () => {
    const c = assembleSections([{ kind: "joke", text: "야식이나 끊어라." }]);
    const set = { kinds: ["joke" as const], channels: [] };
    const a = withComposed(undefined, c, set, { model: "m", now: "t", sessionId: "s" });
    expect(a).toMatchObject({ draft: c.draft, aiDraft: c.draft, chosen: 0, sessionId: "s" });
    const b = withComposed(a, assembleSections([{ kind: "joke", text: "다른 글." }]), set, { model: "m", now: "t2" });
    expect(b.options).toHaveLength(1);
    expect(b.aiDraft).toBe("다른 글.");
    expect(previousComposed(b)?.kinds).toEqual(["joke"]);
  });
});

describe("말투 검사", () => {
  it("말줄임·웃음·달래기를 잡고 기호는 기계로 지운다", () => {
    expect(voiceViolations("엄마도 속상하겠다... ㅋㅋ").map((v) => v.kind)).toEqual(["ellipsis", "laugh", "sympathy"]);
    expect(voiceViolations("고생이 많았어 진짜 화이팅이다.")).toEqual([]);
    expect(stripMarkers("아프겠네… 소아과 가 ㅎㅎ")).toBe("아프겠네. 소아과 가");
  });
});

describe("분류 검증", () => {
  const units = new Map([["p001", replyUnits("오. 사랑이 최고의 영양제야. 철분은 쏜 아이언.")]]);
  it("문장 수와 태그 수가 맞아야 하고 모르는 태그는 오류", () => {
    expect(units.get("p001")).toHaveLength(3);
    expect(checkLabelDraft({ labels: { p001: ["joke", "joke", "product-overseas"] } }, units).errors).toEqual([]);
    expect(checkLabelDraft({ labels: { p001: ["joke"] } }, units).errors[0]).toMatch(/문장 3개/);
    expect(checkLabelDraft({ labels: { p001: ["joke", "x", "other"] } }, units).errors[0]).toMatch(/모르는/);
    expect(checkLabelDraft({ labels: {} }, units).errors[0]).toMatch(/태그 없는/);
  });
  it("쌍 라벨: 이어진 같은 종류는 한 조각, 주 종류는 글자 수로", () => {
    const l = toPairLabel(["오.", "사랑이 최고의 영양제야.", "철분은 쏜 아이언 비스글리시네이트 이틀에 한 번."], ["joke", "joke", "product-overseas"]);
    expect(l).toMatchObject({ kinds: ["joke", "product"], primary: "product", channels: ["overseas"] });
    expect(l?.segments).toHaveLength(2);
    expect(toPairLabel(["응?"], ["other"])).toBeNull();
  });
  it("비슷한 댓글에 주인이 넣은 종류로 토글을 제안한다", () => {
    const label = toPairLabel(["철분이 빠져서 그래.", "쏜 아이언."], ["principle", "product-overseas"])!;
    const s = suggestToggles("출산하고 너무 피곤해 철분 뭐 먹어", [{ comment: "출산하고 피곤해 철분 추천", label }]);
    expect(s.kinds).toEqual(["principle", "product"]);
    expect(s.channels).toEqual(["overseas"]);
  });
});

describe("되묻기", () => {
  it("enough=false 이고 질문이 있을 때만 되묻는다", () => {
    expect(readAskBack({ enough: false, ask: "몇 살이야?" })).toEqual({ enough: false, ask: "몇 살이야?" });
    expect(readAskBack({ enough: false, ask: " " })).toEqual({ enough: true, ask: "" });
    expect(readAskBack({ sections: [] })).toEqual({ enough: true, ask: "" });
  });
  it("질문은 마지막 조각 끝에, 조각이 없으면 켠 첫 종류로", () => {
    expect(attachAsk([{ kind: "principle", text: "그건 병원부터야." }], "언제부터 그랬어?", ["principle"])).toEqual([{ kind: "principle", text: "그건 병원부터야. 언제부터 그랬어?" }]);
    expect(attachAsk([], "지금 먹는 약 있어?", ["empathy", "product"])).toEqual([{ kind: "empathy", text: "지금 먹는 약 있어?" }]);
    expect(attachAsk([{ kind: "joke", text: "가" }], "", ["joke"])).toEqual([{ kind: "joke", text: "가" }]);
  });
});
