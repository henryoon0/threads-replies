// 스레드 댓글 성격 분류 — 휴리스틱(AI 호출 없음). Pure.
// question 만 근거 검색·판정을 거치므로 "되묻는 모양 + 정보를 묻는 말"일 때만 question 으로 본다.
// "띠용!?"·"~했다구요?!" 같은 놀람은 물음표가 있어도 질문이 아니다.
import type { ReplyIntent } from "./model";

/** 이모지·기호·웃음/울음 자모·공백을 걷어낸 알맹이. 길이로 "짧은 반응"을 가른다. */
export function coreText(text: string): string {
  return text
    .replace(/[\p{Extended_Pictographic}‍️]/gu, "")
    .replace(/[ㅋㅎㅠㅜㄷ]+/g, "")
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

// 정보를 묻는 말끝 (문장 끝 또는 물음표 앞). 놀람 말끝(다구요·네요·군요)은 뺀다.
const ASKING_ENDING =
  /(나요|까요|[인는한된던은건]가요|[을를]?까|는지요?|ㄴ지요?|인지요?|건지요?|거죠|건가|뭔가요|하죠|되죠|나\?|냐|니\?|요\?\s*$)/u;
const ASKING_ENDING_AT_END =
  /(나요|까요|[인는한된던은건]가요|을까|는지요?|인지요?|건지요?|거죠|건가|뭔가요|되죠)[\s.!?~^;…ㅎㅋㅠㅜ)\p{Extended_Pictographic}]*$/u;
const SURPRISE_ENDING = /(다구요|라구요|했구요|네요|군요|구나|거네|잖아요?)[\s?!.~…]*$/u;
// 되묻는 척하는 제안·추측 ("인앤아웃버거 아닐까요 😁") — 답을 주는 말이지 묻는 말이 아니다.
const HEDGE = /(아닐까요?|않을까요?|지 않나요?|않나)/u;
const WH_WORD = /(어떻게|어떤|어디|언제(?!나)|얼마|무엇|뭘|뭐가|뭐예요|뭔가요|누구|몇|왜|차이|방법|가능한가|되나|있나|없나)/u;

// 짧은 칭찬·감사·감탄 (길어지면 chat 으로 넘긴다)
const REACTION_WORDS =
  /(감사|고마|최고|대박|미쳤|멋지|멋있|와우|굿|좋네|좋아요|좋은\s?(글|자료|정보)|응원|화이팅|파이팅|레전드|레전더리|끝내주|놀랍|대단|신기|오오|우와|ㄷㄷ|gogo|wow|good|nice|thanks|thank you)/iu;

const TINY_CORE = 4;
const SHORT_REACTION_CORE = 16;

function sentences(text: string): string[] {
  return text
    .split(/(?<=[?？!.\n])\s*/u)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 되묻는 모양인가: 물음표가 있거나 문장이 묻는 말끝으로 끝난다. */
export function isQuestionShaped(text: string): boolean {
  if (/[?？]/.test(text)) return true;
  return sentences(text).some((s) => ASKING_ENDING_AT_END.test(s));
}

/** 정보를 묻는가: 물음이 담긴 문장 중 하나라도 의문사나 묻는 말끝을 가졌고, 놀람 말끝이 아니다. */
export function asksForInfo(text: string): boolean {
  return sentences(text).some((s) => {
    const shaped = /[?？]/.test(s) || ASKING_ENDING_AT_END.test(s);
    if (!shaped) return false;
    if ((SURPRISE_ENDING.test(s) || HEDGE.test(s)) && !WH_WORD.test(s)) return false;
    return ASKING_ENDING.test(s) || ASKING_ENDING_AT_END.test(s) || WH_WORD.test(s);
  });
}

/**
 * 댓글 성격을 가른다.
 * @param isReplyToMyReply 내가 단 답글에 다시 단 말인가 (대화 줄기)
 */
export function classifyIntent(text: string, isReplyToMyReply: boolean): ReplyIntent {
  const core = coreText(text);
  if (core.length <= TINY_CORE) return "reaction";
  if (isQuestionShaped(text) && asksForInfo(text)) return "question";
  if (core.length <= SHORT_REACTION_CORE && REACTION_WORDS.test(text)) return "reaction";
  if (isReplyToMyReply) return "conversation";
  return "chat";
}
