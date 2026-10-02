#!/usr/bin/env bash
# 가짜 스레드 서버로 끝까지 시험: 연결 → 댓글 가져오기 → 답글 보내기 → 모두 건너뛰기
# → 보내기 대기열(5초 되돌리기를 서버가 잰다): 때가 되면 보냄 · 되돌리면 안 보냄 · 기다리는 중 앱이 꺼져도 다시 켜지면 보냄.
# 빌드된 앱(.next)이 있어야 한다. AI 없이도 도는 부분만 본다(초안·말투는 AI CLI 가 있어야 한다).
set -euo pipefail

main() {
  local PORT=3470 FAKE=4568
  DATA="$(mktemp -d)"
  trap 'kill $(jobs -p) 2>/dev/null || true; rm -rf "$DATA"' EXIT
  # 진짜 스레드에는 절대 닿지 않는다: 모든 Graph 호출은 THREADS_GRAPH_BASE_URL(가짜 서버)로 가고,
  # HOME 도 빈 폴더로 바꿔 이 맥에 남은 진짜 토큰을 찾아 쓰지 못하게 한다.
  mkdir -p "$DATA/home"
  node scripts/fake-threads.mjs &
  # 계정 팩(박약사 원장·발송 기록)은 복사본으로 시험한다 — 진짜 팩에 시험 기록이 남지 않게
  cp -R personas "$DATA/personas"
  start_app() {
    HOME="${APP_HOME:-$HOME}" THREADS_GRAPH_BASE_URL="http://127.0.0.1:$FAKE/v1.0" THREADS_REPLIES_DISABLE_SCHEDULER=1 \
      THREADS_ARCHIVE_DIR="$DATA/archive" THREADS_REPLIES_DIR="$DATA/replies" THREADS_REPLIES_DATA="$DATA" \
      MY_DOCS_DIR="$DATA/docs" SHARE_DATA_DIR="$DATA/share" REPLY_PERSONAS_DIR="$DATA/personas" \
      node node_modules/next/dist/bin/next start -p "$PORT" &
    APP_PID=$!
    for _ in $(seq 1 60); do curl -fsS -o /dev/null "http://localhost:$PORT/api/account" 2>/dev/null && break; sleep 1; done
  }
  start_app

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
    if (ids.join() !== "c1,c2,c3,c4,c5" || d.me !== "tester") { console.error(ids, d.me); process.exit(1); }'
  echo "· 답글 보내기"
  curl -fsS -X POST "http://localhost:$PORT/api/threads-replies/c1/send" -H 'content-type: application/json' -d '{"message":"감사해요 !"}' >/dev/null
  curl -fsS "http://127.0.0.1:$FAKE/__sent" | grep -q '"reply_to_id":"c1"'
  echo "· 모두 건너뛰기"
  curl -fsS -X POST "http://localhost:$PORT/api/threads-replies/skip-all" -H 'content-type: application/json' -d '{}' | grep -q '"c2"'
  not_sent() { if sent_to "$1"; then echo "$1 에 보내면 안 되는데 보냈어요" >&2; exit 1; fi; }
  sent_to() { curl -fsS "http://127.0.0.1:$FAKE/__sent" | grep -q "\"reply_to_id\":\"$1\""; }
  queue() { curl -fsS -X POST "http://localhost:$PORT/api/threads-replies/$1/send" -H 'content-type: application/json' -d "{\"message\":\"대기열 $1\",\"delayMs\":$2}" | grep -q '"queued"'; }

  echo "· 대기열: 시간이 지나기 전엔 안 보내고, 지나면 서버가 보낸다"
  queue c2 3000
  not_sent c2
  sleep 4
  sent_to c2
  curl -fsS "http://localhost:$PORT/api/threads-replies/c2/send" | grep -q '"status":"sent"'

  echo "· 대기열: 되돌리면 보내지 않는다"
  queue c3 3000
  curl -fsS -X DELETE "http://localhost:$PORT/api/threads-replies/c3/send" | grep -q '"cancelled":true'
  sleep 4
  not_sent c3

  echo "· 화면이 보내는 방식(10-02: 되돌리기 띠 없이 바로): 맡기자마자 스레드에 답글로 올라간다"
  queue c5 1
  for _ in $(seq 1 10); do sent_to c5 && break; sleep 0.5; done
  curl -fsS "http://127.0.0.1:$FAKE/__sent" | node -e '
    const sent = JSON.parse(require("fs").readFileSync(0, "utf8")).filter((s) => s.reply_to_id === "c5");
    if (sent.length !== 1 || sent[0].text !== "대기열 c5" || sent[0].media_type !== "TEXT") { console.error(sent); process.exit(1); }'
  curl -fsS "http://localhost:$PORT/api/threads-replies/c5/send" | grep -q '"status":"sent"'
  curl -fsS "http://localhost:$PORT/api/threads-replies?answers=0" | node -e '
    const d = JSON.parse(require("fs").readFileSync(0, "utf8"));
    const r = d.groups.flatMap((g) => g.threads.flatMap((t) => [t.root, ...t.followUps])).find((x) => x.id === "c5");
    if (!r || r.myReply?.text !== "대기열 c5") { console.error("원장에 보낸 답이 안 남았어요", r); process.exit(1); }'

  echo "· 대기열: 기다리는 중 앱이 꺼져도 다시 켜지면 보낸다"
  queue c4 2000
  kill "$APP_PID"; wait "$APP_PID" 2>/dev/null || true
  not_sent c4
  sleep 3
  start_app
  for _ in $(seq 1 15); do sent_to c4 && break; sleep 1; done
  sent_to c4

  echo "· 이미 연결한 토큰: 앱을 다시 켜도 다시 연결하라고 하지 않는다"
  curl -fsS "http://localhost:$PORT/api/account" | grep -q '"connected":true'

  echo "· 기록 폴더가 비어도 이 맥에 남은 토큰(백업)을 찾아 스스로 붙는다"
  kill "$APP_PID"; wait "$APP_PID" 2>/dev/null || true
  local BACKUP="$DATA/home/.threads-replies/data-backup-1/threads-archive"
  mkdir -p "$BACKUP"
  mv "$DATA/archive/token.json" "$BACKUP/token.json"
  # 자동 찾기는 기본 계정과 아이디가 같은 토큰만 붙인다 — 시험 사본의 계정을 가짜 서버 아이디(tester)로 맞춘다
  node -e 'const f=process.argv[1];const p=JSON.parse(require("fs").readFileSync(f,"utf8"));p.handle="tester";require("fs").writeFileSync(f,JSON.stringify(p))' "$DATA/personas/glp1/persona.json"
  APP_HOME="$DATA/home" start_app
  curl -fsS "http://localhost:$PORT/api/account" | grep -q '"connected":true'
  echo "끝까지 통과"
}

main "$@"
