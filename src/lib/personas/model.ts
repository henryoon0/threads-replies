// 답글 페르소나 — 계정마다 다른 것(말투·지식·안전 규칙·학습 기록)을 한 묶음으로 부르는 이름.
// 설계: docs/reply-persona-design.md 2장. 시안 픽: data/prototypes/persona-replies-picks.json (2026-09-29).
//
// 엔진은 하나다. 엔진은 "지금 페르소나"(context.ts)만 보고 경로·말투·관문을 고른다.
// 팩 폴더는 대시보드 저장소 밖에 둔다 — backpass 가 작업 폴더가 저장소 안이면
// 그 저장소 대화로 묶어서, 초안 대화가 대시보드 AGENTS.md 학습에 섞이기 때문이다.
// Pure — I/O 없음.

export type PersonaId = string;

/** 지식을 어디서 찾을지. 여러 개면 순서대로 합친다. */
export type KnowledgeKind = "dashboard-retrieve" | "supplement-brain" | "supabase";

export interface PersonaConfig {
  id: PersonaId;
  /** 화면에 보이는 이름 */
  name: string;
  /** 스레드 @핸들 (앞 @ 없이) */
  handle: string;
  /** 프롬프트에서 부르는 주인 이름 ("henry", "박약사") */
  ownerName: string;
  /** 프롬프트 첫 줄에 들어갈 한 줄 소개 */
  intro: string;
  register: "해요체" | "반말";
  /** light = 확인만, strict = 막음 표현이 있으면 보내기 전에 고쳐야 함 */
  gate: "light" | "strict";
  knowledge: KnowledgeKind[];
  /** api = Threads API 로 보냄, copy = 복사하고 스레드에서 열기 (토큰이 없거나 직접 보내기를 끈 팩) */
  send: "api" | "copy";
  /** 기능 켜기 — AICC 전용 기능을 박약사에서 끄는 스위치 */
  features: { toBoard: boolean; evidenceShots: boolean };
  /**
   * 원장·잡 파일을 둘 폴더. 비우면 팩의 private/.
   * AICC 는 기존 data/threads-replies 를 그대로 써서 이전 없이 동작을 유지한다.
   */
  dataDir?: string;
  /** 토큰이 없을 때 받은함을 채울 aside 수집 파일 (저장소 기준 상대 경로) */
  collectedComments?: string;
  /** 예시·말투 재료 파일 (저장소 기준 상대 경로). 팩 private/voice-pairs.json 이 있으면 그쪽이 먼저다. */
  voicePairs?: string;
}

/**
 * 연결한 내 스레드 계정 하나가 기본 페르소나다. 아이디·소개는 연결할 때 profile.json 에서 채운다 (registry.ts).
 * 다른 계정을 더하려면 data/personas/<id>/persona.json 팩을 만든다.
 */
export const DEFAULT_PERSONAS: Readonly<Record<string, PersonaConfig>> = {
  glp1: {
    id: "glp1",
    name: "박약사",
    handle: "glp1.pharmacy",
    ownerName: "박약사",
    intro: "스레드 @glp1.pharmacy, 약사식 판단으로 영양제·GLP-1 질문에 답하는 계정",
    register: "반말",
    gate: "strict",
    knowledge: ["supplement-brain"],
    send: "api",
    features: { toBoard: false, evidenceShots: false },
    collectedComments: "personas/glp1/collected/glp1-pharmacy-DdvdAKek5at.json",
    voicePairs: "personas/glp1/collected/glp1-pharmacy-qa-pairs.json",
  },
};

export const DEFAULT_PERSONA_ID: PersonaId = "glp1";

/** 쿠키·주소에서 온 값을 안전한 id 로 좁힌다 (경로 조립에 쓰이므로 문자 집합을 제한). */
export function normalizePersonaId(raw: string | null | undefined): PersonaId | null {
  const v = (raw ?? "").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,31}$/.test(v) ? v : null;
}

type Raw = Record<string, unknown>;

function pickStr(o: Raw, k: string): string | undefined;
function pickStr(o: Raw, k: string, fallback: string): string;
function pickStr(o: Raw, k: string, fallback?: string): string | undefined {
  const v = o[k];
  return typeof v === "string" && v.trim() ? v.trim() : fallback;
}

function pickKnowledge(o: Raw, fallback: KnowledgeKind[]): KnowledgeKind[] {
  if (!Array.isArray(o.knowledge)) return fallback;
  return o.knowledge.filter((k): k is KnowledgeKind => KNOWLEDGE_KINDS.includes(k as KnowledgeKind));
}

function pickFeatures(o: Raw, base: PersonaConfig["features"]): PersonaConfig["features"] {
  const f = (typeof o.features === "object" && o.features !== null ? o.features : {}) as Raw;
  return { toBoard: pickBool(f, "toBoard", base.toBoard), evidenceShots: pickBool(f, "evidenceShots", base.evidenceShots) };
}

function pickOne<T extends string>(o: Raw, k: string, allowed: readonly T[], fallback: T): T {
  const v = o[k];
  return allowed.includes(v as T) ? (v as T) : fallback;
}

function pickBool(o: Raw, k: string, fallback: boolean): boolean {
  return typeof o[k] === "boolean" ? (o[k] as boolean) : fallback;
}

const KNOWLEDGE_KINDS: readonly KnowledgeKind[] = ["dashboard-retrieve", "supplement-brain", "supabase"];

function baseFor(id: PersonaId): PersonaConfig {
  return DEFAULT_PERSONAS[id] ?? { ...DEFAULT_PERSONAS[DEFAULT_PERSONA_ID], id, name: id, handle: id, ownerName: id };
}

/** persona.json(임의 JSON)을 계약 모양으로 좁힌다. 빠진 칸은 기본값(같은 id)이나 AICC 기본값으로 채운다. */
export function parsePersonaConfig(raw: unknown, id: PersonaId): PersonaConfig {
  const base = baseFor(id);
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return base;
  const o = raw as Raw;
  return {
    ...base,
    id,
    name: pickStr(o, "name", base.name),
    handle: pickStr(o, "handle", base.handle).replace(/^@/, ""),
    ownerName: pickStr(o, "ownerName", base.ownerName),
    intro: pickStr(o, "intro", base.intro),
    register: pickOne(o, "register", ["해요체", "반말"] as const, base.register),
    gate: pickOne(o, "gate", ["light", "strict"] as const, base.gate),
    knowledge: pickKnowledge(o, base.knowledge),
    send: pickOne(o, "send", ["api", "copy"] as const, base.send),
    features: pickFeatures(o, base.features),
    dataDir: pickStr(o, "dataDir") ?? base.dataDir,
    collectedComments: pickStr(o, "collectedComments") ?? base.collectedComments,
    voicePairs: pickStr(o, "voicePairs") ?? base.voicePairs,
  };
}

/** 화면에 내보내도 되는 요약 (경로·토큰 없음). */
export interface PersonaSummary {
  id: PersonaId;
  name: string;
  handle: string;
  register: PersonaConfig["register"];
  gate: PersonaConfig["gate"];
  send: PersonaConfig["send"];
  hasToken: boolean;
}
