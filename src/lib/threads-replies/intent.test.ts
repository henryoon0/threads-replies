import { describe, expect, it } from "vitest";
import { classifyIntent } from "./intent";

// 실제 댓글과 같은 모양으로 바꿔 쓴 문장 (실제 댓글은 공유 저장소에 넣지 않는다)
describe("classifyIntent", () => {
  it.each([
    "Note-sync는 api키 없어도 써도 되나요.?",
    "Nova가 computer-use로 캔바에서 직접 작업을 한 것인가요!?",
    "왜 집에서 할땐 그렇게 프롬포트를 해도 결과가 이상한거죠",
    "아 제미나이도 이제 50달러 써야하나요 ㅎㅎ",
    "부산에 그런게 생겼나요? 해운대가 옮겼나???",
  ])("question: %s", (text) => {
    expect(classifyIntent(text, false)).toBe("question");
  });

  it.each([
    "좋은 글 감사합니다",
    "띠용!?",
    "띠용",
    "늘 좋은자료 감사합니다😊😊",
    "와우👏👏👏",
    "대박..",
    "ㄹㅇㅋㅋ",
    "gogogo!!",
    "작가님 최고 :-)",
    "▓",
  ])("reaction: %s", (text) => {
    expect(classifyIntent(text, false)).toBe("reaction");
  });

  it.each([
    "AI가 엑셀을 알아서 사용했다구요?!",
    "와우, 비서 앱이 하던 걸 그냥 다 알아서 하는거네요?! 빨리 써보고 싶네요!",
    "서울에서 절 만나기…?🙋‍♀️",
    "결국 내가 뭘 원하는지 먼저 알아야 어떤 도구든 제대로된 결과물을 얻을 수 있다는 말이군요",
    "감사합니다. 다른 플러그인과 차별점도 찾아보고싶네요!",
    "대단하긴 한데 비용이 얼마나 들지 감도 안오네..",
  ])("not a question: %s", (text) => {
    expect(classifyIntent(text, false)).toBe("chat");
  });

  it("reply to my reply is conversation unless it asks something", () => {
    expect(classifyIntent("네 저도 인터뷰부터 다시 해봐야겠어요", true)).toBe("conversation");
    expect(classifyIntent("그럼 effort는 어떻게 정하시나요?", true)).toBe("question");
    expect(classifyIntent("감사합니다", true)).toBe("reaction");
  });
});
