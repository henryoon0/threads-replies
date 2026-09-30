import { describe, expect, it } from "vitest";
import { deploymentPrefixOf } from "./ephemeral-media";

describe("임시 미디어 배포 찾기", () => {
  it("배포 고유 주소에서 배포 id 앞 8글자를 뽑는다", () => {
    expect(deploymentPrefixOf("https://bcb62610.aicoffeechat-share.pages.dev")).toBe("bcb62610");
    expect(deploymentPrefixOf(undefined)).toBeUndefined();
  });
});
