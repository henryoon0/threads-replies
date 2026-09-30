import { mkdtemp, rm } from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runClaudeCLI } from "@/lib/ai/claude-cli";
import { buildReplyLogEntry, readReplyLog, appendReplyLog, type ReplyLogEntry } from "./reply-log";
import {
  EXCLUDE_TURN_TEXT,
  buildOutcomeText,
  diffReply,
  endingOf,
  isDue,
  setReplyLearning,
  sweepPersonaOutcomes,
} from "./outcome";

// 실제 Claude 는 부르지 않는다
vi.mock("@/lib/ai/claude-cli", () => ({ runClaudeCLI: vi.fn(async () => "없던 규칙: 짧게 답한다") }));
const cli = vi.mocked(runClaudeCLI);

let dir = "";
const SESSION = "11111111-2222-3333-4444-555555555555";

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "reply-outcome-"));
  process.env.REPLY_PERSONAS_DIR = dir;
  cli.mockClear();
  cli.mockImplementation(async () => "없던 규칙: 짧게 답한다");
});

afterEach(async () => {
  delete process.env.REPLY_PERSONAS_DIR;
  await rm(dir, { recursive: true, force: true });
});

const DRAFT = "네, 저도 그렇게 생각해요. 사실 effort 는 상황마다 다른데 저는 보통 low 를 씁니다.";
const FINAL = "그쵸 !! 저도 그래서 low 써요 ㅎㅎ";

function entry(extra: Partial<ReplyLogEntry> = {}): ReplyLogEntry {
  const base = buildReplyLogEntry({
    reply: {
      id: "c1",
      postId: "p1",
      text: "effort 뭐 쓰세요?",
      answer: {
        verdict: "answerable",
        verdictReason: "",
        sources: [],
        sentences: [],
        draft: FINAL,
        model: "opus",
        generatedAt: "",
        styleExamples: 0,
        aiDraft: DRAFT,
        sessionId: SESSION,
      },
    },
    persona: "aicc",
    action: "sent_edited",
    final: FINAL,
    gate: "pass",
    at: "2026-09-29T00:00:00.000Z",
  });
  return { ...base, ...extra };
}

const LATER = Date.parse("2026-09-29T00:11:00.000Z");
const SOON = Date.parse("2026-09-29T00:05:00.000Z");

describe("결과 기록 턴 문안", () => {
  it("초안 그대로면 한 줄만", () => {
    expect(buildOutcomeText({ aiDraft: "답이에요", final: " 답이에요", reason: null })).toBe("[보낸 결과] 초안 그대로 보냄");
  });

  it("고쳤으면 보낸 답 · 달라진 점(코드 계산) · 이유 · 한 줄 요청", () => {
    const text = buildOutcomeText({ aiDraft: DRAFT, final: FINAL, reason: "너무 길어요" });
    const lines = text.split("\n");
    expect(lines[0]).toBe(`[보낸 결과] 주인이 이 댓글에 실제로 보낸 답: «${FINAL}»`);
    expect(lines[1]).toMatch(/^초안과 달라진 점\(코드 계산\): 길이 53→22자 · 뺀 문장 "네, 저도 그렇게 생각해요\."/);
    expect(lines[1]).toContain('더한 문장 "그쵸 !!", "저도 그래서 low 써요 ㅎㅎ"');
    expect(lines[1]).toContain('끝맺음 "." → "ㅎㅎ"');
    expect(lines[2]).toBe("주인이 남긴 이유: 너무 길어요");
    expect(lines[3]).toBe('한 줄로만 답해: "어긴 규칙: <규칙책 문장 인용>" 또는 "없던 규칙: <한 문장>"');
  });

  it("끝맺음·이모지 변화를 잡는다", () => {
    expect(endingOf("그쵸 !! 저도 ㅎㅎ")).toBe("ㅎㅎ");
    expect(endingOf("있어요")).toBe("요");
    expect(endingOf("좋아요 🙂")).toBe("🙂");
    expect(diffReply("좋아요.", "좋아요 🙂🙂").emojiDelta).toBe(2);
    expect(buildOutcomeText({ aiDraft: "좋아요.", final: "좋아요 🙂", reason: null })).toContain("이모지 +1");
  });
});

describe("언제 턴을 쓰나", () => {
  it("pending 은 유예(기본 10분)가 지나야, 빼기로 건 제외 턴은 바로", () => {
    expect(isDue("aicc", entry(), SOON)).toBe(false);
    expect(isDue("aicc", entry(), LATER)).toBe(true);
    expect(isDue("aicc", entry({ learn: false, outcome: "pending" }), SOON)).toBe(true);
    expect(isDue("aicc", entry({ outcome: "done" }), LATER)).toBe(false);
    expect(isDue("aicc", entry({ sessionId: null }), LATER)).toBe(false);
  });

  it("유예는 env 로 바꾸고, 이상한 값이면 기본값", () => {
    process.env.REPLY_OUTCOME_DELAY_MS = "60000";
    expect(isDue("aicc", entry(), Date.parse("2026-09-29T00:01:00.000Z"))).toBe(true);
    process.env.REPLY_OUTCOME_DELAY_MS = "-5";
    expect(isDue("aicc", entry(), Date.parse("2026-09-29T00:01:00.000Z"))).toBe(false);
    delete process.env.REPLY_OUTCOME_DELAY_MS;
  });
});

describe("스윕 (고아 재개)", () => {
  it("유예가 지난 줄만 그 세션에 이어 쓰고 done 으로 적는다", async () => {
    await appendReplyLog(entry());
    await appendReplyLog(entry({ replyId: "c2", at: "2026-09-29T00:08:00.000Z" }));
    expect(await sweepPersonaOutcomes("aicc", LATER)).toBe(1);
    expect(cli).toHaveBeenCalledTimes(1);
    const [prompt, opts] = cli.mock.calls[0];
    expect(prompt).toContain("[보낸 결과] 주인이 이 댓글에 실제로 보낸 답");
    expect(opts).toMatchObject({
      workspace: { dir: path.join(dir, "aicc"), sessionId: SESSION, resume: true },
      model: "sonnet",
      effort: "low",
      timeoutMs: 120_000,
      requireClaude: true,
    });
    expect((await readReplyLog("aicc")).map((e) => e.outcome)).toEqual(["done", "pending"]);
  });

  it("실패하면 failed 로 남기고, 같은 프로세스에서는 바로 다시 시도하지 않는다", async () => {
    cli.mockRejectedValueOnce(new Error("Claude CLI 시간 초과(120초)"));
    await appendReplyLog(entry({ replyId: "c-fail" }));
    expect(await sweepPersonaOutcomes("aicc", LATER)).toBe(0);
    expect((await readReplyLog("aicc"))[0].outcome).toBe("failed");
    expect(await sweepPersonaOutcomes("aicc", LATER)).toBe(0);
    expect(cli).toHaveBeenCalledTimes(1);
  });
});

describe("학습에서 빼기", () => {
  it("턴이 돌기 전에 빼면 취소하고 Claude 를 부르지 않는다", async () => {
    await appendReplyLog(entry());
    const r = await setReplyLearning("c1", false, "특수 상황", "aicc");
    expect(r).toMatchObject({ ok: true, excludeTurn: "none", entry: { learn: false, outcome: "skipped", reason: "특수 상황" } });
    expect(await sweepPersonaOutcomes("aicc", LATER)).toBe(0);
    expect(cli).not.toHaveBeenCalled();
  });

  it("턴이 이미 돌았으면 같은 세션에 제외 턴을 이어 쓴다", async () => {
    await appendReplyLog(entry({ outcome: "done" }));
    const r = await setReplyLearning("c1", false, undefined, "aicc");
    expect(r).toMatchObject({ ok: true, excludeTurn: "queued", entry: { learn: false, outcome: "pending" } });
    await vi.waitFor(async () => expect((await readReplyLog("aicc"))[0].outcome).toBe("done"));
    expect(cli).toHaveBeenCalledTimes(1);
    expect(cli.mock.calls[0][0]).toBe(EXCLUDE_TURN_TEXT);
  });

  it("관문에 걸린 답은 다시 넣을 수 없고, 기록이 없으면 404", async () => {
    await appendReplyLog(entry({ gate: "block", learn: false, outcome: "skipped" }));
    expect(await setReplyLearning("c1", true, undefined, "aicc")).toMatchObject({ ok: false, status: 409 });
    expect(await setReplyLearning("nope", false, undefined, "aicc")).toMatchObject({ ok: false, status: 404 });
  });

  it("취소했던 답을 다시 넣으면 다시 기다린다", async () => {
    await appendReplyLog(entry({ learn: false, outcome: "skipped" }));
    expect(await setReplyLearning("c1", true, undefined, "aicc")).toMatchObject({ ok: true, entry: { learn: true, outcome: "pending" } });
  });
});
