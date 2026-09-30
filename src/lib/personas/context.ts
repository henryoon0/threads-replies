// "지금 페르소나" — 요청 하나가 끝날 때까지(그 안에서 시작한 백그라운드 잡 포함) 따라다니는 값.
//
// 왜 인자 대신 AsyncLocalStorage 인가: 원장 경로·토큰·규칙책을 쓰는 함수가 30곳이 넘는다.
// 전부 인자로 넘기면 시그니처가 한꺼번에 바뀌어 기존 테스트·호출처가 흔들린다. 경로 helper 몇 개만
// currentPersona() 를 보게 하면, 라우트 첫 줄의 withPersonaRequest 하나로 계정이 갈린다.
// 값이 새지 않게 run() 범위 밖에서는 늘 기본 페르소나(AICC)다.

import { AsyncLocalStorage } from "node:async_hooks";
import { DEFAULT_PERSONAS, DEFAULT_PERSONA_ID, normalizePersonaId, type PersonaConfig, type PersonaId } from "./model";
import { readPersona } from "./registry";

export const PERSONA_COOKIE = "reply-persona";

function storage(): AsyncLocalStorage<PersonaConfig> {
  const g = globalThis as typeof globalThis & { __replyPersonaStore?: AsyncLocalStorage<PersonaConfig> };
  g.__replyPersonaStore ??= new AsyncLocalStorage<PersonaConfig>();
  return g.__replyPersonaStore;
}

/** 지금 페르소나. withPersona 밖이면 AICC. */
export function currentPersona(): PersonaConfig {
  return storage().getStore() ?? DEFAULT_PERSONAS[DEFAULT_PERSONA_ID];
}

export async function withPersona<T>(id: PersonaId, fn: () => Promise<T>): Promise<T> {
  const config = await readPersona(id);
  return storage().run(config, fn);
}

/** 이미 읽은 설정으로 바로 감싼다 (잡 재개처럼 설정을 들고 있을 때). */
export function runWithPersonaConfig<T>(config: PersonaConfig, fn: () => Promise<T>): Promise<T> {
  return storage().run(config, fn);
}

function cookieValue(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

/** ?persona= 가 먼저, 없으면 쿠키, 둘 다 없으면 AICC. */
export function personaIdFromRequest(request: Request): PersonaId {
  const fromQuery = normalizePersonaId(new URL(request.url).searchParams.get("persona"));
  if (fromQuery) return fromQuery;
  return normalizePersonaId(cookieValue(request.headers.get("cookie"), PERSONA_COOKIE)) ?? DEFAULT_PERSONA_ID;
}

/** 라우트 첫 줄: `return withPersonaRequest(request, async () => { ... })` */
export function withPersonaRequest<T>(request: Request, fn: () => Promise<T>): Promise<T> {
  return withPersona(personaIdFromRequest(request), fn);
}
