import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { addIdeas, listIdeas, updateIdea, findIdea } from "@/lib/content-ideas";
import type { ContentIdea } from "@/lib/content-ideas-model";

let tempDir = "";

function idea(id: string): ContentIdea {
  return {
    id,
    platform: "threads",
    type: "info",
    posts: [`post ${id}`],
    original: [`post ${id}`],
    intent: "test",
    sourceQuote: "test",
    sourceNote: "test",
    date: "2026-07-27",
    createdAt: "2026-07-27T00:00:00.000Z",
  };
}

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "content-ideas-"));
  process.env.CONTENT_IDEAS_PATH = path.join(tempDir, "content-ideas.json");
});

afterEach(async () => {
  delete process.env.CONTENT_IDEAS_PATH;
  await rm(tempDir, { recursive: true, force: true });
});

describe("content ideas storage", () => {
  it("preserves every idea when independent generators finish together", async () => {
    await Promise.all([
      addIdeas([idea("variant-1")]),
      addIdeas([idea("variant-2")]),
      addIdeas([idea("variant-3")]),
    ]);

    const stored = await listIdeas();
    expect(stored.map((item) => item.id).sort()).toEqual([
      "variant-1",
      "variant-2",
      "variant-3",
    ]);
  });

  it("updateIdea 직후 listIdeas 가 갱신을 본다 (쓰기-읽기 일관성)", async () => {
    await addIdeas([idea("a")]);
    await updateIdea("a", { intent: "고침" });
    expect((await listIdeas())[0].intent).toBe("고침");
  });

  it("아직 레코드로 이관되지 않은 외부 파일 변경도 반영된다", async () => {
    const f = process.env.CONTENT_IDEAS_PATH ?? "";
    await writeFile(f, JSON.stringify([idea("a")]), "utf-8");
    expect((await listIdeas())[0].intent).toBe("test");
    await writeFile(f, JSON.stringify([{ ...idea("a"), intent: "외부 수정" }]), "utf-8");
    await utimes(f, new Date(), new Date(Date.now() + 5));
    expect((await listIdeas())[0].intent).toBe("외부 수정");
  });

  it("listIdeas 가 돌려준 객체를 mutate 해도 다음 읽기가 오염되지 않는다", async () => {
    await addIdeas([idea("a")]);
    const [first] = await listIdeas();
    first.intent = "오염 시도";
    expect((await listIdeas())[0].intent).toBe("test");
  });
});


describe("findIdea", () => {
  it("reads the current record without parsing an unrelated broken legacy projection", async () => {
    await addIdeas([idea("current")]);
    await updateIdea("current", { intent: "최신 수정" });
    await writeFile(process.env.CONTENT_IDEAS_PATH!, "broken projection");
    expect((await findIdea("current"))?.intent).toBe("최신 수정");
  });
  it("falls back to a legacy-only card and returns null for a missing id", async () => {
    await writeFile(process.env.CONTENT_IDEAS_PATH!, JSON.stringify([idea("legacy")]));
    expect((await findIdea("legacy"))?.id).toBe("legacy");
    expect(await findIdea("missing")).toBeNull();
  });
});
