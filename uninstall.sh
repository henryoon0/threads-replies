#!/usr/bin/env bash
# 스레드 답글 제거 — install.sh 가 만든 것만 지운다.
# 기록(댓글·초안·말투·내 자료·토큰)도 함께 지워진다. 남기려면 먼저 ~/.threads-replies/data 를 다른 곳에 복사해 두세요.
set -euo pipefail

main() {
  local ROOT="$HOME/.threads-replies"
  local PLIST="$HOME/Library/LaunchAgents/com.threads-replies.plist"
  local LAUNCHER="$HOME/Applications/스레드 답글.app"

  if [ "$(uname -s)" = "Darwin" ]; then
    launchctl bootout "gui/$(id -u)/com.threads-replies" >/dev/null 2>&1 || true
  fi
  rm -f "$PLIST"
  rm -rf "$LAUNCHER" "$ROOT"
  # 설치가 새로 만든 폴더가 비어 있으면 같이 지운다 (원래 있던 폴더는 안에 뭔가 있으니 남는다)
  rmdir "$HOME/Applications" "$HOME/Library/LaunchAgents" 2>/dev/null || true
  echo "스레드 답글를 제거했어요. 메타 앱은 developers.facebook.com/apps 에서 직접 지울 수 있어요."
}

main "$@"
