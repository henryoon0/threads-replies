// 스레드 댓글 답글 초안 — henry 말투 + 근거 인용 (픽 4 "답할 수 있음 판정").
//
// Opus 5.5 한 번 호출. 프롬프트 = 말투 규칙책 전문 + 닮은 실제 답글 예시 + 내 글 + 대화 줄기
// + 댓글 + 번호 붙은 근거(원문 인용). 출력은 문장마다 받치는 근거 id 를 단 JSON.
// 정확성 장치는 프롬프트와 코드 양쪽에 있다: 모델이 없는 근거 id 를 달면 버리고,
// 근거 인용에 없는 사실 문장은 초안에서 뺀다(fact-check.ts), 질문인데 근거 달린 문장이
// 하나도 없으면 판정을 "unknown" 으로 내린다. 주인이 예전에 한 말(past-said.ts)도 함께 보여
// 새 답이 예전 답과 어긋나지 않게 한다.

import { runClaudeCLI } from "@/lib/ai/claude-cli";
import { ownerLine, readProfile, type OwnerProfile } from "@/lib/profile";
import { parseJsonObject } from "@/lib/ai/json";
import { dropUnsupported, removeFromDraft, sourceCorpus, trustedContext } from "./fact-check";
import type {
  AnswerSource,
  AnswerVerdict,
  DraftSentence,
  PastSaid,
  ReplyAnswer,
  ThreadsPostRef,
  ThreadsReply,
} from "./model";
import {
  SITUATION_LABEL,
  loadStyleBook,
  selectStyleExamples,
  situationForReply,
  type PickOptions,
  type ReplySituation,
  type VoiceExample,
} from "./voice";

export const ANSWER_MODEL = "claude-opus-5-5";
const DEFAULT_TIMEOUT_MS = 240_000;
const STYLE_EXAMPLE_COUNT = 10;
const POST_CHARS = 1500;
const QUOTE_CHARS = 900;
/** 내 글 본문을 근거로 인용할 때 쓰는 id */
export const POST_SOURCE_ID = "p";

export interface AnswerInput {
  reply: ThreadsReply;
  post: ThreadsPostRef;
  sources: AnswerSource[];
  conversation?: { username: string; text: string }[];
  instruction?: string;
  myNote?: string;
  /** 주인이 예전에 같은 주제·같은 사람에게 한 답 (past-said.ts). 새 답은 이와 어긋나면 안 된다 */
  pastSaid?: PastSaid[];
}

export interface AnswerDeps {
  run?: (prompt: string) => Promise<string>;
  examples?: VoiceExample[];
  styleBook?: string;
  now?: () => Date;
  owner?: OwnerProfile;
  /** 예시 고르기 옵션 (평가에서 홀드아웃을 빼는 데 쓴다) */
  pick?: PickOptions;
}

export interface AnswerPromptParts {
  reply: ThreadsReply;
  post: ThreadsPostRef;
  sources: AnswerSource[];
  conversation?: { username: string; text: string }[];
  instruction?: string;
  myNote?: string;
  pastSaid?: PastSaid[];
  styleBook: string;
  examples: VoiceExample[];
  situation: ReplySituation;
  owner: OwnerProfile;
}

function answerTimeoutMs(): number {
  const v = Number(process.env.THREADS_ANSWER_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_TIMEOUT_MS;
}

function clip(text: string, max: number): string {
  const t = (text ?? "").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** 댓글 길이에 맞춘 henry 답 길이 목표 (실측: 짧은 댓글→중앙값 23자, 60자 초과→60자). */
export function lengthHint(commentText: string, situation: ReplySituation): string {
  const n = [...(commentText ?? "").trim()].length;
  if (situation === "class_inquiry") return "40~80자 + 링크";
  if (situation === "question_fact" || situation === "question_unknown") {
    return n > 60 ? "40~100자" : "15~50자";
  }
  if (n <= 20) return "5~25자";
  if (n > 60) return "30~70자";
  return "15~45자";
}

function isQuestionSituation(s: ReplySituation): boolean {
  return s === "question_fact" || s === "question_unknown" || s === "class_inquiry";
}

function exampleBlock(examples: VoiceExample[]): string {
  if (!examples.length) return "(예시 없음)";
  return examples
    .map(
      (e, i) =>
        `<example n="${i + 1}" situation="${SITUATION_LABEL[e.situation]}">\n<comment>${clip(e.comment, 300)}</comment>\n<owner_reply>${e.reply}</owner_reply>\n</example>`
    )
    .join("\n");
}

function sourceBlock(sources: AnswerSource[], post: ThreadsPostRef): string {
  const lines = [
    `<source id="${POST_SOURCE_ID}" kind="내 글 본문">\n${clip(post.text, POST_CHARS)}\n</source>`,
  ];
  for (const s of sources) {
    const url = s.url ? ` url="${s.url}"` : "";
    lines.push(
      `<source id="${s.id}" kind="${s.kind}" title="${s.title.replace(/"/g, "'")}"${url}>\n${clip(s.quote, QUOTE_CHARS)}\n</source>`
    );
  }
  return lines.join("\n");
}

function conversationBlock(conv: AnswerPromptParts["conversation"]): string {
  if (!conv?.length) return "";
  const body = conv.map((m) => `${m.username}: ${clip(m.text, 400)}`).join("\n");
  return `\n<conversation_so_far>\n${body}\n</conversation_so_far>\n`;
}

/** 예전에 한 말: 새 답이 이와 어긋나지 않게 (되풀이·덧붙임은 된다). 없으면 빈 문자열. */
export function pastSaidBlock(past: readonly PastSaid[] | undefined): string {
  if (!past?.length) return "";
  const items = past
    .map((p) => {
      const attrs = `${p.date ? ` date="${p.date}"` : ""}${p.sameCommenter ? ` same_person="true"` : ""}`;
      const comment = p.comment ? `\n(받은 댓글: ${clip(p.comment, 160)})` : "";
      return `<past${attrs}>${comment}\n${clip(p.text, 400)}\n</past>`;
    })
    .join("\n");
  return `\n<owner_past_replies>\n예전에 한 말: 주인이 같은 주제로(또는 이 댓글 단 사람에게) 실제로 단 답이다. same_person="true" 는 지금 댓글 단 사람에게 한 답이다.\n${items}\n</owner_past_replies>\n새 답은 이 예전 답과 어긋나면 안 된다. 같은 점(방법·수치·추천 여부·가능 여부·순서)에 대해 다른 말을 하지 않는다. 예전 말을 되풀이하거나 더 자세히 덧붙이는 건 된다. 근거가 예전 답과 다르면 근거 쪽 사실만 쓰되 단정하지 말고, 예전 답을 뒤집는 말은 쓰지 않는다.\n`;
}

const OUTPUT_SCHEMA = `{
  "verdict": "answerable" | "partial" | "unknown",
  "verdictReason": "주인에게 보이는 판정 이유 한 줄 (예: \\"s1 원문에 설정 방법이 그대로 있음\\")",
  "sentences": [ { "text": "답글의 한 문장", "sourceIds": ["s1"] } ],
  "draft": "sentences를 이어 붙인 최종 답글 (주인 말투, 줄바꿈 허용)",
  "myAsk": "자료로 못 채우는 내 경험 질문 한 줄, 없으면 빈 문자열"
}`;

function questionTask(hasSources: boolean): string {
  return `## 이번 일
댓글은 질문이다. 주인이 직접 답하는 것처럼 답글 초안을 쓰고, 문장마다 어느 근거에서 왔는지 표시한다.

1. 먼저 <sources>에서 질문에 직접 답하는 부분을 찾는다. ${hasSources ? "붙은 근거와 내 글 본문(id \"p\")을 모두 본다." : "붙은 근거가 없으니 내 글 본문(id \"p\")만 근거로 쓸 수 있다."}
2. 사실은 근거 인용에 있는 말만 쓴다. 사실을 말하는 문장(수치, 이름, 기능, 방법, 날짜, 가격, 가능 여부, 효과)은 그 사실이 그대로 적힌 근거 id를 sourceIds에 넣는다. 근거에 없는 사실은 "내가 알기론"을 붙여도 쓰지 않는다. 모르면 쓰지 말고 모른다고 짧게 말한다.
3. 근거가 받치지 않는 문장은 sourceIds를 []로 두고, 사실이 아닌 말(권유·질문·맞장구·인사·약속·주인의 느낌)만 쓴다. 근거 없는 사실 문장은 코드가 초안에서 지운다.
4. 판정:
   - answerable: 질문의 핵심에 근거 달린 문장으로 답했다.
   - partial: 일부만 근거로 답했고 나머지는 주인 확인이 필요하다.
   - unknown: 근거가 질문에 답하지 못한다. 이때 draft는 근거로 말할 수 있는 만큼만 한 문장으로 말하거나, 아직 써보지 못했다고 짧게 인정한다(규칙책 2-3). 나중에 알려주겠다는 약속은 주인이 직접 확인할 수 있는 일일 때 한 번만 쓴다.
5. myAsk: 주인만 아는 경험(직접 써봤는지, 어떤 설정을 쓰는지 등)이 답을 크게 낫게 만들 때 그 질문 한 줄. 필요 없으면 "".`;
}

function reactionTask(): string {
  return `## 이번 일
댓글은 질문이 아니다(감사·감탄·농담·대화). 근거는 쓰지 않는다. 주인이 실제로 달 법한 짧은 답글 하나를 쓴다.
- verdict는 "answerable", verdictReason은 "반응 댓글", 모든 sentences의 sourceIds는 [], myAsk는 "".`;
}

export function buildAnswerPrompt(parts: AnswerPromptParts): string {
  const { reply, post, sources, situation } = parts;
  const question = isQuestionSituation(situation);
  const addressed = reply.repliedToId !== reply.postId && reply.repliedToText
    ? `\n<owner_previous_reply>${clip(reply.repliedToText, 400)}</owner_previous_reply>\n(이 댓글은 위 주인 답글에 이어 달린 말이다.)\n`
    : "";
  const extras = [
    parts.myNote?.trim() ? `<owner_note>주인이 직접 적은 메모. 주인 본인 경험이니 사실로 써도 되고, 이 메모를 받치는 문장의 sourceIds 는 ["me"]로 둔다.\n${parts.myNote.trim()}\n</owner_note>` : "",
    parts.instruction?.trim() ? `<owner_instruction>이번 초안에 대한 주인의 요청: ${parts.instruction.trim()}</owner_instruction>` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return `당신은 ${ownerLine(parts.owner)} 주인의 스레드 답글을 주인 대신 쓰는 사람이다. 목표는 주인의 팔로워가 읽었을 때 주인이 직접 단 답글과 구별이 안 되는 글이다. 아래 말투 규칙책은 주인의 실제 답글을 잰 결과이고, 예시는 이번 댓글과 닮은 자리에서 주인이 실제로 쓴 답글이다.

<style_book>
${parts.styleBook.trim() || "(규칙책 없음: 예시만 따른다)"}
</style_book>

<owner_real_replies>
${exampleBlock(parts.examples)}
</owner_real_replies>

<my_post>
${clip(post.text, POST_CHARS)}
</my_post>
${conversationBlock(parts.conversation)}${addressed}
<comment author="${reply.username}" situation="${SITUATION_LABEL[situation]}">
${reply.text.trim()}
</comment>
${question ? `\n<sources>\n${sourceBlock(sources, post)}\n</sources>\n` : ""}${pastSaidBlock(parts.pastSaid)}
${extras ? `\n${extras}\n` : ""}
${question ? questionTask(sources.length > 0) : reactionTask()}

## 말투
- 규칙책의 "${SITUATION_LABEL[situation]}" 절과 예시의 길이·첫 마디·끝맺음을 따른다. 이번 답 길이 목표: ${lengthHint(reply.text, situation)}.
- 밀도는 주인 실측에 맞춘다: 문장 1~2개, 기호 버릇(띄운 느낌표·".."·"~"·ㅎㅎ/ㅋㅋ·이모지)은 이번 기분에 맞는 것 하나. 예시 답글 대부분이 그렇게 생겼다.
- 첫 마디가 곧 답이다. 댓글이 물은 것에 바로 반응하고, 그 한 가지를 말하면 끝낸다.
- 답글은 대화다. 내 글 본문의 설명체(마침표로 끝나는 긴 문장)를 쓰지 않고, 예시처럼 말하듯 쓴다.
- 근거에서 가져온 사실도 주인 입말로 옮긴다("~더라고요", "~라고 하더라고요", "~해봤는데").

## 출력
아래 JSON 객체 하나만 출력한다. 설명·코드펜스 없이.
${OUTPUT_SCHEMA}`;
}

// ── 응답 정리 (순수) ────────────────────────────────────────────────

interface RawAnswer {
  verdict?: unknown;
  verdictReason?: unknown;
  sentences?: unknown;
  draft?: unknown;
  myAsk?: unknown;
}

const VERDICTS: AnswerVerdict[] = ["answerable", "partial", "unknown"];

export interface NormalizeContext {
  question: boolean;
  sources: AnswerSource[];
  post: ThreadsPostRef;
  model: string;
  generatedAt: string;
  styleExamples: number;
  myNote?: string;
  /** 되풀이해도 되는 글 (댓글·대화·예전 답). 여기 있는 숫자·이름은 지어낸 말이 아니다 */
  context?: string;
  pastSaid?: PastSaid[];
}

/** 모델 JSON 을 계약 모양으로 고친다: 없는 근거 id 제거, 질문인데 근거 0이면 unknown. */
export function normalizeAnswer(raw: RawAnswer, ctx: NormalizeContext): ReplyAnswer {
  const known = new Set(ctx.sources.map((s) => s.id));
  if (ctx.question) known.add(POST_SOURCE_ID);
  if (ctx.myNote?.trim()) known.add("me");

  const sentences: DraftSentence[] = (Array.isArray(raw.sentences) ? raw.sentences : [])
    .map((s): DraftSentence | null => {
      const o = (s ?? {}) as { text?: unknown; sourceIds?: unknown };
      const text = typeof o.text === "string" ? o.text.trim() : "";
      if (!text) return null;
      const ids = Array.isArray(o.sourceIds) ? o.sourceIds.map(String) : [];
      return { text, sourceIds: ctx.question ? [...new Set(ids.filter((id) => known.has(id)))] : [] };
    })
    .filter((s): s is DraftSentence => s !== null);

  let draft = typeof raw.draft === "string" ? raw.draft.trim() : "";
  if (!draft) draft = sentences.map((s) => s.text).join(" ");

  // 근거 인용에 없는 사실 문장은 뺀다 (질문일 때만: 반응 답은 사실을 말하지 않는다).
  let dropped: { text: string; reason: string }[] = [];
  if (ctx.question) {
    const corpora = [
      ...ctx.sources.map(sourceCorpus),
      { id: POST_SOURCE_ID, text: ctx.post.text },
      ...(ctx.myNote?.trim() ? [{ id: "me", text: ctx.myNote.trim() }] : []),
    ];
    const checked = dropUnsupported(sentences, corpora, ctx.context ?? "");
    if (checked.dropped.length && checked.kept.length) {
      dropped = checked.dropped;
      draft = removeFromDraft(draft, dropped, checked.kept);
      sentences.splice(0, sentences.length, ...checked.kept);
    }
  }

  const cited = new Set(sentences.flatMap((s) => s.sourceIds));
  // 붙은 근거는 인용 여부와 상관없이 전부 남긴다 (칩으로 접혀 보이고, henry 가 바꿔 끼운다).
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
  if (ctx.question && cited.has("me") && ctx.myNote?.trim()) {
    sources.push({ id: "me", kind: "내 경험", title: "내 메모", quote: ctx.myNote.trim() });
  }

  let verdict: AnswerVerdict = VERDICTS.includes(raw.verdict as AnswerVerdict)
    ? (raw.verdict as AnswerVerdict)
    : "partial";
  let verdictReason = typeof raw.verdictReason === "string" ? raw.verdictReason.trim() : "";

  if (!ctx.question) {
    verdict = "answerable";
    verdictReason = "반응 댓글";
  } else if (cited.size === 0 && verdict !== "unknown") {
    verdict = "unknown";
    verdictReason = `근거 달린 문장 없음${verdictReason ? ` (모델 판단: ${verdictReason})` : ""}`;
  } else if (sentences.some((s) => s.sourceIds.length === 0 && looksFactual(s.text)) && verdict === "answerable") {
    verdict = "partial";
    verdictReason = verdictReason || "근거 없는 사실 문장이 있음";
  }

  const myAsk = typeof raw.myAsk === "string" && raw.myAsk.trim() ? raw.myAsk.trim() : undefined;
  return {
    verdict,
    verdictReason: verdictReason || (verdict === "unknown" ? "근거가 질문에 답하지 못함" : "근거로 답함"),
    sources,
    sentences,
    draft,
    ...(myAsk && ctx.question ? { myAsk } : {}),
    model: ctx.model,
    generatedAt: ctx.generatedAt,
    styleExamples: ctx.styleExamples,
    ...(dropped.length ? { dropped } : {}),
    ...(ctx.pastSaid?.length ? { pastSaid: ctx.pastSaid } : {}),
  };
}

/** 숫자·가격·버전·날짜가 든 문장 = 근거가 필요한 사실 문장으로 본다. */
function looksFactual(text: string): boolean {
  return /\d/.test(text) && !/^[\d\s!.~ㅎㅋ]*$/.test(text);
}

// ── 호출 ────────────────────────────────────────────────────────────

export async function generateAnswer(input: AnswerInput, deps: AnswerDeps = {}): Promise<ReplyAnswer> {
  const situation = situationForReply(input.reply);
  const question = isQuestionSituation(situation);
  const [styleBook, examples, owner] = await Promise.all([
    deps.styleBook !== undefined ? Promise.resolve(deps.styleBook) : loadStyleBook(),
    deps.examples ?? selectStyleExamples(input.reply, STYLE_EXAMPLE_COUNT, deps.pick),
    deps.owner ?? readProfile(),
  ]);
  const sources = question ? input.sources : [];
  const prompt = buildAnswerPrompt({ ...input, sources, styleBook, examples, situation, owner });
  const run =
    deps.run ??
    ((p: string) =>
      runClaudeCLI(p, {
        model: ANSWER_MODEL,
        effort: "medium",
        timeoutMs: answerTimeoutMs(),
        requireClaude: true,
      }));
  const text = await run(prompt);
  const raw = parseJsonObject<RawAnswer>(text);
  return normalizeAnswer(raw, {
    question,
    sources,
    post: input.post,
    model: ANSWER_MODEL,
    generatedAt: (deps.now?.() ?? new Date()).toISOString(),
    styleExamples: examples.length,
    myNote: input.myNote,
    pastSaid: input.pastSaid,
    context: trustedContext({
      thread: [input.reply.text, input.reply.repliedToText ?? "", ...(input.conversation ?? []).map((m) => m.text)],
      pastSaid: input.pastSaid,
    }),
  });
}
