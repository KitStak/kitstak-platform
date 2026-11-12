/**
 * Human field messages for the shipment-order API (POST/PATCH /api/orders): the same copy the
 * wizard shows ("Enter address line 1", "Choose a warehouse"), never raw zod text such as
 * "Invalid input: expected string, received undefined".
 */
import type { z } from 'zod';
import { fromZodError } from '@/server/api/errors';

const LABELS: Readonly<
  Record<string, { readonly label: string; readonly verb: 'Enter' | 'Choose' | 'Add' }>
> = {
  warehouseId: { label: 'a warehouse', verb: 'Choose' },
  clientId: { label: 'a client', verb: 'Choose' },
  code: { label: 'an order code', verb: 'Enter' },
  orderTypeId: { label: 'an order type', verb: 'Choose' },
  orderType: { label: 'an order type', verb: 'Choose' },
  orderDate: { label: 'the order date', verb: 'Choose' },
  expectedShipDate: { label: 'the expected shipment date', verb: 'Choose' },
  customerName: { label: 'the customer name', verb: 'Enter' },
  customerEmail: { label: 'a valid email', verb: 'Enter' },
  shipAddress: { label: 'address line 1', verb: 'Enter' },
  shipCity: { label: 'a city', verb: 'Enter' },
  shipState: { label: 'a state', verb: 'Choose' },
  shipZip: { label: 'a postal code', verb: 'Enter' },
  shipCountry: { label: 'a country', verb: 'Choose' },
  lines: { label: 'at least one product', verb: 'Add' },
  productId: { label: 'a product', verb: 'Choose' },
  quantity: { label: 'a quantity', verb: 'Enter' },
  unitPrice: { label: 'a price', verb: 'Enter' },
  version: { label: 'the current version (reload the page)', verb: 'Enter' },
};

type Issue = Parameters<NonNullable<z.core.ParseContext<z.core.$ZodIssue>['error']>>[0];

/** Field-aware message for one zod issue; undefined keeps zod's default. */
export function humanOrderIssue(issue: Issue): string | undefined {
  const last = [...(issue.path ?? [])].reverse().find((p) => typeof p === 'string') as string | undefined;
  const meta = last ? LABELS[last] : undefined;
  const missing = issue.input === undefined || issue.input === null || issue.input === '';
  if (
    meta &&
    (missing ||
      issue.code === 'invalid_type' ||
      (issue.code === 'too_small' && typeof issue.input === 'string'))
  )
    return `${meta.verb} ${meta.label}`;
  if (meta && issue.code === 'too_small' && Array.isArray(issue.input)) return `${meta.verb} ${meta.label}`;
  if (last === 'quantity' && issue.code === 'too_small') return 'Quantity must be at least 1';
  if (issue.code === 'too_big' && typeof issue.maximum !== 'undefined' && typeof issue.input === 'string')
    return `At most ${String(issue.maximum)} characters`;
  if (issue.code === 'invalid_value' && meta) return `${meta.verb} ${meta.label}`;
  return undefined;
}

/** Parses with human messages; throws the standard VALIDATION AppError (fieldErrors keyed by path). */
export function parseOrderBody<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
  const parsed = schema.safeParse(body, { error: humanOrderIssue });
  if (!parsed.success) throw fromZodError(parsed.error);
  return parsed.data;
}
