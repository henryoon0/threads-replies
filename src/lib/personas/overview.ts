// 레일 위 계정 카드(시안 픽 1)가 쓰는 계정 목록 + 계정별 남은 댓글 수.
// 계정마다 그 페르소나 문맥 안에서 원장을 읽는다 (동기화·AI 호출 없음).

import { readThreadsSummary, type ThreadsSummary } from "@/lib/threads-replies/summary";
import { withPersona } from "./context";
import type { PersonaSummary } from "./model";
import { listPersonas } from "./registry";

export interface PersonaOverview extends PersonaSummary {
  summary: ThreadsSummary;
}

export async function personaOverview(): Promise<PersonaOverview[]> {
  const personas = await listPersonas();
  return Promise.all(
    personas.map(async (p) => ({ ...p, summary: await withPersona(p.id, () => readThreadsSummary()) }))
  );
}
