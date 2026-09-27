/**
 * 공유 허브 도메인 — 회의록·플래시카드를 항목 단위로 정적 HTML 로 구워
 * Cloudflare Pages(aicoffeechat-share)에 누적 배포하고 링크로 전한다.
 * 전체 대시보드를 배포하는 게 아니라 "그 한 장"만 내보내는 게 핵심.
 */

export type ShareKind =
  | "meeting"
  | "meeting-notes"
  | "flashcards"
  | "report"
  | "script-kit"
  | "links";

export interface ShareEntry {
  /** 사이트 내 경로 키 — "m/<shareId>" | "n/<shareId>" | "f/<deckId>" | "r/<shareId>". */
  key: string;
  kind: ShareKind;
  /** 원본 식별자(미팅 id, 덱 id). */
  sourceId: string;
  title: string;
  /** 공개 URL 경로 ("/m/abc.../"). */
  path: string;
  publishedAt: string;
  updatedAt: string;
  /** 플래시카드 전용 — 담긴 카드 수. */
  cardCount?: number;
}

export interface ShareDeployInfo {
  at: string;
  ok: boolean;
  /** 배포 산출 URL(프로덕션 alias). */
  url?: string;
  error?: string;
}

export interface ShareManifest {
  entries: ShareEntry[];
  lastDeploy?: ShareDeployInfo;
}

/** 플래시카드 공유 요청 본문 — 선택한 카드만 담아 보낸다. */
export interface ShareFlashcardsPayload {
  title: string;
  summary?: string;
  cards: {
    front: string;
    back: string;
    concept?: string;
    category?: string;
  }[];
}
