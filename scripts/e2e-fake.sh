#!/usr/bin/env bash
# 가짜 스레드 서버로 끝까지 시험: 연결 → 댓글 가져오기 → 답글 보내기 → 모두 건너뛰기.
# 빌드된 앱(.next)이 있어야 한다. AI 없이도 도는 부분만 본다(초안·말투는 AI CLI 가 있어야 한다).
set -euo pipefail

main() {
  local PORT=3470 FAKE=4568
  DATA="$(mktemp -d)"
  trap 'kill $(jobs -p) 2>/dev/null || true; rm -rf "$DATA"' EXIT
  node scripts/fake-threads.mjs &
  THREADS_GRAPH_BASE_URL="http://127.0.0.1:$FAKE/v1.0" THREADS_REPLIES_DISABLE_SCHEDULER=1 \
    THREADS_ARCHIVE_DIR="$DATA/archive" THREADS_REPLIES_DIR="$DATA/replies" THREADS_REPLIES_DATA="$DATA" \
    MY_DOCS_DIR="$DATA/docs" SHARE_DATA_DIR="$DATA/share" \
    node node_modules/next/dist/bin/next start -p "$PORT" &
  for _ in $(seq 1 60); do curl -fsS -o /dev/null "http://localhost:$PORT/api/account" 2>/dev/null && break; sleep 1; done

  local TOKEN
  TOKEN="$(node -e 'console.log("THAAfake"+"x".repeat(120))')"
  echo "· 틀린 토큰은 거절"
  curl -s -X POST "http://localhost:$PORT/api/account" -H 'content-type: application/json' -d '{"token":"THAAwrong-token-that-is-long-enough-to-pass-the-length-check-xxxxxxx"}' | grep -q "토큰이 맞지 않거나"
  echo "· 연결"
  curl -fsS -X POST "http://localhost:$PORT/api/account" -H 'content-type: application/json' -d "{\"token\":\"$TOKEN\"}" | grep -q '"username":"tester"'
  echo "· 댓글 가져오기"
  curl -fsS -X POST "http://localhost:$PORT/api/threads-replies/sync" -H 'content-type: application/json' -d '{}' >/dev/null
  curl -fsS "http://localhost:$PORT/api/threads-replies?answers=0" | node -e '
    const d = JSON.parse(require("fs").readFileSync(0, "utf8"));
    const ids = d.groups.flatMap((g) => g.threads.flatMap((t) => [t.root, ...t.followUps])).map((r) => r.id).sort();
    if (ids.join() !== "c1,c2,c3,c4" || d.me !== "tester") { console.error(ids, d.me); process.exit(1); }'
  echo "· 답글 보내기"
  curl -fsS -X POST "http://localhost:$PORT/api/threads-replies/c1/send" -H 'content-type: application/json' -d '{"message":"감사해요 !"}' >/dev/null
  curl -fsS "http://127.0.0.1:$FAKE/__sent" | grep -q '"reply_to_id":"c1"'
  echo "· 모두 건너뛰기"
  curl -fsS -X POST "http://localhost:$PORT/api/threads-replies/skip-all" -H 'content-type: application/json' -d '{}' | grep -q '"c2"'
  echo "끝까지 통과"
}

main "$@"
