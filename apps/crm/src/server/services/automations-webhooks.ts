/**
 * Board webhooks: CRUD on the existing `webhooks` table, signing secrets (shown once, stored
 * AES-256-GCM encrypted), HMAC-signed deliveries, test deliveries and a delivery log.
 *
 * Delivery log: there is no dedicated deliveries table, so every attempt is appended to
 * `audit_log` (`action = 'webhook.delivery'`, `target = webhook`). Outbound calls are data
 * egress, so keeping them in the security trail is intentional.
 *
 * SSRF: only http(s) URLs; in production, hosts resolving to loopback / private / link-local
 * addresses are refused and https is required. Redirects are never followed; 5s timeout.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { and, desc, eq, lt, or, sql, type SQL } from 'drizzle-orm';
import type { Executor } from '@/server/db';
import { auditLog, webhooks } from '@/server/db/schema';
import { env } from '@/server/env';
import { NotFoundError, ValidationError } from '@/server/http/errors';
import { logger } from '@/server/logger';
import { requireBoard } from './access';
import type { ServiceContext } from './context';
import {
  WEBHOOK_EVENTS,
  WEBHOOK_SIGNATURE_HEADER,
  type CreateWebhookInput,
  type UpdateWebhookInput,
  type WebhookDeliveryDto,
  type WebhookDto,
  type WebhookEvent,
  type WebhookSecretDto,
} from './contracts/automations-center';
import { DeliveryTimeoutError, EgressBlockedError, postWebhook } from './automations-webhooks-transport';
import type { ItemEvent } from './item-events';
import { decodeCursor, encodeCursor, timeIdCursorSchema, toPage, type Page } from './pagination';

const DELIVERY_TIMEOUT_MS = 5_000;
const MAX_LOGGED_BODY = 4_000;
const MAX_LOGGED_RESPONSE = 1_000;
const MAX_WEBHOOKS_PER_BOARD = 20;
const DELIVERY_ACTION = 'webhook.delivery';

export type WebhookRow = typeof webhooks.$inferSelect;

// Secrets --------------------------------------------------------------------------------------

let warnedLegacyKdf = false;

/**
 * Webhook-secret KDF (auth review 2026-11-11, M6): prefers the dedicated
 * `WEBHOOK_KDF_SECRET` so the webhook vault is decoupled from the platform-wide
 * `BETTER_AUTH_SECRET` (shared across WMS/CRM/portal envs — compromise of any of them
 * must not disclose webhook secrets, and rotating it must not brick decryption).
 * The legacy derivation stays as a fallback for existing deployments; switching to the
 * dedicated secret requires a one-time re-encrypt of `webhooks.secret_ciphertext`.
 */
function encryptionKey(): Buffer {
  const dedicated = env.WEBHOOK_KDF_SECRET;
  if (dedicated) {
    return createHash('sha256').update(`kitstak:webhook-secret:v1:${dedicated}`).digest();
  }
  if (!warnedLegacyKdf) {
    warnedLegacyKdf = true;
    logger.warn('webhook.kdf.legacy_secret', {
      message:
        'WEBHOOK_KDF_SECRET is not set — webhook secrets are encrypted with a key derived from the ' +
        'shared BETTER_AUTH_SECRET (deprecated). Set WEBHOOK_KDF_SECRET and re-encrypt webhook secrets.',
    });
  }
  return createHash('sha256').update(`kitstak:webhook-secret:v1:${env.BETTER_AUTH_SECRET}`).digest();
}

export function encryptSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

export function decryptSecret(payload: string): string {
  const [version, iv, tag, ciphertext] = payload.split(':');
  if (version !== 'v1' || !iv || !tag || !ciphertext) throw new Error('Unsupported webhook secret format');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString(
    'utf8',
  );
}

function newSecret(): string {
  return `whsec_${randomBytes(24).toString('base64url')}`;
}

/** `t=<seconds>,v1=<hex>` where v1 = HMAC-SHA256(secret, "<t>.<body>"). Receivers recompute it. */
export function signPayload(secret: string, body: string, timestampSeconds: number): string {
  const digest = createHmac('sha256', secret).update(`${timestampSeconds}.${body}`).digest('hex');
  return `t=${timestampSeconds},v1=${digest}`;
}

// URL safety -----------------------------------------------------------------------------------

/** True for loopback, private (RFC 1918 / ULA), link-local, CGNAT and unspecified addresses. */
export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const [a = 0, b = 0] = address.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  if (version === 6) {
    const lower = address.toLowerCase();
    if (lower === '::' || lower === '::1') return true;
    if (lower.startsWith('::ffff:')) return isPrivateAddress(lower.slice(7));
    return /^(fc|fd|fe8|fe9|fea|feb)/.test(lower);
  }
  return true;
}

const strictEgress = () => env.NODE_ENV === 'production';

/** Throws a ValidationError when the URL may not be called. Returns the parsed URL. */
export async function assertDeliverableUrl(raw: string, options: { resolve?: boolean } = {}): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ValidationError([{ path: 'url', message: 'Enter a valid URL' }]);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ValidationError([{ path: 'url', message: 'Only http(s) URLs are supported' }]);
  }
  if (url.username || url.password) {
    throw new ValidationError([
      { path: 'url', message: 'Credentials in the URL are not allowed; use the signing secret' },
    ]);
  }
  if (!strictEgress()) return url;
  if (url.protocol !== 'https:')
    throw new ValidationError([{ path: 'url', message: 'Webhook URLs must use https' }]);
  if (options.resolve !== false) {
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = isIP(host)
      ? [host]
      : (await lookup(host, { all: true }).catch(() => [] as { address: string }[])).map((a) => a.address);
    if (addresses.length === 0)
      throw new ValidationError([{ path: 'url', message: 'The host name does not resolve' }]);
    if (addresses.some(isPrivateAddress)) {
      throw new ValidationError([
        { path: 'url', message: 'Private and internal network addresses are not allowed' },
      ]);
    }
  }
  return url;
}

// Mapping --------------------------------------------------------------------------------------

function toWebhookDto(row: WebhookRow): WebhookDto {
  return {
    id: row.id,
    boardId: row.boardId,
    url: row.url,
    events: row.events.filter((event): event is WebhookEvent =>
      (WEBHOOK_EVENTS as readonly string[]).includes(event),
    ),
    enabled: row.enabled,
    failureCount: row.failureCount,
    lastDeliveryAt: row.lastDeliveryAt?.toISOString() ?? null,
    lastStatus: row.lastStatus,
    createdAt: row.createdAt.toISOString(),
  };
}

async function requireWebhook(ctx: ServiceContext, webhookId: string): Promise<WebhookRow> {
  const [row] = await ctx.db
    .select()
    .from(webhooks)
    .where(and(eq(webhooks.id, webhookId), eq(webhooks.orgId, ctx.orgId)))
    .limit(1);
  if (!row) throw new NotFoundError('Webhook');
  if (row.boardId) {
    try {
      await requireBoard(ctx, row.boardId, 'read');
    } catch {
      throw new NotFoundError('Webhook');
    }
  }
  return row;
}

// CRUD -----------------------------------------------------------------------------------------

export async function listWebhooks(ctx: ServiceContext, boardId: string): Promise<WebhookDto[]> {
  await requireBoard(ctx, boardId, 'read');
  const rows = await ctx.db
    .select()
    .from(webhooks)
    .where(and(eq(webhooks.orgId, ctx.orgId), eq(webhooks.boardId, boardId)))
    .orderBy(webhooks.createdAt);
  return rows.map(toWebhookDto);
}

export async function createWebhook(
  ctx: ServiceContext,
  boardId: string,
  input: CreateWebhookInput,
): Promise<WebhookSecretDto> {
  await requireBoard(ctx, boardId, 'write');
  await assertDeliverableUrl(input.url);
  const [count] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(webhooks)
    .where(and(eq(webhooks.orgId, ctx.orgId), eq(webhooks.boardId, boardId)));
  if ((count?.n ?? 0) >= MAX_WEBHOOKS_PER_BOARD) {
    throw new ValidationError([
      { path: 'url', message: `A board can have at most ${MAX_WEBHOOKS_PER_BOARD} webhooks` },
    ]);
  }
  const secret = newSecret();
  const [row] = await ctx.db
    .insert(webhooks)
    .values({
      orgId: ctx.orgId,
      boardId,
      url: input.url,
      events: [...new Set(input.events)],
      secretCiphertext: encryptSecret(secret),
      createdBy: ctx.userId,
    })
    .returning();
  if (!row) throw new Error('Webhook insert returned no row');
  return { webhook: toWebhookDto(row), secret };
}

export async function updateWebhook(
  ctx: ServiceContext,
  webhookId: string,
  input: UpdateWebhookInput,
): Promise<WebhookDto> {
  const existing = await requireWebhook(ctx, webhookId);
  if (existing.boardId) await requireBoard(ctx, existing.boardId, 'write');
  if (input.url !== undefined) await assertDeliverableUrl(input.url);
  const [row] = await ctx.db
    .update(webhooks)
    .set({
      ...(input.url !== undefined && { url: input.url }),
      ...(input.events !== undefined && { events: [...new Set(input.events)] }),
      ...(input.enabled !== undefined && { enabled: input.enabled }),
      // Re-enabling resets the consecutive failure counter.
      ...(input.enabled === true && { failureCount: 0 }),
      updatedAt: new Date(),
    })
    .where(and(eq(webhooks.id, webhookId), eq(webhooks.orgId, ctx.orgId)))
    .returning();
  if (!row) throw new NotFoundError('Webhook');
  return toWebhookDto(row);
}

export async function rotateWebhookSecret(ctx: ServiceContext, webhookId: string): Promise<WebhookSecretDto> {
  const existing = await requireWebhook(ctx, webhookId);
  if (existing.boardId) await requireBoard(ctx, existing.boardId, 'write');
  const secret = newSecret();
  const [row] = await ctx.db
    .update(webhooks)
    .set({ secretCiphertext: encryptSecret(secret), updatedAt: new Date() })
    .where(and(eq(webhooks.id, webhookId), eq(webhooks.orgId, ctx.orgId)))
    .returning();
  if (!row) throw new NotFoundError('Webhook');
  return { webhook: toWebhookDto(row), secret };
}

export async function deleteWebhook(ctx: ServiceContext, webhookId: string): Promise<{ id: string }> {
  const existing = await requireWebhook(ctx, webhookId);
  if (existing.boardId) await requireBoard(ctx, existing.boardId, 'write');
  await ctx.db.delete(webhooks).where(and(eq(webhooks.id, webhookId), eq(webhooks.orgId, ctx.orgId)));
  return { id: webhookId };
}

// Delivery -------------------------------------------------------------------------------------

export interface DeliveryPayload {
  readonly event: string;
  readonly boardId: string | null;
  readonly data: Record<string, unknown>;
}

interface DeliveryMetadata {
  readonly kind: 'test' | 'event';
  readonly attempt: number;
  readonly event: string;
  readonly ok: boolean;
  readonly status: number | null;
  readonly durationMs: number;
  readonly error: string | null;
  readonly requestBody: string;
  readonly responseBody: string | null;
}

function firstIssue(error: ValidationError): string {
  const issues = (error.details as { issues?: readonly { message: string }[] } | undefined)?.issues;
  return issues?.[0]?.message ?? error.message;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/** Perform one HTTP delivery and record it. Never throws; the outcome is returned. */
export async function deliverWebhook(
  executor: Executor,
  row: WebhookRow,
  actorId: string | null,
  kind: 'test' | 'event',
  payload: DeliveryPayload,
  options: { deliveryId?: string; attempt?: number } = {},
): Promise<WebhookDeliveryDto> {
  const deliveryId = options.deliveryId ?? randomUUID();
  const attempt = options.attempt ?? 1;
  const body = JSON.stringify({
    id: deliveryId,
    event: payload.event,
    createdAt: new Date().toISOString(),
    orgId: row.orgId,
    boardId: payload.boardId,
    test: kind === 'test',
    data: payload.data,
  });
  const started = Date.now();
  let status: number | null = null;
  let responseBody: string | null = null;
  let error: string | null = null;
  try {
    // DNS is resolved and checked inside the socket lookup (pinned), not separately here.
    const url = await assertDeliverableUrl(row.url, { resolve: false });
    const secret = decryptSecret(row.secretCiphertext);
    const response = await postWebhook(
      url,
      {
        'content-type': 'application/json',
        'user-agent': 'KitStak-Webhooks/1.0',
        'x-kitstak-event': payload.event,
        'x-kitstak-delivery': deliveryId,
        ...(attempt > 1 && { 'x-kitstak-attempt': String(attempt) }),
        [WEBHOOK_SIGNATURE_HEADER]: signPayload(secret, body, Math.floor(started / 1000)),
      },
      body,
      {
        timeoutMs: DELIVERY_TIMEOUT_MS,
        maxResponseBytes: MAX_LOGGED_RESPONSE,
        blockPrivate: strictEgress(),
        isPrivateAddress,
      },
    );
    status = response.status;
    responseBody = truncate(response.body, MAX_LOGGED_RESPONSE);
    if (status >= 300 && status < 400) error = 'The endpoint redirected; webhooks do not follow redirects';
    else if (status < 200 || status >= 300) error = `The endpoint answered HTTP ${status}`;
  } catch (cause) {
    if (cause instanceof ValidationError) error = firstIssue(cause);
    else if (cause instanceof EgressBlockedError || cause instanceof DeliveryTimeoutError) error = cause.message;
    else error = 'Could not connect to the endpoint';
  }
  const durationMs = Date.now() - started;
  const ok = error === null && status !== null && status >= 200 && status < 300;
  const metadata: DeliveryMetadata = {
    kind,
    attempt,
    event: payload.event,
    ok,
    status,
    durationMs,
    error,
    requestBody: truncate(body, MAX_LOGGED_BODY),
    responseBody,
  };
  try {
    const [logged] = await executor
      .insert(auditLog)
      .values({
        orgId: row.orgId,
        actorId,
        action: DELIVERY_ACTION,
        targetType: 'webhook',
        targetId: row.id,
        metadata: { ...metadata },
      })
      .returning({ id: auditLog.id, createdAt: auditLog.createdAt });
    await executor
      .update(webhooks)
      .set({
        lastDeliveryAt: new Date(),
        lastStatus: status,
        failureCount: ok ? 0 : sql`${webhooks.failureCount} + 1`,
      })
      .where(eq(webhooks.id, row.id));
    return {
      id: logged?.id ?? deliveryId,
      webhookId: row.id,
      ...metadata,
      createdAt: (logged?.createdAt ?? new Date()).toISOString(),
    };
  } catch (logError) {
    logger.error('webhooks.log_failed', { webhookId: row.id, error: logError });
    return { id: deliveryId, webhookId: row.id, ...metadata, createdAt: new Date().toISOString() };
  }
}

export async function testWebhook(ctx: ServiceContext, webhookId: string): Promise<WebhookDeliveryDto> {
  const row = await requireWebhook(ctx, webhookId);
  return deliverWebhook(ctx.db, row, ctx.userId, 'test', {
    event: 'webhook.test',
    boardId: row.boardId,
    data: {
      message: 'This is a test delivery from KitStak. Verify the signature header to trust real events.',
    },
  });
}

function toDeliveryDto(row: typeof auditLog.$inferSelect): WebhookDeliveryDto {
  const meta = row.metadata as Partial<DeliveryMetadata>;
  return {
    id: row.id,
    webhookId: row.targetId ?? '',
    kind: meta.kind === 'test' ? 'test' : 'event',
    event: typeof meta.event === 'string' ? meta.event : 'unknown',
    ok: meta.ok === true,
    status: typeof meta.status === 'number' ? meta.status : null,
    durationMs: typeof meta.durationMs === 'number' ? meta.durationMs : 0,
    error: typeof meta.error === 'string' ? meta.error : null,
    requestBody: typeof meta.requestBody === 'string' ? meta.requestBody : '',
    responseBody: typeof meta.responseBody === 'string' ? meta.responseBody : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listWebhookDeliveries(
  ctx: ServiceContext,
  webhookId: string,
  query: { cursor?: string; limit: number },
): Promise<Page<WebhookDeliveryDto>> {
  await requireWebhook(ctx, webhookId);
  const cursor = decodeCursor(query.cursor, timeIdCursorSchema);
  const conditions: SQL[] = [
    eq(auditLog.orgId, ctx.orgId),
    eq(auditLog.action, DELIVERY_ACTION),
    eq(auditLog.targetType, 'webhook'),
    eq(auditLog.targetId, webhookId),
  ];
  if (cursor) {
    const at = new Date(cursor[0]);
    conditions.push(
      or(lt(auditLog.createdAt, at), and(eq(auditLog.createdAt, at), lt(auditLog.id, cursor[1]))) as SQL,
    );
  }
  const rows = await ctx.db
    .select()
    .from(auditLog)
    .where(and(...conditions))
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(query.limit + 1);
  const page = toPage(rows, query.limit, (row) => encodeCursor([row.createdAt.toISOString(), row.id]));
  return { nextCursor: page.nextCursor, items: page.items.map(toDeliveryDto) };
}

// Item events → deliveries ---------------------------------------------------------------------

/** Webhook event names an item event maps to (pure; exported for tests). */
export function webhookEventsFor(event: ItemEvent): WebhookEvent[] {
  switch (event.type) {
    case 'item_created':
      return ['item.created'];
    case 'column_changed':
      return event.columnType === 'status' ? ['item.updated', 'item.status_changed'] : ['item.updated'];
    case 'item_moved':
      return ['item.moved'];
    default:
      return [];
  }
}

export function webhookEventData(event: ItemEvent): Record<string, unknown> {
  return Object.fromEntries(Object.entries(event).filter(([key]) => key !== 'type' && key !== 'boardId'));
}
