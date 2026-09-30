// 댓글 읽기 — 초안을 쓰기 전에 주인이 댓글을 읽으며 하는 판단을 구조로 뽑는다 (2026-09-30 henry 리뷰).
//
// 예전 초안기는 말끝 정규식(intent.ts)으로 질문/잡담/반응만 가르고 바로 썼다. 그래서
// "상의할 의사가 없어서 박약사한테 묻는" 사람에게 "의사쌤한테 물어봐"로 돌려보냈다.
// 이제 댓글마다 한 번 읽는다: 누구인가 · 원글/댓글의 어느 지점 · 진짜 니즈 · 본질 문제와 접근 ·
// 되물을 것 · 유머 각도. 모든 버전 초안 요청에 이 결과를 먼저 싣는다. 버전은 모양일 뿐, 판단은 여기서 한다.
// 순수 — I/O 없음 (모델 호출·캐시는 reading-run.ts).

import type { CommenterProfile } from "./commenter-profile";

export const READING_NEEDS = ["consult", "info", "empathy", "recognition", "chat"] as const;
export type ReadingNeed = (typeof READING_NEEDS)[number];

export const NEED_NAME: Record<ReadingNeed, string> = {
  consult: "주인에게 직접 상담받고 싶다",
  info: "정보·사실 하나가 궁금하다",
  empathy: "힘든 걸 알아줬으면 한다",
  recognition: "한 일을 인정받고 싶다",
  chat: "가볍게 말 걸기·반응",
};

export interface CommentReading {
  /** 누구인가 (글·댓글 단서로. 짐작은 짐작이라고 적는다) */
  who: string;
  /** 원글·댓글의 어느 지점에 반응했나 */
  focus: string;
  need: ReadingNeed;
  /** 니즈를 한 문장으로 */
  needNote: string;
  /** 겉으로 묻는 것 밑의 본질 문제 */
  core: string;
  /** 해결 접근 (약 하나에 기대지 않고 운동·식단·생활 같은 실질 방법까지) */
  approach: string[];
  /** 답이 크게 달라져서 되물어야 할 사실 */
  missing: string[];
  /** 재밌게 말할 각도 (없으면 빈 문자열) */
  humor: string;
  /** 누구인지 판단할 단서가 모자라 프로필을 보면 판단이 달라지나 */
  needProfile: boolean;
}

/** 과거 댓글-답 한 쌍을 같은 틀로 읽은 것 (예시 은행 reading-examples.json 한 칸) */
export interface ReadingExample {
  pairId: string;
  comment: string;
  reply: string;
  focus: string;
  need: ReadingNeed;
  approach: string;
}

export interface ReadingPromptParts {
  owner: string;
  ownerLine: string;
  post: string;
  conversation?: string;
  comment: string;
  commenter: string;
  profile?: CommenterProfile | null;
  safety: string;
  examples: readonly ReadingExample[];
}

function clip(text: string, max: number): string {
  const t = (text ?? "").trim();
  return t.length > max ? `${t.slice(0, max)}(생략)` : t;
}

function exampleLines(owner: string, examples: readonly ReadingExample[]): string {
  if (!examples.length) return "";
  const body = examples
    .map((e) => `<past>\n댓글: ${clip(e.comment, 300)}\n읽은 지점: ${e.focus}\n니즈: ${NEED_NAME[e.need]}\n접근: ${e.approach}\n${owner}의 실제 답: ${clip(e.reply, 500)}\n</past>`)
    .join("\n");
  return `\n## ${owner}이(가) 비슷한 댓글을 실제로 어떻게 읽고 답했나\n${body}\n`;
}

function profileLine(profile: CommenterProfile | null | undefined): string {
  if (!profile) return "";
  return `\n<commenter_profile>\n이름: ${profile.name}\n소개: ${clip(profile.bio, 300)}\n</commenter_profile>\n프로필은 판단에만 쓴다. 답에 프로필 내용을 드러내는 말은 넣지 않는다.`;
}

export function buildReadingPrompt(p: ReadingPromptParts): string {
  const conv = p.conversation ? `\n<conversation_so_far>\n${p.conversation}\n</conversation_so_far>` : "";
  return `당신은 ${p.ownerLine}인 ${p.owner} 본인이다. 팔로워 댓글에 답을 쓰기 전에, 댓글을 읽고 판단부터 한다. 답은 아직 쓰지 않는다.

<my_post>
${clip(p.post, 1200)}
</my_post>${conv}
<comment author="${p.commenter}">
${p.comment.trim()}
</comment>${profileLine(p.profile)}

<safety>
${p.safety.trim()}
</safety>
${exampleLines(p.owner, p.examples)}
## 판단할 것
1. who: 누구인가. 나이대·성별·엄마인지·운동하는지·지금 먹는 약 같은 단서를 글과 댓글에서 찾는다. 단서가 없으면 "모름"이라고 쓰고 지어내지 않는다.
2. focus: 원글이나 댓글의 어느 문장·숫자에 반응했나. 댓글에서 제일 무게가 실린 지점을 짚는다.
3. need: consult(${NEED_NAME.consult}) / info(${NEED_NAME.info}) / empathy(${NEED_NAME.empathy}) / recognition(${NEED_NAME.recognition}) / chat(${NEED_NAME.chat}) 중 하나. needNote 에 한 문장으로.
   ${p.owner}에게 자기 상황을 길게 털어놓고 "~해야 할까?"를 묻는 사람은 ${p.owner}의 판단을 원한다. 다른 곳(의사·병원)으로 돌리는 건 정말 위험 신호가 있을 때만이다.
4. core: 겉으로 묻는 것 밑의 본질 문제 (예: 용량 질문이지만 실제로는 근육이 적어서 대사가 떨어진 것).
5. approach: ${p.owner}이(가) 줄 해결 접근 2~4개. 약·영양제 하나에 기대지 않고 운동·식단·생활·용량 속도 같은 실질 방법까지. 처방약 용량 이야기도 상황 판단으로 한다(표준 증량 스케줄, 속도, 운동·식단과 함께).
6. missing: ${p.owner}은(는) 댓글 여섯 개 중 다섯은 되묻지 않고 가진 정보로 바로 판단한다. 알면 더 좋은 사실은 missing 이 아니다. 이 사실 없이는 답의 방향 자체를 못 잡을 때만 1개 (예: 용량을 언제 올렸는지 모르면 증량 판단이 정반대가 된다). 대부분 빈 배열이다.
7. humor: 재밌게·가볍게 말할 각도가 있으면 한 줄 (억지면 빈 문자열).
8. needProfile: 누구인지(나이대·성별·엄마인지 등)가 답을 바꾸는데 글·댓글만으로 모르면 true.${p.profile ? " 이미 프로필을 봤으면 false." : ""}

## 출력
JSON 하나만. 설명·코드펜스 없이.
{"who": "", "focus": "", "need": "consult", "needNote": "", "core": "", "approach": [""], "missing": [], "humor": "", "needProfile": false}`;
}

function str(v: unknown, max = 400): string {
  return typeof v === "string" ? clip(v, max) : "";
}

function strs(v: unknown, n: number): string[] {
  return Array.isArray(v) ? v.map((x) => str(x, 200)).filter(Boolean).slice(0, n) : [];
}

export function parseReading(raw: unknown): CommentReading | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const need = (READING_NEEDS as readonly string[]).includes(String(r.need)) ? (r.need as ReadingNeed) : null;
  const focus = str(r.focus);
  if (!need || !focus) return null;
  return {
    who: str(r.who) || "모름",
    focus,
    need,
    needNote: str(r.needNote),
    core: str(r.core),
    approach: strs(r.approach, 4),
    missing: strs(r.missing, 3),
    humor: str(r.humor, 200),
    needProfile: r.needProfile === true,
  };
}

function readingLines(r: CommentReading, humor: boolean): string[] {
  return [
    `누구: ${r.who}`,
    `짚을 지점: ${r.focus}`,
    `진짜 니즈: ${NEED_NAME[r.need]}${r.needNote ? ` — ${r.needNote}` : ""}`,
    r.core ? `본질 문제: ${r.core}` : "",
    r.approach.length ? `접근:\n${r.approach.map((a) => `- ${a}`).join("\n")}` : "",
    r.missing.length ? `모자란 정보: ${r.missing.join(" / ")}` : "모자란 정보: 없음",
    r.humor && humor ? `유머 각도: ${r.humor}` : "",
  ].filter(Boolean);
}

/** 초안 요청문에 싣는 읽기 결과 */
/**
 * humor=false 면 유머 각도를 싣지 않는다 (2026-09-30 henry "버전이 다 같은 답의 변형"):
 * 유머 각도는 완성된 한 문장이라, 드립 조각이 없는 버전에도 실으면 모든 버전이 그 문장으로 연다.
 */
export function readingBlock(owner: string, r: CommentReading, opts: { humor?: boolean } = {}): string {
  const lines = readingLines(r, opts.humor !== false);
  const light = isLightNeed(r.need)
    ? `\n가벼운 말 걸기다. 켠 조각을 다 채우지 않는다. 켠 조각 하나로 한두 문장만 받는다 (정보를 얹지 않는다).`
    : "";
  const consult =
    r.need === "consult"
      ? `\n이 사람은 ${owner}의 판단을 원한다. "내가 정할 수 없다", "의사쌤한테 물어봐"로 돌려보내지 않는다. ${owner}이(가) 직접 상황을 판단하고 방법을 준다.`
      : "";
  return `<reading>\n${lines.join("\n")}\n</reading>\n위는 ${owner}이(가) 이 댓글을 읽고 내린 판단이다. 답은 이 판단을 따른다: 짚을 지점에서 시작하고, 니즈에 맞게, 접근을 실제 행동으로 준다. 접근을 다 쓰지 않는다. 이 사람에게 제일 급한 한두 개만 쓴다.${isLightNeed(r.need) ? "" : " 조각이 하나뿐이어도 약·영양제만 남기지 않는다. 생활 쪽 해결책(운동·식단·수면 등) 하나는 꼭 넣는다."} 버전 지시는 답의 모양만 정한다.${consult}${light}`;
}

/** 가벼운 말 걸기·인정: 켠 조각을 다 채우지 않고 짧게 받는다 */
export function isLightNeed(need: ReadingNeed): boolean {
  return need === "chat" || need === "recognition";
}

/** 읽기 결과 캐시 열쇠에 쓰는 판 (프롬프트 틀이 바뀌면 올린다) */
export const READING_VERSION = 2;
