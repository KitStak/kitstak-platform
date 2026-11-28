/**
 * The public invoice page lookup (docs/ledger/SPEC.md 4.5.8). `ledger.public_links` holds only the
 * SHA-256 of a token. A visitor has no workspace, so the lookup is one of the `asSystem` callers
 * the database guard allows; it returns that one invoice and nothing else.
 */
import 'server-only';
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { asSystem } from '@/server/db/scope';

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface PublicInvoice {
  readonly number: string;
  readonly orgName: string;
  readonly totalCents: string;
  readonly balanceCents: string;
  readonly dueDate: string | null;
}

const TOKEN_RE = /^[A-Za-z0-9_-]{20,100}$/;

/** The invoice behind a live, unexpired link, or null. Never throws on a bad token. */
export async function findPublicInvoice(token: string): Promise<PublicInvoice | null> {
  if (!TOKEN_RE.test(token)) return null;
  const result = await asSystem('public invoice page lookup (token hash)', () =>
    db.execute<{ number: string; org_name: string; total: string; balance: string; due_date: string | null }>(
      sql`select i.number, o.name as org_name, i.total_cents::text as total, i.balance_cents::text as balance, i.due_date::text as due_date
            from ledger.public_links l
            join ledger.invoices i on i.id = l.invoice_id and i.org_id = l.org_id
            join core.organization o on o.id = l.org_id
           where l.token_hash = ${hashToken(token)} and l.revoked_at is null and l.expires_at > now()
             and i.status <> 'draft' and i.deleted_at is null
           limit 1`,
    ),
  );
  const row = result.rows[0];
  return row ? { number: row.number, orgName: row.org_name, totalCents: row.total, balanceCents: row.balance, dueDate: row.due_date } : null;
}
