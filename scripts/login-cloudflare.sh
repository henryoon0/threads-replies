#!/usr/bin/env bash
# (선택) 근거 캡처를 답글에 붙이려면 이미지를 잠깐 공개할 곳이 필요하다 — 내 Cloudflare 무료 계정을 쓴다.
# 브라우저가 열리면 Cloudflare 에 로그인(없으면 무료 가입)하고 [Allow]를 누르면 끝.
# 올린 이미지는 답글 발행이 끝나면 바로 지우므로 쌓이지 않는다.
set -euo pipefail

main() {
  local HERE
  HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  local NODE_BIN="$HOME/.threads-replies/node/bin"
  [ -d "$NODE_BIN" ] && export PATH="$NODE_BIN:$PATH"
  "$HERE/node_modules/.bin/wrangler" login
  echo "Cloudflare 로그인 완료. 앱 화면을 새로고침하면 답글 칸에 '이미지 붙이기'가 보여요."
}

main "$@"
