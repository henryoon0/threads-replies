// 사례 모음(roundup) 잡·카드의 화면용 모양 (2026-09-24 픽 반영 계약).
//
// 클라이언트와 서버가 같이 import 한다 — node 모듈을 import 하지 않는 순수 모듈로
// 유지한다. 잡 레코드(GenerationJob.roundup)와 보드 카드(ContentIdea.roundup)가
// 이 모양을 그대로 싣는다.

export type RoundupPhase = "search" | "awaiting" | "collect" | "draft";

/** 검색 중 흘러드는 후보 타일. used = 장부에 이미 쓴 사례, rejected = 사례 아님. */
export type RoundupThumb = {
  url: string;
  author: string;
  text: string;
  poster?: string;
  videos: number;
  images: number;
  likes: number;
  state: "fresh" | "used" | "rejected";
  reason?: string;
};

/** 선별된 사례 (승인 목록·예비). */
export type RoundupPick = {
  url: string;
  author: string;
  what: string;
  text: string;
  poster?: string;
  videos: number;
  images: number;
  likes: number;
  date?: string;
};

export type RoundupCaseState = "wait" | "doing" | "done" | "failed" | "refilled";

/**
 * 수집 단계의 사례 줄. 실패한 사례를 예비로 메우면 그 줄은 "refilled" 가 되고
 * replacedBy 에 예비 주소가 붙으며, 예비 줄이 바로 다음 자리에 끼어든다.
 */
export type RoundupCaseProgress = {
  url: string;
  author: string;
  what: string;
  state: RoundupCaseState;
  note?: string;
  replacedBy?: string;
};

export type RoundupJobView = {
  phase: RoundupPhase;
  subject: string;
  count: number; // 요청 개수
  found: number; // 검색 후보 수
  used: number; // 장부 때문에 빠진 수
  rejected: number; // 사례가 아니라 빠진 수 (답글·모음 글·결과물 없는 인용)
  thumbs: RoundupThumb[]; // 도착 순, 최대 MAX_THUMBS
  picks: RoundupPick[];
  reserve: RoundupPick[]; // 최대 MAX_RESERVE
  progress: RoundupCaseProgress[];
  autoRefill: boolean;
};

/** 보드 카드의 사례 목록. 순서 = 칸 2..N+1 순서. */
export type RoundupCardCase = { url: string; author: string; what: string };
export type RoundupIdeaMeta = { cases: RoundupCardCase[] };

export const MAX_THUMBS = 30;
export const MAX_RESERVE = 8;
export const AWAITING_TTL_MS = 48 * 60 * 60 * 1000;
export const AWAITING_EXPIRED_ERROR = "승인 대기 48시간이 지나 닫았어요";
export const AWAITING_CANCELLED_ERROR = "승인하지 않고 닫았어요";

/**
 * 사례 모음 시안 3벌의 결. 같은 사례, 다른 글. 카드의 perspective 에 id 가 찍힌다
 * (보드 칩 라벨은 이 표에서 찾는다).
 */
export const ROUNDUP_STYLES = [
  { id: "roundup-facts", label: "사실만", hint: "사례마다 무엇·어떻게 2문장" },
  { id: "roundup-grouped", label: "종류별 묶음", hint: "결과물 종류끼리 모아 순서" },
  { id: "roundup-work", label: "실무 번역", hint: "사례마다 내 일로 옮기면 한 줄" },
] as const;
export type RoundupStyleId = (typeof ROUNDUP_STYLES)[number]["id"];
export const ROUNDUP_STYLE_BY_ID: Record<string, (typeof ROUNDUP_STYLES)[number]> =
  Object.fromEntries(ROUNDUP_STYLES.map((s) => [s.id, s]));

export function emptyRoundupView(subject = "", count = 0): RoundupJobView {
  return {
    phase: "search",
    subject,
    count,
    found: 0,
    used: 0,
    rejected: 0,
    thumbs: [],
    picks: [],
    reserve: [],
    progress: [],
    autoRefill: true,
  };
}

const sameUrl = (a: string, b: string) => a.split("?")[0] === b.split("?")[0];

/** 새 타일을 도착 순으로 덧붙인다 (중복 주소는 상태만 갱신, 상한 MAX_THUMBS). */
export function appendThumbs(
  thumbs: readonly RoundupThumb[],
  incoming: readonly RoundupThumb[]
): RoundupThumb[] {
  const out = [...thumbs];
  for (const t of incoming) {
    const at = out.findIndex((o) => sameUrl(o.url, t.url));
    if (at >= 0) out[at] = { ...out[at], state: t.state, ...(t.reason ? { reason: t.reason } : {}) };
    else if (out.length < MAX_THUMBS) out.push(t);
  }
  return out;
}

export type CaseProgressUpdate = {
  pick: { url: string; author: string; what: string };
  state: RoundupCaseState;
  note?: string;
  /** state "refilled" 일 때 대신 들어갈 예비 사례. 이 줄 바로 뒤에 "wait" 로 끼운다. */
  replacement?: { url: string; author: string; what: string };
};

/** 수집 줄 하나의 상태를 바꾼다. 없는 사례면 끝에 붙인다. */
export function markCaseProgress(
  progress: readonly RoundupCaseProgress[],
  update: CaseProgressUpdate
): RoundupCaseProgress[] {
  const out = [...progress];
  const { pick, state, note, replacement } = update;
  let at = out.findIndex((r) => sameUrl(r.url, pick.url));
  if (at < 0) {
    out.push({ url: pick.url, author: pick.author, what: pick.what, state: "wait" });
    at = out.length - 1;
  }
  out[at] = {
    ...out[at],
    state,
    ...(note ? { note } : {}),
    ...(replacement ? { replacedBy: replacement.url } : {}),
  };
  if (replacement && !out.some((r) => sameUrl(r.url, replacement.url))) {
    out.splice(at + 1, 0, {
      url: replacement.url,
      author: replacement.author,
      what: replacement.what,
      state: "wait",
    });
  }
  return out;
}

/** 저장·PATCH 로 들어온 카드 사례 목록을 방어적으로 다듬는다. 비면 undefined. */
export function sanitizeRoundupMeta(raw: unknown): RoundupIdeaMeta | undefined {
  const cases = (raw as { cases?: unknown } | null)?.cases;
  if (!Array.isArray(cases)) return undefined;
  const clean = cases
    .map((c) => {
      const r = (c ?? {}) as Record<string, unknown>;
      return {
        url: String(r.url ?? "").trim(),
        author: String(r.author ?? "").trim().replace(/^@/, ""),
        what: String(r.what ?? "").trim(),
      };
    })
    .filter((c) => /^https?:\/\//.test(c.url));
  return clean.length ? { cases: clean } : undefined;
}
