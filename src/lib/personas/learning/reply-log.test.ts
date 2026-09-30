import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ReplyAnswer } from "@/lib/threads-replies/model";
import {
  appendReplyLog,
  buildReplyLogEntry,
  editRatio,
  latestReplyLog,
  levenshtein,
  readReplyLog,
  replyLogPath,
  sentAction,
  updateReplyLog,
} from "./reply-log";

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "reply-log-"));
  process.env.REPLY_PERSONAS_DIR = dir;
});

afterEach(async () => {
  delete process.env.REPLY_PERSONAS_DIR;
  await rm(dir, { recursive: true, force: true });
});

function answer(extra: Partial<ReplyAnswer> = {}): ReplyAnswer {
  return {
    verdict: "answerable",
    verdictReason: "",
    sources: [],
    sentences: [],
    draft: "주인이 고친 글",
    model: "opus",
    generatedAt: "2026-09-29T00:00:00.000Z",
    styleExamples: 0,
    aiDraft: "네, 저도 그렇게 생각해요.",
    sessionId: "11111111-2222-3333-4444-555555555555",
    ...extra,
  };
}

const reply = (a?: ReplyAnswer) => ({ id: "c1", postId: "p1", text: "effort 뭐 쓰세요?", answer: a });

describe("편집 거리·수정 비율", () => {
  it("글자 단위로 센다 (한글·이모지 한 글자)", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("안녕하세요", "안녕해요")).toBe(2);
    expect(levenshtein("😀", "")).toBe(1);
    expect(levenshtein("", "abc")).toBe(3);
  });

  it("수정 비율 = 편집 거리 / 초안 길이, 앞뒤 공백은 무시", () => {
    expect(editRatio("안녕하세요", " 안녕해요 ")).toBe(0.4);
    expect(editRatio("같아요", "같아요")).toBe(0);
    expect(editRatio("", "새 글")).toBe(3); // 초안이 비면 분모 1
  });

  it("초안 그대로면 sent, 고쳤거나 AI 초안이 없으면 sent_edited", () => {
    expect(sentAction("답이에요", " 답이에요 ")).toBe("sent");
    expect(sentAction("답이에요", "답이요")).toBe("sent_edited");
    expect(sentAction(null, "답")).toBe("sent_edited");
  });
});

describe("기록 한 줄 만들기", () => {
  it("정해진 칸을 정해진 순서로 채운다", () => {
    const e = buildReplyLogEntry({ reply: reply(answer()), persona: "aicc", action: "sent_edited", final: "그쵸 ㅎㅎ", gate: "pass", at: "2026-09-29T01:00:00.000Z" });
    expect(Object.keys(e)).toEqual([
      "v", "at", "replyId", "postId", "persona", "sessionId", "action", "comment", "aiDraft", "final",
      "categoryId", "editRatio", "gate", "learn", "reason", "outcome",
    ]);
    expect(e).toMatchObject({ v: 1, replyId: "c1", postId: "p1", comment: "effort 뭐 쓰세요?", learn: true, outcome: "pending", reason: null, categoryId: null });
    expect(e.editRatio).toBeGreaterThan(0);
  });

  it("고른 벌의 카테고리를 적고, aiDraft 가 없던 예전 답은 고른 벌 원문으로 비교한다", () => {
    const options = [
      { categoryId: "short", categoryName: "짧게", draft: "첫 벌", sentences: [] },
      { categoryId: "explain", categoryName: "설명", draft: "둘째 벌", sentences: [] },
    ];
    const chosen = buildReplyLogEntry({ reply: reply(answer({ options, chosen: 1, aiDraft: "둘째 벌" })), persona: "aicc", action: "sent", final: "둘째 벌", gate: "pass" });
    expect(chosen).toMatchObject({ aiDraft: "둘째 벌", categoryId: "explain", editRatio: 0 });
    const legacy = buildReplyLogEntry({ reply: reply(answer({ options, chosen: 0, aiDraft: undefined })), persona: "aicc", action: "sent", final: "첫 벌!", gate: "pass" });
    expect(legacy).toMatchObject({ aiDraft: "첫 벌", categoryId: "short" });
  });

  it("관문에 막힌 답·세션 없는 답은 학습 턴을 기다리지 않는다", () => {
    const blocked = buildReplyLogEntry({ reply: reply(answer()), persona: "glp1", action: "copied", final: "마운자로 추천", gate: "block" });
    expect(blocked).toMatchObject({ learn: false, outcome: "skipped" });
    const gateStop = buildReplyLogEntry({ reply: reply(answer()), persona: "glp1", action: "gate_blocked", final: "x", gate: "block" });
    expect(gateStop).toMatchObject({ learn: false, outcome: "skipped" });
    const manual = buildReplyLogEntry({ reply: reply(undefined), persona: "aicc", action: "copied", final: "직접 쓴 답", gate: "pass" });
    expect(manual).toMatchObject({ sessionId: null, aiDraft: null, editRatio: null, learn: true, outcome: "skipped" });
  });
});

describe("기록 파일", () => {
  const entry = (replyId: string, at: string) =>
    buildReplyLogEntry({ reply: { ...reply(answer()), id: replyId }, persona: "aicc", action: "sent", final: "답", gate: "pass", at });

  it("팩 private/reply-log.jsonl 에 한 줄씩 쓰고 그대로 읽는다", async () => {
    await appendReplyLog(entry("c1", "2026-09-29T01:00:00.000Z"));
    await appendReplyLog(entry("c2", "2026-09-29T02:00:00.000Z"));
    expect(replyLogPath("aicc")).toBe(path.join(dir, "aicc", "private", "reply-log.jsonl"));
    const raw = await readFile(replyLogPath("aicc"), "utf8");
    expect(raw.trim().split("\n")).toHaveLength(2);
    expect((await readReplyLog("aicc")).map((e) => e.replyId)).toEqual(["c1", "c2"]);
  });

  it("고치기는 그 댓글의 마지막 줄만 고치고 깨진 줄·다른 줄은 둔다", async () => {
    await appendReplyLog(entry("c1", "2026-09-29T01:00:00.000Z"));
    await writeFile(replyLogPath("aicc"), `${await readFile(replyLogPath("aicc"), "utf8")}{깨진 줄\n`);
    await appendReplyLog(entry("c1", "2026-09-29T03:00:00.000Z"));
    const next = await updateReplyLog("c1", { learn: false, reason: "특수 상황" }, "aicc");
    expect(next).toMatchObject({ at: "2026-09-29T03:00:00.000Z", learn: false, reason: "특수 상황" });
    const all = await readReplyLog("aicc");
    expect(all.map((e) => e.learn)).toEqual([true, false]);
    expect(await readFile(replyLogPath("aicc"), "utf8")).toContain("{깨진 줄");
    expect(await latestReplyLog("c1", "aicc")).toMatchObject({ learn: false });
    expect(await updateReplyLog("nope", { learn: false }, "aicc")).toBeNull();
  });

  it("동시에 덧붙이고 고쳐도 줄을 잃지 않는다", async () => {
    await Promise.all([
      ...Array.from({ length: 10 }, (_, i) => appendReplyLog(entry(`c${i}`, `2026-09-29T0${i}:00:00.000Z`))),
      updateReplyLog("c0", { outcome: "done" }, "aicc"),
    ]);
    expect(await readReplyLog("aicc")).toHaveLength(10);
  });
});
