// 댓글 쓴 사람의 공개 스레드 프로필 (이름·소개) — 읽기 단계가 "누구인지 모르겠다"고 할 때만 가져온다.
//
// 공개 프로필 페이지는 로그인 없이 링크 미리보기용 og 태그(이름·팔로워·소개)를 준다. 미리보기 봇 UA 로 받아야 태그가 온다.
// 결과는 팩 private/profiles/<아이디>.json 에 캐시한다. 못 가져오면 null (읽기는 프로필 없이 진행).
// 프로필에서 짐작한 개인정보는 판단에만 쓴다 — 답에 드러내지 않는다 (reading.ts 요청문).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface CommenterProfile {
  username: string;
  name: string;
  bio: string;
  fetchedAt: string;
}

const FETCH_TIMEOUT_MS = 10_000;
const CACHE_DAYS = 30;
const PREVIEW_UA = "facebookexternalhit/1.1";

function decode(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function meta(html: string, prop: string): string {
  const re = new RegExp(`<meta[^>]+(?:property|name)="${prop}"[^>]+content="([^"]*)"`, "i");
  return decode(html.match(re)?.[1] ?? "");
}

/** 프로필 페이지 HTML → 이름·소개. 그 사람 프로필 태그가 아니면 null. Pure. */
export function parseProfileHtml(username: string, html: string, now: string): CommenterProfile | null {
  const title = meta(html, "og:title");
  const desc = meta(html, "og:description");
  // 없는 계정·막힌 계정은 로그인 페이지 태그("Threads • Log in")가 온다 — 제목에 (@아이디) 가 있어야 그 사람 프로필이다.
  if (!title.toLowerCase().includes(`(@${username.toLowerCase()})`)) return null;
  const name = title.replace(/\s*\(@[^)]+\).*$/, "").trim();
  const bio = desc
    .replace(/^[\d.,KMk만천]+\s*Followers\s*•\s*[\d.,KMk만천]+\s*Threads\s*•\s*/i, "")
    .replace(/\s*See the latest conversations with @\S+\.?\s*$/i, "")
    .trim();
  return { username, name, bio, fetchedAt: now };
}

function cachePath(privateDir: string, username: string): string {
  return path.join(privateDir, "profiles", `${username.replace(/[^A-Za-z0-9_.]/g, "")}.json`);
}

async function fetchProfile(username: string): Promise<CommenterProfile | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`https://www.threads.com/@${encodeURIComponent(username)}`, { headers: { "User-Agent": PREVIEW_UA }, signal: ctl.signal });
    if (!res.ok) return null;
    return parseProfileHtml(username, await res.text(), new Date().toISOString());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 캐시 → 없거나 오래됐으면 가져와서 캐시. 실패하면 null (던지지 않는다). */
export async function commenterProfile(privateDir: string, username: string): Promise<CommenterProfile | null> {
  if (!/^[A-Za-z0-9_.]{1,40}$/.test(username)) return null;
  const file = cachePath(privateDir, username);
  try {
    const hit = JSON.parse(await readFile(file, "utf8")) as CommenterProfile;
    if (Date.now() - Date.parse(hit.fetchedAt) < CACHE_DAYS * 86_400_000) return hit;
  } catch {
    // 캐시 없음
  }
  const got = await fetchProfile(username);
  if (!got) return null;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(got, null, 2));
  return got;
}
