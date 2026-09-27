import { describe, expect, it } from "vitest";
import { isShootable, parseShotOutput } from "./evidence-shot";
import type { AnswerSource } from "./model";

const base: AnswerSource = { id: "s1", kind: "웹", title: "t", quote: "원문 그대로의 인용 문장입니다.", url: "https://example.com/a" };

describe("isShootable", () => {
  it("원본 주소가 있는 웹·X·붙인 링크만 찍는다", () => {
    expect(isShootable(base)).toBe(true);
    expect(isShootable({ ...base, kind: "원글 원본", url: "https://x.com/a/status/1" })).toBe(true);
    expect(isShootable({ ...base, kind: "붙인 링크" })).toBe(true);
    expect(isShootable({ ...base, kind: "수집한 원문", url: "https://x.com/lydiahallie/status/2096668098422272007" })).toBe(true);
  });
  it("henry 노트·주소 없음·빈 인용은 찍지 않는다", () => {
    expect(isShootable({ ...base, kind: "수집노트" })).toBe(false);
    expect(isShootable({ ...base, kind: "내 경험" })).toBe(false);
    expect(isShootable({ ...base, url: undefined })).toBe(false);
    expect(isShootable({ ...base, url: "file:///etc/passwd" })).toBe(false);
    expect(isShootable({ ...base, quote: "  " })).toBe(false);
  });
});

describe("parseShotOutput", () => {
  it("마지막 JSON 줄을 읽는다", () => {
    const out = 'noise\n{"ok":false,"error":"a"}\n{"ok":true,"png":"/p.png","painted":1}\n';
    expect(parseShotOutput(out)).toEqual({ ok: true, png: "/p.png", painted: 1 });
  });
  it("JSON 이 없으면 null", () => {
    expect(parseShotOutput("crash\n")).toBeNull();
  });
});
