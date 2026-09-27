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
export type SourceKind = "원글 원본" | "수집한 원문" | "수집노트" | "강의 자료" | "FAQ" | "지난 글" | "웹" | "내 경험" | "붙인 링크" | "내 자료";

export interface AnswerSource {
  id: string;
  kind: SourceKind;
  title: string;
  /** 원문 그대로 옮긴 인용. 캡처 형광펜이 이 문자열을 원문에서 찾는다 — 의역 금지. */
  quote: string;
  url?: string;
  /** 저장소 안 출처 (파일 경로·id). 사람이 따라가 확인하는 용도. */
  origin?: string;
}

/** 초안 문장 하나와 그 문장을 받치는 근거 id. 빈 배열 = 근거 없음(확인 필요). */
export interface DraftSentence {
  text: string;
  sourceIds: string[];
}

/** 답할 수 있음 판정 (픽 4). */
export type AnswerVerdict = "answerable" | "partial" | "unknown";

export interface ReplyAnswer {
  verdict: AnswerVerdict;
  /** 판정 한 줄 (henry 에게 보이는 이유) */
  verdictReason: string;
  sources: AnswerSource[];
  sentences: DraftSentence[];
  /** 보낼 답글 (sentences 를 henry 말투로 이은 것. henry 가 고치면 이 값만 바뀐다) */
  draft: string;
  /** 자료로는 못 채우는 내 경험 질문 한 줄 (없으면 비움) */
  myAsk?: string;
  model: string;
  generatedAt: string;
  /** 초안이 참고한 henry 과거 답글 예시 수 (말투 학습 확인용) */
  styleExamples: number;
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
  sync: { lastSyncAt?: string; lastError?: string; postsScanned?: number };
}

export function createRepliesLedger(): ThreadsRepliesLedger {
  return { posts: [], replies: [], sync: {} };
}

/** 아직 답할 차례인 댓글 (내 답 없음 · 건너뛰지 않음). */
export function isPending(r: ThreadsReply): boolean {
  return !r.myReply && !r.skipped;
}
