// 제품 url 안전 검사 (SSRF 막기). 운영자가 넣은 url 을 서버가 브라우저로 열기 때문에,
// 저장할 때와 캡처 직전에 "공개 인터넷 주소인가"를 확인한다. 같은 규칙이 캡처 스크립트
// (scripts/personas/url-guard.mjs)에도 있다 — 리다이렉트·하위 요청까지 막으려고. 둘은 테스트가 같은 표로 맞춘다.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

function v4ToInt(ip: string): number {
  return ip.split(".").reduce((n, p) => n * 256 + Number(p), 0);
}

const V4_BLOCKS: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
];

function inV4Block(ip: string): boolean {
  const n = v4ToInt(ip);
  return V4_BLOCKS.some(([base, bits]) => {
    const size = 2 ** (32 - bits);
    const start = v4ToInt(base);
    return n >= start && n < start + size;
  });
}

/** 사설·루프백·링크로컬·CGNAT·메타데이터 주소인가 (IPv4, IPv6, IPv4-mapped IPv6). 모르는 모양도 막는다. */
export function isBlockedAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return inV4Block(ip);
  if (kind !== 6) return true;
  const low = ip.toLowerCase();
  const mapped = low.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return inV4Block(mapped[1]);
  if (low === "::" || low === "::1") return true;
  return /^f[cd]/.test(low) || /^fe[89ab]/.test(low);
}

/** 모양만 본다 (저장 전 빠른 거절): http(s) 인가, 호스트가 IP 면 막힌 대역이 아닌가 */
export function checkUrlShape(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "url 모양이 아니에요";
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "http(s) 주소만 돼요";
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost")) return "내부 주소는 안 돼요";
  if (isIP(host) && isBlockedAddress(host)) return "내부 주소는 안 돼요";
  return null;
}

type Lookup = (host: string) => Promise<{ address: string }[]>;
const defaultLookup: Lookup = (host) => lookup(host, { all: true });

/** 모양 + DNS 로 푼 모든 주소가 공개 주소인가. 문제가 있으면 이유, 괜찮으면 null. */
export async function checkPublicUrl(raw: string, resolve: Lookup = defaultLookup): Promise<string | null> {
  const shape = checkUrlShape(raw);
  if (shape) return shape;
  const host = new URL(raw).hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return null;
  try {
    const addrs = await resolve(host);
    if (!addrs.length) return "주소를 찾을 수 없어요";
    return addrs.some((a) => isBlockedAddress(a.address)) ? "내부 주소로 풀리는 url 이에요" : null;
  } catch {
    return "주소를 찾을 수 없어요";
  }
}
