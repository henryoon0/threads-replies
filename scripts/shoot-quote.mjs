#!/usr/bin/env node
// 인용 한 줄의 원문 형광 캡처 (스레드 댓글 답하기 픽 6, 09-27).
//
//   node scripts/shoot-quote.mjs <url> --quote "<원문 그대로>" [--quote ...] --out <png>
//
// 답글 근거가 X 게시물이나 웹 글에서 왔을 때, 그 원본 화면에서 인용이 있는 자리를
// 형광펜으로 칠해 4:5 한 장으로 찍는다. henry 노트(수집노트·강의 자료)는 찍지 않는다 —
// 호출하는 쪽(evidence-shot.ts)이 원본 url 이 있는 근거만 넘긴다.
//
// 기준 (x-article-shots.mjs 와 같은 원칙):
// - 원본 화면 위에 칠한다. 칠하기는 글자 조각(텍스트 노드)마다 따로 감싼다.
// - X 는 로그인 프로필에서 쿠키만 빌려 별도 headless 2배로 찍는다 (headed 창 좌표 자르기 금지).
// - 웹 글은 휴대폰 폭(420) 3배 = 1260 폭. 스크롤은 behavior "instant".
// - 첫 인용이 틀 안에 들어오는 것이 조건이다. 못 칠하면 실패로 돌려준다 (틀린 캡처보다 없는 게 낫다).
//
// stdout 마지막 줄: {"ok":true,"png":"…","painted":1,"width":1260,"height":1576,"cached":false}
// 실패: {"ok":false,"error":"…"} (종료 코드 1)
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { chromium } from "playwright";
import sharp from "sharp";
import { HIGHLIGHT_COLORS, highlightMarkStyle } from "./lib/content-evidence.mjs";
import { launchXContext, releaseProfileLock } from "./lib/x-browser.mjs";

// 캡처 모양(틀·여백·칠하기)을 바꾸면 올린다 — 옛 캐시를 안 쓰게.
const SHOT_VERSION = "q2-4x5-1260";
const FRAME_RATIO = 1.25;
const PAD = 16;
const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

const log = (...args) => console.error("[shoot-quote]", ...args);

function parseArgs(argv) {
  const out = { url: "", quotes: [], out: "" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--quote") out.quotes.push(argv[++i] ?? "");
    else if (arg === "--out") out.out = argv[++i] ?? "";
    else if (!out.url) out.url = arg;
  }
  out.quotes = out.quotes.map((q) => q.trim()).filter(Boolean);
  return out;
}

export function isXStatusUrl(url) {
  try {
    const u = new URL(url);
    return /(^|\.)(x|twitter)\.com$/.test(u.hostname) && /\/status\/\d+/.test(u.pathname);
  } catch {
    return false;
  }
}

function hashKey(value) {
  return crypto.createHash("sha1").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

function cacheDir() {
  return (
    process.env.THREADS_EVIDENCE_CACHE_DIR ||
    path.join(process.cwd(), "data", "threads-replies", "shots-cache")
  );
}

const done = (result) => result;

function finish(result) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exit(result.ok ? 0 : 1);
}

// ── 브라우저 안에서 도는 부분 ────────────────────────────────────────────────
// page.evaluate 에 함수와 데이터(설정)만 넘긴다 — 원문 글자를 코드로 만들어 실행하지 않는다.

/**
 * 인용을 찾아 칠하고, 첫 인용이 들어오는 4:5 틀을 잡는다.
 * 비교는 글자·숫자만 남긴 "뼈대"로 한다 — 공백·따옴표 모양·이모지(X 는 img)·줄바꿈
 * 차이로 원문 그대로인 인용을 놓치지 않게. 칠하는 범위는 첫 글자부터 끝 글자까지다.
 */
function paintAndFrame({ quotes, styles, mode, pad, ratio }) {
  const isX = mode === "x";
  const letter = /[\p{L}\p{N}]/u;
  const blockOf = (node) => {
    for (let el = node.parentElement; el; el = el.parentElement) {
      const d = getComputedStyle(el).display;
      if (d === "block" || d === "list-item" || d === "flex" || d === "grid" || d === "table-cell") return el;
    }
    return document.body;
  };
  const pickRoot = () => {
    if (isX) return document.querySelector('[data-testid="primaryColumn"]') || document.body;
    const candidates = [...document.querySelectorAll("article, main, [role='main']")];
    return candidates.sort((a, b) => (b.innerText || "").length - (a.innerText || "").length)[0] || document.body;
  };

  // 숨긴 떠 있는 요소 (고정 바·쿠키 배너)
  for (const el of document.querySelectorAll("body *")) {
    const position = getComputedStyle(el).position;
    if (position === "sticky" || position === "fixed") el.style.setProperty("visibility", "hidden", "important");
  }

  const root = pickRoot();
  const chars = []; // 뼈대 글자 → { node, offset }
  let skeleton = "";
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const p = node.parentElement;
      if (!p || p.closest("script, style, noscript, nav, header, footer, [aria-hidden='true']")) return NodeFilter.FILTER_REJECT;
      const r = p.getBoundingClientRect();
      return r.width > 0 && r.height > 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const data = node.data;
    for (let i = 0; i < data.length; i++) {
      if (!letter.test(data[i])) continue;
      skeleton += data[i].toLowerCase();
      chars.push({ node, offset: i });
    }
  }
  const skel = (text) => [...String(text)].filter((c) => letter.test(c)).join("").toLowerCase();

  // 인용 → 뼈대 구간. 통째로 없으면 문장 단위로 쪼개 가장 긴 것부터 찾는다.
  const locate = (quote) => {
    const whole = skel(quote);
    if (whole.length >= 6) {
      const at = skeleton.indexOf(whole);
      if (at >= 0) return { start: at, end: at + whole.length, partial: false };
    }
    const parts = String(quote)
      .split(/(?<=[.!?。？！])\s+|\n+/)
      .map(skel)
      .filter((p) => p.length >= 12)
      .sort((a, b) => b.length - a.length);
    for (const part of parts) {
      const at = skeleton.indexOf(part);
      if (at >= 0) return { start: at, end: at + part.length, partial: true };
    }
    return null;
  };

  // 짧은 인용(20자 미만)은 담긴 문장 전체로 넓힌다 — 한 단어만 칠하면 근거로 안 읽힌다.
  const widenToSentence = (hit) => {
    const block = blockOf(chars[hit.start].node);
    const text = [];
    const bw = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let startNode = null;
    for (let n = bw.nextNode(); n; n = bw.nextNode()) text.push(n);
    // 블록 텍스트를 이어 붙여 문장 경계를 찾는다.
    let joined = "";
    const map = [];
    for (const n of text) {
      for (let i = 0; i < n.data.length; i++) {
        joined += n.data[i];
        map.push({ node: n, offset: i });
      }
    }
    const first = chars[hit.start];
    const last = chars[hit.end - 1];
    const from = map.findIndex((m) => m.node === first.node && m.offset === first.offset);
    const to = map.findIndex((m) => m.node === last.node && m.offset === last.offset);
    if (from < 0 || to < 0) return hit;
    let s = from;
    // 문장 끝 = 마침표류 뒤에 공백(또는 블록 끝). "5.1" 같은 숫자 안 점은 끝이 아니다.
    const endsAt = (i) => /[.!?。？！]/.test(joined[i]) && (i + 1 >= joined.length || /\s/.test(joined[i + 1]));
    // 줄바꿈도 경계다 — X 글은 마침표 없이 줄을 바꿔 문단을 나눈다 (09-27 실측).
    while (s > 0 && joined[s - 1] !== "\n" && !endsAt(s - 1) && !(s > 1 && /\s/.test(joined[s - 1]) && endsAt(s - 2))) s--;
    while (s < from && /\s/.test(joined[s])) s++;
    let e = to;
    while (e < joined.length - 1 && joined[e + 1] !== "\n" && !endsAt(e)) e++;
    startNode = map[s];
    const endNode = map[e];
    // 넓힌 경계를 뼈대 번호로 되돌린다.
    const idx = (m, dir) => {
      const pos = map.indexOf(m);
      for (let p = pos; p >= 0 && p < map.length; p += dir) {
        const k = chars.findIndex((c) => c.node === map[p].node && c.offset === map[p].offset);
        if (k >= 0) return k;
      }
      return -1;
    };
    const ns = idx(startNode, 1);
    const ne = idx(endNode, -1);
    if (ns < 0 || ne < ns || ne - ns > 400) return hit;
    return { start: Math.min(ns, hit.start), end: Math.max(ne + 1, hit.end), partial: hit.partial };
  };

  const wrap = (hit, style, index) => {
    const first = chars[hit.start];
    const last = chars[hit.end - 1];
    const segments = [];
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    tw.currentNode = first.node;
    for (let n = first.node; n; n = tw.nextNode()) {
      const from = n === first.node ? first.offset : 0;
      const to = n === last.node ? last.offset + 1 : n.data.length;
      if (to > from && n.data.slice(from, to).trim()) segments.push({ node: n, from, to });
      if (n === last.node) break;
    }
    const color = getComputedStyle(first.node.parentElement).color.match(/\d+(\.\d+)?/g) || [0, 0, 0];
    const [r, g, b] = color.map(Number);
    const lightText = (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6;
    const marks = [];
    for (const { node, from, to } of segments) {
      const target = node.splitText(from);
      target.splitText(to - from);
      const mark = document.createElement("mark");
      mark.dataset.qMark = String(index);
      mark.style.cssText = style;
      if (lightText) mark.style.color = "#1f1f1f";
      target.replaceWith(mark);
      mark.append(target);
      marks.push(mark);
    }
    return marks;
  };

  // 찾기를 먼저 다 하고 칠한다 — 칠하면 텍스트 노드가 쪼개져 chars 가 낡는다.
  const hits = [];
  quotes.forEach((quote, index) => {
    let hit = locate(quote);
    if (!hit) return;
    if (skel(quote).length < 20 || String(quote).trim().length < 20) hit = widenToSentence(hit);
    if (hits.some((h) => h.hit.start < hit.end && hit.start < h.hit.end)) return;
    hits.push({ hit, index });
  });
  if (!hits.length || hits[0].index !== 0) {
    return { error: hits.length ? "첫 인용을 원문에서 못 찾음" : "인용을 원문에서 못 찾음" };
  }
  // 뒤에서부터 칠한다 — 앞을 먼저 쪼개면 뒤 오프셋이 어긋난다.
  const ordered = [...hits].sort((a, b) => b.hit.start - a.hit.start);
  for (const { hit, index } of ordered) wrap(hit, styles[index % styles.length], index);

  const firstMarks = [...document.querySelectorAll('mark[data-q-mark="0"]')];
  if (!firstMarks.length) return { error: "칠하기 실패" };
  const partial = hits[0].hit.partial;

  // 틀의 좌우: X 는 인용이 든 게시물 칸, 웹 글은 화면 전체 폭(휴대폰 1단 화면).
  const cell = isX ? firstMarks[0].closest("article") : null;
  firstMarks[0].scrollIntoView({ block: "center", behavior: "instant" });
  const markBox = () => {
    const rects = firstMarks.map((m) => m.getBoundingClientRect());
    return { top: Math.min(...rects.map((r) => r.top)), bottom: Math.max(...rects.map((r) => r.bottom)) };
  };
  const cellRect = () => (cell ? cell.getBoundingClientRect() : null);
  const width = isX ? Math.round(cellRect().width) : document.documentElement.clientWidth;
  const height = Math.round(width * ratio);
  const x = isX ? Math.max(0, Math.round(cellRect().left)) : 0;

  // 윗변: X 는 가능하면 게시물 칸 윗변(작성자 줄), 인용이 그 틀 밖이면 인용 위 30% 지점.
  // 웹 글은 인용이 든 문단 윗변부터 — 문단이 길면 인용 위 30% 지점.
  let docTop;
  const scrollY = () => window.scrollY;
  const mb = markBox();
  if (isX) {
    const c = cellRect();
    docTop = mb.bottom - c.top <= height - pad * 2 ? c.top : mb.top - height * 0.3;
  } else {
    const block = blockOf(firstMarks[0].firstChild || firstMarks[0]);
    const bTop = block.getBoundingClientRect().top - pad;
    docTop = mb.bottom - bTop <= height - pad * 2 && mb.top - bTop < height * 0.5 ? bTop : mb.top - height * 0.3;
    // 앞 문단의 반쯤 걸린 줄은 빼고 시작한다.
  }
  docTop += scrollY();
  window.scrollTo({ top: Math.max(0, docTop - pad), behavior: "instant" });
  let y = Math.max(0, Math.round(docTop - scrollY()));
  // 윗변에 걸친 글줄은 반쯤 잘려 보인다 — 그 줄 윗선으로 올린다.
  const lines = [];
  const lw = document.createTreeWalker(isX && cell ? cell : root, NodeFilter.SHOW_TEXT);
  for (let n = lw.nextNode(); n; n = lw.nextNode()) {
    if (!n.data.trim()) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    for (const line of range.getClientRects()) lines.push({ top: line.top, bottom: line.bottom });
  }
  for (const line of lines) if (line.top < y && line.bottom > y) y = Math.max(0, Math.floor(line.top - 2));
  if (y + height > window.innerHeight || x + width > window.innerWidth + 1) {
    return { error: `틀이 화면을 넘음 (${width}x${height} @${x},${y})` };
  }

  // 아랫변: 경계에 걸친 글줄부터 배경색으로 덮는다. X 는 게시물 칸 아래(댓글)도 덮는다.
  const frameBottom = y + height;
  let cutoff = frameBottom;
  if (isX && cell) cutoff = Math.min(cutoff, cellRect().bottom + 1);
  for (const line of lines) if (line.top < cutoff && line.bottom > cutoff) cutoff = Math.min(cutoff, line.top - 2);
  const box = markBox();
  if (box.top < y - 1 || box.bottom > cutoff + 1) return { error: "첫 인용이 틀 안에 다 안 들어옴" };
  // 웹 글: 윗변 위 요소(큰 소제목 등)의 글자 끝자락이 틀 윗부분에 비친다 (09-27 실측).
  // 틀 안에 온전히 들어온 첫 글줄 위쪽은 배경색으로 덮는다.
  const bgColor = () => {
    const bg = getComputedStyle(document.body).backgroundColor;
    return bg && bg !== "rgba(0, 0, 0, 0)" ? bg : "#fff";
  };
  if (!isX) {
    const firstLineTop = Math.min(...lines.filter((l) => l.top >= y).map((l) => l.top));
    if (Number.isFinite(firstLineTop) && firstLineTop - 6 > y) {
      const topVeil = document.createElement("div");
      topVeil.id = "q-veil-top";
      topVeil.style.cssText = `position:fixed;left:${x}px;top:${y - 1}px;width:${width}px;height:${firstLineTop - 6 - y + 1}px;background:${bgColor()};z-index:2147483647;pointer-events:none`;
      document.body.append(topVeil);
    }
  }
  if (cutoff < frameBottom) {
    const veil = document.createElement("div");
    veil.id = "q-veil";
    const bg = getComputedStyle(document.body).backgroundColor;
    veil.style.cssText = `position:fixed;left:${x}px;top:${cutoff}px;width:${width}px;height:${frameBottom - cutoff + 2}px;background:${bg && bg !== "rgba(0, 0, 0, 0)" ? bg : "#fff"};z-index:2147483647;pointer-events:none`;
    document.body.append(veil);
  }
  const painted = new Set(
    [...document.querySelectorAll("mark[data-q-mark]")]
      .filter((m) => {
        const r = m.getBoundingClientRect();
        return r.height > 0 && r.top >= y - 1 && r.bottom <= cutoff + 1 && r.left >= x - 1 && r.right <= x + width + 1;
      })
      .map((m) => m.dataset.qMark)
  );
  return { clip: { x, y, width, height }, painted: painted.size, partial };
}

// ── 페이지 열기 ──────────────────────────────────────────────────────────────

async function openWeb(browser, url) {
  const page = await browser.newPage({
    viewport: { width: 420, height: 1100 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: MOBILE_UA,
  });
  page.setDefaultTimeout(30_000);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(1500);
  // lazy 요소를 깨운다 (ingest-resource openMobilePage 와 같은 점진 스크롤).
  await page.evaluate(async () => {
    const step = window.innerHeight;
    for (let y = 0; y < document.body.scrollHeight && y < 40_000; y += step) {
      window.scrollTo({ top: y, behavior: "instant" });
      await new Promise((r) => setTimeout(r, 120));
    }
    window.scrollTo({ top: 0, behavior: "instant" });
  });
  await page.waitForTimeout(500);
  return page;
}

/** 로그인 프로필에서 쿠키만 빌리고 곧바로 닫는다 — 프로필 락을 오래 쥐지 않게. */
async function borrowXCookies() {
  const context = await launchXContext(false, log);
  try {
    return await context.cookies("https://x.com");
  } finally {
    await context.close().catch(() => {});
    releaseProfileLock();
  }
}

async function openX(browser, url) {
  const cookies = await borrowXCookies().catch((e) => {
    log(`X 쿠키를 못 빌림(비로그인으로 시도): ${e.message}`);
    return [];
  });
  const context = await browser.newContext({
    viewport: { width: 1100, height: 1600 },
    deviceScaleFactor: 2,
    userAgent: DESKTOP_UA,
  });
  if (cookies.length) await context.addCookies(cookies);
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector('article[data-testid="tweet"] [data-testid="tweetText"]', { timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => {});
  await page.waitForTimeout(1200);
  return page;
}

// X 게시물 칸 폭(약 598)×2 는 1196 이라 웹 캡처(420×3 = 1260)와 폭이 다르다.
// 스레드 첨부는 같은 크기여야 하므로 폭 1260 으로 맞춘다 (비율은 그대로 4:5).
const TARGET_WIDTH = 1260;
async function toTargetWidth(raw) {
  const img = sharp(raw);
  const meta = await img.metadata();
  if (!meta.width || !meta.height || meta.width === TARGET_WIDTH) {
    return { buf: raw, width: meta.width ?? 0, height: meta.height ?? 0 };
  }
  const height = Math.round((meta.height * TARGET_WIDTH) / meta.width);
  const buf = await img.resize(TARGET_WIDTH, height, { kernel: "lanczos3" }).png().toBuffer();
  return { buf, width: TARGET_WIDTH, height };
}

// ── 본체 ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!/^https?:\/\//.test(args.url)) return done({ ok: false, error: "http(s) 주소가 필요합니다" });
  if (!args.quotes.length) return done({ ok: false, error: "--quote 가 필요합니다" });
  if (!args.out) return done({ ok: false, error: "--out 이 필요합니다" });
  const out = path.resolve(args.out);
  const mode = isXStatusUrl(args.url) ? "x" : "web";

  const key = hashKey([SHOT_VERSION, args.url, args.quotes]);
  const cachePng = path.join(cacheDir(), `${key}.png`);
  const cacheMeta = path.join(cacheDir(), `${key}.json`);
  if (process.env.X_CAPTURE_FRESH !== "1") {
    const meta = await fs.readFile(cacheMeta, "utf8").then(JSON.parse).catch(() => null);
    if (meta && (await fs.stat(cachePng).catch(() => null))) {
      await fs.mkdir(path.dirname(out), { recursive: true });
      await fs.copyFile(cachePng, out);
      return done({ ok: true, png: out, painted: meta.painted, width: meta.width, height: meta.height, partial: meta.partial, cached: true });
    }
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const page = mode === "x" ? await openX(browser, args.url) : await openWeb(browser, args.url);
    const styles = HIGHLIGHT_COLORS.map((c) => highlightMarkStyle(c));
    const framed = await page.evaluate(paintAndFrame, { quotes: args.quotes, styles, mode, pad: PAD, ratio: FRAME_RATIO });
    if (framed.error) return done({ ok: false, error: framed.error });
    await page.waitForTimeout(mode === "web" ? 1000 : 400);
    const raw = await page.screenshot({ clip: framed.clip });
    const { buf, width, height } = await toTargetWidth(raw);
    const result = { painted: framed.painted, width, height, partial: framed.partial };
    await fs.mkdir(path.dirname(out), { recursive: true });
    await fs.writeFile(out, buf);
    // 캐시: 임시 파일에 쓰고 옮긴다 (반쪽 파일이 캐시로 남지 않게). 실패해도 캡처는 성공이다.
    try {
      await fs.mkdir(cacheDir(), { recursive: true });
      await fs.writeFile(`${cachePng}.${process.pid}.tmp`, buf);
      await fs.rename(`${cachePng}.${process.pid}.tmp`, cachePng);
      await fs.writeFile(cacheMeta, JSON.stringify({ url: args.url, quotes: args.quotes, ...result }));
    } catch (e) {
      log(`캐시 쓰기 실패: ${e.message}`);
    }
    return done({ ok: true, png: out, ...result, cached: false });
  } finally {
    await browser.close().catch(() => {});
  }
}

main()
  .catch((e) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }))
  .then(finish);
