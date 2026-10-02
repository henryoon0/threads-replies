// 스레드 댓글 답글 초안 — 지금 페르소나(주인) 말투 + 근거 인용 (픽 4 "답할 수 있음 판정", 픽 9 "초안 3벌").
//
// Opus 5.5 한 번 호출. 팩 폴더(~/.local/share/reply-personas/<id>)를 작업 폴더로 돌려서
// 세션이 팩의 CLAUDE.md → AGENTS.md(말투 규칙책)를 직접 읽는다. 그래서 규칙책을 프롬프트에 붙이지 않고,
// 팩 SAFETY.md 만 --append-system-prompt 로 붙인다. 세션은 저장돼 다시 쓰기가 같은 대화에 이어 쓴다.
//
//   3벌 (팩에 categories.json 이 있을 때): 주인의 실제 답을 유형별로 나눈 카테고리 가운데
//     이 댓글에 맞는 셋을 모델이 고르고, 카테고리마다 그 유형의 지시문으로 한 벌씩 쓴다.
//   1벌 (categories.json 이 없을 때): 예전 한 벌짜리 프롬프트를 쓰고 한 벌짜리 options 로 감싼다.
//
// 정확성 장치는 프롬프트와 코드 양쪽에 있다: 모델이 없는 근거 id 를 달면 버리고,
// 질문인데 근거 달린 문장이 하나도 없으면 판정을 "unknown" 으로 내린다.

import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { runClaudeCLI } from "@/lib/ai/claude-cli";
import { parseJsonObject } from "@/lib/ai/json";
import { textSimilarity } from "@/lib/content-ideas-style-eval";
import { readCategories, type CategoriesFile, type ReplyCategory } from "@/lib/personas/categories";
import { currentPersona } from "@/lib/personas/context";
import type { PersonaConfig } from "@/lib/personas/model";
import { packDir, packFile, packRulebookPath } from "@/lib/personas/registry";
import { nextDistinctCategory, offendingIndex, pickDiverseCategories, targetTraits, tooSimilar } from "./diversity";
import { dropUnsupported, removeFromDraft, sourceCorpus, type DroppedSentence, type FactCorpus } from "./fact-check";
import { assignRoles, lengthPlan, roleForLength, roleLine, type LengthPlan } from "./length-plan";
import { fixLengths } from "./length-fix";
import type {
  AnswerSource,
  AnswerVerdict,
  DraftOption,
  DraftSentence,
  LengthRole,
  PastSaid,
  ReplyAnswer,
  ThreadsPostRef,
  ThreadsReply,
} from "./model";
import {
  SITUATION_LABEL,
  loadStyleBook,
  loadVoiceExamples,
  pickStyleExamples,
  situationForReply,
  type PickOptions,
  type ReplySituation,
  type VoiceExample,
} from "./voice";

// 답 초안·버전 쓰기의 모델과 effort 는 여기 한 곳에서 바꾼다 (compose-run 도 이 값을 쓴다).
export const ANSWER_MODEL = "claude-opus-5-5";
export const ANSWER_EFFORT = "medium" as const;
const DEFAULT_TIMEOUT_MS = 240_000;
const STYLE_EXAMPLE_COUNT = 10;
const DETAILED_CATEGORIES = 5;
const EXAMPLES_PER_CATEGORY = 3;
/** 세 벌을 고를 후보 수 (댓글에 맞는 순) — 이 안에서 말투가 가장 먼 셋을 고른다 */
const DIVERSE_POOL = 6;
/** 다른 버전 한 번에 시도할 카테고리 수 (빈 벌이 나오면 다음으로) */
const MORE_ATTEMPTS = 2;
const POST_CHARS = 1500;
const QUOTE_CHARS = 900;
const EXAMPLE_REPLY_CHARS = 600;
/** 내 글 본문을 근거로 인용할 때 쓰는 id */
export const POST_SOURCE_ID = "p";
/** 주인 메모를 근거로 쓸 때의 id */
export const NOTE_SOURCE_ID = "note";
/** categories.json 이 없을 때 한 벌짜리 답을 감싸는 카테고리 */
export const SINGLE_CATEGORY = { id: "default", name: "기본 한 벌" } as const;

/** claude-cli 기본 단발 지시와 같은 문장. 팩 SAFETY.md 를 여기에 이어 붙인다. */
const GENERATOR_RULE =
  "당신은 한 번의 호출로 끝나는 텍스트 생성기입니다. 어떤 도구도 쓰지 말고(웹검색 포함), 다른 워크플로우나 에이전트를 시작하지 마세요. 요청된 형식의 최종 출력만 다른 텍스트 없이 반환하세요.";

export interface AnswerInput {
  reply: ThreadsReply;
  post: ThreadsPostRef;
  sources: AnswerSource[];
  conversation?: { username: string; text: string }[];
  instruction?: string;
  /** 주인이 직접 적은 메모 (필드 이름은 화면 호환 때문에 henryNote 그대로) */
  henryNote?: string;
  /** 주인이 예전에 같은 주제·같은 사람에게 한 답 (past-said.ts). 새 답은 이와 어긋나면 안 된다 */
  pastSaid?: PastSaid[];
}

export interface RunOptions {
  systemAppend: string;
  workspace?: { dir: string; sessionId: string; resume?: boolean };
  signal?: AbortSignal;
}

export interface AnswerDeps {
  run?: (prompt: string, opts: RunOptions) => Promise<string>;
  /** 1벌 경로에 쓸 예시 (이미 고른 것) */
  examples?: VoiceExample[];
  /** 3벌 경로의 예시 풀 (카테고리 exampleIds 를 찾는 곳) */
  pool?: VoiceExample[];
  /** 팩 폴더에서 못 돌 때 프롬프트에 싣는 규칙책 */
  styleBook?: string;
  /** null = 카테고리 없음 (1벌) */
  categories?: CategoriesFile | null;
  persona?: PersonaConfig;
  /** null = 팩 폴더 없음 (세션 없이 격리 호출 + 규칙책을 프롬프트에) */
  workspaceDir?: string | null;
  safety?: string;
  /** 새 세션 id (테스트 고정용) */
  sessionId?: string;
  /** 다시 쓰기: 이 세션에 이어 쓴다 (실패하면 새 세션으로 처음부터) */
  resumeSessionId?: string;
  now?: () => Date;
  /** 예시 고르기 옵션 (평가에서 홀드아웃을 빼는 데 쓴다) */
  pick?: PickOptions;
  /** 잡 상한에 걸리면 CLI 자식까지 죽인다 */
  signal?: AbortSignal;
}

export interface AnswerPromptParts {
  reply: ThreadsReply;
  post: ThreadsPostRef;
  sources: AnswerSource[];
  conversation?: { username: string; text: string }[];
  instruction?: string;
  henryNote?: string;
  pastSaid?: PastSaid[];
  /** 비우면 팩 규칙책(AGENTS.md)을 세션이 읽었다고 본다 */
  styleBook: string;
  examples: VoiceExample[];
  situation: ReplySituation;
  persona?: PersonaConfig;
}

function answerTimeoutMs(): number {
  const v = Number(process.env.THREADS_ANSWER_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_TIMEOUT_MS;
}

function clip(text: string, max: number): string {
  const t = (text ?? "").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function isQuestionSituation(s: ReplySituation): boolean {
  return s === "question_fact" || s === "question_unknown" || s === "class_inquiry";
}

// ── 주인 소개 (페르소나에서) ─────────────────────────────────────────

/** "박약사(스레드 @glp1.pharmacy, 약사식 판단으로 …)" */
export function ownerLine(p: PersonaConfig): string {
  const handle = p.handle ? `스레드 @${p.handle}` : "";
  const intro = p.handle && p.intro.includes(p.handle) ? p.intro : [handle, p.intro].filter(Boolean).join(", ");
  return intro ? `${p.ownerName}(${intro})` : p.ownerName;
}

function registerRule(p: PersonaConfig): string {
  return p.register === "반말"
    ? "말씨는 반말이다. 친구에게 말하듯 쓰고 존댓말(~요, ~습니다)을 섞지 않는다."
    : "말씨는 존댓말 해요체다. 반말로 쓰지 않는다.";
}

function voiceSourceLine(p: PersonaConfig, hasBook: boolean): string {
  return hasBook
    ? `아래 <style_book>은 ${p.ownerName}의 말투 규칙책이다.`
    : `${p.ownerName}의 말투 규칙책은 이 폴더의 AGENTS.md 로 이미 읽었다. 그 규칙을 따른다.`;
}

// ── 프롬프트 조각 ────────────────────────────────────────────────────

function exampleXml(e: VoiceExample, i: number, withSituation: boolean): string {
  const situation = withSituation ? ` situation="${SITUATION_LABEL[e.situation]}"` : "";
  return `<example n="${i + 1}"${situation}>\n<comment>${clip(e.comment, 300)}</comment>\n<owner_reply>${clip(e.reply, EXAMPLE_REPLY_CHARS)}</owner_reply>\n</example>`;
}

function exampleBlock(examples: VoiceExample[]): string {
  if (!examples.length) return "(예시 없음)";
  return examples.map((e, i) => exampleXml(e, i, true)).join("\n");
}

function sourceBlock(sources: AnswerSource[], post: ThreadsPostRef): string {
  const lines = [`<source id="${POST_SOURCE_ID}" kind="내 글 본문">\n${clip(post.text, POST_CHARS)}\n</source>`];
  for (const s of sources) {
    const url = s.url ? ` url="${s.url}"` : "";
    const speaker = s.speaker ? ` speaker="${s.speaker.replace(/"/g, "'")}"` : "";
    const ko = s.claimKo ? `\n(한국어 요약: ${s.claimKo})` : "";
    lines.push(
      `<source id="${s.id}" kind="${s.kind}" title="${s.title.replace(/"/g, "'")}"${speaker}${url}>\n${clip(s.quote, QUOTE_CHARS)}${ko}\n</source>`
    );
  }
  return lines.join("\n");
}

function conversationBlock(conv: AnswerPromptParts["conversation"]): string {
  if (!conv?.length) return "";
  const body = conv.map((m) => `${m.username}: ${clip(m.text, 400)}`).join("\n");
  return `\n<conversation_so_far>\n${body}\n</conversation_so_far>\n`;
}

function previousReplyBlock(reply: ThreadsReply, owner: string): string {
  if (reply.repliedToId === reply.postId || !reply.repliedToText) return "";
  return `\n<owner_previous_reply>${clip(reply.repliedToText, 400)}</owner_previous_reply>\n(이 댓글은 위 ${owner} 답글에 이어 달린 말이다.)\n`;
}

function extrasBlock(parts: Pick<AnswerPromptParts, "henryNote" | "instruction">, owner: string): string {
  const note = parts.henryNote?.trim();
  const instruction = parts.instruction?.trim();
  return [
    note
      ? `<owner_note>${owner}이(가) 직접 적은 메모. ${owner} 본인 경험이니 사실로 써도 되고, 이 메모를 받치는 문장의 sourceIds 는 ["${NOTE_SOURCE_ID}"]로 둔다.\n${note}\n</owner_note>`
      : "",
    instruction ? `<owner_instruction>이번 초안에 대한 ${owner}의 요청: ${instruction}</owner_instruction>` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function commentBlock(reply: ThreadsReply, situation?: ReplySituation): string {
  const s = situation ? ` situation="${SITUATION_LABEL[situation]}"` : "";
  return `<comment author="${reply.username}"${s}>\n${reply.text.trim()}\n</comment>`;
}

/** 내 글 · 대화 줄기 · 앞 답글 · 댓글 · 근거 · 메모 · 예전에 한 말까지 (1벌·3벌 공통) */
type ContextParts = Pick<AnswerPromptParts, "reply" | "post" | "sources" | "conversation" | "instruction" | "henryNote" | "pastSaid">;

/** 예전에 한 말: 새 답이 이와 어긋나지 않게 (되풀이·덧붙임은 된다). 없으면 빈 문자열. */
export function pastSaidBlock(past: readonly PastSaid[] | undefined, owner: string): string {
  if (!past?.length) return "";
  const items = past
    .map((p) => {
      const attrs = `${p.date ? ` date="${p.date}"` : ""}${p.sameCommenter ? ` same_person="true"` : ""}`;
      const comment = p.comment ? `\n(받은 댓글: ${clip(p.comment, 160)})` : "";
      return `<past${attrs}>${comment}\n${clip(p.text, 400)}\n</past>`;
    })
    .join("\n");
  return `\n<owner_past_replies>\n예전에 한 말: ${owner}이(가) 같은 주제로(또는 이 댓글 단 사람에게) 실제로 단 답이다. same_person="true" 는 지금 댓글 단 사람에게 한 답이다.\n${items}\n</owner_past_replies>\n새 답은 이 예전 답과 어긋나면 안 된다. 같은 점(방법·수치·추천 여부·가능 여부·순서)에 대해 다른 말을 하지 않는다. 예전 말을 되풀이하거나 더 자세히 덧붙이는 건 된다. 근거가 예전 답과 다르면 근거 쪽 사실만 쓰되 단정하지 말고, 예전 답을 뒤집는 말은 쓰지 않는다.\n`;
}

function contextBlocks(parts: ContextParts, owner: string, question: boolean, situation?: ReplySituation): string {
  const extras = extrasBlock(parts, owner);
  return `<my_post>
${clip(parts.post.text, POST_CHARS)}
</my_post>
${conversationBlock(parts.conversation)}${previousReplyBlock(parts.reply, owner)}
${commentBlock(parts.reply, situation)}
${question ? `\n<sources>\n${sourceBlock(parts.sources, parts.post)}\n</sources>\n` : ""}${pastSaidBlock(parts.pastSaid, owner)}
${extras ? `\n${extras}\n` : ""}`;
}

function evidenceRules(owner: string, hasSources: boolean): string {
  return `1. 먼저 <sources>에서 질문에 직접 답하는 부분을 찾는다. ${hasSources ? "붙은 근거와 내 글 본문(id \"p\")을 모두 본다." : "붙은 근거가 없으니 내 글 본문(id \"p\")만 근거로 쓸 수 있다."}
2. 사실은 근거 인용에 있는 말만 쓴다. 사실을 말하는 문장(수치, 이름, 기능, 방법, 날짜, 가격, 가능 여부, 용량, 효과, 부작용)은 그 사실이 그대로 적힌 근거 id를 sourceIds에 넣는다. 근거에 없는 사실은 "내가 알기론"을 붙여도 쓰지 않는다. 모르면 쓰지 말고 모른다고 짧게 말한다.
3. 팟캐스트 발언 근거는 누가 한 말인지 밝혀 옮긴다(예: "허버먼이 팟캐스트에서 ~라고 하더라"). 발언은 관점이지 처방이 아니다.
4. 근거가 받치지 않는 문장은 sourceIds를 []로 두고, 사실이 아닌 말(권유·질문·맞장구·인사·약속)만 쓴다. 근거 없는 사실 문장은 코드가 초안에서 지운다.
5. 판정:
   - answerable: 질문의 핵심에 근거 달린 문장으로 답했다.
   - partial: 일부만 근거로 답했고 나머지는 ${owner} 확인이 필요하다.
   - unknown: 근거가 질문에 답하지 못한다. 이때 답은 근거로 말할 수 있는 만큼만 짧게 말하거나, 아직 확인하지 못했다고 짧게 인정한다. 나중에 알려주겠다는 약속은 ${owner}이(가) 직접 확인할 수 있는 일일 때 한 번만 쓴다.`;
}

function questionTask(owner: string, hasSources: boolean): string {
  return `## 이번 일
댓글은 질문이다. ${owner}이(가) 직접 답하는 것처럼 답글 초안을 쓰고, 문장마다 어느 근거에서 왔는지 표시한다.

${evidenceRules(owner, hasSources)}
6. ownerAsk: ${owner}만 아는 경험(직접 써봤는지, 어떤 설정을 쓰는지 등)이 답을 크게 낫게 만들 때 그 질문 한 줄. 필요 없으면 "".`;
}

function reactionTask(owner: string): string {
  return `## 이번 일
댓글은 질문이 아니다(감사·감탄·농담·대화). 근거는 쓰지 않는다. ${owner}이(가) 실제로 달 법한 짧은 답글을 쓴다.
- verdict는 "answerable", verdictReason은 "반응 댓글", 모든 sentences의 sourceIds는 [], ownerAsk는 "".`;
}

// ── 1벌 프롬프트 (categories.json 이 없을 때) ─────────────────────────

function singleSchema(owner: string): string {
  return `{
  "verdict": "answerable" | "partial" | "unknown",
  "verdictReason": "${owner}에게 보이는 판정 이유 한 줄 (예: \\"s1 원문에 설정 방법이 그대로 있음\\")",
  "sentences": [ { "text": "답글의 한 문장", "sourceIds": ["s1"] } ],
  "draft": "sentences를 이어 붙인 최종 답글 (${owner} 말투, 줄바꿈 허용)",
  "ownerAsk": "자료로 못 채우는 ${owner} 경험 질문 한 줄, 없으면 빈 문자열"
}`;
}

/** 예시 답 길이로 잡은 이번 답 길이 목표 (주인마다 다르므로 실측 예시에서 계산한다). */
export function lengthTarget(examples: readonly VoiceExample[]): string {
  const lens = examples.map((e) => [...e.reply.trim()].length).sort((a, b) => a - b);
  if (!lens.length) return "예시 답 길이에 맞춘다";
  const median = lens[Math.floor((lens.length - 1) / 2)];
  const p90 = lens[Math.min(lens.length - 1, Math.ceil(lens.length * 0.9) - 1)];
  return `예시 답 중앙값 ${median}자, 길어도 ${p90}자 안`;
}

export function buildAnswerPrompt(parts: AnswerPromptParts): string {
  const persona = parts.persona ?? currentPersona();
  const owner = persona.ownerName;
  const question = isQuestionSituation(parts.situation);
  const book = parts.styleBook.trim();
  const label = SITUATION_LABEL[parts.situation];

  return `당신은 ${ownerLine(persona)}의 스레드 답글을 ${owner} 대신 쓰는 사람이다. 목표는 ${owner}의 팔로워가 읽었을 때 ${owner}이(가) 직접 단 답글과 구별이 안 되는 글이다. ${voiceSourceLine(persona, !!book)} 예시는 이번 댓글과 닮은 자리에서 ${owner}이(가) 실제로 쓴 답글이다. ${registerRule(persona)}
${book ? `\n<style_book>\n${book}\n</style_book>\n` : ""}
<owner_real_replies>
${exampleBlock(parts.examples)}
</owner_real_replies>

${contextBlocks(parts, owner, question, parts.situation)}
${question ? questionTask(owner, parts.sources.length > 0) : reactionTask(owner)}

## 말투
- 규칙책의 "${label}" 상황 규칙과 예시의 길이·첫 마디·끝맺음을 따른다. 이번 답 길이 목표: ${lengthTarget(parts.examples)}.
- 첫 마디가 곧 답이다. 댓글이 물은 것에 바로 반응한다.
- 답글은 대화다. 내 글 본문의 설명체를 쓰지 않고, 예시처럼 말하듯 쓴다.
- 근거에서 가져온 사실도 ${owner}의 입말로 옮긴다.

## 출력
아래 JSON 객체 하나만 출력한다. 설명·코드펜스 없이.
${singleSchema(owner)}`;
}

// ── 3벌 프롬프트 ─────────────────────────────────────────────────────

export interface OptionsPromptParts extends Omit<AnswerPromptParts, "examples" | "situation"> {
  question: boolean;
  categories: ReplyCategory[];
  /** 지시문 전문을 싣는 카테고리 (이 댓글에 맞을 법한 것) + 그 실제 예시 + 길이 역할 */
  detailed: DetailedCategory[];
  /** 주인 실측 길이 목표 (있으면 벌마다 짧게·중간·길게) */
  plan?: LengthPlan | null;
}

export interface DetailedCategory {
  category: ReplyCategory;
  examples: VoiceExample[];
  role?: LengthRole;
}

function optionsSchema(owner: string): string {
  return `{
  "verdict": "answerable" | "partial" | "unknown",
  "verdictReason": "${owner}에게 보이는 판정 이유 한 줄",
  "options": [
    { "categoryId": "<category_details>의 id", "sentences": [ { "text": "답글의 한 문장", "sourceIds": ["s1"] } ], "draft": "sentences를 이어 붙인 최종 답글" }
  ],
  "ownerAsk": "자료로 못 채우는 ${owner} 경험 질문 한 줄, 없으면 빈 문자열"
}
options 는 정확히 3개이고, <category_details>에 적힌 세 카테고리를 그 순서대로 하나씩 쓴다.`;
}

function detailedBlock(detailed: OptionsPromptParts["detailed"], plan?: LengthPlan | null): string {
  return detailed
    .map(
      ({ category: c, examples, role }) => `<category id="${c.id}" name="${c.name}">
<when>${c.when}</when>
<target>${targetTraits(c)}</target>${role && plan ? `\n<length>${roleLine(role, plan)} (길이는 <target>보다 이 줄이 먼저다)</length>` : ""}
<prompt>
${c.prompt.trim()}
</prompt>
<owner_real_replies>
${examples.map((e, i) => exampleXml(e, i, false)).join("\n") || "(예시 없음)"}
</owner_real_replies>
</category>`
    )
    .join("\n");
}

function optionsTask(owner: string, question: boolean, hasSources: boolean): string {
  const evidence = question
    ? `\n댓글은 질문이다. 세 벌 모두 아래 근거 규칙을 지킨다. 판정(verdict)은 세 벌을 통틀어 한 번 낸다.\n${evidenceRules(owner, hasSources)}\n6. ownerAsk: ${owner}만 아는 경험이 답을 크게 낫게 만들 때 그 질문 한 줄. 필요 없으면 "".`
    : `\n댓글은 질문이 아니다(감사·감탄·농담·대화). 근거는 쓰지 않는다. verdict는 "answerable", verdictReason은 "반응 댓글", 모든 sourceIds는 [], ownerAsk는 "".`;
  return `## 이번 일
1. <category_details>의 세 카테고리는 ${owner}의 실제 답 가운데 서로 말투가 가장 먼 유형으로 골라 둔 것이다. 적힌 순서대로 한 카테고리에 한 벌씩 쓴다.
2. 벌마다 그 카테고리의 <prompt>를 따르고, <target>의 첫 마디·끝맺음·이모지·웃음을 맞춘다. 길이는 <length>(짧게·중간·길게)를 지킨다. 짧은 벌과 긴 벌은 글자 수가 확 달라야 한다. 규칙책 AGENTS.md 의 말투 규칙은 세 벌 모두 지킨다.
3. 세 벌은 나란히 놓였을 때 한눈에 달라 보여야 한다: 길이, 첫 마디, 끝맺음, 무엇을 앞에 세우는지(되묻기·농담·설명·경험)가 다르다. 같은 사실을 같은 순서로 되풀이하지 않는다.
4. 어려운 말(성분명·기술 용어·영어 약어)을 쓰면 바로 뒤에 일상 말로 짧게 풀어준다. 재미는 ${owner}의 실제 예시에 있는 방식으로만 낸다.
${evidence}`;
}

export function buildOptionsPrompt(parts: OptionsPromptParts): string {
  const persona = parts.persona ?? currentPersona();
  const owner = persona.ownerName;
  const book = parts.styleBook.trim();
  return `당신은 ${ownerLine(persona)}의 스레드 답글을 ${owner} 대신 쓰는 사람이다. 목표는 ${owner}의 팔로워가 읽었을 때 ${owner}이(가) 직접 단 답글과 구별이 안 되는 글이다. ${voiceSourceLine(persona, !!book)} ${registerRule(persona)}
${book ? `\n<style_book>\n${book}\n</style_book>\n` : ""}
아래 카테고리는 ${owner}이(가) 실제로 단 답을 유형별로 나눈 것 가운데 이번에 쓸 셋이다. 카테고리마다 지시문(prompt), 실측 목표(target), 실제 답 예시가 있다.

<category_details>
${detailedBlock(parts.detailed, parts.plan)}
</category_details>

${contextBlocks(parts, owner, parts.question)}
${optionsTask(owner, parts.question, parts.sources.length > 0)}

## 출력
아래 JSON 객체 하나만 출력한다. 설명·코드펜스 없이.
${optionsSchema(owner)}`;
}

/** 다시 쓰기 턴 (같은 세션에 이어서). 카테고리 지시문은 앞 턴에 있으므로 다시 싣지 않는다. */
export function buildRewritePrompt(parts: Omit<OptionsPromptParts, "categories" | "styleBook">): string {
  const persona = parts.persona ?? currentPersona();
  const owner = persona.ownerName;
  const extras = extrasBlock(parts, owner);
  const sources = parts.question
    ? `\n근거는 아래 <sources>만 쓴다 (앞 턴의 근거 번호는 무효).\n<sources>\n${sourceBlock(parts.sources, parts.post)}\n</sources>\n`
    : "";
  return `[다시 쓰기] ${owner}이(가) 방금 초안 3벌을 보고 다시 써 달라고 했다.
${extras ? `\n${extras}\n` : "(따로 남긴 요청 없음: 더 ${owner}답게 다시 쓴다)\n"}${sources}${pastSaidBlock(parts.pastSaid, owner)}
이번에는 아래 세 카테고리로, 적힌 순서대로 한 벌씩 다시 쓴다 (말투가 서로 가장 먼 셋으로 다시 골랐다). 규칙은 앞 턴과 같다: 지시문·<target>·근거 표시·판정. ${owner}의 요청이 있으면 세 벌 모두에 반영한다. 세 벌은 나란히 놓였을 때 한눈에 달라 보여야 한다.

<category_details>
${detailedBlock(parts.detailed, parts.plan)}
</category_details>

## 출력
아래 JSON 객체 하나만 출력한다. 설명·코드펜스 없이.
${optionsSchema(owner)}`;
}

// ── 이 댓글에 맞을 법한 카테고리 (순수) ─────────────────────────────

function categoryScore(comment: string, c: ReplyCategory, byId: ReadonlyMap<string, VoiceExample>): number {
  const sims = c.exampleIds.map((id) => byId.get(id)).filter((e): e is VoiceExample => !!e).map((e) => textSimilarity(comment, e.comment));
  const best = sims.length ? Math.max(...sims) : 0;
  return best + 0.5 * textSimilarity(comment, c.when) + 0.3 * (c.share / 100);
}

/** 지시문 전문을 실을 카테고리 k개 + 카테고리마다 댓글과 닮은 실제 예시 몇 개. */
export function detailedCategories(
  comment: string,
  categories: readonly ReplyCategory[],
  pool: readonly VoiceExample[],
  k = DETAILED_CATEGORIES,
  perCategory = EXAMPLES_PER_CATEGORY
): OptionsPromptParts["detailed"] {
  const byId = new Map(pool.filter((e) => e.id).map((e) => [e.id as string, e]));
  return [...categories]
    .map((c) => ({ c, score: categoryScore(comment, c, byId) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(({ c }) => ({
      category: c,
      examples: c.exampleIds
        .map((id) => byId.get(id))
        .filter((e): e is VoiceExample => !!e)
        .sort((a, b) => textSimilarity(comment, b.comment) - textSimilarity(comment, a.comment))
        .slice(0, perCategory),
    }));
}

/** 댓글에 맞는 후보(DIVERSE_POOL개) 가운데 실측 말투가 서로 가장 먼 셋. 첫째는 가장 잘 맞는 것. */
export function diverseDetailed(comment: string, categories: readonly ReplyCategory[], pool: readonly VoiceExample[]): OptionsPromptParts["detailed"] {
  const ranked = detailedCategories(comment, categories, pool, DIVERSE_POOL);
  const picked = pickDiverseCategories(ranked.map((d) => d.category), 3);
  return picked.map((c) => ranked.find((d) => d.category === c)!);
}

/** 다른 버전 후보 순서: 댓글에 맞는 순으로 모든 카테고리 (예시 포함). */
function rankedAll(comment: string, categories: readonly ReplyCategory[], pool: readonly VoiceExample[]): OptionsPromptParts["detailed"] {
  return detailedCategories(comment, categories, pool, categories.length);
}

// ── 한 벌만 쓰기 (닮은 벌 다시 쓰기 · 다른 버전) ───────────────────────

export interface OneOptionPromptParts {
  kind: "revise" | "more" | "length";
  owner: string;
  detail: OptionsPromptParts["detailed"][number];
  existing: readonly DraftOption[];
  /** revise: 닮은 두 벌 번호 (1부터) */
  pair?: [number, number];
  question: boolean;
  /** 세션에 이어 쓰지 못할 때 싣는 맥락 (내 글·댓글·근거) */
  context?: string;
  plan?: LengthPlan | null;
  /** length: 다시 쓸 벌 번호 (1부터) */
  target?: number;
}

function oneOptionIntro(p: OneOptionPromptParts): string {
  if (p.kind === "length" && p.target) {
    const now = [...(p.existing[p.target - 1]?.draft ?? "")].length;
    return `[길이만 다시] ${p.target}번 벌이 ${now}자라 길이 목표를 못 맞췄다. ${p.target}번 벌만 아래 카테고리와 <length> 목표에 맞춰 다시 쓴다. 말하려는 내용 방향은 그대로 두고 길이만 맞춘다.`;
  }
  if (p.kind === "revise" && p.pair) {
    return `[한 벌만 다시] ${p.pair[1]}번 벌이 ${p.pair[0]}번 벌과 너무 닮았다(길이·첫 마디·끝맺음이 같거나 표현이 겹친다). ${p.pair[1]}번 벌만 아래 카테고리로 다시 쓴다.`;
  }
  return `[다른 버전] ${p.owner}이(가) 다른 느낌의 버전을 하나 더 보고 싶어 한다. 아래 카테고리로 한 벌을 새로 쓴다.`;
}

export function buildOneOptionPrompt(p: OneOptionPromptParts): string {
  const existing = p.existing.map((o, i) => `${i + 1}. (${o.categoryName}) ${o.draft.replace(/\n+/g, " / ")}`).join("\n");
  const facts = p.question
    ? "앞 턴과 같은 근거 규칙을 지킨다: 사실 문장은 근거 id를 sourceIds에 넣고, 근거에 없는 사실은 쓰지 않는다."
    : "댓글은 질문이 아니다. 근거는 쓰지 않고 모든 sourceIds는 []로 둔다.";
  return `${oneOptionIntro(p)}
${p.context ? `\n${p.context}\n` : ""}
${detailedBlock([p.detail], p.plan)}

<already_written>
${existing || "(없음)"}
</already_written>

- <prompt>와 <target>을 따르고(<length>가 있으면 길이는 그것을) 규칙책 AGENTS.md 의 말투 규칙을 지킨다.
- <already_written>의 벌들과 첫 마디, 끝맺음, 길이, 앞에 세우는 것이 달라야 한다. 같은 사실을 같은 순서로 되풀이하지 않는다.
- 어려운 말은 바로 일상 말로 짧게 풀어준다. 재미는 ${p.owner}이(가) 실제로 쓰는 방식으로만 낸다.
- ${facts}

## 출력
아래 JSON 객체 하나만 출력한다. 설명·코드펜스 없이.
{ "categoryId": "${p.detail.category.id}", "sentences": [ { "text": "답글의 한 문장", "sourceIds": [] } ], "draft": "sentences를 이어 붙인 최종 답글" }`;
}

// ── 응답 정리 (순수) ────────────────────────────────────────────────

interface RawAnswer {
  verdict?: unknown;
  verdictReason?: unknown;
  sentences?: unknown;
  draft?: unknown;
  henryAsk?: unknown;
  ownerAsk?: unknown;
}

interface RawOptions extends RawAnswer {
  options?: unknown;
}

const VERDICTS: AnswerVerdict[] = ["answerable", "partial", "unknown"];

export interface NormalizeContext {
  question: boolean;
  sources: AnswerSource[];
  post: ThreadsPostRef;
  model: string;
  generatedAt: string;
  styleExamples: number;
  henryNote?: string;
  /** 주인 메모 근거 제목에 쓰는 이름 */
  ownerName?: string;
  /** 댓글·대화 본문 — 댓글이 한 말(숫자·이름)을 되풀이하는 건 지어낸 사실이 아니다 */
  commentText?: string;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function knownSourceIds(ctx: NormalizeContext): Set<string> {
  const known = new Set(ctx.sources.map((s) => s.id));
  if (ctx.question) known.add(POST_SOURCE_ID);
  if (ctx.henryNote?.trim()) known.add(NOTE_SOURCE_ID);
  return known;
}

function readSentence(s: unknown, known: ReadonlySet<string>, question: boolean): DraftSentence | null {
  const o = (s ?? {}) as { text?: unknown; sourceIds?: unknown };
  const text = str(o.text);
  if (!text) return null;
  const ids = Array.isArray(o.sourceIds) ? o.sourceIds.map(String) : [];
  return { text, sourceIds: question ? [...new Set(ids.filter((id) => known.has(id)))] : [] };
}

/** 문장 목록 정리: 빈 문장 버림, 없는 근거 id 버림, 질문이 아니면 근거 비움. */
export function normalizeSentences(raw: unknown, known: ReadonlySet<string>, question: boolean): DraftSentence[] {
  return (Array.isArray(raw) ? raw : [])
    .map((s) => readSentence(s, known, question))
    .filter((s): s is DraftSentence => s !== null);
}

/** 붙은 근거는 인용 여부와 상관없이 전부 남긴다 (칩으로 접혀 보이고, 주인이 바꿔 끼운다). */
function answerSources(ctx: NormalizeContext, cited: ReadonlySet<string>): AnswerSource[] {
  const sources = [...ctx.sources];
  if (ctx.question && cited.has(POST_SOURCE_ID)) {
    sources.unshift({
      id: POST_SOURCE_ID,
      kind: "지난 글",
      title: "내 글 본문",
      quote: clip(ctx.post.text, QUOTE_CHARS).replace(/…$/, ""),
      url: ctx.post.permalink,
      origin: `threads-post:${ctx.post.id}`,
    });
  }
  const note = ctx.henryNote?.trim();
  if (ctx.question && cited.has(NOTE_SOURCE_ID) && note) {
    sources.push({ id: NOTE_SOURCE_ID, kind: "내 경험", title: `${ctx.ownerName ?? "주인"} 메모`, quote: note });
  }
  return sources;
}

/** 숫자·가격·버전·날짜가 든 문장 = 근거가 필요한 사실 문장으로 본다. */
function looksFactual(text: string): boolean {
  return /\d/.test(text) && !/^[\d\s!.~ㅎㅋ]*$/.test(text);
}

function modelVerdict(raw: RawAnswer): { verdict: AnswerVerdict; reason: string } {
  const verdict = VERDICTS.includes(raw.verdict as AnswerVerdict) ? (raw.verdict as AnswerVerdict) : "partial";
  return { verdict, reason: str(raw.verdictReason) };
}

/**
 * 판정 규칙: 반응 댓글은 answerable 고정 · 질문인데 근거 달린 문장이 없으면 unknown ·
 * answerable 인데 근거 없는 사실 문장이 있으면 partial.
 */
export function applyVerdictRules(
  raw: RawAnswer,
  question: boolean,
  cited: ReadonlySet<string>,
  sentences: readonly DraftSentence[]
): { verdict: AnswerVerdict; verdictReason: string } {
  if (!question) return { verdict: "answerable", verdictReason: "반응 댓글" };
  const { verdict, reason } = modelVerdict(raw);
  if (cited.size === 0 && verdict !== "unknown") {
    return { verdict: "unknown", verdictReason: `근거 달린 문장 없음${reason ? ` (모델 판단: ${reason})` : ""}` };
  }
  const uncitedFact = sentences.some((s) => s.sourceIds.length === 0 && looksFactual(s.text));
  if (verdict === "answerable" && uncitedFact) return { verdict: "partial", verdictReason: reason || "근거 없는 사실 문장이 있음" };
  return { verdict, verdictReason: reason || (verdict === "unknown" ? "근거가 질문에 답하지 못함" : "근거로 답함") };
}

function ownerAskOf(raw: RawAnswer, question: boolean): string | undefined {
  const ask = str(raw.ownerAsk) || str(raw.henryAsk);
  return ask && question ? ask : undefined;
}

function citedIn(sentences: readonly DraftSentence[]): Set<string> {
  return new Set(sentences.flatMap((s) => s.sourceIds));
}

function baseAnswer(ctx: NormalizeContext, raw: RawAnswer, sentences: DraftSentence[], cited: Set<string>, draft: string): ReplyAnswer {
  const henryAsk = ownerAskOf(raw, ctx.question);
  return {
    ...applyVerdictRules(raw, ctx.question, cited, sentences),
    sources: answerSources(ctx, cited),
    sentences,
    draft,
    ...(henryAsk ? { henryAsk } : {}),
    model: ctx.model,
    generatedAt: ctx.generatedAt,
    styleExamples: ctx.styleExamples,
  };
}

function factCorpora(ctx: NormalizeContext): FactCorpus[] {
  const out = ctx.sources.map(sourceCorpus);
  out.push({ id: POST_SOURCE_ID, text: ctx.post.text });
  const note = ctx.henryNote?.trim();
  if (note) out.push({ id: NOTE_SOURCE_ID, text: note });
  return out;
}

/**
 * 질문 답의 근거 없는 사실 문장을 초안에서 뺀다 (fact-check.ts). 반응 댓글은 건드리지 않는다.
 * 뺀 문장은 dropped 로 남겨 화면이 "근거 없어 뺀 문장"으로 보여준다.
 */
export function checkFacts(
  sentences: DraftSentence[],
  draft: string,
  ctx: NormalizeContext
): { sentences: DraftSentence[]; draft: string; dropped: DroppedSentence[] } {
  if (!ctx.question) return { sentences, draft, dropped: [] };
  const { kept, dropped } = dropUnsupported(sentences, factCorpora(ctx), ctx.commentText ?? "");
  if (!dropped.length) return { sentences, draft, dropped };
  return { sentences: kept, draft: removeFromDraft(draft, dropped, kept), dropped };
}

/** 한 벌짜리 모델 JSON 을 계약 모양으로 고친다: 없는 근거 id 제거, 근거 없는 사실 문장 제거, 질문인데 근거 0이면 unknown. */
export function normalizeAnswer(raw: RawAnswer, ctx: NormalizeContext): ReplyAnswer {
  const all = normalizeSentences(raw.sentences, knownSourceIds(ctx), ctx.question);
  const checked = checkFacts(all, str(raw.draft) || all.map((s) => s.text).join(" "), ctx);
  const answer = baseAnswer(ctx, raw, checked.sentences, citedIn(checked.sentences), checked.draft);
  return checked.dropped.length ? { ...answer, dropped: checked.dropped } : answer;
}

export interface OptionsContext extends NormalizeContext {
  categories: readonly Pick<ReplyCategory, "id" | "name">[];
  sessionId?: string;
}

export function readOption(o: unknown, names: ReadonlyMap<string, string>, known: ReadonlySet<string>, ctx: NormalizeContext): DraftOption | null {
  const r = (o ?? {}) as { categoryId?: unknown; sentences?: unknown; draft?: unknown };
  const categoryId = str(r.categoryId);
  const categoryName = names.get(categoryId);
  if (!categoryName) return null;
  const all = normalizeSentences(r.sentences, known, ctx.question);
  const draft = str(r.draft) || all.map((s) => s.text).join(" ");
  if (!draft) return null;
  const checked = checkFacts(all, draft, ctx);
  return {
    categoryId,
    categoryName,
    draft: checked.draft,
    sentences: checked.sentences,
    ...(checked.dropped.length ? { dropped: checked.dropped } : {}),
  };
}

/** 3벌 목록 정리: 모르는 카테고리·같은 카테고리 두 번·빈 초안은 버린다. 최대 3벌. */
export function normalizeOptionList(raw: unknown, ctx: OptionsContext): DraftOption[] {
  const names = new Map(ctx.categories.map((c) => [c.id, c.name]));
  const known = knownSourceIds(ctx);
  const out: DraftOption[] = [];
  for (const o of Array.isArray(raw) ? raw : []) {
    const opt = readOption(o, names, known, ctx);
    if (opt && !out.some((x) => x.categoryId === opt.categoryId)) out.push(opt);
    if (out.length === 3) break;
  }
  return out;
}

/**
 * 3벌 모델 JSON 을 계약 모양으로. 판정은 세 벌 공통: 어느 벌에도 근거 달린 문장이 없으면 unknown,
 * 첫 벌(기본 선택)에 근거 없는 사실 문장이 있으면 answerable → partial. draft·aiDraft = 첫 벌.
 */
export function normalizeOptions(raw: RawOptions, ctx: OptionsContext): ReplyAnswer {
  const options = normalizeOptionList(raw.options, ctx);
  if (!options.length) throw new Error("초안 3벌을 받지 못했어요 (카테고리가 맞는 벌이 없음)");
  const cited = new Set(options.flatMap((o) => [...citedIn(o.sentences)]));
  const first = options[0];
  return {
    ...baseAnswer(ctx, raw, first.sentences, cited, first.draft),
    ...(first.dropped ? { dropped: first.dropped } : {}),
    options,
    chosen: 0,
    aiDraft: first.draft,
    ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
  };
}

/** 한 벌짜리 답을 options 한 개로 감싼다 (categories.json 이 없을 때). */
export function asSingleOption(answer: ReplyAnswer, sessionId?: string): ReplyAnswer {
  return {
    ...answer,
    options: [{ categoryId: SINGLE_CATEGORY.id, categoryName: SINGLE_CATEGORY.name, draft: answer.draft, sentences: answer.sentences, ...(answer.dropped ? { dropped: answer.dropped } : {}) }],
    chosen: 0,
    aiDraft: answer.draft,
    ...(sessionId ? { sessionId } : {}),
  };
}

// ── 주인 편집 (순수, PATCH /api/threads-replies) ──────────────────────

/** 주인이 손으로 고친 초안. AI 초안(aiDraft)은 건드리지 않는다. 아직 AI 초안이 없던 댓글이면 근거 없는 답으로 만든다. */
export function withOwnerDraft(answer: ReplyAnswer | undefined, draft: string, now: Date = new Date()): ReplyAnswer {
  if (answer) return { ...answer, draft };
  return {
    verdict: "unknown",
    verdictReason: "주인이 직접 쓴 답",
    sources: [],
    sentences: [{ text: draft, sourceIds: [] }],
    draft,
    // 화면이 model === "henry" 로 "손으로 쓴 답"을 가른다 (threads-answer-draft.tsx)
    model: "henry",
    generatedAt: now.toISOString(),
    styleExamples: 0,
  };
}

/** 3벌 가운데 n번째를 고른다: draft = aiDraft = 그 벌, 문장 근거도 그 벌 것으로. 못 고르면 이유 문자열. */
export function chooseOption(answer: ReplyAnswer | undefined, n: number): ReplyAnswer | string {
  if (!answer?.options?.length) return "고를 초안 벌이 없어요";
  if (!Number.isInteger(n) || n < 0 || n >= answer.options.length) return `chosen 은 0~${answer.options.length - 1} 사이여야 해요`;
  const opt = answer.options[n];
  const { dropped: _prev, ...rest } = answer;
  void _prev;
  const consistency = opt.consistency ? { consistency: opt.consistency, consistencyFor: opt.draft } : {};
  return { ...rest, chosen: n, draft: opt.draft, aiDraft: opt.draft, sentences: opt.sentences, ...(opt.dropped ? { dropped: opt.dropped } : {}), ...consistency };
}

// ── 팩 파일 (I/O) ───────────────────────────────────────────────────

/** 팩에 규칙책이 있으면 팩 폴더, 없으면 null (그때는 격리 호출 + 규칙책을 프롬프트에). */
export async function packWorkspaceDir(persona: PersonaConfig): Promise<string | null> {
  try {
    await stat(packRulebookPath(persona.id));
    return packDir(persona.id);
  } catch {
    return null;
  }
}

export async function readSafety(persona: PersonaConfig): Promise<string> {
  try {
    return await readFile(packFile(persona.id, "SAFETY.md"), "utf8");
  } catch {
    return "";
  }
}

export function systemAppendFor(safety: string): string {
  return safety.trim() ? `${GENERATOR_RULE}\n\n${safety.trim()}` : GENERATOR_RULE;
}

// ── 호출 ────────────────────────────────────────────────────────────

interface DraftEnv {
  persona: PersonaConfig;
  question: boolean;
  situation: ReplySituation;
  sources: AnswerSource[];
  categories: CategoriesFile | null;
  workspaceDir: string | null;
  styleBook: string;
  systemAppend: string;
  sessionId: string;
  run: (prompt: string, opts: RunOptions) => Promise<string>;
  generatedAt: string;
  signal?: AbortSignal;
}

function defaultRun(prompt: string, opts: RunOptions): Promise<string> {
  return runClaudeCLI(prompt, {
    model: ANSWER_MODEL,
    effort: ANSWER_EFFORT,
    timeoutMs: answerTimeoutMs(),
    requireClaude: true,
    noTools: true,
    systemAppend: opts.systemAppend,
    signal: opts.signal,
    ...(opts.workspace ? { workspace: opts.workspace } : {}),
  });
}

/** 팩에서 읽는 것: 카테고리 · 팩 폴더(세션 자리) · 안전 규칙 · (팩 폴더가 없을 때만) 규칙책. 주입값이 있으면 그걸 쓴다. */
async function packBits(persona: PersonaConfig, deps: AnswerDeps) {
  const [categories, workspaceDir, safety] = await Promise.all([
    deps.categories !== undefined ? deps.categories : readCategories(persona.id),
    deps.workspaceDir !== undefined ? deps.workspaceDir : packWorkspaceDir(persona),
    deps.safety ?? readSafety(persona),
  ]);
  const styleBook = workspaceDir ? "" : (deps.styleBook ?? (await loadStyleBook(persona)));
  return { categories, workspaceDir, safety, styleBook };
}

async function draftEnv(input: AnswerInput, deps: AnswerDeps): Promise<DraftEnv> {
  const persona = deps.persona ?? currentPersona();
  const situation = situationForReply(input.reply);
  const question = isQuestionSituation(situation);
  const { categories, workspaceDir, safety, styleBook } = await packBits(persona, deps);
  return {
    persona,
    question,
    situation,
    sources: question ? input.sources : [],
    categories,
    workspaceDir,
    styleBook,
    systemAppend: systemAppendFor(safety),
    sessionId: deps.sessionId ?? randomUUID(),
    run: deps.run ?? defaultRun,
    generatedAt: (deps.now?.() ?? new Date()).toISOString(),
    signal: deps.signal,
  };
}

function runOpts(env: DraftEnv, sessionId: string, resume = false): RunOptions {
  return {
    systemAppend: env.systemAppend,
    signal: env.signal,
    ...(env.workspaceDir ? { workspace: { dir: env.workspaceDir, sessionId, ...(resume ? { resume } : {}) } } : {}),
  };
}

function normalizeContext(input: AnswerInput, env: DraftEnv, styleExamples: number): NormalizeContext {
  return {
    question: env.question,
    sources: env.sources,
    post: input.post,
    model: ANSWER_MODEL,
    generatedAt: env.generatedAt,
    styleExamples,
    henryNote: input.henryNote,
    ownerName: env.persona.ownerName,
    commentText: [input.reply.text, input.reply.repliedToText ?? "", ...(input.conversation ?? []).map((m) => m.text)].join("\n"),
  };
}

async function generateSingle(input: AnswerInput, env: DraftEnv, deps: AnswerDeps): Promise<ReplyAnswer> {
  const pool = deps.examples ? null : (deps.pool ?? (await loadVoiceExamples(env.persona)));
  const examples = deps.examples ?? pickStyleExamples(pool ?? [], { text: input.reply.text, situation: env.situation }, STYLE_EXAMPLE_COUNT, deps.pick);
  const prompt = buildAnswerPrompt({ ...input, sources: env.sources, styleBook: env.styleBook, examples, situation: env.situation, persona: env.persona });
  const text = await env.run(prompt, runOpts(env, env.sessionId));
  const answer = normalizeAnswer(parseJsonObject<RawAnswer>(text), normalizeContext(input, env, examples.length));
  return asSingleOption(answer, env.workspaceDir ? env.sessionId : undefined);
}

/** 주인이 이 상황(질문이면 질문 전체)에 실제로 단 답의 길이로 잰 목표 */
export function planForSituation(pool: readonly VoiceExample[], situation: ReplySituation): LengthPlan | null {
  const q = isQuestionSituation(situation);
  const same = pool.filter((e) => (q ? isQuestionSituation(e.situation) : e.situation === situation));
  const len = (e: VoiceExample) => [...e.reply.trim()].length;
  return lengthPlan(same.map(len), pool.map(len));
}

/** 세 카테고리에 짧게·중간·길게를 맡긴다 (실측 중앙 길이 순). */
export function withRoles(detailed: DetailedCategory[], plan: LengthPlan | null): DetailedCategory[] {
  if (!plan) return detailed;
  const roles = assignRoles(detailed.map((d) => d.category.stats.lengthMedian));
  return detailed.map((d, i) => ({ ...d, role: roles[i] }));
}

function optionsParts(input: AnswerInput, env: DraftEnv, categories: ReplyCategory[], pool: VoiceExample[]): OptionsPromptParts {
  const plan = planForSituation(pool, env.situation);
  return {
    ...input,
    sources: env.sources,
    styleBook: env.styleBook,
    persona: env.persona,
    question: env.question,
    categories,
    detailed: withRoles(diverseDetailed(input.reply.text, categories, pool), plan),
    plan,
  };
}

export function canRetryFresh(e: unknown): boolean {
  const err = e as Error | undefined;
  return err?.name !== "CancelledError" && !/시간 초과|timed? ?out/i.test(err?.message ?? "");
}

/** 다시 쓰기면 앞 세션에 이어 쓰고, 그게 실패하면(세션 파일 없음 등) 새 세션으로 처음부터 쓴다. */
async function runOptionsCall(parts: OptionsPromptParts, env: DraftEnv, resumeId?: string): Promise<{ text: string; sessionId: string }> {
  if (resumeId && env.workspaceDir) {
    try {
      return { text: await env.run(buildRewritePrompt(parts), runOpts(env, resumeId, true)), sessionId: resumeId };
    } catch (e) {
      // 취소·시간 초과는 그대로 올린다 (처음부터 다시 돌면 상한을 두 번 쓴다)
      if (!canRetryFresh(e)) throw e;
    }
  }
  return { text: await env.run(buildOptionsPrompt(parts), runOpts(env, env.sessionId)), sessionId: env.sessionId };
}

async function generateOptions(input: AnswerInput, env: DraftEnv, deps: AnswerDeps, file: CategoriesFile): Promise<ReplyAnswer> {
  const pool = deps.pool ?? (await loadVoiceExamples(env.persona));
  const parts = optionsParts(input, env, file.categories, pool);
  const { text, sessionId } = await runOptionsCall(parts, env, deps.resumeSessionId);
  const styleExamples = parts.detailed.reduce((n, d) => n + d.examples.length, 0);
  const ctx: OptionsContext = {
    ...normalizeContext(input, env, styleExamples),
    categories: file.categories,
    sessionId: env.workspaceDir ? sessionId : undefined,
  };
  const answer = normalizeOptions(parseJsonObject<RawOptions>(text), ctx);
  if (!env.workspaceDir) return markRoles(answer, parts);
  return enforceLengths(await reviseSimilar(answer, parts, env, ctx, sessionId), parts, env, ctx, sessionId);
}

function roleOf(parts: OptionsPromptParts, o: DraftOption): LengthRole | undefined {
  return parts.detailed.find((d) => d.category.id === o.categoryId)?.role;
}

function markRoles(answer: ReplyAnswer, parts: OptionsPromptParts): ReplyAnswer {
  const options = (answer.options ?? []).map((o) => {
    const role = roleOf(parts, o);
    return role ? { ...o, lengthRole: role } : o;
  });
  return { ...answer, options };
}

/**
 * 길이 관문: 짧게·길게 벌이 주인 실측 목표(length-plan.ts)를 못 맞췄으면 그 벌만 같은 세션에서 다시 쓴다.
 * 고른 벌(첫 벌)이 바뀌었으면 draft·aiDraft 도 따라간다.
 */
async function enforceLengths(answer: ReplyAnswer, parts: OptionsPromptParts, env: DraftEnv, ctx: OptionsContext, sessionId: string): Promise<ReplyAnswer> {
  const marked = markRoles(answer, parts);
  const options = marked.options ?? [];
  if (!parts.plan || !options.length) return marked;
  const rewrite = async (i: number, current: readonly DraftOption[]) => {
    const detail = parts.detailed.find((d) => d.category.id === current[i].categoryId);
    if (!detail) return null;
    const prompt = buildOneOptionPrompt({ kind: "length", owner: env.persona.ownerName, detail, existing: current, question: env.question, plan: parts.plan, target: i + 1 });
    const text = await env.run(prompt, runOpts(env, sessionId, true));
    return readOption(parseJsonObject(text), new Map([[detail.category.id, detail.category.name]]), knownSourceIds(ctx), ctx);
  };
  const fixed = await fixLengths(options, options.map((o) => o.lengthRole), parts.plan, rewrite);
  const first = fixed[0];
  const changedFirst = first.draft !== options[0].draft;
  return {
    ...marked,
    options: fixed,
    ...(changedFirst ? { draft: first.draft, aiDraft: first.draft, sentences: first.sentences } : {}),
  };
}

/**
 * 다양성 관문: 두 벌이 너무 닮았으면(diversity.ts tooSimilar) 뒤 벌만 같은 세션에서 한 번 다시 쓴다.
 * 다시 쓴 벌이 실패하거나 여전히 닮았어도 앞 결과를 그대로 돌려준다 (초안은 늘 3벌).
 */
async function reviseSimilar(answer: ReplyAnswer, parts: OptionsPromptParts, env: DraftEnv, ctx: OptionsContext, sessionId: string): Promise<ReplyAnswer> {
  const options = answer.options ?? [];
  const bad = offendingIndex(options.map((o) => o.draft));
  const detail = bad >= 0 ? parts.detailed.find((d) => d.category.id === options[bad].categoryId) : undefined;
  if (!detail) return answer;
  const against = options.findIndex((o, i) => i < bad && tooSimilar(o.draft, options[bad].draft));
  const prompt = buildOneOptionPrompt({ kind: "revise", owner: env.persona.ownerName, detail, existing: options, pair: [against + 1, bad + 1], question: env.question });
  try {
    const text = await env.run(prompt, runOpts(env, sessionId, true));
    const next = readOption(parseJsonObject(text), new Map([[detail.category.id, detail.category.name]]), knownSourceIds(ctx), ctx);
    if (!next) return answer;
    return { ...answer, options: options.map((o, i) => (i === bad ? next : o)) };
  } catch (e) {
    if (!canRetryFresh(e)) throw e;
    return answer;
  }
}

// ── 다른 버전 (POST /api/threads-replies/[id]/more) ─────────────────────

export interface MoreInput extends AnswerInput {
  answer: ReplyAnswer;
}

/**
 * 이미 쓴 벌들과 가장 먼 남은 카테고리로 한 벌을 더 쓴다. 이 댓글의 세션에 이어 쓰고(학습 대화로 남게),
 * 세션이 없거나 이어 쓰기가 실패하면 맥락을 실어 새로 쓴다. 남은 카테고리가 없으면 null.
 */
export async function generateMoreOption(input: MoreInput, deps: AnswerDeps = {}): Promise<DraftOption | null> {
  const env = await draftEnv(input, deps);
  if (!env.categories) return null;
  const pool = deps.pool ?? (await loadVoiceExamples(env.persona));
  const ranked = rankedAll(input.reply.text, env.categories.categories, pool);
  const tried = (input.answer.options ?? []).map((o) => o.categoryId);
  // 근거 없는 문장을 빼고 나니 빈 벌이면 다음 카테고리로 한 번 더 (빈 칸을 버전으로 보여주지 않는다)
  for (let attempt = 0; attempt < MORE_ATTEMPTS; attempt++) {
    const next = nextDistinctCategory(ranked.map((d) => d.category), tried);
    const detail = next ? ranked.find((d) => d.category === next) : undefined;
    if (!detail) return null;
    tried.push(detail.category.id);
    const opt = await writeMoreOnce(env, input, detail);
    if (opt?.draft.trim()) return withLengthRole({ ...opt, categoryWhen: detail.category.when }, planForSituation(pool, env.situation));
  }
  return null;
}

/** 다른 버전 칩: 실제 길이로 본 역할 */
function withLengthRole(opt: DraftOption, plan: LengthPlan | null): DraftOption {
  return plan ? { ...opt, lengthRole: roleForLength([...opt.draft].length, plan) } : opt;
}

async function writeMoreOnce(env: DraftEnv, input: MoreInput, detail: OptionsPromptParts["detailed"][number]): Promise<DraftOption | null> {
  const ctx = normalizeContext(input, env, detail.examples.length);
  const base = { kind: "more" as const, owner: env.persona.ownerName, detail, existing: input.answer.options ?? [], question: env.question };
  const text = await runMore(env, input, base, input.answer.sessionId);
  return readOption(parseJsonObject(text), new Map([[detail.category.id, detail.category.name]]), knownSourceIds(ctx), ctx);
}

async function runMore(env: DraftEnv, input: AnswerInput, base: OneOptionPromptParts, sessionId?: string): Promise<string> {
  if (sessionId && env.workspaceDir) {
    try {
      return await env.run(buildOneOptionPrompt(base), runOpts(env, sessionId, true));
    } catch (e) {
      if (!canRetryFresh(e)) throw e;
    }
  }
  const context = contextBlocks({ ...input, sources: env.sources }, env.persona.ownerName, env.question);
  const book = env.styleBook.trim() ? `<style_book>\n${env.styleBook.trim()}\n</style_book>\n` : "";
  const intro = `당신은 ${ownerLine(env.persona)}의 스레드 답글을 ${env.persona.ownerName} 대신 쓰는 사람이다. ${voiceSourceLine(env.persona, !!book)} ${registerRule(env.persona)}\n${book}`;
  return env.run(`${intro}\n${buildOneOptionPrompt({ ...base, context })}`, runOpts(env, env.sessionId));
}

/** 댓글 하나의 답 초안. 팩에 categories.json 이 있으면 3벌, 없으면 1벌(options 한 개). */
export async function generateAnswer(input: AnswerInput, deps: AnswerDeps = {}): Promise<ReplyAnswer> {
  const env = await draftEnv(input, deps);
  if (env.categories) return generateOptions(input, env, deps, env.categories);
  return generateSingle(input, env, deps);
}
