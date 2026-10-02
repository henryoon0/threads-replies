// 페르소나 팩 읽기. 경로 계산은 여기에만 둔다 (AGENTS.md 저장 규칙).
//
// 팩 = ~/.local/share/reply-personas/<id>/ (REPLY_PERSONAS_DIR 로 바꿈)
//   persona.json · AGENTS.md(말투 규칙책, backpass 가 고치는 유일한 파일) · CLAUDE.md("@AGENTS.md")
//   SAFETY.md · gate-rules.json · categories.json · private/(원장·학습 기록·토큰, git 제외)
// 팩이 없어도 DEFAULT_PERSONAS 로 돈다 — 대시보드가 팩 준비 여부에 멈추지 않게.

import { readFile, readdir, stat } from "fs/promises";
import path from "path";
import {
  DEFAULT_PERSONAS,
  DEFAULT_PERSONA_ID,
  normalizePersonaId,
  parsePersonaConfig,
  type PersonaConfig,
  type PersonaId,
  type PersonaSummary,
} from "./model";
import { ownerLine, readProfile } from "@/lib/profile";
import { tokenPath } from "@/lib/threads-archive/storage";

export function personasDir(): string {
  // 이 앱은 받는 사람 맥에서 돈다 — 팩도 앱 data/ 안에 둔다 (다른 앱의 팩 폴더를 읽지 않게).
  return process.env.REPLY_PERSONAS_DIR ?? path.join(process.cwd(), "personas");
}

export function packDir(id: PersonaId): string {
  const safe = normalizePersonaId(id);
  if (!safe) throw new Error(`잘못된 페르소나 id: ${id}`);
  return path.join(personasDir(), safe);
}

/** git 에서 빠지는 팩 안쪽 폴더. 원장·학습 기록·토큰. */
export function packPrivateDir(id: PersonaId): string {
  return path.join(packDir(id), "private");
}

/** 말투 규칙책 = 팩의 AGENTS.md */
export function packRulebookPath(id: PersonaId): string {
  return path.join(packDir(id), "AGENTS.md");
}

export function packFile(id: PersonaId, name: string): string {
  return path.join(packDir(id), name);
}

/** 원장·잡 파일 폴더. persona.dataDir 가 있으면 저장소 기준 경로, 없으면 팩 private/. */
export function personaDataDir(p: PersonaConfig): string {
  if (p.dataDir) return path.resolve(process.cwd(), p.dataDir);
  return packPrivateDir(p.id);
}

/** 저장소 기준 상대 경로 → 절대 경로 */
export function repoPath(rel: string): string {
  return path.resolve(process.cwd(), rel);
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

// persona.json 은 요청마다 읽히므로 mtime 이 같으면 캐시를 쓴다. hot reload 에도 살아남게 globalThis.
type CacheEntry = { mtimeMs: number; config: PersonaConfig };
function cache(): Map<string, CacheEntry> {
  const g = globalThis as typeof globalThis & { __replyPersonaCache?: Map<string, CacheEntry> };
  g.__replyPersonaCache ??= new Map();
  return g.__replyPersonaCache;
}

/** 기본 페르소나(연결한 내 계정)는 연결할 때 저장한 아이디·소개로 이름을 채운다. */
async function withProfile(config: PersonaConfig): Promise<PersonaConfig> {
  if (config.id !== DEFAULT_PERSONA_ID) return config;
  // 팩에 이름·핸들이 있으면 그대로 쓴다. 비어 있을 때만 연결한 계정으로 채운다.
  if (config.handle) return config;
  const profile = await readProfile();
  if (!profile.username) return config;
  return { ...config, name: profile.username, handle: profile.username, intro: ownerLine(profile) };
}

export async function readPersona(id: PersonaId): Promise<PersonaConfig> {
  return withProfile(await readPersonaPack(id));
}

async function readPersonaPack(id: PersonaId): Promise<PersonaConfig> {
  const safe = normalizePersonaId(id) ?? DEFAULT_PERSONA_ID;
  const file = path.join(packDir(safe), "persona.json");
  try {
    const s = await stat(file);
    const hit = cache().get(safe);
    if (hit && hit.mtimeMs === s.mtimeMs) return hit.config;
    const config = parsePersonaConfig(JSON.parse(await readFile(file, "utf8")), safe);
    cache().set(safe, { mtimeMs: s.mtimeMs, config });
    return config;
  } catch {
    return parsePersonaConfig(DEFAULT_PERSONAS[safe] ?? null, safe);
  }
}

/** 팩이 있는 페르소나 id. AICC 는 팩이 없어도 늘 있다. */
export async function listPersonaIds(): Promise<PersonaId[]> {
  const ids = new Set<PersonaId>([DEFAULT_PERSONA_ID]);
  try {
    for (const name of await readdir(personasDir())) {
      const id = normalizePersonaId(name);
      if (id && (await exists(path.join(personasDir(), name, "persona.json")))) ids.add(id);
    }
  } catch {
    // 팩 폴더가 아직 없음
  }
  return [...ids];
}

/** 팩 private/token.json 경로 (AICC 는 기존 threads-archive 토큰을 쓰므로 여기를 안 본다). */
export function personaTokenPath(id: PersonaId): string {
  return path.join(packPrivateDir(id), "token.json");
}

export async function hasPersonaToken(p: PersonaConfig): Promise<boolean> {
  if (p.id === DEFAULT_PERSONA_ID) {
    return Boolean(process.env.THREADS_ACCESS_TOKEN?.trim()) || (await exists(tokenPath()));
  }
  return exists(personaTokenPath(p.id));
}

/**
 * 실제로 쓸 보내기 방식. 설정이 copy 여도 팩에 토큰을 연결했으면 바로 보낸다.
 * copy 는 "토큰이 없을 때 복사해서 달기"라는 대비책이다 (2026-10-02 henry "토큰을 연결한 상태에서는 바로 보내져야 해").
 */
export async function resolveSendMode(p: PersonaConfig): Promise<"api" | "copy"> {
  if (p.send === "api") return "api";
  return (await hasPersonaToken(p)) ? "api" : "copy";
}

export async function listPersonas(): Promise<PersonaSummary[]> {
  const out: PersonaSummary[] = [];
  for (const id of await listPersonaIds()) {
    const p = await readPersona(id);
    out.push({ id: p.id, name: p.name, handle: p.handle, register: p.register, gate: p.gate, send: await resolveSendMode(p), hasToken: await hasPersonaToken(p) });
  }
  return out;
}
