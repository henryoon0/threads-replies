/**
 * Twitter/X content fetcher.
 *
 * X.com serves almost-empty HTML to unauthenticated clients, so we bypass the
 * web page entirely and use two public, no-auth endpoints:
 *
 *   1. FxTwitter  (api.fxtwitter.com/status/{id}) — primary
 *   2. Syndication (cdn.syndication.twimg.com/tweet-result) — fallback, Twitter's own
 *      embed backend. The required `token` is derived client-side from the tweet id.
 *
 * If the tweet is a self-reply we walk the `replying_to_status` chain to
 * reconstruct the full thread (common pattern for long-form content on X).
 */

export interface TwitterTweet {
  id: string;
  url: string;
  text: string;
  /** raw tweet text including the trailing t.co link that `text` strips off. */
  rawText?: string;
  /**
   * X 아티클(장문 글)을 가리키는 트윗이면 그 글의 제목·미리보기·전문.
   * `bodyText`는 FxTwitter가 content blocks를 줄 때 채워지는 본문 전체(로그인 불필요).
   * 없으면 `previewText`(잘린 첫 문단)로 폴백한다.
   */
  article?: { title: string; previewText: string; bodyText?: string };
  author: { screenName: string; name: string };
  createdAt?: string;
  lang?: string;
  mediaDescriptions: string[];
  quoted?: TwitterTweet;
  parent?: TwitterTweet;
}

export interface TwitterContent {
  sourceId: string;
  title: string;
  author: string;
  content: string;
  /** 트윗 본문이 사실상 링크 하나뿐일 때, 그 링크 URL (보통 t.co, 미해석). */
  linkedUrl?: string;
  /** 트윗 자체에 읽을 만한 텍스트가 거의 없는지 (링크/미디어만). */
  isThin?: boolean;
}

const URL_RE = /https?:\/\/[^\s)]+/g;

/** 텍스트에서 URL을 모두 제거한 나머지 (트윗에 실제 글이 있는지 판단용). */
function textWithoutUrls(s: string): string {
  return s.replace(URL_RE, " ").replace(/\s+/g, " ").trim();
}

function firstUrl(s: string): string | undefined {
  const m = s.match(URL_RE);
  return m ? m[0] : undefined;
}

const TWEET_URL_RE =
  /(?:twitter\.com|x\.com|nitter\.[^/]+|vxtwitter\.com|fxtwitter\.com)\/(?:[^/?#]+\/status|i\/web\/status)\/(\d{5,25})/i;

export function extractTweetId(url: string): string | null {
  const m = url.match(TWEET_URL_RE);
  return m ? m[1] : null;
}

/** Derive the token the syndication endpoint requires. Mirrors react-tweet's algorithm. */
function syndicationToken(id: string): string {
  const n = (Number(id) / 1e15) * Math.PI;
  return n.toString(36).replace(/(0+|\.)/g, "");
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";
const TIMEOUT_MS = 6000;

async function fetchJson<T>(url: string, headers: Record<string, string> = {}): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json, */*", ...headers },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

interface FxAuthor {
  screen_name: string;
  name: string;
}

interface FxMedia {
  altText?: string;
  description?: string;
}

interface FxTweet {
  id: string;
  url: string;
  text: string;
  raw_text?: { text?: string };
  article?: {
    title?: string;
    preview_text?: string;
    content?: { blocks?: Array<{ text?: string; type?: string }> };
  };
  author: FxAuthor;
  created_at?: string;
  lang?: string;
  is_note_tweet?: boolean;
  media?: { photos?: FxMedia[]; videos?: FxMedia[] };
  quote?: FxTweet;
  replying_to_status?: FxTweet | null;
}

interface FxResponse {
  code: number;
  message?: string;
  tweet?: FxTweet;
}

/** X 아티클의 content blocks를 문단 단위 본문 한 덩어리로 잇는다 (빈 블록 제외). */
function joinArticleBlocks(blocks?: Array<{ text?: string }>): string {
  if (!blocks?.length) return "";
  return blocks
    .map((b) => (b.text || "").trim())
    .filter(Boolean)
    .join("\n\n");
}

function fromFx(t: FxTweet): TwitterTweet {
  const mediaDescriptions: string[] = [];
  for (const m of t.media?.photos ?? []) {
    const alt = m.altText || m.description;
    if (alt) mediaDescriptions.push(`[이미지] ${alt}`);
  }
  for (const m of t.media?.videos ?? []) {
    const alt = m.altText || m.description;
    if (alt) mediaDescriptions.push(`[동영상] ${alt}`);
  }
  return {
    id: t.id,
    url: t.url,
    text: (t.text || "").trim(),
    rawText: t.raw_text?.text,
    article: t.article?.title
      ? {
          title: t.article.title,
          previewText: (t.article.preview_text || "").trim(),
          bodyText: joinArticleBlocks(t.article.content?.blocks) || undefined,
        }
      : undefined,
    author: { screenName: t.author.screen_name, name: t.author.name },
    createdAt: t.created_at,
    lang: t.lang,
    mediaDescriptions,
    quoted: t.quote ? fromFx(t.quote) : undefined,
    parent: t.replying_to_status ? fromFx(t.replying_to_status) : undefined,
  };
}

async function fetchFromFxTwitter(id: string): Promise<TwitterTweet | null> {
  const json = await fetchJson<FxResponse>(`https://api.fxtwitter.com/status/${id}`);
  if (!json || json.code !== 200 || !json.tweet) return null;
  return fromFx(json.tweet);
}

interface SyndicationEntity {
  text?: string;
  display_url?: string;
}

interface SyndicationTweet {
  __typename?: string;
  id_str?: string;
  text?: string;
  full_text?: string;
  created_at?: string;
  lang?: string;
  user?: { screen_name?: string; name?: string };
  quoted_tweet?: SyndicationTweet;
  entities?: { urls?: SyndicationEntity[] };
  mediaDetails?: Array<{ ext_alt_text?: string; type?: string }>;
}

function fromSyndication(t: SyndicationTweet): TwitterTweet {
  const mediaDescriptions: string[] = [];
  for (const m of t.mediaDetails ?? []) {
    if (m.ext_alt_text) mediaDescriptions.push(`[${m.type || "이미지"}] ${m.ext_alt_text}`);
  }
  return {
    id: t.id_str || "",
    url: t.user?.screen_name
      ? `https://x.com/${t.user.screen_name}/status/${t.id_str}`
      : `https://x.com/i/web/status/${t.id_str}`,
    text: (t.full_text || t.text || "").trim(),
    author: {
      screenName: t.user?.screen_name || "",
      name: t.user?.name || "",
    },
    createdAt: t.created_at,
    lang: t.lang,
    mediaDescriptions,
    quoted: t.quoted_tweet ? fromSyndication(t.quoted_tweet) : undefined,
  };
}

async function fetchFromSyndication(id: string): Promise<TwitterTweet | null> {
  const token = syndicationToken(id);
  const json = await fetchJson<SyndicationTweet>(
    `https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${token}&lang=en`,
    { Referer: "https://platform.twitter.com/" }
  );
  if (!json || json.__typename === "TweetTombstone" || !json.id_str) return null;
  return fromSyndication(json);
}

/**
 * Walks the `replying_to_status` chain via FxTwitter while the same author keeps
 * replying to themselves (classic "thread" pattern). Capped to prevent loops.
 */
async function expandThread(start: TwitterTweet, maxHops = 20): Promise<TwitterTweet[]> {
  const chain: TwitterTweet[] = [start];
  let current = start;
  const seen = new Set<string>([start.id]);
  for (let i = 0; i < maxHops; i++) {
    const parent = current.parent;
    if (!parent) break;
    if (seen.has(parent.id)) break;
    if (parent.author.screenName.toLowerCase() !== start.author.screenName.toLowerCase()) break;
    seen.add(parent.id);
    chain.unshift(parent);
    current = parent;
  }
  return chain;
}

function formatTweet(t: TwitterTweet, index?: number, total?: number): string {
  const header =
    index != null && total != null && total > 1
      ? `[${index + 1}/${total}] @${t.author.screenName}`
      : `@${t.author.screenName} (${t.author.name})`;
  const parts: string[] = [header, t.text];
  if (t.mediaDescriptions.length > 0) parts.push(t.mediaDescriptions.join("\n"));
  if (t.quoted) {
    parts.push(
      `↳ 인용: @${t.quoted.author.screenName}: ${t.quoted.text}${
        t.quoted.mediaDescriptions.length ? "\n" + t.quoted.mediaDescriptions.join("\n") : ""
      }`
    );
  }
  return parts.filter(Boolean).join("\n");
}

/** 트윗 URL → 스레드의 트윗 원본 배열 (캡처 도구처럼 프롬프트 포맷이 필요 없는 호출처용). */
export async function fetchTweetThread(url: string): Promise<TwitterTweet[] | null> {
  const id = extractTweetId(url);
  if (!id) return null;
  const tweet = (await fetchFromFxTwitter(id)) ?? (await fetchFromSyndication(id));
  if (!tweet) return null;
  return expandThread(tweet);
}

export async function fetchTwitterContent(url: string): Promise<TwitterContent | null> {
  const id = extractTweetId(url);
  if (!id) return null;

  const tweet = (await fetchFromFxTwitter(id)) ?? (await fetchFromSyndication(id));
  if (!tweet) return null;

  const thread = await expandThread(tweet);
  const headTweet = thread[0];
  const author = `${headTweet.author.name} (@${headTweet.author.screenName})`;
  const article = thread.map((t) => t.article).find(Boolean);

  const meta = [
    `URL: ${tweet.url}`,
    tweet.createdAt ? `작성: ${tweet.createdAt}` : null,
    thread.length > 1 ? `스레드 ${thread.length}개 트윗` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  // X 아티클(장문 글)을 가리키는 트윗: FxTwitter가 content blocks를 주면 전문을
  // 그대로 가져오고(로그인 불필요), 미리보기뿐이면 잘린 첫 문단 + 안내문으로 폴백한다.
  if (article) {
    const body = article.bodyText || article.previewText;
    const note = article.bodyText
      ? ""
      : "\n\n(X 아티클 미리보기입니다. 전문은 X 로그인이 필요합니다.)";
    return {
      sourceId: id,
      title: article.title,
      author,
      content: `[X 아티클] ${article.title}\n작성자: ${author} · ${meta}\n\n${body}${note}`,
      isThin: false,
    };
  }

  const firstLine = headTweet.text.split("\n")[0].trim();
  const title =
    firstLine.length > 80 ? firstLine.slice(0, 77) + "…" : firstLine || `@${headTweet.author.screenName}`;

  const body = thread.map((t, i) => formatTweet(t, i, thread.length)).join("\n\n");

  // 스레드 전체에서 링크를 뺀 실제 텍스트가 거의 없으면 "thin" — 본문이 링크나
  // 미디어뿐인 트윗. 이 경우 가리키는 링크를 노출해 호출자가 그 글을 가져올 수 있게.
  const visibleText = thread.map((t) => textWithoutUrls(t.text)).join(" ").trim();
  const isThin = visibleText.length < 20;
  let linkedUrl: string | undefined;
  if (isThin) {
    for (const t of thread) {
      linkedUrl = firstUrl(t.text) || firstUrl(t.rawText || "");
      if (linkedUrl) break;
    }
  }

  return {
    sourceId: id,
    title,
    author,
    content: `[X/Twitter]\n${meta}\n\n${body}`,
    linkedUrl,
    isThin,
  };
}

export const __testing = {
  extractTweetId,
  syndicationToken,
  formatTweet,
};
