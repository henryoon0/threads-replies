// ── DAS-47: 자가 치유 sweep — 고아 잡을 서버가 스스로 복구한다 ──
//
// 지금까지 고아(=status는 active인데 이 프로세스에서 안 도는) 복구는 브라우저 탭의
// GET 폴링이 닿아야만 일어났다 — 탭을 닫으면 잡이 영원히 갇혔다. 이 모듈은 그 복구를
// 서버 시작 시 + 주기적으로 스스로 하도록 한다(instrumentation.ts register 에서 기동).
//
// 도메인(자막·영상)은 어댑터로 등록한다. 어댑터는 두 가지만 안다:
//   - listActive(): active(재개 가능) 상태 잡들의 {id, updatedAt}
//   - resume(id):   멱등 재개 — 내부에서 phase 별 isRunning 가드를 거친다
//
// heartbeat 는 잡의 자연스러운 updatedAt 갱신(상태 전이·배치 저장)으로 충분하다.
// 단일 프로세스 로컬 앱에서 in-process 권위는 Job Runner 의 isRunning 이고(어댑터의
// resume 이 그걸 쓴다), staleness 는 "재시작 교차" 판정용 보조 장치다. 그래서 시작
// sweep 은 staleness 를 무시하고(새 프로세스 = active 면 전부 고아) 즉시 재개하고,
// 주기 sweep 만 stale 게이트로 막 시작한 잡을 건드리지 않는다.

const STALE_MS = 5 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60_000;

export interface ActiveJobRef {
  /** 도메인 잡 id. */
  id: string;
  /** 마지막 갱신(=heartbeat) ISO 시각. stale 판정에 쓴다. */
  updatedAt: string;
}

interface SweepAdapterBase {
  /** 도메인 이름 — 같은 이름 재등록 시 덮어쓴다(hot-reload 중복 방지). */
  name: string;
}

/** 흔한 모양: 스윕이 고아를 고르고, 어댑터는 열거와 재개만 안다. */
export interface ListResumeSweepAdapter extends SweepAdapterBase {
  /** active(재개 가능) 상태 잡들. */
  listActive: () => Promise<ActiveJobRef[]>;
  /** 멱등 재개 — phase 별 isRunning 가드는 어댑터 안에서 한다. */
  resume: (id: string) => Promise<void> | void;
}

/**
 * 되살리기를 이미 자기 안에 갖고 있는 기능용(content-ideas·고민함 배치처럼 목록
 * 함수가 읽기-판정-재개를 한 트랜잭션으로 한다). 스윕이 기여하는 건 "언제 도는가"
 * 뿐이라 여기선 그것만 받는다 — listActive 가 빈 배열을 돌려주며 몰래 부수효과를
 * 내는 것보다 이 쪽이 정직하다.
 *
 * ⚠ 이 어댑터는 자기 stale 기준을 스스로 쓴다. 그래서 시작 스윕의 ignoreStale 이
 * 안 먹는다 — 재시작 직후 방금 죽은 잡은 그 기능의 창(예: 2분)이 지나야 되살아난다.
 */
export interface SelfSweepAdapter extends SweepAdapterBase {
  /** 고아 판정과 재개를 한 번에. 멱등해야 한다(1분마다 불린다). */
  sweep: () => Promise<void>;
}

export type SweepAdapter = ListResumeSweepAdapter | SelfSweepAdapter;

function isSelfSweep(a: SweepAdapter): a is SelfSweepAdapter {
  return "sweep" in a;
}

const adapters = new Map<string, SweepAdapter>();

export function registerSweepAdapter(adapter: SweepAdapter): void {
  adapters.set(adapter.name, adapter);
}

/** 테스트용 — 등록된 어댑터를 모두 비운다. */
export function clearSweepAdapters(): void {
  adapters.clear();
}

/**
 * 등록된 모든 어댑터를 한 번 쓸어 고아를 재개한다. 재개 성공 건수를 돌려준다.
 * - ignoreStale=true: staleness 무시(시작 sweep — active 면 전부 고아).
 * - 기본: heartbeat 가 STALE_MS 보다 오래된 잡만 재개(주기 sweep).
 * 어댑터 하나가 던져도 나머지는 계속 쓴다. resume 실패는 잡 단위로 격리한다.
 */
export async function sweepOnce(
  opts: { ignoreStale?: boolean; now?: number } = {}
): Promise<number> {
  const now = opts.now ?? Date.now();
  let resumed = 0;

  for (const adapter of adapters.values()) {
    if (isSelfSweep(adapter)) {
      try {
        await adapter.sweep();
        // 몇 건을 되살렸는지는 이 어댑터가 알려주지 않는다(자기 안에서 끝낸다).
      } catch {
        // 한 어댑터의 실패가 나머지를 막지 않는다.
      }
      continue;
    }

    let jobs: ActiveJobRef[];
    try {
      jobs = await adapter.listActive();
    } catch {
      continue; // 한 어댑터의 열거 실패가 전체 sweep 을 막지 않는다
    }

    for (const job of jobs) {
      if (!opts.ignoreStale) {
        const beat = Date.parse(job.updatedAt);
        if (Number.isFinite(beat) && now - beat <= STALE_MS) continue;
      }
      try {
        await adapter.resume(job.id);
        resumed++;
      } catch {
        // 재개는 best-effort — 한 잡 실패가 다음 잡을 막지 않는다
      }
    }
  }

  return resumed;
}

// ── 스케줄러 ──
// dev hot-reload 가 이 모듈을 재평가해도 인터벌이 중복되지 않게 globalThis 에 상태를 둔다.

interface SchedulerState {
  started: boolean;
  timer?: ReturnType<typeof setInterval>;
}

function schedulerState(): SchedulerState {
  const g = globalThis as typeof globalThis & { __jobSweep?: SchedulerState };
  g.__jobSweep ??= { started: false };
  return g.__jobSweep;
}

/**
 * 서버 시작 시 1회 호출(instrumentation register). 즉시 시작 sweep(ignoreStale)으로
 * 재시작으로 갇힌 고아를 모두 재개하고, 이후 주기 sweep(stale 게이트)을 건다.
 * 중복 호출/재평가에도 인터벌은 하나만 돈다.
 */
export async function startSweepScheduler(): Promise<void> {
  const state = schedulerState();
  if (state.started) return;
  state.started = true;

  await sweepOnce({ ignoreStale: true }).catch(() => {});

  state.timer = setInterval(() => {
    void sweepOnce().catch(() => {});
  }, SWEEP_INTERVAL_MS);
  // 잡이 없으면 인터벌이 프로세스를 붙들지 않게 한다(테스트·CLI).
  state.timer.unref?.();
}

/** 테스트용 — 스케줄러 상태/인터벌을 리셋한다. */
export function __resetSchedulerForTest(): void {
  const state = schedulerState();
  if (state.timer) clearInterval(state.timer);
  state.started = false;
  state.timer = undefined;
}
