/**
 * Channel adapter contract (M12). Every store integration (Shopify, ShipStation, the KitStak
 * Sandbox) normalises its API into these shapes; the runtime (`runtime/*`) applies filters,
 * creates orders through the foundation domain and writes channel runs / missing orders.
 */
import type { ChannelSettings } from '@/lib/domain-types';
import type * as schema from '@/server/db/schema';
import type { Credentials } from './crypto';

export type ChannelConnectionRow = typeof schema.channelConnections.$inferSelect;

export interface ChannelAddress {
  readonly name: string;
  readonly firstName?: string | null;
  readonly lastName?: string | null;
  readonly company?: string | null;
  readonly line1: string;
  readonly line2?: string | null;
  readonly city: string;
  readonly state?: string | null;
  readonly zip: string;
  readonly country: string;
  readonly phone?: string | null;
}

export interface ChannelOrderLine {
  readonly sku: string | null;
  readonly title: string;
  readonly quantity: number;
  readonly price: number;
  readonly requiresShipping: boolean;
  readonly isCustom: boolean;
  readonly fulfilledQuantity: number;
}

export interface ChannelOrder {
  readonly id: string;
  /** Store order number shown to merchants, e.g. "#41200". */
  readonly number: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly financialStatus: string;
  readonly tags: readonly string[];
  readonly email: string | null;
  readonly locationId: string | null;
  readonly hasFulfillmentOrders: boolean;
  readonly shipTo: ChannelAddress | null;
  readonly lines: readonly ChannelOrderLine[];
  readonly totalPrice: number;
  readonly note: string | null;
  readonly isGift: boolean;
  readonly raw: unknown;
}

export interface ChannelProduct {
  readonly id: string;
  readonly sku: string | null;
  readonly title: string;
  readonly price: number;
  readonly barcode: string | null;
  readonly weightOz: number;
  readonly imageUrl: string | null;
}

export interface ChannelLocation {
  readonly id: string;
  readonly name: string;
}

export interface AdapterContext {
  readonly connection: ChannelConnectionRow;
  readonly credentials: Credentials | null;
  readonly settings: ChannelSettings;
  /** Monotonic run counter per method, used by the sandbox for deterministic traffic. */
  readonly runNumber: number;
  readonly now: Date;
  /** Sandbox only: the run was asked (Simulate error) to include one order with an unknown SKU. */
  readonly simulateError?: boolean;
  /** The run was started by a user (Run / Simulate error / Retry), not the scheduler. */
  readonly manual?: boolean;
}

export interface ValidateResult {
  readonly ok: boolean;
  readonly message: string;
  readonly locations: readonly ChannelLocation[];
}

export interface InventoryPush {
  readonly sellerSku: string;
  readonly channelProductId: string;
  readonly qty: number;
}

export interface ShipmentPush {
  readonly channelOrderId: string;
  readonly storeOrderNumber: string;
  readonly trackingNumber: string;
  readonly carrier: string;
  readonly lines: readonly { readonly sku: string; readonly quantity: number }[];
}

export interface ChannelAdapter {
  readonly key: string;
  validate(ctx: Omit<AdapterContext, 'runNumber' | 'settings'>): Promise<ValidateResult>;
  fetchOrders(ctx: AdapterContext, since: string | null): Promise<readonly ChannelOrder[]>;
  /** Re-fetches specific orders (Retry Download). */
  fetchOrdersById(ctx: AdapterContext, ids: readonly string[]): Promise<readonly ChannelOrder[]>;
  fetchProducts(ctx: AdapterContext): Promise<readonly ChannelProduct[]>;
  pushInventory(
    ctx: AdapterContext,
    items: readonly InventoryPush[],
  ): Promise<readonly { readonly sellerSku: string; readonly ok: boolean; readonly error?: string }[]>;
  pushShipment(
    ctx: AdapterContext,
    shipment: ShipmentPush,
  ): Promise<{ readonly ok: boolean; readonly error?: string }>;
}

/** HTTP failure from a store API; 401/403 mark the run Unauthorized. */
export class ChannelApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ChannelApiError';
    this.status = status;
  }
}

export async function fetchJson(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 20_000);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (!res.ok) {
      const detail =
        typeof body === 'object' && body && 'errors' in body
          ? JSON.stringify((body as { errors: unknown }).errors).slice(0, 300)
          : String(text).slice(0, 300);
      throw new ChannelApiError(`${res.status} ${res.statusText}${detail ? `: ${detail}` : ''}`, res.status);
    }
    return body;
  } catch (error) {
    if (error instanceof ChannelApiError) throw error;
    if (error instanceof Error && error.name === 'AbortError')
      throw new ChannelApiError('The store did not respond within 20 seconds', 504);
    throw new ChannelApiError(
      error instanceof Error ? `Couldn't reach the store: ${error.message}` : "Couldn't reach the store",
      502,
    );
  } finally {
    clearTimeout(timer);
  }
}

export const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
};
export const strOrNull = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null;
export const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
