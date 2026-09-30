import { describe, expect, it } from "vitest";
import { classifyIntent } from "./intent";

// 실제 댓글 (data/threads-replies/sample-conversations.json, 2026-09-27 수집)
describe("classifyIntent", () => {
  it.each([
    "Prompt-audit는 api사용 아니어도 써도 되나요.?",
    "Astra가 computer-use로 Figma에서 직접 작업을 한 것인가요!?",
    "왜 회사 일할땐 그렇게 프롬포트를 해도 결과가 이상한거죠",
    "아 클로드도 이제 100달러 써야하나요 ㅎㅎ",
    "할리우드에 그런게 생겼나요? 그리피스 천문대가 옮겼나???",
  ])("question: %s", (text) => {
    expect(classifyIntent(text, false)).toBe("question");
  });

  it.each([
    "좋은 글 감사합니다",
    "띠용!?",
    "띠용",
    "언제나 좋은자료 감사합니다😊😊",
    "와우👏👏👏",
    "대박..",
    "ㄹㅇㅋㅋ",
    "gogogo!!",
    "커피챗님 최고 :-)",
    "▓",
  ])("reaction: %s", (text) => {
    expect(classifyIntent(text, false)).toBe("reaction");
  });

  it.each([
    "클로드가 블랜더를 알아서 사용했다구요?!",
    "와우, AI 웹 브라우저가 하던 걸 그냥 다 알아서 하는거네요?! 빨리 써보고 싶네요!",
    "SF에서 절 만나기…?🙋‍♀️",
    "결국 내 스스로 내가 뭘 원하는가를 제대로 알아야 effort에 상관없이 제대로된 결과물을 얻을 수 있다는 말이군요",
    "감사합니다. Lazyweb mcp와 차별점도 찾아보고싶네요!",
    "대단하긴 한데 토큰을 얼마나 먹을지 감도 안오네..",
  ])("not a question: %s", (text) => {
    expect(classifyIntent(text, false)).toBe("chat");
  });

  it("reply to my reply is conversation unless it asks something", () => {
    expect(classifyIntent("네 저도 인터뷰부터 다시 해봐야겠어요", true)).toBe("conversation");
    expect(classifyIntent("그럼 effort는 어떻게 정하시나요?", true)).toBe("question");
    expect(classifyIntent("감사합니다", true)).toBe("reaction");
  });
});
