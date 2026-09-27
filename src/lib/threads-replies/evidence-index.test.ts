import { describe, expect, it } from "vitest";
import {
  buildIndexRows,
  cleanAliases,
  docContentHash,
  docsMissingAliases,
  emptyAliasCache,
  formatIndexSheet,
  pruneAliasCache,
  type EvidenceDoc,
} from "./evidence-index";

const doc = (id: string, text = "본문", extra: Partial<EvidenceDoc> = {}): EvidenceDoc => ({
  id,
  kind: "수집노트",
  title: `제목 ${id}`,
  text,
  origin: id,
  date: "2026-09-01",
  ...extra,
});

describe("docContentHash", () => {
  it("is stable for the same content and changes when content changes", () => {
    expect(docContentHash(doc("a"))).toBe(docContentHash(doc("b", "본문", { title: "제목 a" })));
    expect(docContentHash(doc("a"))).not.toBe(docContentHash(doc("a", "다른 본문")));
  });
});

describe("cleanAliases", () => {
  it("dedupes case-insensitively, drops the title, trims length and pipes", () => {
    const got = cleanAliases(["클코", "클코", "Claude Code", "claude code", "제목 a", "a|b", "x".repeat(50), 3], "제목 a");
    expect(got).toEqual(["클코", "Claude Code", "a/b", "x".repeat(32)]);
  });

  it("returns an empty list for non-arrays", () => {
    expect(cleanAliases("클코")).toEqual([]);
  });
});

describe("index rows", () => {
  it("uses cached aliases by content hash and falls back to doc aliases", () => {
    const cache = emptyAliasCache();
    const a = doc("a");
    cache.entries[docContentHash(a)] = { aliases: ["별칭1"], at: "" };
    const b = doc("b", "본문 b", { aliases: ["즉석 별칭"] });
    const rows = buildIndexRows([a, b, doc("c", "본문 c")], cache);
    expect(rows.map((r) => r.key)).toEqual(["r1", "r2", "r3"]);
    expect(rows[0].aliases).toEqual(["별칭1"]);
    expect(rows[1].aliases).toEqual(["즉석 별칭"]);
    expect(rows[2].aliases).toEqual([]);
    const sheet = formatIndexSheet(rows);
    expect(sheet.split("\n")[0]).toBe("r1 [노트] 26.09 제목 a | 별칭1");
    expect(sheet.split("\n")[2]).toBe("r3 [노트] 26.09 제목 c");
  });

  it("lists only docs without cached aliases, once per hash, and prunes dead entries", () => {
    const cache = emptyAliasCache();
    const a = doc("a");
    cache.entries[docContentHash(a)] = { aliases: ["x"], at: "" };
    cache.entries["dead"] = { aliases: ["y"], at: "" };
    const b1 = doc("b");
    const b2 = doc("b2", "본문", { title: "제목 b" });
    expect(docsMissingAliases([a, b1, b2], cache).map((d) => d.id)).toEqual(["b"]);
    expect(Object.keys(pruneAliasCache(cache, [a]).entries)).toEqual([docContentHash(a)]);
  });
});
