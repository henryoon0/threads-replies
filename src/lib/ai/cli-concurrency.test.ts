import { describe, expect, it } from "vitest";
import { effectiveTimeoutAfterSlot, withCliSlot } from "./cli-concurrency";

// 캡 자체는 스폰 직전(claude-cli·codex-exec) 한 곳에서만 획득한다. 여기 테스트는
// 그 계약이 지켜야 할 두 성질을 고정한다: (1) 동시 실행 수가 MAX 를 못 넘고,
// (2) 슬롯 대기로 까먹은 시간이 deadlineMs 예산에서 깎인다.

const MAX = Math.max(1, Number(process.env.AI_CLI_MAX_PARALLEL) || 5);

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe("withCliSlot", () => {
  it("동시 실행을 MAX 개로 제한한다", async () => {
    let running = 0;
    let peak = 0;
    const gate = deferred();

    // MAX + 3 개를 한꺼번에 밀어넣는다. 앞의 MAX 개만 들어가고 나머지는 줄을 선다.
    const tasks = Array.from({ length: MAX + 3 }, () =>
      withCliSlot(async () => {
        running += 1;
        peak = Math.max(peak, running);
        await gate.promise;
        running -= 1;
      })
    );

    // 마이크로태스크가 다 돌 때까지 기다린 뒤 관찰 — 게이트를 열기 전이라
    // 여기서의 running 이 곧 "동시에 슬롯을 쥔 수"다.
    await new Promise((r) => setTimeout(r, 0));
    expect(running).toBe(MAX);

    gate.resolve();
    await Promise.all(tasks);
    expect(peak).toBe(MAX);
    expect(running).toBe(0);
  });

  it("실패한 작업도 슬롯을 반납한다", async () => {
    await expect(
      withCliSlot(async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    // 반납이 안 되면 MAX 번 반복 후 다음 호출이 영영 안 끝난다.
    for (let i = 0; i < MAX + 1; i += 1) {
      await withCliSlot(async () => "ok");
    }
  });
});

describe("effectiveTimeoutAfterSlot", () => {
  it("deadlineMs 가 없으면 timeoutMs 를 그대로 쓴다", () => {
    expect(effectiveTimeoutAfterSlot(300_000)).toBe(300_000);
  });

  it("남은 예산이 timeoutMs 보다 짧으면 예산으로 깎는다", () => {
    const left = effectiveTimeoutAfterSlot(300_000, Date.now() + 5_000);
    expect(left).toBeGreaterThan(0);
    expect(left).toBeLessThanOrEqual(5_000);
  });

  it("예산이 넉넉하면 timeoutMs 가 이긴다", () => {
    expect(effectiveTimeoutAfterSlot(1_000, Date.now() + 300_000)).toBe(1_000);
  });

  it("대기 중 마감이 지났으면 시작하지 않고 던진다", () => {
    expect(() => effectiveTimeoutAfterSlot(1_000, Date.now() - 1)).toThrow(
      /예산 소진/
    );
  });
});
