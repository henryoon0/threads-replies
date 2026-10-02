import { describe, expect, it } from "vitest";
import { postedText } from "./posted-text";

describe("postedText — 스레드에 실제로 달릴 글", () => {
  it("앞뒤 공백·빈 줄만 자르고 안쪽 엔터·띄어쓰기는 그대로 둔다", () => {
    expect(postedText("\n  첫 줄  두 칸\n\n\n셋째   줄 \n ")).toBe("첫 줄  두 칸\n\n\n셋째   줄");
  });
  it("윈도우 줄바꿈(\\r\\n)은 \\n 하나로 맞춘다", () => {
    expect(postedText("가\r\n나")).toBe("가\n나");
  });
});
