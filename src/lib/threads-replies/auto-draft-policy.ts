// 사람이 누르지 않아도 AI 를 돌리는 범위 (2026-10-02 henry "비용 줄이기 1~3번부터").
// 실측: 대기 421개 전부에 버전 미리 쓰기 + 답 초안 잡 3벌 + 예전 답 대조가 따로 돌았다. 화면이 쓰는 건 버전 글뿐.
//  1. 답 초안 잡: 모든 계정에서 끈다 — 3벌은 아무도 안 봤다. henry 결정(10-02 "AICC 만 돌릴 필요 없어"):
//     AICC 의 근거 캡처 자동 첨부도 이 잡의 근거 찾기를 썼으므로 함께 꺼진다.
//  2. 목록을 열 때 전부 미리 쓰지 않는다 — 화면이 보내는 "지금 보는 댓글부터 10개"(POST /prefetch)만 쓴다.
//  3. 예전 답 대조(Codex)는 자동으로 돌리지 않는다 — 결과를 보여 주는 화면이 없다.
import type { PersonaConfig } from "@/lib/personas/model";

export interface AutoDraftPolicy {
  answerJob: boolean;
  prefetchAllOnOpen: boolean;
  autoConsistency: boolean;
}

export function autoDraftPolicy(_persona: Pick<PersonaConfig, "features">): AutoDraftPolicy {
  void _persona; // 계정별로 다시 켤 때를 위해 자리를 둔다
  return { answerJob: false, prefetchAllOnOpen: false, autoConsistency: false };
}
