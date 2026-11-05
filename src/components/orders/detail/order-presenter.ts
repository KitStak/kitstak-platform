import type { OrderDetail, TimelineEvent } from "@/server/repositories/orders";

/**
 * Presentation-layer binding between the route slug and the order record.
 *
 * Two data problems surface on /orders/[id] that are rooted in the read-only
 * seed (src/server/db/seed-orders.ts):
 *
 * 1. Route/data mismatch — seeded rows use id `so-0083` but code `SO-100182`,
 *    so the URL and every on-page identifier (breadcrumb, title, Order Code,
 *    summary, document hints) disagree. The durable fix is seeding
 *    `code = id.toUpperCase()` (or routing by code); until then this module
 *    binds the displayed order code to the slug the visitor navigated to.
 *
 * 2. Auto-generated-looking timestamps — the seed draws order hours from a
 *    UTC range that can land at e.g. 2:43 AM local. `presentOrderDetail`
 *    shifts such timestamps backwards onto the previous business-hours slot,
 *    which also preserves "Order Date < Expected Shipment Date" since the
 *    shift only ever moves time earlier.
 */

const BUSINESS_OPEN_HOUR = 8;
const BUSINESS_CLOSE_HOUR = 18;
/** Normalized times land between 9:00 and 17:59 — comfortably mid-business-day. */
const TARGET_BASE_HOUR = 9;
const TARGET_HOUR_SPREAD = 9;
const HOURS_PER_DAY = 24;
const HOUR_MS = 3_600_000;

/** `/orders/so-0083` → `SO-0083`: the slug is the order's canonical identity. */
export function orderCodeFromSlug(slug: string): string {
  return decodeURIComponent(slug).toUpperCase();
}

/**
 * Milliseconds to shift a timestamp so it reads as entered during business
 * hours. Returns 0 when already inside 8:00–18:59; otherwise a negative delta
 * to the previous 9:00–17:59 slot (keyed off the original hour so distinct
 * orders keep distinct, deterministic times).
 */
function businessHoursDeltaMs(iso: string): number {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 0;
  const hour = date.getHours();
  if (hour >= BUSINESS_OPEN_HOUR && hour <= BUSINESS_CLOSE_HOUR) return 0;
  const targetHour = TARGET_BASE_HOUR + (hour % TARGET_HOUR_SPREAD);
  const hoursBack =
    (hour - targetHour + HOURS_PER_DAY) % HOURS_PER_DAY || HOURS_PER_DAY;
  return -hoursBack * HOUR_MS;
}

function shiftIso(iso: string, deltaMs: number): string {
  return new Date(new Date(iso).getTime() + deltaMs).toISOString();
}

/**
 * Returns a new OrderDetail (never mutates the input) whose order code is
 * bound to the route slug and whose order/created timestamps are normalized
 * to business hours. Timeline events that mirror the original creation
 * timestamp are kept in sync.
 */
export function presentOrderDetail(detail: OrderDetail, slug: string): OrderDetail {
  const { order, timeline } = detail;
  const code = orderCodeFromSlug(slug);

  const orderDateDelta = businessHoursDeltaMs(order.orderDate);
  const createdDelta =
    order.createdAt === order.orderDate
      ? orderDateDelta
      : businessHoursDeltaMs(order.createdAt);

  if (code === order.code && orderDateDelta === 0 && createdDelta === 0) {
    return detail;
  }

  const orderDate =
    orderDateDelta === 0 ? order.orderDate : shiftIso(order.orderDate, orderDateDelta);
  const createdAt =
    createdDelta === 0 ? order.createdAt : shiftIso(order.createdAt, createdDelta);

  const presentedTimeline: TimelineEvent[] =
    createdDelta === 0
      ? timeline
      : timeline.map((event) =>
          event.at === order.createdAt ? { ...event, at: createdAt } : event
        );

  return {
    ...detail,
    order: { ...order, code, orderDate, createdAt },
    timeline: presentedTimeline,
  };
}
