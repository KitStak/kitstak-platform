/**
 * Signup intents (docs/billing/CONTRACTS.md section 11.9): the cart and answers a person brought from
 * the marketing site, and the signup step they are on. One open intent per person.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { signupIntents, type SignupIntentRow } from '@kitstak/db/schema';
import { normalizeSelection, type PlanSelection } from '../catalog';
import { type HandoffSource, parseHandoff, type SignupHandoff } from '../handoff';
import type { BillingDb, BillingReadDb } from './db';

export interface SignupIntent {
  readonly id: string;
  readonly userId: string;
  readonly orgId: string | null;
  readonly selection: PlanSelection | null;
  readonly profile: SignupHandoff['profile'];
  readonly source: HandoffSource | 'invite';
  readonly step: 'company' | 'plan' | 'verify' | 'welcome' | 'done';
  readonly verifySkippedAt: Date | null;
}

/** Stored answers are untrusted JSON. Read them through the same validator the link uses. */
function cleanProfile(raw: unknown): SignupHandoff['profile'] {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const record = raw as Record<string, unknown>;
  const asStrings: Record<string, string | undefined> = {};
  for (const key of ['businessType', 'teamSize', 'startMode'] as const) {
    const value = record[key];
    if (typeof value === 'string') asStrings[key] = value;
  }
  if (typeof record.guided === 'boolean') asStrings.guided = record.guided ? '1' : '0';
  return parseHandoff(asStrings).profile;
}

function cleanSelection(raw: unknown): PlanSelection | null {
  if (raw === null || raw === undefined) return null;
  const selection = normalizeSelection(raw);
  return selection.products.length > 0 ? selection : null;
}

function toIntent(row: SignupIntentRow): SignupIntent {
  return {
    id: row.id,
    userId: row.userId,
    orgId: row.orgId,
    selection: cleanSelection(row.selection),
    profile: cleanProfile(row.profile),
    source: row.source,
    step: row.step,
    verifySkippedAt: row.verifySkippedAt,
  };
}

async function findOpen(db: BillingReadDb, userId: string): Promise<SignupIntentRow | null> {
  const [row] = await db
    .select()
    .from(signupIntents)
    .where(and(eq(signupIntents.userId, userId), isNull(signupIntents.completedAt)));
  return row ?? null;
}

export async function getOpenSignupIntent(db: BillingReadDb, userId: string): Promise<SignupIntent | null> {
  const row = await findOpen(db, userId);
  return row ? toIntent(row) : null;
}

/**
 * Creates the person's open intent, or merges into it. A handoff with a cart replaces the stored
 * cart; a handoff without one keeps it. Answers are merged key by key. Fields left out stay as they are.
 */
export async function upsertSignupIntent(
  db: BillingDb,
  input: {
    userId: string;
    orgId?: string | null;
    handoff?: SignupHandoff;
    step?: SignupIntent['step'];
    verifySkipped?: boolean;
  },
): Promise<SignupIntent> {
  const merge = async (existing: SignupIntentRow): Promise<SignupIntent> => {
    const selection = input.handoff?.selection
      ? normalizeSelection(input.handoff.selection)
      : cleanSelection(existing.selection);
    const profile = { ...cleanProfile(existing.profile), ...(input.handoff ? cleanProfile(input.handoff.profile) : {}) };
    // A plain revisit ("direct") never hides where the person first came from.
    const source =
      input.handoff && input.handoff.source !== 'direct' && existing.source !== 'invite'
        ? input.handoff.source
        : existing.source;
    const [updated] = await db
      .update(signupIntents)
      .set({
        ...(input.orgId !== undefined ? { orgId: input.orgId } : {}),
        selection: selection as unknown as Record<string, unknown> | null,
        profile: profile as Record<string, unknown>,
        source,
        ...(input.step ? { step: input.step } : {}),
        ...(input.verifySkipped ? { verifySkippedAt: new Date() } : {}),
        updatedAt: new Date(),
      })
      .where(eq(signupIntents.id, existing.id))
      .returning();
    return toIntent(updated ?? existing);
  };

  const existing = await findOpen(db, input.userId);
  if (existing) return merge(existing);

  const selection = input.handoff?.selection ? normalizeSelection(input.handoff.selection) : null;
  const inserted = await db
    .insert(signupIntents)
    .values({
      userId: input.userId,
      orgId: input.orgId ?? null,
      selection: selection as unknown as Record<string, unknown> | null,
      profile: (input.handoff ? cleanProfile(input.handoff.profile) : {}) as Record<string, unknown>,
      source: input.handoff?.source ?? 'direct',
      step: input.step ?? 'company',
      verifySkippedAt: input.verifySkipped ? new Date() : null,
    })
    .onConflictDoNothing()
    .returning();
  if (inserted[0]) return toIntent(inserted[0]);

  // Another request made the open intent between the read and the insert. Merge into that one.
  const raced = await findOpen(db, input.userId);
  if (!raced) throw new Error('Could not save the signup intent.');
  return merge(raced);
}

/** Closes the person's open intent. Safe to call when there is none. */
export async function completeSignupIntent(db: BillingDb, userId: string): Promise<void> {
  const now = new Date();
  await db
    .update(signupIntents)
    .set({ completedAt: now, step: 'done', updatedAt: now })
    .where(and(eq(signupIntents.userId, userId), isNull(signupIntents.completedAt)));
}
