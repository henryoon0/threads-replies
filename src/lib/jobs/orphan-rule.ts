// ── 고아 잡 판정 규칙을 만드는 한 곳 ──
//
// "활성 상태인데 updatedAt 이 오래 묵었으면 프로세스가 죽은 고아다"는 규칙이 기능마다
// 손으로 복사돼 있었다(cardnews·youtube/script·collection-notes·threads-archive).
// 네 사본은 글자 하나까지 같은 모양이었고, 실제로 다른 건 딱 세 가지였다:
// 활성 상태 판정 / STALE_MS / id 필드 이름.
//
// ⚠ staleMs 를 기능끼리 통일하지 말 것. 그 값들은 각자 실측으로 정한 것이라
// (하트비트 간격·최장 단일 구간·무응답 상한이 기능마다 다르다) 하나로 뭉개면
// 정상적으로 오래 도는 잡을 sweep 이 도중에 죽여 재개 루프를 만든다.
// 불변식은 기능별로 같다: **staleMs > 그 기능의 최장 무하트비트 구간 + 여유**.

interface BaseSpec<J> {
  /** 재개 대상이 되는 상태인지. 여기서 false 면 절대 고아가 아니다. */
  isActive: (job: J) => boolean;
  /** 이 기능의 고아 윈도우. 위 불변식에 맞춰 기능마다 따로 정한다. */
  staleMs: number;
  /** 마지막 하트비트 시각. 기본은 updatedAt. */
  beatOf?: (job: J) => string;
}

export interface OrphanRuleSpec<J, Id = string> extends BaseSpec<J> {
  /** 잡에서 id 를 꺼낸다(기능마다 필드 이름이 다르다: id, setId …). */
  idOf: (job: J) => Id;
}

export interface SingleOrphanRule<J> {
  /** 이 규칙의 고아 윈도우(ms). */
  readonly staleMs: number;
  /** 잡 하나가 고아인지. staleMs 를 넘겨 한 번만 다르게 볼 수도 있다. */
  isOrphan: (job: J, nowMs: number, staleMs?: number) => boolean;
}

export interface OrphanRule<J, Id = string> extends SingleOrphanRule<J> {
  /** 고아인 잡들의 id. */
  findOrphanIds: (jobs: readonly J[], nowMs: number, staleMs?: number) => Id[];
}

// 잡이 여러 개인 기능(목록에서 고아를 골라낸다)과 잡이 하나뿐인 기능(threads-archive
// 동기화처럼 id 가 아예 없다)을 타입으로 가른다 — 후자에 findOrphanIds 는 무의미하다.
export function defineOrphanRule<J, Id = string>(
  spec: OrphanRuleSpec<J, Id>
): OrphanRule<J, Id>;
export function defineOrphanRule<J>(spec: BaseSpec<J>): SingleOrphanRule<J>;
export function defineOrphanRule<J, Id = string>(
  spec: BaseSpec<J> & { idOf?: (job: J) => Id }
): OrphanRule<J, Id> | SingleOrphanRule<J> {
  const beatOf = spec.beatOf ?? ((job: J) => (job as { updatedAt: string }).updatedAt);

  const isOrphan = (job: J, nowMs: number, staleMs: number = spec.staleMs): boolean => {
    if (!spec.isActive(job)) return false;
    const beat = Date.parse(beatOf(job));
    // 하트비트를 못 읽으면 고아로 본다 — 갇힌 채로 두는 것보다 재개가 낫다
    // (재개는 멱등이고, 도는 중이면 isRunning 가드가 막는다).
    if (!Number.isFinite(beat)) return true;
    return nowMs - beat > staleMs;
  };

  const idOf = spec.idOf;
  if (!idOf) return { staleMs: spec.staleMs, isOrphan };

  return {
    staleMs: spec.staleMs,
    isOrphan,
    findOrphanIds: (jobs, nowMs, staleMs) =>
      jobs.filter((j) => isOrphan(j, nowMs, staleMs)).map(idOf),
  };
}
