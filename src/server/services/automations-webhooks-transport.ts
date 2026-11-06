/**
 * Outbound webhook HTTP transport (node:http / node:https, no redirects).
 *
 * DNS pinning: the address is resolved and checked inside the socket's own `lookup`, so the
 * address that passed the private-network check is exactly the one connected to (no DNS
 * rebinding window between check and request). The response body is streamed and reading stops
 * at `maxResponseBytes`.
 */
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { LookupFunction } from 'node:net';
import { isIP } from 'node:net';

export class EgressBlockedError extends Error {
  constructor() {
    super('Private and internal network addresses are not allowed');
    this.name = 'EgressBlockedError';
  }
}

export class DeliveryTimeoutError extends Error {
  constructor(ms: number) {
    super(`No response within ${ms / 1000}s`);
    this.name = 'DeliveryTimeoutError';
  }
}

export interface PostOptions {
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
  /** Refuse private / loopback / link-local targets (production). */
  readonly blockPrivate: boolean;
  readonly isPrivateAddress: (address: string) => boolean;
}

export interface PostResult {
  readonly status: number;
  readonly body: string;
}

/** A `lookup` that validates every resolved address before the socket uses it. */
export function pinnedLookup(isPrivate: (address: string) => boolean): LookupFunction {
  return (hostname, options, callback) => {
    dnsLookup(hostname, { ...options, all: true }, (error, addresses: LookupAddress[]) => {
      if (error) return callback(error, '', 0);
      if (addresses.length === 0 || addresses.some((entry) => isPrivate(entry.address))) {
        return callback(new EgressBlockedError(), '', 0);
      }
      if ((options as { all?: boolean }).all) {
        return (callback as unknown as (err: null, list: LookupAddress[]) => void)(null, addresses);
      }
      const first = addresses[0] as LookupAddress;
      return callback(null, first.address, first.family);
    });
  };
}

async function readCapped(response: IncomingMessage, maxBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of response) {
    const buffer = chunk as Buffer;
    const room = maxBytes - size;
    if (room <= 0) break;
    chunks.push(buffer.subarray(0, room));
    size += Math.min(buffer.length, room);
    if (size >= maxBytes) break;
  }
  response.destroy();
  return Buffer.concat(chunks).toString('utf8');
}

export function postWebhook(
  url: URL,
  headers: Record<string, string>,
  body: string,
  options: PostOptions,
): Promise<PostResult> {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (options.blockPrivate && isIP(host) && options.isPrivateAddress(host)) {
    return Promise.reject(new EgressBlockedError());
  }
  const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise<PostResult>((resolve, reject) => {
    const req = send(
      url,
      {
        method: 'POST',
        headers: { ...headers, 'content-length': String(Buffer.byteLength(body)) },
        ...(options.blockPrivate && !isIP(host) && { lookup: pinnedLookup(options.isPrivateAddress) }),
      },
      (response) => {
        readCapped(response, options.maxResponseBytes).then(
          (text) => resolve({ status: response.statusCode ?? 0, body: text }),
          (error: unknown) => reject(error),
        );
      },
    );
    const timer = setTimeout(() => {
      req.destroy(new DeliveryTimeoutError(options.timeoutMs));
    }, options.timeoutMs);
    req.on('error', (error) => reject(error));
    req.on('close', () => clearTimeout(timer));
    req.end(body);
  });
}
