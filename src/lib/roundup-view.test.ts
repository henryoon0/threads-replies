import { describe, expect, it } from "vitest";
import {
  appendThumbs,
  markCaseProgress,
  MAX_THUMBS,
  sanitizeRoundupMeta,
  type RoundupThumb,
} from "@/lib/roundup-view";

const thumb = (n: number, state: RoundupThumb["state"] = "fresh"): RoundupThumb => ({
  url: `https://x.com/u${n}/status/${n}`,
  author: `u${n}`,
  text: "t",
  videos: 0,
  images: 0,
  likes: 0,
  state,
});

describe("appendThumbs", () => {
  it("keeps arrival order, updates state of known urls, caps at MAX_THUMBS", () => {
    const first = appendThumbs([], [thumb(1), thumb(2)]);
    const next = appendThumbs(first, [{ ...thumb(1), state: "used" }, thumb(3)]);
    expect(next.map((t) => [t.author, t.state])).toEqual([
      ["u1", "used"],
      ["u2", "fresh"],
      ["u3", "fresh"],
    ]);
    const many = appendThumbs([], Array.from({ length: 40 }, (_, i) => thumb(i)));
    expect(many).toHaveLength(MAX_THUMBS);
  });
});

describe("markCaseProgress", () => {
  const a = { url: "https://x.com/a/status/1", author: "a", what: "게임" };
  const b = { url: "https://x.com/b/status/2", author: "b", what: "앱" };
  const r = { url: "https://x.com/r/status/9", author: "r", what: "예비" };

  it("moves a row through states", () => {
    let p = markCaseProgress([], { pick: a, state: "wait" });
    p = markCaseProgress(p, { pick: b, state: "wait" });
    p = markCaseProgress(p, { pick: a, state: "doing" });
    p = markCaseProgress(p, { pick: a, state: "done" });
    expect(p.map((x) => x.state)).toEqual(["done", "wait"]);
  });

  it("inserts the refill right after the failed row", () => {
    let p = markCaseProgress([], { pick: a, state: "wait" });
    p = markCaseProgress(p, { pick: b, state: "wait" });
    p = markCaseProgress(p, { pick: a, state: "refilled", note: "삭제된 게시물", replacement: r });
    expect(p.map((x) => [x.author, x.state])).toEqual([
      ["a", "refilled"],
      ["r", "wait"],
      ["b", "wait"],
    ]);
    expect(p[0]).toMatchObject({ replacedBy: r.url, note: "삭제된 게시물" });
  });
});

describe("sanitizeRoundupMeta", () => {
  it("keeps http cases and strips @", () => {
    expect(
      sanitizeRoundupMeta({ cases: [{ url: "https://x.com/a/status/1", author: "@a", what: " 게임 " }, { url: "nope" }] })
    ).toEqual({ cases: [{ url: "https://x.com/a/status/1", author: "a", what: "게임" }] });
    expect(sanitizeRoundupMeta({ cases: [] })).toBeUndefined();
    expect(sanitizeRoundupMeta(null)).toBeUndefined();
  });
});
