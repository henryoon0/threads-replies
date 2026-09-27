// X 수집 스크립트 공용 부품 — 로그인 프로필·프로필 락·오프스크린 headed 런치.
// ingest-x.mjs(단건 딥수집)와 ingest-x-timeline.mjs(타임라인 훑기)가 같은 프로필을
// 공유하므로, 락과 런치는 반드시 이 모듈을 거쳐야 SingletonLock 충돌(#76)이 없다.

import { promises as fs, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";

export const REPO_ROOT = path.dirname(
  path.dirname(path.dirname(fileURLToPath(import.meta.url)))
);
export const PROFILE_DIR =
  process.env.X_BROWSER_PROFILE ||
  path.join(REPO_ROOT, "data", "browser-profile", "x");

// ── 프로필 락 ────────────────────────────────────────────────────────────────
// persistent context 는 프로필에 SingletonLock 을 잡아서, 잡 2개가 겹치면 두 번째
// 크로미움이 launch 실패로 통째로 죽는다 (실측 버그, #76). launch 전에 mkdir 기반
// 락으로 직렬화한다 — 두 번째 잡은 실패 대신 앞 잡이 끝날 때까지 대기.
// SIGKILL(부모 타임아웃)로 죽으면 exit 핸들러가 못 돌지만, pid 생존 검사가
// 다음 잡에서 죽은 락을 회수한다.

const PROFILE_LOCK_DIR = `${PROFILE_DIR}.lock`;
const LOCK_WAIT_MS = 5 * 60 * 1000; // 부모 잡 타임아웃(6분)보다 짧게
const LOCK_STALE_MS = 10 * 60 * 1000;
let holdingLock = false;

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function releaseProfileLock() {
  if (!holdingLock) return;
  holdingLock = false;
  try {
    rmSync(PROFILE_LOCK_DIR, { recursive: true, force: true });
  } catch {
    /* 이미 없으면 그만 */
  }
}

/**
 * 락 획득. 대기 상한을 넘기면 code === "LOCK_TIMEOUT" 인 Error 를 던진다 —
 * 호출 스크립트가 자기 fail 컨벤션(stdout JSON + exit code)으로 번역한다.
 */
export async function acquireProfileLock(log = console.error) {
  const deadline = Date.now() + LOCK_WAIT_MS;
  let announced = false;
  for (;;) {
    try {
      await fs.mkdir(PROFILE_LOCK_DIR);
      await fs.writeFile(path.join(PROFILE_LOCK_DIR, "pid"), String(process.pid), "utf8");
      holdingLock = true;
      process.on("exit", releaseProfileLock);
      return;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
    // 죽은 주인의 락은 회수한다.
    let stale = false;
    try {
      const st = await fs.stat(PROFILE_LOCK_DIR);
      if (Date.now() - st.mtimeMs > LOCK_STALE_MS) stale = true;
      else {
        const pid = parseInt(
          await fs.readFile(path.join(PROFILE_LOCK_DIR, "pid"), "utf8").catch(() => ""),
          10
        );
        if (Number.isFinite(pid) && pid > 0 && !pidAlive(pid)) stale = true;
      }
    } catch {
      stale = true; // stat 도 못 하는 락은 깨진 것
    }
    if (stale) {
      log("죽은 X 수집 락을 회수합니다.");
      await fs.rm(PROFILE_LOCK_DIR, { recursive: true, force: true }).catch(() => {});
      continue;
    }
    if (Date.now() > deadline) {
      throw Object.assign(
        new Error(
          "다른 X 수집이 오래 걸려 대기 시간(5분)을 넘겼습니다. 앞 수집이 끝난 뒤 다시 시도해 주세요."
        ),
        { code: "LOCK_TIMEOUT" }
      );
    }
    if (!announced) {
      log("다른 X 수집이 진행 중 — 끝날 때까지 대기합니다.");
      announced = true;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
}

// ── 고아 크롬 정리 ───────────────────────────────────────────────────────────
// 앞 잡이 SIGKILL 로 죽으면 크롬 프로세스가 프로필을 쥔 채 고아로 남고, 다음
// launch 의 크롬이 그 인스턴스와 랑데부하려다 영원히 대기 → Playwright 쪽
// launchPersistentContext 180초 타임아웃으로 터진다 (2026-08-06 실측). mkdir 락을
// 이미 쥔 시점이므로 이 프로필을 쓰는 크롬은 전부 고아 — 죽여도 안전하다.

function reapOrphanChrome(log = console.error) {
  const marker = `--user-data-dir=${PROFILE_DIR}`;
  let killed = 0;
  try {
    const out = execFileSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" });
    for (const line of out.split("\n")) {
      const m = line.match(/^\s*(\d+)\s+(.*)$/);
      if (!m) continue;
      const cmd = m[2];
      // 경로 접두 오탐 방지 (…/x 가 …/x2 에 매치되는 것): marker 뒤는 공백/끝만 허용.
      const idx = cmd.indexOf(marker);
      if (idx === -1) continue;
      const after = cmd[idx + marker.length];
      if (after !== undefined && after !== " ") continue;
      const pid = parseInt(m[1], 10);
      if (pid === process.pid) continue;
      try {
        process.kill(pid, "SIGKILL");
        killed++;
      } catch {
        /* 이미 죽었으면 그만 */
      }
    }
  } catch {
    /* ps 실패 시엔 그냥 진행 — launch 재시도가 마지막 안전망 */
  }
  if (killed > 0) log(`프로필을 쥔 고아 크롬 ${killed}개를 정리했습니다.`);
  // 비정상 종료가 남긴 싱글턴 잔재도 청소 (크롬이 "다른 인스턴스가 있다"고 오판하는 재료).
  for (const name of ["SingletonLock", "SingletonSocket", "SingletonCookie", "RunningChromeVersion"]) {
    try {
      rmSync(path.join(PROFILE_DIR, name), { recursive: true, force: true });
    } catch {
      /* 없으면 그만 */
    }
  }
  return killed;
}

/**
 * 오프스크린 headed 런치 (락 획득 포함).
 * X는 "보이는 탭"에서만 이미지·답글을 로드해 headless 금지 — 대신 창을 화면 밖
 * 좌표로 밀어 숨긴다. Playwright 창은 자기 창의 활성 탭이라 visible 로 취급된다.
 */
export async function launchXContext(headlessNever, log = console.error) {
  await acquireProfileLock(log);
  reapOrphanChrome(log);
  const winPos = process.env.X_INGEST_WINDOW_POS || "20000,20000";
  const opts = {
    headless: false,
    viewport: { width: 1100, height: 900 },
    args: headlessNever ? [] : [`--window-position=${winPos}`],
    timeout: 60_000, // 정상 기동은 ~1초. 60초를 넘기면 프로필이 잠긴 것 — 기본 180초를 기다릴 이유가 없다.
  };
  try {
    return await chromium.launchPersistentContext(PROFILE_DIR, opts);
  } catch (e) {
    if (!/Timeout/i.test(String(e?.message))) throw e;
    log("브라우저 기동 60초 초과 — 고아 크롬을 다시 정리하고 1회 재시도합니다.");
    reapOrphanChrome(log);
    return chromium.launchPersistentContext(PROFILE_DIR, opts);
  }
}

// 로그인 판정: X는 로그인 상태면 auth_token 쿠키를 갖는다 (실검증 대체 신호:
// 로그인 벽 리다이렉트). 쿠키가 제일 안정적이라 이것만 본다.
export async function isLoggedIn(context) {
  const cookies = await context.cookies("https://x.com");
  return cookies.some((c) => c.name === "auth_token" && c.value);
}
