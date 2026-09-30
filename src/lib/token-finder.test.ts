import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { candidateTokens } from "./token-finder";

const T = (c: string) => `TH${c.repeat(60)}`;

describe("candidateTokens", () => {
  it("finds tokens in old installs, source copies, .env.local and env, once each", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "tf-"));
    const put = async (rel: string, body: string) => {
      await mkdir(path.dirname(path.join(home, rel)), { recursive: true });
      await writeFile(path.join(home, rel), body);
    };
    await put(".threads-replies/data-backup-1/threads-archive/token.json", JSON.stringify({ accessToken: T("a") }));
    await put("Downloads/threads-replies-main/data/threads-archive/token.json", JSON.stringify({ accessToken: T("b") }));
    await put("Desktop/apps/threads-replies/.env.local", `X=1\nTHREADS_ACCESS_TOKEN="${T("c")}"\n`);
    await put("Documents/other/data/threads-archive/token.json", JSON.stringify({ accessToken: T("z") }));
    const got = await candidateTokens(home, { THREADS_ACCESS_TOKEN: T("a") });
    expect(got.map((g) => g.token).sort()).toEqual([T("a"), T("b"), T("c")].sort());
  });

  it("returns nothing on a clean machine", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "tf-"));
    expect(await candidateTokens(home, {})).toEqual([]);
  });
});
