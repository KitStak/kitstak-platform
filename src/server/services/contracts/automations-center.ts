/**
 * Automations center + webhooks contracts (client-safe: zod and types only).
 * Used by `src/server/services/automations-center.ts`, `automations-webhooks.ts`, the
 * `/api/v1/automation-center/*` routes and `src/features/automations`.
 */
import { z } from 'zod';
import type { AutomationDto, AutomationRunDto } from './dto';

// Usage ----------------------------------------------------------------------------------------

/**
 * Monthly automation run allowance shown by the usage meter. There is no billing plan model yet,
 * so the allowance is informational: the engine does not stop at the limit.
 */
export const AUTOMATION_MONTHLY_ALLOWANCE = 2_500;

export interface AutomationUsageRowDto extends AutomationDto {
  readonly boardName: string;
  readonly workspaceId: string;
  readonly runsThisMonth: number;
  readonly failuresThisMonth: number;
}

export interface AutomationUsageDto {
  /** ISO timestamp of the first instant of the current (UTC) month. */
  readonly monthStart: string;
  readonly daysInMonth: number;
  /** 1-based day of the month "now" (UTC). */
  readonly dayOfMonth: number;
  readonly allowance: number;
  readonly runsThisMonth: number;
  readonly failuresThisMonth: number;
  /** Runs per UTC day of the current month (index 0 = day 1). */
  readonly daily: readonly number[];
  readonly automations: readonly AutomationUsageRowDto[];
}

// Runs -----------------------------------------------------------------------------------------

export const RUN_STATUS_FILTERS = ['succeeded', 'failed', 'skipped', 'pending'] as const;
export type RunStatusFilter = (typeof RUN_STATUS_FILTERS)[number];

export const boardRunsQuerySchema = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  status: z.enum(RUN_STATUS_FILTERS).optional(),
  automationId: z.uuid().optional(),
  /** Only runs created at or after this instant. */
  since: z.iso.datetime().optional(),
});
export type BoardRunsQuery = z.infer<typeof boardRunsQuerySchema>;

export interface BoardRunDto extends AutomationRunDto {
  readonly automationName: string;
  readonly itemName: string | null;
}

export const runAutomationSchema = z.object({
  itemId: z.uuid(),
  /** When true nothing is executed: conditions are evaluated and the planned actions returned. */
  dryRun: z.boolean().default(false),
});
export type RunAutomationInput = z.infer<typeof runAutomationSchema>;

/** Undo of a delete: brings the soft-deleted automation back with its previous on/off state. */
/** No client input: the pre-delete `enabled` state is read from the server's delete log. */
export const restoreAutomationSchema = z.object({});
export type RestoreAutomationInput = z.infer<typeof restoreAutomationSchema>;

export interface AutomationPreviewDto {
  readonly dryRun: true;
  readonly itemId: string;
  readonly itemName: string;
  readonly conditionsMet: boolean;
  readonly conditions: readonly { readonly index: number; readonly type: string; readonly holds: boolean }[];
  readonly actions: readonly { readonly index: number; readonly type: string }[];
}

export interface AutomationManualRunDto {
  readonly dryRun: false;
  readonly itemId: string;
  readonly status: 'succeeded' | 'failed' | 'skipped';
  readonly error: string | null;
}

// Webhooks -------------------------------------------------------------------------------------

export const WEBHOOK_EVENTS = ['item.created', 'item.updated', 'item.status_changed', 'item.moved'] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const WEBHOOK_EVENT_LABELS: Readonly<Record<WebhookEvent, { title: string; description: string }>> = {
  'item.created': { title: 'Item created', description: 'A new item is added to the board' },
  'item.updated': { title: 'Column value changed', description: 'Any column value of an item changes' },
  'item.status_changed': { title: 'Status changed', description: 'A status column changes label' },
  'item.moved': { title: 'Item moved to group', description: 'An item moves to another group' },
};

const webhookUrl = z
  .url({ protocol: /^https?$/, message: 'Enter a full http(s) URL, e.g. https://example.com/hooks/kitstak' })
  .max(2_048);
const webhookEvents = z
  .array(z.enum(WEBHOOK_EVENTS))
  .min(1, 'Choose at least one event')
  .max(WEBHOOK_EVENTS.length);

export const createWebhookSchema = z.object({ url: webhookUrl, events: webhookEvents });
export type CreateWebhookInput = z.infer<typeof createWebhookSchema>;

export const updateWebhookSchema = z
  .object({ url: webhookUrl.optional(), events: webhookEvents.optional(), enabled: z.boolean().optional() })
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update' });
export type UpdateWebhookInput = z.infer<typeof updateWebhookSchema>;

export interface WebhookDto {
  readonly id: string;
  readonly boardId: string | null;
  readonly url: string;
  readonly events: readonly WebhookEvent[];
  readonly enabled: boolean;
  readonly failureCount: number;
  readonly lastDeliveryAt: string | null;
  readonly lastStatus: number | null;
  readonly createdAt: string;
}

/** Returned once on create / rotate: the raw signing secret is never readable again. */
export interface WebhookSecretDto {
  readonly webhook: WebhookDto;
  readonly secret: string;
}

export interface WebhookDeliveryDto {
  readonly id: string;
  readonly webhookId: string;
  readonly kind: 'test' | 'event';
  readonly event: string;
  readonly ok: boolean;
  /** HTTP status, or null when no response was received (timeout, DNS, blocked address). */
  readonly status: number | null;
  readonly durationMs: number;
  readonly error: string | null;
  readonly requestBody: string;
  readonly responseBody: string | null;
  readonly createdAt: string;
}

export const listDeliveriesQuerySchema = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

/** Header carrying `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">`. */
export const WEBHOOK_SIGNATURE_HEADER = 'x-kitstak-signature';
