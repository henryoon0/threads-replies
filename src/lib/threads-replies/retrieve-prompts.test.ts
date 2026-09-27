import { describe, expect, it } from "vitest";
import type { EvidenceDoc, IndexRow } from "./evidence-index";
import { keepPastedLinks, leadingPassage, parsePicks, rankSources, verifyPassages, type RankCandidate } from "./retrieve-prompts";

const doc = (id: string, text: string, url?: string, kind: EvidenceDoc["kind"] = "수집노트"): EvidenceDoc => ({
  id,
  kind,
  title: id,
  text,
  url,
  origin: id,
});

describe("parsePicks", () => {
  const rows: IndexRow[] = [
    { key: "r1", docId: "note:a", kind: "수집노트", date: "", title: "a", aliases: [] },
    { key: "r2", docId: "faq:b", kind: "FAQ", date: "", title: "b", aliases: [] },
  ];
  it("maps row keys back to doc ids, drops unknown and duplicate rows", () => {
    const got = parsePicks({ picks: [{ row: "r2", why: "w" }, { row: "r9" }, { row: "r2" }, { row: "r1" }] }, rows);
    expect(got.map((p) => p.docId)).toEqual(["faq:b", "note:a"]);
  });
  it("treats a missing list as none", () => {
    expect(parsePicks({}, rows)).toEqual([]);
  });
});

describe("verifyPassages", () => {
  it("keeps verbatim quotes and drops paraphrases", () => {
    const items = [
      { doc: doc("a", "Fable 5.1 is now live in Claude Code."), excerpt: "" },
      { doc: doc("b", "캐시 읽기 가격을 내렸다."), excerpt: "" },
    ];
    const got = verifyPassages(
      {
        passages: [
          { doc: "d1", quote: "Fable 5.1 is now  live in Claude Code.", support: "direct" },
          { doc: "d2", quote: "캐시 가격을 낮췄다.", support: "partial" },
          { doc: "d7", quote: "없는 문서" },
        ],
      },
      items
    );
    expect(got.passages).toHaveLength(1);
    expect(got.passages[0].quote).toBe("Fable 5.1 is now live in Claude Code.");
    expect(got.dropped).toBe(1);
  });
});

describe("rankSources", () => {
  const c = (d: EvidenceDoc, quote: string, stage: RankCandidate["stage"], support: RankCandidate["support"], order = 0): RankCandidate => ({
    doc: d,
    quote,
    stage,
    support,
    order,
  });

  it("ranks direct over partial, then link > anchor > index, and assigns s1..", () => {
    const got = rankSources([
      c(doc("i", "x"), "색인 인용", "index", "direct"),
      c(doc("a", "x", undefined, "원글 원본"), "원본 인용", "anchor", "direct"),
      c(doc("p", "x"), "부분 인용", "link", "partial"),
    ]);
    expect(got.map((s) => [s.id, s.quote])).toEqual([
      ["s1", "원본 인용"],
      ["s2", "색인 인용"],
      ["s3", "부분 인용"],
    ]);
  });

  it("dedupes by doc, by url (x.com == twitter.com) and by contained quotes, and caps at max", () => {
    const got = rankSources(
      [
        c(doc("a", "x", "https://x.com/u/status/1"), "긴 인용 문장입니다", "anchor", "direct"),
        c(doc("a", "x", "https://x.com/u/status/1"), "같은 문서 다른 인용", "anchor", "direct", 1),
        c(doc("n", "x", "https://twitter.com/u/status/1/"), "노트 인용", "index", "direct"),
        c(doc("m", "x"), "인용 문장", "index", "direct", 1),
        ...Array.from({ length: 8 }, (_, i) => c(doc(`z${i}`, "x"), `다른 인용 ${i}`, "index", "partial", i)),
      ],
      3
    );
    expect(got.map((s) => s.quote)).toEqual(["긴 인용 문장입니다", "다른 인용 0", "다른 인용 1"]);
  });
});

describe("keepPastedLinks", () => {
  it("keeps a pasted link with no extracted passage, quoting its opening verbatim", () => {
    const link = doc("link:1", "Claude Code 는 API 키 없이 구독으로도 돌아갑니다. 설정 방법은 아래와 같습니다. " + "가".repeat(300), "https://example.com/a", "붙인 링크");
    const out = keepPastedLinks([], [link]);
    expect(out).toHaveLength(1);
    expect(out[0].stage).toBe("link");
    expect(link.text.includes(out[0].quote)).toBe(true);
  });
  it("does not duplicate a link that already produced a passage", () => {
    const link = doc("link:1", "본문", "https://example.com/a", "붙인 링크");
    const existing: RankCandidate = { doc: link, quote: "본문", support: "direct", stage: "link", order: 0 };
    expect(keepPastedLinks([existing], [link])).toHaveLength(1);
  });
});

describe("leadingPassage", () => {
  it("returns short text whole and cuts long text at a sentence end", () => {
    expect(leadingPassage("짧은 글")).toBe("짧은 글");
    const long = "첫 문장은 충분히 길게 써서 육십 자를 넘기도록 만든 문장이며 끝에 마침표가 옵니다. 둘째 문장도 조금 더 길게 이어 써서 기준을 넘깁니다. " + "나".repeat(400);
    expect(leadingPassage(long).endsWith(".")).toBe(true);
  });
});
