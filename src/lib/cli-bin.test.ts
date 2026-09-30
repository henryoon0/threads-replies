import { describe, expect, it } from "vitest";
import { augmentedPath, resolveCliBin } from "./cli-bin";

describe("resolveCliBin", () => {
  it("passes through a name that already contains a path separator", () => {
    expect(resolveCliBin("/usr/local/bin/claude")).toBe("/usr/local/bin/claude");
    expect(resolveCliBin("./local/claude")).toBe("./local/claude");
  });

  it("returns the bare name when the binary is nowhere to be found", () => {
    expect(resolveCliBin("definitely-not-a-real-binary-xyz")).toBe(
      "definitely-not-a-real-binary-xyz"
    );
  });

  it("resolves a real binary (node) to an executable absolute path", () => {
    const resolved = resolveCliBin("node");
    // node is running this test, so it must be discoverable.
    expect(resolved.endsWith("/node")).toBe(true);
    expect(resolved.startsWith("/")).toBe(true);
  });
});

describe("augmentedPath", () => {
  it("includes the known user install dirs so a child CLI keeps a sane PATH", () => {
    const p = augmentedPath();
    expect(p).toContain("/.local/bin");
    expect(p).toContain("/opt/homebrew/bin");
  });
});
