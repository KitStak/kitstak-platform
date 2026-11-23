/**
 * Invoices (docs/billing/CONTRACTS.md section 11.8): read from the `core.billing_invoices` cache the
 * sync keeps. The PDF comes from the gateway, after a check that the invoice belongs to the org.
 */
import { and, desc, eq, lt, ne, or, sql } from 'drizzle-orm';
import { billingInvoices, type BillingInvoice } from '@kitstak/db/schema';
import { isProductId } from '../catalog';
import { type BillingResult, billingError, billingOk } from '../errors';
import type { GatewayInvoice, GatewayInvoiceLine, GatewayInvoicePdf } from '../gateway/types';
import { type BillingReadDb, type BillingRuntime, errorText, logBilling } from './db';

export interface InvoiceRow {
  readonly id: string;
  readonly number: string | null;
  readonly status: GatewayInvoice['status'];
  readonly issuedAt: Date;
  readonly totalCents: number;
  readonly amountDueCents: number;
  readonly taxCents: number;
  readonly periodStart: Date | null;
  readonly periodEnd: Date | null;
  readonly lines: readonly GatewayInvoiceLine[];
  /** Extra fields for the on screen invoice (added during build, CONTRACTS section 24). */
  readonly subtotalCents: number;
  readonly discountCents: number;
  readonly amountPaidCents: number;
  readonly paidAt: Date | null;
  readonly billingReason: string | null;
  readonly paymentMethodLast4: string | null;
  /** How much of this invoice was paid from credit (added in review round 1). */
  readonly creditAppliedCents: number;
  /** How much of what was paid was sent back. Above 0 only for a second checkout that was canceled. */
  readonly refundedCents: number;
}

function toRow(row: BillingInvoice): InvoiceRow {
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    issuedAt: row.issuedAt,
    totalCents: row.totalCents,
    amountDueCents: row.amountDueCents,
    taxCents: row.taxCents,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    lines: row.lines.map((line) => ({
      description: line.description,
      product: line.product !== null && isProductId(line.product) ? line.product : null,
      quantity: line.quantity,
      unitCents: line.unitCents,
      amountCents: line.amountCents,
      proration: line.proration,
    })),
    subtotalCents: row.subtotalCents,
    discountCents: row.discountCents,
    amountPaidCents: row.amountPaidCents,
    paidAt: row.paidAt,
    billingReason: row.billingReason,
    paymentMethodLast4: row.pmLast4,
    creditAppliedCents: row.creditAppliedCents,
    refundedCents: row.refundedCents,
  };
}

/**
 * Newest first. The $0.00 invoice a gateway makes when a card is saved during the free trial is left
 * out: it is not a bill, and the first real one arrives when the trial ends. A first invoice that is
 * $0.00 because credit paid it is a real bill and stays in the list.
 */
export async function listInvoices(
  db: BillingReadDb,
  input: { orgId: string; limit?: number; before?: Date },
): Promise<readonly InvoiceRow[]> {
  const limit = Math.min(Math.max(Math.round(input.limit ?? 24), 1), 100);
  const notTrialStart = or(
    ne(billingInvoices.totalCents, 0),
    sql`${billingInvoices.billingReason} IS DISTINCT FROM 'subscription_create'`,
    ne(billingInvoices.creditAppliedCents, 0),
  );
  const found = await db
    .select()
    .from(billingInvoices)
    .where(
      and(
        eq(billingInvoices.orgId, input.orgId),
        ne(billingInvoices.status, 'draft'),
        notTrialStart,
        input.before ? lt(billingInvoices.issuedAt, input.before) : undefined,
      ),
    )
    .orderBy(desc(billingInvoices.issuedAt), desc(billingInvoices.id))
    .limit(limit);
  return found.map(toRow);
}

export async function getInvoice(db: BillingReadDb, input: { orgId: string; invoiceId: string }): Promise<InvoiceRow | null> {
  const [row] = await db
    .select()
    .from(billingInvoices)
    .where(and(eq(billingInvoices.orgId, input.orgId), eq(billingInvoices.id, input.invoiceId)));
  return row ? toRow(row) : null;
}

/** Checks that the invoice belongs to the org (`not_found` otherwise) before it asks the gateway. */
export async function getInvoicePdf(
  rt: BillingRuntime,
  input: { orgId: string; invoiceId: string },
): Promise<BillingResult<GatewayInvoicePdf>> {
  const [row] = await rt.db
    .select({ id: billingInvoices.id, gateway: billingInvoices.gateway })
    .from(billingInvoices)
    .where(and(eq(billingInvoices.orgId, input.orgId), eq(billingInvoices.id, input.invoiceId)));
  if (!row) return billingError('not_found');
  if (!rt.gateway) return billingError('billing_unavailable');
  if (row.gateway !== rt.gateway.kind) return billingError('not_found');
  try {
    return billingOk(await rt.gateway.getInvoicePdf(row.id));
  } catch (error) {
    logBilling('error', 'invoice pdf failed', { orgId: input.orgId, invoiceId: row.id, error: errorText(error) });
    return billingError('gateway_error', 'We could not get that invoice right now. Please try again.');
  }
}
