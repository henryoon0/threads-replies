import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  appendLearnedRule,
  deletionSpan,
  isLockedUnit,
  LEARNED_SECTION,
  parseRuleUnits,
  removeUnitLines,
  ruleHeatmap,
  unitSnapshot,
} from "./rules";

// backpass 설치본(v0.1.3)의 parseMemoryUnits — 없으면 대조 테스트만 건너뛴다.
function backpassSrc(): string | null {
  try {
    const root = execFileSync("npm", ["root", "-g"], { encoding: "utf8", timeout: 10_000 }).trim();
    const src = path.join(root, "backpass", "src");
    return existsSync(path.join(src, "memory.js")) ? src : null;
  } catch {
    return null;
  }
}

const BP = backpassSrc();
const AICC_RULEBOOK = path.join(process.env.REPLY_PERSONAS_DIR ?? path.join(os.homedir(), ".local/share/reply-personas"), "aicc", "AGENTS.md");

const SAMPLE = `# 규칙책

머리말 문단
두 줄짜리.

## 공통

- 첫 규칙
- 둘째 규칙
   - "예시 하나"
   - "예시 둘"
- 셋째 규칙

\`\`\`
코드 안의 - 목록은 쪼개지 않는다

- 여기도
\`\`\`

## 잠긴 규칙

- 처방약 용량은 답하지 않는다.

### 더 깊이

- 하위 절도 잠김
`;

describe("parseRuleUnits", () => {
  it("목록 한 줄·문단 하나가 규칙 하나, 제목 경로가 절 이름", () => {
    const units = parseRuleUnits(SAMPLE);
    expect(units.map((u) => u.id).slice(0, 3)).toEqual(["AG-001", "AG-002", "AG-003"]);
    expect(units[0]).toMatchObject({ text: "머리말 문단\n두 줄짜리.", section: "규칙책", startLine: 3, endLine: 4 });
    expect(units[1]).toMatchObject({ text: "- 첫 규칙", section: "규칙책 > 공통", startLine: 8, endLine: 8 });
    // 들여 쓴 예시도 따로 센다 (backpass 와 같음)
    expect(units.map((u) => u.text)).toContain('   - "예시 하나"');
    // 코드 울타리는 한 덩어리
    expect(units.some((u) => u.text.startsWith("```") && u.text.includes("- 여기도"))).toBe(true);
  });

  it("잠긴 규칙 절과 그 하위 절은 잠김", () => {
    const units = parseRuleUnits(SAMPLE);
    const locked = units.filter(isLockedUnit).map((u) => u.text);
    expect(locked).toEqual(["- 처방약 용량은 답하지 않는다.", "- 하위 절도 잠김"]);
  });

  it.skipIf(!BP || !existsSync(AICC_RULEBOOK))("실제 AICC 규칙책에서 backpass 와 id·해시·줄·절이 같다", async () => {
    const mod = (await import(pathToFileURL(path.join(BP as string, "memory.js")).href)) as {
      parseMemoryUnits: (t: string) => { id: string; hash: string; tokens: number; text: string; section: string; startLine: number; endLine: number }[];
    };
    const text = readFileSync(AICC_RULEBOOK, "utf8");
    const theirs = mod.parseMemoryUnits(text);
    const ours = parseRuleUnits(text);
    expect(ours.length).toBeGreaterThan(50);
    expect(ours).toEqual(theirs.map((u) => ({ id: u.id, hash: u.hash, tokens: u.tokens, text: u.text, section: u.section, startLine: u.startLine, endLine: u.endLine })));
  });

  it.skipIf(!BP)("예시 규칙책에서도 backpass 와 같다", async () => {
    const mod = (await import(pathToFileURL(path.join(BP as string, "memory.js")).href)) as { parseMemoryUnits: (t: string) => unknown[] };
    const ours = parseRuleUnits(SAMPLE).map((u) => ({ ...u }));
    expect(ours).toEqual(mod.parseMemoryUnits(SAMPLE));
  });
});

describe("지우기 범위", () => {
  it("목록 규칙을 지우면 딸린 들여 쓴 예시도 같이 지운다", () => {
    const units = parseRuleUnits(SAMPLE);
    const index = units.findIndex((u) => u.text === "- 둘째 규칙");
    const span = deletionSpan(units, index);
    expect(span.ids).toHaveLength(3);
    const next = removeUnitLines(SAMPLE, span);
    expect(next).not.toContain("둘째 규칙");
    expect(next).not.toContain("예시 하나");
    expect(next).toContain("- 첫 규칙\n- 셋째 규칙");
  });

  it("문단을 지우면 빈 줄이 두 번 겹치지 않는다", () => {
    const units = parseRuleUnits(SAMPLE);
    const next = removeUnitLines(SAMPLE, deletionSpan(units, 0));
    expect(next).not.toContain("머리말");
    expect(next).not.toMatch(/\n\n\n/);
    expect(next.startsWith("# 규칙책\n\n## 공통")).toBe(true);
  });
});

describe("규칙 더하기", () => {
  it("절이 없으면 끝에 만들고, 있으면 그 절 끝에 한 줄 붙인다", () => {
    const once = appendLearnedRule("# 책\n\n- 하나\n", "감사 답엔 💌 하나로 닫는다.");
    expect(once).toBe(`# 책\n\n- 하나\n\n${LEARNED_SECTION}\n\n- 감사 답엔 💌 하나로 닫는다.\n`);
    const twice = appendLearnedRule(`${once}\n## 뒤 절\n\n- x\n`, "둘째 규칙");
    expect(twice).toContain("- 감사 답엔 💌 하나로 닫는다.\n- 둘째 규칙\n\n## 뒤 절");
  });
});

describe("ruleHeatmap", () => {
  const evidence = [{ instruction: "AG-002", positive: 3, negative: 1, sessions: 4, relevance: 0.5 }];

  it("성적표를 같은 id 에 붙인다", () => {
    const rows = ruleHeatmap(SAMPLE, evidence);
    expect(rows.find((r) => r.id === "AG-002")).toMatchObject({ text: "- 첫 규칙", positive: 3, negative: 1, sessions: 4, line: 8 });
    expect(rows.find((r) => r.text.includes("처방약"))?.locked).toBe(true);
  });

  it("분석 뒤 규칙이 지워져 번호가 밀려도 해시로 같은 규칙을 찾는다", () => {
    const snapshot = unitSnapshot(SAMPLE);
    const units = parseRuleUnits(SAMPLE);
    const shifted = removeUnitLines(SAMPLE, deletionSpan(units, 0)); // 머리말 삭제 → "첫 규칙"이 AG-001 로
    const rows = ruleHeatmap(shifted, evidence, snapshot);
    expect(rows.find((r) => r.text === "- 첫 규칙")).toMatchObject({ id: "AG-001", positive: 3 });
    expect(rows.find((r) => r.id === "AG-002")?.positive).toBe(0);
  });
});
