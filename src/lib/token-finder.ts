// 연결 안 된 채로 켜졌을 때, 이 컴퓨터에 남아 있는 스레드 토큰을 찾아 자동으로 연결한다.
// 예전 설치의 백업, ZIP 으로 받아 직접 돌린 사본, .env.local, 환경변수 순으로 본다.
// 기본 계정(박약사) 핸들과 같은 계정의 토큰만 붙인다. 다른 계정 토큰으로 잘못 붙지 않게.
import { readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { connectAccount } from "@/lib/account";
import { fetchMe } from "@/lib/threads-archive/graph";
import { readPersona } from "@/lib/personas/registry";
import { DEFAULT_PERSONA_ID } from "@/lib/personas/model";

export type FindResult = { state: "connected"; username: string; from: string } | { state: "none"; tried: number };

async function readText(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
}

async function subdirs(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory() && d.name !== "node_modules").map((d) => path.join(dir, d.name));
  } catch {
    return [];
  }
}

/** 토큰이 있을 만한 앱 폴더들: 설치 폴더와 그 백업, 바탕화면·다운로드·문서 아래 threads-replies 사본(두 단계까지). */
async function appDirs(home: string): Promise<string[]> {
  const root = path.join(home, ".threads-replies");
  const out = [path.join(root, "app"), ...(await subdirs(root)).filter((d) => /data-backup/.test(d))];
  for (const base of ["Desktop", "Downloads", "Documents"].map((b) => path.join(home, b))) {
    const lvl1 = await subdirs(base);
    const lvl2 = (await Promise.all(lvl1.map(subdirs))).flat();
    out.push(...[...lvl1, ...lvl2].filter((d) => /threads-replies/i.test(path.basename(d))));
  }
  return out;
}

function fromEnvFile(text: string): string | null {
  return text.match(/^THREADS_ACCESS_TOKEN\s*=\s*["']?([^"'\s]+)/m)?.[1] ?? null;
}

/** 후보 토큰과 출처. 같은 토큰은 한 번만. */
export async function candidateTokens(home = os.homedir(), env: Record<string, string | undefined> = process.env): Promise<{ token: string; from: string }[]> {
  const seen = new Set<string>();
  const out: { token: string; from: string }[] = [];
  const add = (token: string | null | undefined, from: string) => {
    if (token && token.length >= 50 && !seen.has(token)) {
      seen.add(token);
      out.push({ token, from });
    }
  };
  for (const dir of await appDirs(home)) {
    for (const tokenFile of [path.join(dir, "data", "threads-archive", "token.json"), path.join(dir, "threads-archive", "token.json")]) {
      const raw = await readText(tokenFile);
      if (raw) {
        try {
          add((JSON.parse(raw) as { accessToken?: string }).accessToken, tokenFile);
        } catch {
          // 깨진 파일은 건너뛴다
        }
      }
    }
    const envText = await readText(path.join(dir, ".env.local"));
    if (envText) add(fromEnvFile(envText), path.join(dir, ".env.local"));
  }
  add(env.THREADS_ACCESS_TOKEN, "환경변수 THREADS_ACCESS_TOKEN");
  return out;
}

/** 찾은 토큰 중 기본 계정 핸들과 맞는 첫 토큰으로 연결한다. 한 번 켜질 때 한 번만 돈다. */
export async function findAndConnect(): Promise<FindResult> {
  const handle = (await readPersona(DEFAULT_PERSONA_ID)).handle.replace(/^@/, "").toLowerCase();
  const candidates = await candidateTokens();
  for (const c of candidates) {
    try {
      const me = await fetchMe(c.token);
      if (handle && me.username.toLowerCase() !== handle) continue;
      const done = await connectAccount(c.token);
      return { state: "connected", username: done.username, from: c.from };
    } catch {
      // 만료·권한 없음 → 다음 후보
    }
  }
  return { state: "none", tried: candidates.length };
}

let once: Promise<FindResult> | null = null;
export function findOnce(): Promise<FindResult> {
  const g = globalThis as typeof globalThis & { __tokenFind?: Promise<FindResult> };
  g.__tokenFind ??= once ??= findAndConnect();
  return g.__tokenFind;
}
