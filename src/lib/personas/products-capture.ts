// 제품 페이지 캡처 — scripts/personas/shoot-product.mjs 를 detached 로 띄우고 시간이 넘으면 그룹째 죽인다.
// 결과(성공이면 파일 이름, 실패면 이유·걸린 시간)를 구조화해 돌려준다. 목록 저장은 호출하는 쪽(라우트)이 한다.
//
// 실측 2026-09-29: 아이허브 됨(10~12초) · 쿠팡 안 됨(HTTP 403 Access Denied, 봇 차단) · 약학정보원 됨(3초).
import { spawn } from "node:child_process";
import path from "node:path";
import { killProcessTree } from "@/lib/cli-bin";
import { envMs } from "@/lib/threads-replies/storage";
import type { PersonaId } from "./model";
import { checkPublicUrl } from "./products-url-guard";
import { productShotsDir, type Product, type ProductCapture } from "./products";

const SCRIPT = "scripts/personas/shoot-product.mjs";
const DEFAULT_TIMEOUT_MS = 90_000;

export type CaptureOutcome =
  | { ok: true; capture: ProductCapture; ms: number }
  | { ok: false; reason: string; error: string; ms: number };

interface ScriptResult {
  ok: boolean;
  reason?: string;
  error?: string;
  ms?: number;
}

export function parseCaptureOutput(stdout: string): ScriptResult | null {
  for (const line of stdout.trim().split("\n").reverse()) {
    if (!line.trim().startsWith("{")) continue;
    try {
      const r = JSON.parse(line) as ScriptResult;
      if (typeof r.ok === "boolean") return r;
    } catch {
      // 다음 줄
    }
  }
  return null;
}

function run(args: string[], timeoutMs: number): Promise<{ stdout: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(process.cwd(), SCRIPT), ...args], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "ignore"],
      detached: true,
    });
    let stdout = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child);
    }, timeoutMs);
    child.stdout.on("data", (d) => (stdout += d.toString()));
    const done = () => {
      clearTimeout(timer);
      resolve({ stdout, timedOut });
    };
    child.on("error", done);
    child.on("close", done);
  });
}

export async function captureProduct(persona: PersonaId, product: Product): Promise<CaptureOutcome> {
  const started = Date.now();
  if (!product.url) return { ok: false, reason: "no-url", error: "url 이 비어 있어요", ms: 0 };
  const unsafe = await checkPublicUrl(product.url);
  if (unsafe) return { ok: false, reason: "blocked", error: unsafe, ms: Date.now() - started };
  const image = `${product.id.replace(/[^A-Za-z0-9_-]/g, "")}-${Date.now()}.png`;
  const timeoutMs = envMs("PRODUCT_CAPTURE_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);
  const { stdout, timedOut } = await run([product.url, "--out", path.join(productShotsDir(persona), image)], timeoutMs);
  const ms = Date.now() - started;
  if (timedOut) return { ok: false, reason: "timeout", error: `시간 초과 (${Math.round(timeoutMs / 1000)}초)`, ms };
  const r = parseCaptureOutput(stdout);
  if (!r?.ok) return { ok: false, reason: r?.reason ?? "other", error: r?.error ?? "출력 없음", ms };
  return { ok: true, capture: { image, capturedAt: new Date().toISOString() }, ms };
}
