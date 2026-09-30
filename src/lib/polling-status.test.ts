import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";

import {
  PollingHttpError,
  __resetPollingStatus,
  clearPollingFailure,
  describePollingError,
  pollFetch,
  reportPollingFailure,
  subscribePollingStatus,
} from "./polling-status";
import { MAX_BACKOFF_MS, resolveDelay } from "@/hooks/use-polling";

describe("describePollingError", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("blames the network, not the server, when the mac is offline", () => {
    vi.stubGlobal("navigator", { onLine: false });
    // Even a server error is reported as offline — the request never landed.
    const p = describePollingError(new PollingHttpError(500, "/api/x"));
    expect(p.kind).toBe("offline");
    expect(p.command).toBeUndefined();
  });

  it("reads a rejected fetch as a dev server that is not running", () => {
    const p = describePollingError(new TypeError("Failed to fetch"));
    expect(p.kind).toBe("server-down");
    expect(p.command).toBe("npm run dev");
  });

  it("points a 404 at build cache corruption, not at missing code", () => {
    const p = describePollingError(new PollingHttpError(404, "/api/new"));
    expect(p.kind).toBe("not-found");
    expect(p.command).toBe("npm run dev");
  });

  it("sends 5xx to the dev log", () => {
    const p = describePollingError(new PollingHttpError(503, "/api/x"));
    expect(p.kind).toBe("server-error");
    expect(p.command).toContain(".dev.log");
  });

  it("treats a gateway timeout as slow, not broken", () => {
    expect(describePollingError(new PollingHttpError(504, "/api/x")).kind).toBe(
      "timeout",
    );
  });

  it("always yields an actionable message", () => {
    const p = describePollingError({ weird: true });
    expect(p.title).not.toHaveLength(0);
    expect(p.action).not.toHaveLength(0);
  });
});

describe("pollFetch", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("throws with the status instead of returning a bad response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })),
    );
    await expect(pollFetch("/api/x")).rejects.toBeInstanceOf(PollingHttpError);
  });

  it("passes a good response through", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );
    await expect(pollFetch("/api/x")).resolves.toBeInstanceOf(Response);
  });
});

describe("polling status store", () => {
  beforeEach(() => __resetPollingStatus());

  it("shows one notice when several screens fail at once", () => {
    const seen: number[] = [];
    const stop = subscribePollingStatus((s) => seen.push(s.failingCount));
    reportPollingFailure("cut", new TypeError("Failed to fetch"));
    reportPollingFailure("income", new TypeError("Failed to fetch"));
    expect(seen.at(-1)).toBe(2);
    stop();
  });

  it("clears itself when the last failing screen recovers", () => {
    let latest = 0;
    const stop = subscribePollingStatus((s) => {
      latest = s.failingCount;
    });
    reportPollingFailure("cut", new TypeError("x"));
    reportPollingFailure("income", new TypeError("x"));
    clearPollingFailure("cut");
    expect(latest).toBe(1);
    clearPollingFailure("income");
    expect(latest).toBe(0);
    stop();
  });

  it("does not notify for a screen that never failed", () => {
    const fn = vi.fn();
    const stop = subscribePollingStatus(fn);
    fn.mockClear();
    clearPollingFailure("never-failed");
    expect(fn).not.toHaveBeenCalled();
    stop();
  });
});

describe("resolveDelay", () => {
  const base = { active: false, activeMs: 3_000, idleMs: 30_000 };

  it("polls fast only while work is in flight", () => {
    expect(resolveDelay({ ...base, active: true, failures: 0 })).toBe(3_000);
    expect(resolveDelay({ ...base, failures: 0 })).toBe(30_000);
  });

  it("backs off as failures pile up", () => {
    expect(resolveDelay({ ...base, active: true, failures: 1 })).toBe(3_000);
    expect(resolveDelay({ ...base, active: true, failures: 2 })).toBe(6_000);
    expect(resolveDelay({ ...base, active: true, failures: 3 })).toBe(12_000);
  });

  it("never waits longer than the cap, so recovery stays quick", () => {
    expect(resolveDelay({ ...base, active: true, failures: 20 })).toBe(
      MAX_BACKOFF_MS,
    );
  });

  it("never gives up — silence is the one failure mode we refuse", () => {
    for (const failures of [0, 1, 5, 50]) {
      expect(resolveDelay({ ...base, failures })).toBeGreaterThan(0);
    }
  });
});

describe("outage episodes", () => {
  beforeEach(() => __resetPollingStatus());

  it("counts a new episode only when going from healthy to failing", () => {
    let s = { episode: 0 } as { episode: number };
    const stop = subscribePollingStatus((next) => {
      s = next;
    });
    const start = s.episode;
    reportPollingFailure("a", new TypeError("x"));
    reportPollingFailure("b", new TypeError("x")); // 같은 장애, 회차 그대로
    expect(s.episode).toBe(start + 1);

    clearPollingFailure("a");
    clearPollingFailure("b"); // 전부 회복
    reportPollingFailure("a", new TypeError("x")); // 새 장애
    expect(s.episode).toBe(start + 2);
    stop();
  });
});
