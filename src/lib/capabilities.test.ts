import { describe, expect, it } from "vitest";
import { aiState, claudeLoggedIn, codexLoggedIn } from "./capabilities";

describe("AI 로그인 확인", () => {
  it("claude auth status 의 loggedIn 을 읽는다 (깨진 출력은 로그인 안 됨)", () => {
    expect(claudeLoggedIn('{"loggedIn": true, "authMethod": "claude.ai"}')).toBe(true);
    expect(claudeLoggedIn('{"loggedIn": false}')).toBe(false);
    expect(claudeLoggedIn("Error: not found")).toBe(false);
  });

  it("codex login status 는 'Logged in' 이 있어야 로그인이다", () => {
    expect(codexLoggedIn("Logged in using ChatGPT")).toBe(true);
    expect(codexLoggedIn("Not logged in")).toBe(false);
  });

  it("설치만 되고 로그인 안 된 경우를 '없음'과 따로 알린다", () => {
    expect(aiState({ claude: { installed: true, loggedIn: false }, codex: { installed: false, loggedIn: false } })).toBe("logged-out");
    expect(aiState({ claude: { installed: false, loggedIn: false }, codex: { installed: false, loggedIn: false } })).toBe("missing");
    expect(aiState({ claude: { installed: true, loggedIn: false }, codex: { installed: true, loggedIn: true } })).toBe("ready");
  });
});
