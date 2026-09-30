// 스레드 댓글 답하기 — 공용 데이터 모양 (2026-09-27, 시안 라운드 /prototypes/social-replies 픽 반영).
//
// 픽: 채널 스위치 · 질문 띠 · 글별 묶음+대화 줄기 · 답할 수 있음 판정 · 링크 끌어 놓기 · 하나씩+되돌리기 · 콘텐츠 소재로.
// 여러 모듈(동기화·검색·초안·캡처·발송·보드 넘기기)이 이 파일의 모양만 보고 맞물린다. 모양을 바꾸면 호출처 전부 확인.
// Pure — I/O 없음.

/** 댓글 성격. question 만 근거 검색·판정을 거친다. */
export type ReplyIntent = "question" | "conversation" | "chat" | "reaction";

/** 내 글 (루트 게시물). 댓글을 글별로 묶는 머리. */
export interface ThreadsPostRef {
  id: string;
  text: string;
  permalink?: string;
  timestamp: string;
}

/** 남이 단 댓글 한 건 + 내 처리 상태. */
export interface ThreadsReply {
  id: string;
  postId: string;
  username: string;
  text: string;
  timestamp: string;
  /** 이 댓글 자체의 스레드 주소 (수집 때 댓글 코드를 받았을 때만) */
  permalink?: string;
  /** 무엇에 단 답인지. postId 와 같으면 원글에 단 댓글, 아니면 대화 줄기 속 답. */
  repliedToId: string;
  /** repliedToId 가 내 답글일 때 그 본문 (대화 줄기 그리기용) */
  repliedToText?: string;
  intent: ReplyIntent;
  /** 이미 내가 답했으면 그 답글 */
  /** withImage: 이미지를 붙여 보냈는지 (이미지 자체는 발행 뒤 지워서 남지 않는다) */
  myReply?: { id: string; text: string; timestamp: string; withImage?: boolean };
  skipped?: boolean;
  /** 초안 · 근거 · 판정. 질문이 아니면 answer 만 짧게 채운다. */
  answer?: ReplyAnswer;
}

/**
 * 근거 한 건. id 는 한 답 안에서만 유일하면 된다 (s1, s2 …).
 * 수집한 원문 = henry 가 link 잡으로 조사해 둔 X·웹 원문 (data/threads-runs/<runId>/00_input/source.md) 중
 * 이 글의 재료로 짝지어지지 않은 것. 진짜 원문이라 형광 캡처 대상이다.
 */
export type SourceKind =
  | "원글 원본"
  | "수집한 원문"
  | "수집노트"
  | "강의 자료"
  | "FAQ"
  | "지난 글"
  | "웹"
  | "내 경험"
  | "붙인 링크"
  // 받는 사람의 내 자료 폴더 (evidence-docs.ts)
  | "내 자료"
  // 박약사 팩(보충제 지식 뇌): 성분 설명·근거 강도 칸 / 팟캐스트 발언 요약 (retrieve-brain.ts)
  | "성분 페이지"
  | "팟캐스트 발언";

export interface AnswerSource {
  id: string;
  kind: SourceKind;
  title: string;
  /** 원문 그대로 옮긴 인용. 캡처 형광펜이 이 문자열을 원문에서 찾는다 — 의역 금지. */
  quote: string;
  url?: string;
  /** 저장소 안 출처 (파일 경로·id). 사람이 따라가 확인하는 용도. */
  origin?: string;
  /** 팟캐스트·유튜브 발언: 말한 사람 */
  speaker?: string;
  /** 팟캐스트·유튜브 발언: 영상 제목 */
  videoTitle?: string;
  /** 팟캐스트·유튜브 발언: 말한 시각(초). url 은 이 초에서 열린다 */
  startSec?: number;
  /** 원문(영어) 발언의 한국어 한 줄 요약. quote 는 원문 그대로 */
  claimKo?: string;
  /** 성분 페이지: 근거 강도 한 줄 (NIH 안내서·문헌고찰 수) */
  strength?: string;
}

/** 초안 문장 하나와 그 문장을 받치는 근거 id. 빈 배열 = 근거 없음(확인 필요). */
export interface DraftSentence {
  text: string;
  sourceIds: string[];
}

/** 답할 수 있음 판정 (픽 4). */
export type AnswerVerdict = "answerable" | "partial" | "unknown";

/**
 * 초안 한 벌 (시안 픽 9 "초안 3벌"). 주인이 실제로 단 답을 유형별로 나눈 카테고리(팩 categories.json)
 * 가운데 이 댓글에 맞는 셋을 골라, 카테고리마다 그 유형의 정교한 지시문으로 한 벌씩 쓴다.
 */
export interface DraftOption {
  categoryId: string;
  categoryName: string;
  /** 이 유형을 쓰는 때 (카테고리 when). "다른 버전" 칸에 "왜 이런 느낌인지"로 보인다 */
  categoryWhen?: string;
  draft: string;
  sentences: DraftSentence[];
  /** 근거 인용에 없는 사실이라 초안에서 뺀 문장 (fact-check.ts). 화면에 "근거 없어 뺀 문장"으로 보인다 */
  dropped?: { text: string; reason: string }[];
  /** 길이 역할 (length-plan.ts): 기본 3벌은 짧게·중간·길게가 하나씩 */
  lengthRole?: LengthRole;
  /** 예전 답과 어긋나는 문장 (consistency.ts). 글은 바꾸지 않고 칠하기만 한다 */
  consistency?: ConsistencyHit[];
}

export type LengthRole = "short" | "mid" | "long";

/** 주인이 예전에 단 답 한 건 (초안 프롬프트의 "예전에 한 말" · 어긋남 검사의 비교 대상) */
export interface PastSaid {
  id: string;
  text: string;
  /** 그 답이 달린 댓글 */
  comment?: string;
  date?: string;
  permalink?: string;
  /** 지금 댓글 단 사람에게 했던 답 */
  sameCommenter?: boolean;
}

/** 초안 문장 하나가 예전 답과 어긋남. 위치는 그 글(draft) 안 [start, end). */
export interface ConsistencyHit {
  sentenceStart: number;
  sentenceEnd: number;
  /** text = 예전 답에서 그대로 옮긴 구절 (원문에 있는지 코드가 확인한 것만 남는다) */
  past: { text: string; date?: string; permalink?: string; comment?: string };
  /** 어떻게 다른지 한 줄 */
  note: string;
}

/** 안전 관문이 초안에서 찾은 표현 하나 (시안 픽 7·11: 빨간 배지 대신 글자 위 색칠 + 호버 이유). */
export interface GateHit {
  /** draft 문자열 안 위치 [start, end) */
  start: number;
  end: number;
  phrase: string;
  kind: string;
  /** block = 고치기 전엔 못 보냄 (strict 팩), check = 확인만 */
  action: "block" | "check";
  reason: string;
  /** 바꿔 쓸 표현 제안 (있으면 누르면 바뀐다) */
  suggest?: string;
  /** 예전 답과 어긋남 칠하기일 때 그 예전 답 (kind = PAST_HIT_KIND) */
  past?: ConsistencyHit["past"];
  /** 근거 없는 사실 칠하기일 때 대조한 자료 (kind = FACT_HIT_KIND) */
  sources?: { title: string; url?: string }[];
  /** 근거 없는 사실 칠하기일 때 자료에서 못 찾은 낱말 ("4주짜리", "24g") */
  missing?: string[];
}

export interface GateResult {
  status: "pass" | "check" | "block";
  hits: GateHit[];
  /** 칠하지 않고 칸 아래 한 줄로만 알리는 막는 표현 (링크 등, editor-paint.ts) */
  notes?: GateHit[];
}

export interface ReplyAnswer {
  verdict: AnswerVerdict;
  /** 판정 한 줄 (henry 에게 보이는 이유) */
  verdictReason: string;
  sources: AnswerSource[];
  sentences: DraftSentence[];
  /** 보낼 답글 (sentences 를 henry 말투로 이은 것. henry 가 고치면 이 값만 바뀐다) */
  draft: string;
  /** 자료로는 못 채우는 henry 경험 질문 한 줄 (없으면 비움) */
  henryAsk?: string;
  model: string;
  generatedAt: string;
  /** 초안이 참고한 henry 과거 답글 예시 수 (말투 학습 확인용) */
  styleExamples: number;
  /** 초안 3벌 (픽 9). 없으면 예전 한 벌짜리 답. */
  options?: DraftOption[];
  /** 고른 벌 (options 의 index) */
  chosen?: number;
  /** AI 가 처음 쓴 초안 원문 — 주인이 고쳐도 안 바뀐다. 학습 신호 = aiDraft 와 보낸 답의 차이. */
  aiDraft?: string;
  /** 이 댓글의 Claude 세션 (팩 폴더). 다시 쓰기·보낸 결과 기록이 같은 세션에 이어 쓴다. */
  sessionId?: string;
  /** 안전 관문 결과 (draft 기준) */
  gate?: GateResult;
  /** 근거 없어 뺀 문장 (고른 벌 기준) */
  dropped?: { text: string; reason: string }[];
  /** 초안 전에 찾은 주인의 예전 답 (같은 주제 · 같은 사람). 어긋남 검사가 이것과 비교한다 */
  pastSaid?: PastSaid[];
  /** draft(=consistencyFor) 기준 예전 답과 어긋나는 문장 */
  consistency?: ConsistencyHit[];
  /** consistency 를 잰 글. draft 와 다르면 옛 결과라 다시 잰다 */
  consistencyFor?: string;
}

/** 원문 형광 캡처 (픽 6). 원본 X 글·웹 글만 찍는다. henry 노트는 찍지 않는다. */
export interface EvidenceShot {
  sourceId: string;
  url: string;
  /** public/ 아래 경로 (/threads-evidence/<replyId>/<file>.png) */
  image: string;
  painted: number;
  createdAt: string;
}

/** 보내기 대기 (픽 6: 하나씩 + 5초 되돌리기). */
export interface PendingSend {
  replyId: string;
  message: string;
  /** 이 시각이 지나야 실제로 보낸다. 그 전 DELETE = 되돌리기 */
  sendAfter: string;
  status: "waiting" | "sending" | "sent" | "failed" | "cancelled";
  error?: string;
  sentReplyId?: string;
}

export interface ThreadsRepliesLedger {
  posts: ThreadsPostRef[];
  replies: ThreadsReply[];
  /** source: api = Threads API 동기화, collected = 토큰 없는 페르소나의 aside 수집본(읽기 전용) */
  sync: { lastSyncAt?: string; lastError?: string; postsScanned?: number; source?: "api" | "collected" };
}

export function createRepliesLedger(): ThreadsRepliesLedger {
  return { posts: [], replies: [], sync: {} };
}

/** 아직 답할 차례인 댓글 (내 답 없음 · 건너뛰지 않음). */
export function isPending(r: ThreadsReply): boolean {
  return !r.myReply && !r.skipped;
}
