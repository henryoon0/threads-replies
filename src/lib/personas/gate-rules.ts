// 안전 관문 규칙 읽기 — 팩의 gate-rules.json (docs/reply-persona-design.md 4-6).
// 파일이 없거나 깨졌으면 아래 기본 규칙을 쓴다. 기본 규칙 = 처음 팩에 심은 값과 같다.
// 규칙을 고치는 곳은 팩 파일이다 — 여기 기본값은 팩이 없을 때 안전 쪽으로 떨어지기 위한 바닥이다.
import { readFile, stat } from "fs/promises";
import type { GateResult } from "@/lib/threads-replies/model";
import { currentPersona } from "./context";
import { applyGateMode, checkGate, EMPTY_GATE_RULES, parseGateRules, type GateRules } from "./gate";
import type { PersonaConfig, PersonaId } from "./model";
import { packFile } from "./registry";

// ── 박약사 (strict): 링크만 막는다. 전문의약품·진단 표현은 확인만 ──
// 2026-09-29 운영자 피드백: 제품·브랜드·구매처(약국 일반약 · 온라인 건기식 · 해외 직구) 추천은 박약사 답의
// 한 유형이라 막지 않는다. 2026-09-30 henry: GLP-1 처방약 용량·증량·전환도 상황 판단으로 답한다 —
// "의사쌤한테 돌릴 자리인지" 칠하던 drug-choice 규칙을 뺐다 (칠하면 떠넘기는 답으로 고치게 만든다).
const LINK = String.raw`https?://[^\s)]+|www\.[^\s)]+|[a-z0-9-]+\.(?:com|co\.kr|kr|net|shop|store|me|ly|io)(?![a-z])(?:/[^\s)]*)?`;
const RX_OTHER = String.raw`탈모약|피나스테리드|두타스테리드|프로페시아|아보다트|미녹시딜|수면제|수면\s?유도제|졸피뎀|스틸녹스|항우울제|에스시탈로프람|렉사프로|설트랄린|졸로푸트|플루옥세틴|프로작|부프로피온|웰부트린`;
const DIAGNOSIS = String.raw`(?:내|제)\s?진단|진단(?:하자면|해\s?보면|하면|이야)|(?:병|증|질환)(?:이야|이네|이에요|입니다|인\s?것\s?같|인\s?거\s?같|인\s?듯|일\s?거야)`;

const GLP1_RULES: GateRules = {
  version: 1,
  rules: [
    { id: "link", kind: "link", action: "block", pattern: LINK, reason: "답글에 링크는 붙이지 않아요." },
    { id: "rx-other", kind: "rx", action: "check", pattern: RX_OTHER, reason: "탈모약·수면제·항우울제 같은 전문의약품이에요. 복용 판단은 처방 의사에게 돌려요." },
    { id: "diagnosis", kind: "diagnosis", action: "check", pattern: DIAGNOSIS, reason: "진단처럼 들려요. \"~일 수 있어\"까지만 말해요." },
  ],
};

// ── AICC (light): 막지 않고 확인만. 가격·날짜·기수·약속·수치는 근거가 있을 때만 쓴다 (팩 SAFETY.md) ──
const PRICE = String.raw`₩\s?\d[\d,]*|\d[\d,.]*\s?(?:(?:억|만|천)\s?(?:\d[\d,.]*\s?)?)*원(?=$|[\s.,!?~)/-]|이|에|으로|을|은|부터|짜리|대|씩|정도|까지|만|선|이상|이하)`;
const DATE = String.raw`\d{1,2}\s?월(?:\s?\d{1,2}\s?일|\s?(?:초|중순|말)|(?=에|부터|까지))|(?:이번|다음)\s?(?:주|달)\s?[월화수목금토일]요일|\d{4}\s?년|(?:1[0-2]|0?[1-9])/(?:3[01]|[12]\d|0?[1-9])(?!\d)`;
const COHORT = String.raw`\d+\s?기(?=$|[\s.,!?~)]|생|에|는|가|도|를|로|부터|까지|분|수강|모집|마감|과정|째)`;
const PROMISE = String.raw`무료|공짜|100\s?%|환불\s?보장|무조건|평생\s?(?:소장|무료|이용)|보장(?:해|합|돼|된|드)`;

const AICC_RULES: GateRules = {
  version: 1,
  rules: [
    { id: "promise", kind: "promise", action: "check", pattern: PROMISE, reason: "약속·보장처럼 들려요. 실제 조건과 맞는지 확인해요." },
    { id: "price", kind: "price", action: "check", pattern: PRICE, reason: "가격은 근거가 있을 때만 써요. 지금 가격이 맞는지 확인해요." },
    { id: "date", kind: "date", action: "check", pattern: DATE, reason: "날짜·일정은 근거가 있을 때만 써요." },
    { id: "cohort", kind: "cohort", action: "check", pattern: COHORT, reason: "기수 정보가 맞는지 확인해요." },
    { id: "percent", kind: "number", action: "check", pattern: String.raw`\d+(?:\.\d+)?\s?%`, reason: "수치는 근거가 있을 때만 써요." },
  ],
};

/** 팩에 처음 심는 규칙이자, 팩 파일이 없을 때의 바닥값. */
export const SEED_GATE_RULES: Readonly<Record<string, GateRules>> = { glp1: GLP1_RULES, me: AICC_RULES, aicc: AICC_RULES };

export function gateRulesPath(id: PersonaId): string {
  return packFile(id, "gate-rules.json");
}

function seedFor(id: PersonaId): GateRules {
  return SEED_GATE_RULES[id] ?? EMPTY_GATE_RULES;
}

// 요청마다 읽히므로 mtime 이 같으면 캐시. hot reload 에도 하나 (globalThis).
type CacheEntry = { mtimeMs: number; rules: GateRules };
function cache(): Map<string, CacheEntry> {
  const g = globalThis as typeof globalThis & { __gateRulesCache?: Map<string, CacheEntry> };
  g.__gateRulesCache ??= new Map();
  return g.__gateRulesCache;
}

/** 팩의 관문 규칙. 파일이 없거나 JSON 이 깨졌으면 기본 규칙. */
export async function readGateRules(id: PersonaId): Promise<GateRules> {
  const file = gateRulesPath(id);
  try {
    const { mtimeMs } = await stat(file);
    const hit = cache().get(file);
    if (hit && hit.mtimeMs === mtimeMs) return hit.rules;
    const rules = parseGateRules(JSON.parse(await readFile(file, "utf8"))) ?? seedFor(id);
    cache().set(file, { mtimeMs, rules });
    return rules;
  } catch {
    return seedFor(id);
  }
}

/** 보낼 답을 그 페르소나 규칙과 관문 세기(light·strict)로 검사한다. 기본은 지금 페르소나. */
export async function gateForPersona(text: string, persona: PersonaConfig = currentPersona()): Promise<GateResult> {
  return applyGateMode(checkGate(text, await readGateRules(persona.id)), persona.gate);
}
