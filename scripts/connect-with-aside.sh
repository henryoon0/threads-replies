#!/usr/bin/env bash
# 스레드 연결을 Aside 브라우저 에이전트에게 맡긴다. 순서서: docs/connect-playbook.md
# 로그인이 필요할 때만 멈추고 사람에게 부탁한다. 토큰은 브라우저 안에서 앱 화면으로 바로 붙여넣는다.
set -euo pipefail

main() {
  local HERE PLAYBOOK
  HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  PLAYBOOK="$HERE/docs/connect-playbook.md"
  if ! command -v aside >/dev/null 2>&1; then
    echo "Aside 브라우저의 aside 명령을 찾지 못했어요."
    echo "Aside 가 없으면 http://localhost:3457 화면의 '직접 할 때' 5단계를 따라 해 주세요 (15분쯤)."
    exit 1
  fi
  if ! curl -fsS -o /dev/null http://localhost:3457/api/account 2>/dev/null; then
    echo "스레드 답글 앱이 켜져 있지 않아요. 설치를 먼저 끝내 주세요 (bash install.sh)."
    exit 1
  fi
  echo "AI 에게 스레드 연결을 맡겨요. 로그인이 필요할 때만 멈추고 알려 줍니다."
  aside "$(cat "$PLAYBOOK")"
}

main "$@"
