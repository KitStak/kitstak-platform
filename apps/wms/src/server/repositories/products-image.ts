/**
 * Product image proxy (M09). Product `imageUrl` values point at arbitrary merchant CDNs
 * (Shopify, Amazon, …) which the app CSP (`img-src 'self' data: blob:`) blocks. The grid,
 * wizard preview, detail header and listings render them through
 * `GET /api/products/image?u=<url>` instead, so they load same-origin.
 *
 * SSRF hardening (the server fetches a URL a user typed):
 * - http/https only, default ports only, no credentials in the URL, length ≤ 2000;
 * - every resolved address is checked at connect time (custom `lookup`, so DNS rebinding
 *   between check and connect is impossible) and loopback / private / link-local / CGNAT /
 *   multicast / reserved / IPv4-mapped ranges are refused;
 * - redirects are followed manually (≤ 3) and each hop is re-validated;
 * - 8 s timeout, 5 MB cap, raster image content types only (no SVG: it can carry script).
 * Responses are cached in memory (LRU, 300 entries / 40 MB) so a grid page costs one fetch per image.
 */
import { lookup as dnsLookup } from 'node:dns';
import type { LookupAddress } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const IMAGE_TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 3;
const CACHE_MAX_ENTRIES = 300;
const CACHE_MAX_BYTES = 40 * 1024 * 1024;

export const ALLOWED_IMAGE_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/jpg',
  'image/pjpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/x-icon',
  'image/vnd.microsoft.icon',
]);

export class ImageProxyError extends Error {
  constructor(
    readonly status: 400 | 404 | 413 | 415 | 502 | 504,
    message: string,
  ) {
    super(message);
  }
}

/** Parses and validates a user-supplied image URL (scheme, port, credentials, host). */
export function parseImageUrl(raw: string): URL {
  if (raw.length > 2000) throw new ImageProxyError(400, 'Image URL is too long');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ImageProxyError(400, 'Enter a full image URL (https://…)');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw new ImageProxyError(400, 'Only http and https image URLs are supported');
  if (url.username || url.password) throw new ImageProxyError(400, 'Image URLs cannot contain credentials');
  if (url.port && !['80', '443'].includes(url.port))
    throw new ImageProxyError(400, 'Image URLs must use the default port');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    !host ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    throw new ImageProxyError(400, 'This image host is not allowed');
  }
  if (net.isIP(host) && isBlockedAddress(host))
    throw new ImageProxyError(400, 'This image host is not allowed');
  return url;
}

function ipv4Parts(ip: string): number[] | null {
  const parts = ip.split('.').map(Number);
  return parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? parts : null;
}

/** True for any address a server-side fetch must never reach. */
export function isBlockedAddress(address: string): boolean {
  const ip =
    address
      .toLowerCase()
      .replace(/^\[|\]$/g, '')
      .split('%')[0] ?? '';
  if (net.isIPv4(ip)) {
    const [a = 0, b = 0, c = 0] = ipv4Parts(ip) ?? [];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 || // this-net, private, loopback, multicast + reserved
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      (a === 169 && b === 254) || // link-local / cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) || // IETF protocol assignments, TEST-NET-1
      (a === 198 && (b === 18 || b === 19)) || // benchmarking
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113)
    ); // TEST-NET-2/3
  }
  if (net.isIPv6(ip)) {
    if (ip === '::' || ip === '::1') return true;
    const mapped = /^::ffff:(?:0:)?([0-9.]+)$/.exec(ip);
    if (mapped?.[1]) return isBlockedAddress(mapped[1]);
    if (/^::ffff:/.test(ip)) return true; // hex-form mapped addresses
    const head = parseInt(ip.split(':')[0] || '0', 16);
    return (
      (head & 0xfe00) === 0xfc00 || // fc00::/7 unique local
      (head & 0xffc0) === 0xfe80 || // fe80::/10 link-local
      (head & 0xffc0) === 0xfec0 || // site-local (deprecated)
      (head & 0xff00) === 0xff00 || // multicast
      (head === 0x2001 && parseInt(ip.split(':')[1] || '0', 16) === 0x0db8) || // documentation
      head === 0x0064 ||
      head === 0
    ); // NAT64 well-known prefix, other ::/8
  }
  return true;
}

type LookupCb = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

/** `dns.lookup` that refuses blocked addresses; used by the socket itself (no rebinding window). */
export function guardedLookup(hostname: string, options: object, callback: LookupCb): void {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, []);
    const list = (addresses as LookupAddress[]).filter((a) => !isBlockedAddress(a.address));
    if (!list.length) {
      const blocked = Object.assign(new Error('This image host is not allowed'), {
        code: 'EBLOCKED',
      }) as NodeJS.ErrnoException;
      return callback(blocked, []);
    }
    if ((options as { all?: boolean }).all) return callback(null, list);
    const first = list[0] as LookupAddress;
    return callback(null, first.address, first.family);
  });
}

export interface FetchedImage {
  readonly contentType: string;
  readonly bytes: Buffer;
}

function requestOnce(
  url: URL,
  deadline: number,
): Promise<{ status: number; location: string | null; contentType: string; bytes: Buffer }> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const remaining = Math.max(1, deadline - Date.now());
    const req = lib.request(
      url,
      {
        method: 'GET',
        lookup: guardedLookup as never,
        timeout: remaining,
        headers: {
          'user-agent': 'KitStaksWMS-ImageProxy/1.0',
          accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8',
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          resolve({
            status,
            location: res.headers.location ?? null,
            contentType: '',
            bytes: Buffer.alloc(0),
          });
          return;
        }
        const contentType =
          String(res.headers['content-type'] ?? '')
            .split(';')[0]
            ?.trim()
            .toLowerCase() ?? '';
        const declared = Number(res.headers['content-length'] ?? 0);
        if (status === 200 && declared > IMAGE_MAX_BYTES) {
          res.destroy();
          reject(new ImageProxyError(413, 'The image is larger than 5 MB'));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > IMAGE_MAX_BYTES) {
            res.destroy();
            reject(new ImageProxyError(413, 'The image is larger than 5 MB'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => resolve({ status, location: null, contentType, bytes: Buffer.concat(chunks) }));
        res.on('error', (e) => reject(e));
      },
    );
    req.on('timeout', () => req.destroy(new ImageProxyError(504, 'The image host did not respond in time')));
    req.on('error', (e) =>
      reject(
        e instanceof ImageProxyError
          ? e
          : (e as NodeJS.ErrnoException).code === 'EBLOCKED'
            ? new ImageProxyError(400, 'This image host is not allowed')
            : new ImageProxyError(502, 'The image could not be loaded'),
      ),
    );
    req.end();
  });
}

/** Fetches and validates a remote product image (follows ≤ 3 re-validated redirects). */
export async function fetchRemoteImage(raw: string): Promise<FetchedImage> {
  let url = parseImageUrl(raw);
  const deadline = Date.now() + IMAGE_TIMEOUT_MS;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const r = await requestOnce(url, deadline);
    if (r.status >= 300 && r.status < 400) {
      if (!r.location)
        throw new ImageProxyError(502, 'The image host returned a redirect without a location');
      url = parseImageUrl(new URL(r.location, url).toString());
      continue;
    }
    if (r.status === 404 || r.status === 410) throw new ImageProxyError(404, 'The image was not found');
    if (r.status !== 200) throw new ImageProxyError(502, `The image host answered ${r.status}`);
    if (!ALLOWED_IMAGE_TYPES.has(r.contentType))
      throw new ImageProxyError(
        415,
        'The URL does not point to a supported image (JPEG, PNG, GIF, WebP, AVIF)',
      );
    return {
      contentType:
        r.contentType === 'image/jpg' || r.contentType === 'image/pjpeg' ? 'image/jpeg' : r.contentType,
      bytes: r.bytes,
    };
  }
  throw new ImageProxyError(502, 'Too many redirects');
}

/* ------------------------------------------------------------------ cache */

const cache = new Map<string, FetchedImage & { readonly at: number }>();
let cacheBytes = 0;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const inflight = new Map<string, Promise<FetchedImage>>();

function remember(key: string, img: FetchedImage): void {
  if (img.bytes.length > CACHE_MAX_BYTES / 4) return;
  const prev = cache.get(key);
  if (prev) cacheBytes -= prev.bytes.length;
  cache.delete(key);
  cache.set(key, { ...img, at: Date.now() });
  cacheBytes += img.bytes.length;
  while (cache.size > CACHE_MAX_ENTRIES || cacheBytes > CACHE_MAX_BYTES) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    cacheBytes -= cache.get(oldest)?.bytes.length ?? 0;
    cache.delete(oldest);
  }
}

/** Cached + de-duplicated `fetchRemoteImage` (concurrent grid requests share one fetch). */
export async function getProductImage(
  raw: string,
  fetcher: (u: string) => Promise<FetchedImage> = fetchRemoteImage,
): Promise<FetchedImage> {
  const key = raw.trim();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const pending = inflight.get(key);
  if (pending) return pending;
  const run = fetcher(key)
    .then((img) => {
      remember(key, img);
      return img;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, run);
  return run;
}

/** Test hook. */
export function clearProductImageCache(): void {
  cache.clear();
  cacheBytes = 0;
  inflight.clear();
}
