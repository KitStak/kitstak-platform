/**
 * Small readers and word helpers for the email templates. Payloads come back from a JSON column,
 * so every value is checked before it is used. A payload that misses a needed value throws
 * `EmailPayloadError`, and the outbox marks that row as failed instead of sending half an email.
 */
import {
  CATALOG,
  formatDay,
  formatDayShort,
  formatMoney,
  productListLabel,
  toStack,
  type BillingInterval,
  type Stack,
} from '../../catalog';

export class EmailPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmailPayloadError';
  }
}

type Payload = Readonly<Record<string, unknown>>;

export function asPayload(value: unknown): Payload {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new EmailPayloadError('The email payload is not an object.');
  }
  return value as Payload;
}

/** A required text value, trimmed and cut to a sane length. */
export function text(payload: Payload, key: string, max = 200): string {
  const value = payload[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new EmailPayloadError(`The email payload has no "${key}".`);
  }
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

export function optionalText(payload: Payload, key: string, max = 200): string | null {
  const value = payload[key];
  if (typeof value !== 'string' || value.trim() === '') return null;
  return text(payload, key, max);
}

/** A required whole number of cents. */
export function cents(payload: Payload, key: string): number {
  const value = payload[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new EmailPayloadError(`The email payload has no amount "${key}".`);
  }
  return Math.trunc(value);
}

export function wholeNumber(payload: Payload, key: string): number {
  return cents(payload, key);
}

/** A required ISO date. */
export function date(payload: Payload, key: string): Date {
  const value = payload[key];
  const parsed = typeof value === 'string' || value instanceof Date ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) {
    throw new EmailPayloadError(`The email payload has no date "${key}".`);
  }
  return parsed;
}

export function optionalDate(payload: Payload, key: string): Date | null {
  const value = payload[key];
  if (value === null || value === undefined || value === '') return null;
  return date(payload, key);
}

export function stack(payload: Payload, key: string): Stack {
  const value = payload[key];
  if (!Array.isArray(value)) throw new EmailPayloadError(`The email payload has no app list "${key}".`);
  const products = toStack(value.filter((entry): entry is string => typeof entry === 'string'));
  if (products.length === 0) throw new EmailPayloadError(`The email payload has an empty app list "${key}".`);
  return products;
}

export function interval(payload: Payload, key: string): BillingInterval {
  return payload[key] === 'yearly' ? 'yearly' : 'monthly';
}

/** A portal origin with no trailing slash. Anything that is not http or https is refused. */
export function portal(payload: Payload): string {
  const value = text(payload, 'portalUrl', 500);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new EmailPayloadError('The email payload has a bad portal address.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new EmailPayloadError('The email payload has a bad portal address.');
  }
  return value.replace(/\/+$/, '');
}

/** 'Dec 7, 2026'. Emails have no viewer time zone, so dates are in UTC like the invoices. */
export function day(value: Date): string {
  return formatDay(value);
}

/** 'Dec 7'. For subjects, where short is kinder. */
export function dayShort(value: Date): string {
  return formatDayShort(value);
}

export function money(amountCents: number): string {
  return formatMoney(amountCents);
}

/** 'per month' or 'per year'. */
export function perPeriod(value: BillingInterval): string {
  return value === 'yearly' ? 'per year' : 'per month';
}

/** 'CRM and WMS'. */
export function apps(products: Stack): string {
  return productListLabel(products);
}

/** 'the card ending 4242' or 'your card'. */
export function cardWords(last4: string | null): string {
  return last4 && /^\d{4}$/.test(last4) ? `the card ending ${last4}` : 'your card';
}

/** The first word of a name, for a greeting. */
export function firstWord(name: string): string {
  return name.split(' ')[0] ?? name;
}

export const TRIAL_DAYS = CATALOG.trialDays;

export function billingFooter(orgName: string): string {
  return `You get this email because you manage billing for ${orgName} on KitStak.`;
}
