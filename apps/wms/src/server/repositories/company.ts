/**
 * Company Settings repository (M14): display / full name, logo (png/jpeg < 2 MB, stored in
 * the file store), account defaults and the password / lockout policy. One row ("company");
 * every change writes field-level `change_log` (entity "company") and bumps `version`.
 */
import { eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { AppDb } from '@/server/api/db';
import { AppError } from '@/server/api/errors';
import type { AuthContext } from '@/server/auth/context';
import { DEFAULT_PASSWORD_POLICY, passwordPolicySchema } from '@/server/auth/password-policy';
import * as s from '@/server/db/schema';
import type { CompanyDefaults } from '@/server/db/schema';
import type { FileStore } from '@/server/files/files';
import {
  idleMinutesFrom,
  LOGO_MAX_BYTES,
  LOGO_MIMES,
  type companyDefaultsSchema,
  type companyInfoSchema,
  type companySecuritySchema,
} from '@/lib/grid-defs/admin/company';
import { assertVersion, domainCtxOf, logUpdate, type Actor } from './users-shared';

const c = s.companySettings;
export const COMPANY_ENTITY = 'company';
const ID = 'company';

const DEFAULTS: CompanyDefaults = {
  currency: 'USD',
  dateFormat: 'M/D/YYYY h:mm:ss A',
  weightUnit: 'Pound',
  dimensionUnit: 'Inch',
};

export interface CompanySettings {
  readonly displayName: string;
  readonly fullName: string;
  readonly logoFileId: string | null;
  readonly logoUrl: string | null;
  readonly defaults: CompanyDefaults;
  readonly passwordPolicy: z.output<typeof passwordPolicySchema>;
  /** Web idle sign-out in minutes (company Security), or null when off. Stored in `defaults.sessionIdleMinutes`. */
  readonly sessionIdleMinutes: number | null;
  readonly updatedAt: string;
  readonly version: number;
}

async function ensureRow(db: AppDb): Promise<typeof c.$inferSelect> {
  const row = (await db.select().from(c).where(eq(c.id, ID)).limit(1))[0];
  if (row) return row;
  // Reads run outside the write lock, so two first reads can race: the loser's insert is a
  // no-op and both return the committed singleton (was atomic on synchronous SQLite).
  await db
    .insert(c)
    .values({
      id: ID,
      displayName: 'KitStaks',
      fullName: 'KitStaks',
      defaults: DEFAULTS,
      passwordPolicy: DEFAULT_PASSWORD_POLICY,
    })
    .onConflictDoNothing({ target: c.id });
  const created = (await db.select().from(c).where(eq(c.id, ID)).limit(1))[0];
  if (!created) throw new Error('company_settings row could not be created');
  return created;
}

export async function getCompany(db: AppDb): Promise<CompanySettings> {
  const row = await ensureRow(db);
  const policy = passwordPolicySchema.safeParse(row.passwordPolicy ?? {});
  return {
    displayName: row.displayName,
    fullName: row.fullName,
    logoFileId: row.logoFileId,
    logoUrl: row.logoFileId ? `/api/company/logo?v=${row.version}` : null,
    defaults: { ...DEFAULTS, ...publicDefaults(row.defaults) },
    passwordPolicy: policy.success ? policy.data : DEFAULT_PASSWORD_POLICY,
    sessionIdleMinutes: readIdleMinutes(row.defaults),
    updatedAt: row.updatedAt,
    version: row.version,
  };
}

/** The defaults JSON without server-only keys (`mail` holds the encrypted SMTP secret). */
function publicDefaults(defaults: CompanyDefaults | null | undefined): Partial<CompanyDefaults> {
  if (!defaults) return {};
  const rest: Record<string, unknown> = { ...(defaults as unknown as Record<string, unknown>) };
  delete rest.mail;
  return rest as Partial<CompanyDefaults>;
}

/** Idle sign-out minutes from the defaults JSON (null = off). */
function readIdleMinutes(defaults: unknown): number | null {
  return idleMinutesFrom((defaults as Record<string, unknown> | null | undefined)?.sessionIdleMinutes);
}

/** Company web idle sign-out for the shell (null = off). */
export async function getSessionIdleMinutes(db: AppDb): Promise<number | null> {
  return readIdleMinutes(
    (await db.select({ defaults: c.defaults }).from(c).where(eq(c.id, ID)).limit(1))[0]?.defaults,
  );
}

async function bump(tx: AppDb, actor: Actor, set: Partial<typeof c.$inferInsert>): Promise<number> {
  return (
    (
      await tx
        .update(c)
        .set({
          ...set,
          updatedBy: actor.userId,
          updatedAt: new Date().toISOString(),
          version: sql`${c.version} + 1`,
        })
        .where(eq(c.id, ID))
        .returning({ v: c.version })
    )[0]?.v ?? 1
  );
}

const ref = { entityType: COMPANY_ENTITY, entityId: ID, entityCode: 'Company settings' };

export async function updateCompanyInfo(
  tx: AppDb,
  auth: AuthContext,
  actor: Actor,
  input: z.output<typeof companyInfoSchema>,
): Promise<CompanySettings> {
  const before = await ensureRow(tx);
  assertVersion(before.version, input.version);
  await bump(tx, actor, { displayName: input.displayName, fullName: input.fullName });
  await logUpdate(
    tx,
    domainCtxOf(actor, auth),
    ref,
    { displayName: before.displayName, fullName: before.fullName },
    { displayName: input.displayName, fullName: input.fullName },
  );
  return await getCompany(tx);
}

export async function updateCompanyDefaults(
  tx: AppDb,
  auth: AuthContext,
  actor: Actor,
  input: z.output<typeof companyDefaultsSchema>,
): Promise<CompanySettings> {
  const before = await ensureRow(tx);
  assertVersion(before.version, input.version);
  const next: CompanyDefaults = {
    currency: input.currency,
    weightUnit: input.weightUnit,
    dimensionUnit: input.dimensionUnit,
    dateFormat: input.dateFormat,
  };
  // The JSON also carries other settings (e.g. `returnRules`); keep them.
  await bump(tx, actor, { defaults: { ...(before.defaults ?? {}), ...next } });
  // Only the four account-default keys are compared (the JSON also holds return rules and mail).
  const was = { ...DEFAULTS, ...(before.defaults ?? {}) };
  const prev: CompanyDefaults = {
    currency: was.currency,
    weightUnit: was.weightUnit,
    dimensionUnit: was.dimensionUnit,
    dateFormat: was.dateFormat,
  };
  await logUpdate(
    tx,
    domainCtxOf(actor, auth),
    ref,
    prev as unknown as Record<string, unknown>,
    next as unknown as Record<string, unknown>,
  );
  return await getCompany(tx);
}

export async function updateCompanySecurity(
  tx: AppDb,
  auth: AuthContext,
  actor: Actor,
  input: z.output<typeof companySecuritySchema>,
): Promise<CompanySettings> {
  const before = await ensureRow(tx);
  assertVersion(before.version, input.version);
  const next = passwordPolicySchema.parse({
    minLength: input.minLength,
    requireUpper: input.requireUpper,
    requireNumber: input.requireNumber,
    requireSymbol: input.requireSymbol,
    ...(input.expires ? { maxAgeDays: input.maxAgeDays } : {}),
    lockoutThreshold: input.lockoutThreshold,
    lockoutMinutes: input.lockoutMinutes,
  });
  const prev = passwordPolicySchema.safeParse(before.passwordPolicy ?? {});
  const prevIdle = readIdleMinutes(before.defaults);
  const nextIdle = input.idleTimeout ? input.idleMinutes : null;
  // `defaults` also carries account defaults and return rules; only the idle key changes.
  const defaults = {
    ...((before.defaults ?? {}) as Record<string, unknown>),
    sessionIdleMinutes: nextIdle,
  } as unknown as typeof c.$inferInsert.defaults;
  await bump(tx, actor, { passwordPolicy: next, defaults });
  const view = (p: z.output<typeof passwordPolicySchema>) => ({
    minimumLength: p.minLength,
    requireUppercase: p.requireUpper,
    requireNumber: p.requireNumber,
    requireSymbol: p.requireSymbol,
    passwordExpiry: p.maxAgeDays ? `${p.maxAgeDays} days` : 'Never',
    lockoutAfter: `${p.lockoutThreshold} failed attempts`,
    lockoutDuration: `${p.lockoutMinutes} minutes`,
  });
  const idle = (m: number | null) => (m ? `${m} minutes` : 'Off');
  await logUpdate(
    tx,
    domainCtxOf(actor, auth),
    ref,
    { ...view(prev.success ? prev.data : DEFAULT_PASSWORD_POLICY), idleSignOut: idle(prevIdle) },
    { ...view(next), idleSignOut: idle(nextIdle) },
  );
  return await getCompany(tx);
}

/** PNG / JPEG magic bytes — the extension and the declared type are not trusted. */
export function sniffImage(bytes: Uint8Array): (typeof LOGO_MIMES)[number] | null {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
    return 'image/png';
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  return null;
}

export async function setCompanyLogo(
  tx: AppDb,
  store: FileStore,
  auth: AuthContext,
  actor: Actor,
  upload: { fileName: string; bytes: Uint8Array },
): Promise<CompanySettings> {
  if (upload.bytes.length > LOGO_MAX_BYTES)
    throw new AppError('VALIDATION', 'The logo must be smaller than 2 MB', {
      fieldErrors: { file: ['Use an image smaller than 2 MB'] },
    });
  const mime = sniffImage(upload.bytes);
  if (!mime)
    throw new AppError('VALIDATION', 'Upload a JPG or PNG image', {
      fieldErrors: { file: ['Only JPG and PNG images are accepted'] },
    });
  const ext = mime === 'image/png' ? 'png' : 'jpg';
  const before = await ensureRow(tx);
  const file = await store.store(tx, {
    name: `company-logo.${ext}`,
    bytes: upload.bytes,
    purpose: 'attachment',
    uploadedBy: actor.userId ?? undefined,
    ownerEntityType: COMPANY_ENTITY,
    ownerEntityId: ID,
    expiresAt: null,
  });
  await bump(tx, actor, { logoFileId: file.id });
  await logUpdate(
    tx,
    domainCtxOf(actor, auth),
    ref,
    { logo: before.logoFileId ? 'Previous logo' : '' },
    { logo: upload.fileName.slice(0, 120) },
  );
  if (before.logoFileId) {
    try {
      await store.remove(tx, before.logoFileId);
    } catch {
      /* the old blob may already be gone */
    }
  }
  return await getCompany(tx);
}

export async function removeCompanyLogo(
  tx: AppDb,
  store: FileStore,
  auth: AuthContext,
  actor: Actor,
): Promise<CompanySettings> {
  const before = await ensureRow(tx);
  if (!before.logoFileId) throw new AppError('INVALID_STATE', 'There is no logo to remove');
  await bump(tx, actor, { logoFileId: null });
  await logUpdate(tx, domainCtxOf(actor, auth), ref, { logo: 'Logo' }, { logo: '' });
  try {
    await store.remove(tx, before.logoFileId);
  } catch {
    /* already removed */
  }
  return await getCompany(tx);
}

/** Logo bytes for the shell and printouts, or null. */
export async function readCompanyLogo(
  db: AppDb,
  store: FileStore,
): Promise<{ bytes: Buffer; mime: string } | null> {
  const row = await ensureRow(db);
  if (!row.logoFileId) return null;
  try {
    const { record, bytes } = await store.read(db, row.logoFileId);
    return { bytes, mime: record.mime };
  } catch {
    return null;
  }
}
