#!/usr/bin/env node
// 개발·시험용 가짜 스레드 서버. 진짜 계정 없이 연결 → 댓글 가져오기 → 말투 만들기 → 답글 보내기를 끝까지 돌린다.
//   node scripts/fake-threads.mjs            (127.0.0.1:4568)
//   THREADS_GRAPH_BASE_URL=http://127.0.0.1:4568/v1.0 npm run dev
// 토큰: 아래 FAKE_TOKEN 을 연결 화면에 붙여넣는다. 보낸 답글은 GET /__sent 로 확인한다.
import http from "node:http";

export const FAKE_TOKEN = "THAAfake" + "x".repeat(120);
const PORT = Number(process.env.FAKE_THREADS_PORT || 4568);
const ME = { id: "900", username: "tester" };
const now = Date.now();
const iso = (minAgo) => new Date(now - minAgo * 60_000).toISOString().replace(/\.\d{3}Z$/, "+0000");

const posts = [
  { id: "p1", text: "노션 AI 한 달 써 본 후기. 회의록 정리가 제일 편했어요. 요약 길이는 설정에서 바꿀 수 있어요.", permalink: "https://www.threads.com/@tester/post/p1", timestamp: iso(600), media_type: "TEXT_POST" },
  { id: "p2", text: "퇴근 전 10분 정리 습관", permalink: "https://www.threads.com/@tester/post/p2", timestamp: iso(3000), media_type: "TEXT_POST" },
];
const conversations = {
  p1: [
    { id: "c1", text: "좋은 글 감사합니다", username: "kim", timestamp: iso(500), replied_to: { id: "p1" } },
    { id: "c2", text: "요약 길이는 어디서 바꾸나요?", username: "lee", timestamp: iso(400), replied_to: { id: "p1" } },
    { id: "c3", text: "ㅋㅋㅋ 회의록 공감돼요", username: "park", timestamp: iso(300), replied_to: { id: "p1" } },
  ],
  p2: [
    { id: "c4", text: "저도 해볼게요!", username: "choi", timestamp: iso(2000), replied_to: { id: "p2" } },
    { id: "c5", text: "이건 바로 보내 주세요", username: "jung", timestamp: iso(1500), replied_to: { id: "p2" } },
  ],
};
// 말투 만들기가 읽는 내 지난 답글 (짝이 되는 원댓글은 parents)
const parents = {};
const myReplies = [];
const samples = [
  ["우와 너무 유용해요", "헤헤 도움 됐다니 다행이에요 !"],
  ["이거 무료인가요?", "네 무료 요금제로도 돼요 ㅎㅎ"],
  ["ㅋㅋㅋ 완전 제 얘기", "ㅋㅋㅋ 다들 그렇더라고요"],
  ["감사합니다!", "봐 주셔서 감사해요 💌"],
  ["어떤 설정 쓰세요?", "저는 기본 설정 그대로 써요 !"],
];
for (let i = 0; i < 25; i++) {
  const [c, r] = samples[i % samples.length];
  parents[`old-c${i}`] = { text: c, username: `fan${i}` };
  myReplies.push({ id: `old-m${i}`, text: r, timestamp: iso(10_000 + i * 60), username: ME.username, replied_to: { id: `old-c${i}` }, root_post: { id: "p2" } });
}
const sent = [];
const containers = {};

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return new URLSearchParams(raw);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === "/__sent") return send(res, 200, sent);
  const body = req.method === "POST" ? await readBody(req) : new URLSearchParams();
  const token = url.searchParams.get("access_token") || body.get("access_token") || (req.headers.authorization || "").replace(/^Bearer /, "");
  if (token !== FAKE_TOKEN) return send(res, 400, { error: { message: "Invalid OAuth access token", code: 190 } });
  const path = url.pathname.replace(/^\/v1\.0/, "");

  if (path === "/refresh_access_token") return send(res, 200, { access_token: FAKE_TOKEN, token_type: "bearer", expires_in: 5_184_000 });
  if (path === "/me") return send(res, 200, ME);
  if (path === "/me/threads" && req.method === "GET") return send(res, 200, { data: posts });
  if (path === "/me/replies") return send(res, 200, { data: myReplies });
  if (path === "/me/threads" && req.method === "POST") {
    const id = `ct${Object.keys(containers).length + 1}`;
    containers[id] = { text: body.get("text"), reply_to_id: body.get("reply_to_id"), image_url: body.get("image_url"), media_type: body.get("media_type") };
    return send(res, 200, { id });
  }
  if (path === "/me/threads_publish") {
    const c = containers[body.get("creation_id")];
    if (!c) return send(res, 400, { error: { message: "unknown container" } });
    const id = `posted${sent.length + 1}`;
    sent.push({ id, ...c });
    return send(res, 200, { id });
  }
  let m = path.match(/^\/([^/]+)\/conversation$/);
  if (m) return send(res, 200, { data: conversations[m[1]] ?? [] });
  m = path.match(/^\/([^/]+)\/insights$/);
  if (m) return send(res, 200, { data: ["views", "likes", "replies", "reposts", "quotes"].map((name) => ({ name, values: [{ value: 0 }], total_value: { value: 0 } })) });
  m = path.match(/^\/([^/]+)$/);
  if (m && containers[m[1]]) return send(res, 200, { status: "FINISHED", id: m[1] });
  if (m && parents[m[1]]) return send(res, 200, parents[m[1]]);
  if (m && posts.find((p) => p.id === m[1])) return send(res, 200, posts.find((p) => p.id === m[1]));
  return send(res, 404, { error: { message: `fake: ${req.method} ${path} 없음` } });
});

server.listen(PORT, "127.0.0.1", () => console.log(`가짜 스레드 서버 http://127.0.0.1:${PORT}/v1.0 · 토큰 ${FAKE_TOKEN.slice(0, 12)}…`));
