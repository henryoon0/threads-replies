// 스레드에 실제로 달릴 글. 서버 발송과 화면 미리보기가 같은 함수를 써서 "보이는 글 = 달리는 글"을 지킨다.
// 앞뒤 공백만 자르고 안쪽 엔터·띄어쓰기는 손대지 않는다. 미리보기는 whitespace-pre-wrap 으로 그려야 칸이 합쳐지지 않는다.
export function postedText(message: string): string {
  return message.replace(/\r\n?/g, "\n").trim();
}
