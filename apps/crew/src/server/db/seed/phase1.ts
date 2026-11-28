/**
 * Phase 1 seed (docs/crew/SPEC.md section 10, org `kitstak`): labor classes, the agency vendor
 * "Brightway Staffing", 48 people (30 employees, 14 temps from Brightway, 4 seasonal) with 3
 * leads, the supervisors j.okafor, t.nguyen and d.castillo linked to their users, and the
 * explicit roles (admin@kitstak.io owner, a payroll user, supervisors per site, a lead, a viewer).
 * Everything goes through the domain layer (`writePerson`, `upsertVendorKind`). Idempotent: people
 * are found by number and updated, so a second run changes nothing. A seeded random generator
 * keeps the names and dates the same on every run. Local dev only: people get kiosk PIN 2468.
 */
import 'server-only';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { member, user } from '@kitstak/db/schema';
import { db, type Transaction } from '@/server/db';
import { scoped } from '@/server/db/scope';
import { areas, laborClasses, memberRoles, people, sites } from '@/server/db/schema';
import { inTx, todayInZone, type DomainContext } from '@/server/domain/_shared';
import { writePerson, type PersonInput } from '@/server/domain/people';
import { hashPin } from '@/server/domain/pins';
import { upsertVendorKind } from '@/server/domain/vendors';
import { addDays } from '@/lib/dates';
import type { CrewRole } from '@/lib/permissions';

/** The local dev kiosk PIN for every seeded person (SPEC 10). Never set in production. */
export const SEED_PIN = '2468';
export const AGENCY_NAME = 'Brightway Staffing';

const FIRST = ['Maria', 'Luis', 'Ana', 'Jamal', 'Keisha', 'Tran', 'Diego', 'Rosa', 'Marcus', 'Linh', 'Carlos', 'Aisha', 'Brandon', 'Yesenia', 'Omar', 'Tanya', 'Hector', 'Grace', 'Darius', 'Mei', 'Javier', 'Latoya', 'Kevin', 'Alma', 'Tyrone', 'Sofia', 'Ramon', 'Nia', 'Victor', 'Paula', 'Andre', 'Lucia', 'Terrell', 'Esther', 'Miguel', 'Shanice', 'Ivan', 'Monica', 'Dwayne', 'Rita', 'Samuel', 'Yolanda', 'Felix', 'Imani', 'Pedro', 'Carmen', 'Jerome', 'Beatriz'];
const LAST = ['Lopez', 'Garcia', 'Johnson', 'Nguyen', 'Williams', 'Martinez', 'Brown', 'Hernandez', 'Davis', 'Pham', 'Rodriguez', 'Jackson', 'Smith', 'Flores', 'Thomas', 'Rivera', 'Moore', 'Tran', 'Taylor', 'Gomez', 'Harris', 'Diaz', 'Clark', 'Reyes', 'Lewis', 'Cruz', 'Walker', 'Morales', 'Hall', 'Ortiz', 'Young', 'Ramos', 'King', 'Castro', 'Wright', 'Vargas', 'Scott', 'Mendoza', 'Green', 'Ruiz', 'Adams', 'Chavez', 'Baker', 'Silva', 'Nelson', 'Romero', 'Carter', 'Soto'];

/** A small seeded random generator (mulberry32), so every run makes the same people. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Phase1Summary {
  readonly people: number;
  readonly employees: number;
  readonly temps: number;
  readonly seasonal: number;
  readonly leads: number;
  readonly linked: number;
  readonly roles: number;
  readonly classes: number;
}

interface SeedPerson {
  readonly number: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly kind: 'employee' | 'temp' | 'seasonal';
  readonly site: 'MLT1' | 'KS2';
  readonly area: string;
  readonly classCode: 'EMP' | 'TEMP' | 'SEAS';
  readonly leadNumber: string | null;
  readonly agencyRef: string | null;
  readonly startOffsetDays: number;
  readonly language: 'en' | 'es';
  readonly userEmail: string | null;
  readonly wageCents: number | null;
  readonly emergency: boolean;
}

const AREAS = ['KIT1', 'KIT2', 'RECV', 'PICK', 'SHIP'] as const;

/** The 48 people of SPEC 10, as plain data. Pure, so it is the same every run. */
export function kitstakPeople(): SeedPerson[] {
  const next = random(20261127);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)] as T;
  const out: SeedPerson[] = [];
  let name = 0;
  const nameAt = () => {
    const at = name;
    name += 1;
    return { firstName: FIRST[at % FIRST.length]!, lastName: LAST[(at * 7) % LAST.length]! };
  };
  // Leads 1001 to 1003 (one per kitting line and receiving), then the supervisors, then employees.
  const leads = [
    { number: '1001', firstName: 'Renata', lastName: 'Alvarez', site: 'MLT1' as const, area: 'KIT1', userEmail: 'ops.manager@kitstak.io' },
    { number: '1002', firstName: 'Marcus', lastName: 'Bell', site: 'MLT1' as const, area: 'KIT2', userEmail: null },
    { number: '1003', firstName: 'Linh', lastName: 'Pham', site: 'KS2' as const, area: 'RECV', userEmail: null },
  ];
  for (const leadRow of leads) out.push({ ...leadRow, kind: 'employee', classCode: 'EMP', leadNumber: null, agencyRef: null, startOffsetDays: -900, language: 'en', wageCents: 2400, emergency: true });
  const supervisors = [
    { number: '1004', firstName: 'Jonah', lastName: 'Okafor', site: 'MLT1' as const, userEmail: 'j.okafor@kitstak.io' },
    { number: '1005', firstName: 'Thao', lastName: 'Nguyen', site: 'KS2' as const, userEmail: 't.nguyen@kitstak.io' },
    { number: '1006', firstName: 'Diego', lastName: 'Castillo', site: 'MLT1' as const, userEmail: 'd.castillo@kitstak.io' },
  ];
  for (const row of supervisors) out.push({ ...row, area: 'KIT1', kind: 'employee', classCode: 'EMP', leadNumber: null, agencyRef: null, startOffsetDays: -1400, language: 'en', wageCents: 2800, emergency: true });
  for (let i = 0; out.length < 30; i += 1) {
    const site = i % 4 === 3 ? 'KS2' : 'MLT1';
    const leadNumber = site === 'KS2' ? '1003' : i % 2 === 0 ? '1001' : '1002';
    out.push({ number: String(1007 + i), ...nameAt(), kind: 'employee', site, area: pick(AREAS), classCode: 'EMP', leadNumber, agencyRef: null, startOffsetDays: -60 - Math.floor(next() * 1500), language: next() < 0.3 ? 'es' : 'en', userEmail: null, wageCents: 1700 + Math.floor(next() * 8) * 50, emergency: next() < 0.6 });
  }
  for (let i = 0; i < 14; i += 1) {
    out.push({ number: `T-${1001 + i}`, ...nameAt(), kind: 'temp', site: i < 10 ? 'MLT1' : 'KS2', area: i % 2 === 0 ? 'KIT1' : 'KIT2', classCode: 'TEMP', leadNumber: i < 10 ? (i % 2 === 0 ? '1001' : '1002') : '1003', agencyRef: `BW-${5501 + i}`, startOffsetDays: -21 + i, language: next() < 0.5 ? 'es' : 'en', userEmail: null, wageCents: null, emergency: false });
  }
  for (let i = 0; i < 4; i += 1) {
    out.push({ number: `S-${3001 + i}`, ...nameAt(), kind: 'seasonal', site: 'MLT1', area: 'PICK', classCode: 'SEAS', leadNumber: '1002', agencyRef: null, startOffsetDays: -30, language: 'en', userEmail: null, wageCents: 1800, emergency: false });
  }
  return out;
}

/** Explicit Crew roles by email (SPEC 10: owner, payroll, supervisors per site, a lead, a viewer). */
const ROLES: readonly { readonly email: string; readonly role: CrewRole; readonly sites?: readonly ('MLT1' | 'KS2')[] }[] = [
  { email: 'admin@kitstak.io', role: 'owner' },
  { email: 'finance@kitstak.io', role: 'payroll' },
  { email: 'j.okafor@kitstak.io', role: 'supervisor', sites: ['MLT1'] },
  { email: 'd.castillo@kitstak.io', role: 'supervisor', sites: ['MLT1'] },
  { email: 't.nguyen@kitstak.io', role: 'supervisor', sites: ['KS2'] },
  { email: 'ops.manager@kitstak.io', role: 'lead' },
  { email: 'cs.team@kitstak.io', role: 'viewer' },
];

const CLASSES = [
  { code: 'EMP', name: 'Employee', kind: 'employee', isDefault: true },
  { code: 'TEMP', name: 'Temp packer', kind: 'temp_agency', isDefault: false },
  { code: 'SEAS', name: 'Seasonal', kind: 'employee', isDefault: false },
] as const;

async function upsertClasses(tx: Transaction, ctx: DomainContext): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const row of CLASSES) {
    const [found] = await tx.select({ id: laborClasses.id }).from(laborClasses).where(and(eq(laborClasses.orgId, ctx.orgId), sql`lower(${laborClasses.code}) = lower(${row.code})`, isNull(laborClasses.deletedAt)));
    if (found) {
      await tx.update(laborClasses).set({ name: row.name, kind: row.kind, isDefault: row.isDefault }).where(eq(laborClasses.id, found.id));
      out.set(row.code, found.id);
    } else {
      const [made] = await tx.insert(laborClasses).values({ orgId: ctx.orgId, code: row.code, name: row.name, kind: row.kind, isDefault: row.isDefault, source: 'manual' }).returning({ id: laborClasses.id });
      out.set(row.code, made!.id);
    }
  }
  return out;
}

export const seedPhase1 = scoped(async function seedPhase1(ctx: DomainContext, options: { readonly devPins?: boolean } = {}): Promise<Phase1Summary> {
  const devPins = options.devPins ?? process.env.NODE_ENV !== 'production';
  return inTx(async (tx) => {
    const siteRows = await tx.select().from(sites).where(and(eq(sites.orgId, ctx.orgId), isNull(sites.deletedAt)));
    const siteBy = new Map(siteRows.map((site) => [site.code.toUpperCase(), site]));
    if (!siteBy.has('MLT1') || !siteBy.has('KS2')) throw new Error('Seed: run phase 0 first (sites MLT1 and KS2).');
    const areaRows = await tx.select().from(areas).where(and(eq(areas.orgId, ctx.orgId), isNull(areas.deletedAt)));
    const areaBy = new Map(areaRows.map((area) => [`${area.siteId}|${area.code.toUpperCase()}`, area.id]));
    const users = await tx.select({ id: user.id, email: user.email }).from(member).innerJoin(user, eq(user.id, member.userId)).where(eq(member.organizationId, ctx.orgId));
    const userBy = new Map(users.map((row) => [row.email.toLowerCase(), row.id]));

    let roles = 0;
    for (const entry of ROLES) {
      const userId = userBy.get(entry.email);
      if (!userId) continue;
      const siteIds = entry.sites ? entry.sites.map((code) => siteBy.get(code)!.id) : null;
      await tx
        .insert(memberRoles)
        .values({ orgId: ctx.orgId, userId, role: entry.role, siteIds, updatedBy: ctx.userId })
        .onConflictDoUpdate({ target: [memberRoles.orgId, memberRoles.userId], set: { role: entry.role, siteIds } });
      roles += 1;
    }

    const classBy = await upsertClasses(tx, ctx);
    const agency = (await upsertVendorKind(tx, ctx, { name: AGENCY_NAME, kind: 'temp_agency', email: 'staffing@brightway.example', phone: '555-0170' })).vendor;

    const plan = kitstakPeople();
    const numbers = plan.map((row) => row.number);
    const existing = await tx.select({ id: people.id, number: people.number, version: people.version, pinHash: people.pinHash }).from(people).where(and(eq(people.orgId, ctx.orgId), inArray(people.number, numbers), isNull(people.deletedAt)));
    const byNumber = new Map(existing.map((row) => [row.number, row]));
    const idOf = new Map<string, string>(existing.map((row) => [row.number, row.id]));
    const today = todayInZone(siteBy.get('MLT1')!.timezone);
    let linked = 0;
    // Leads first, so their people can point at them.
    const ordered = [...plan.filter((row) => row.leadNumber === null), ...plan.filter((row) => row.leadNumber !== null)];
    for (const row of ordered) {
      const site = siteBy.get(row.site)!;
      const userId = row.userEmail ? (userBy.get(row.userEmail) ?? null) : null;
      if (userId) linked += 1;
      const input: PersonInput = {
        number: row.number,
        firstName: row.firstName,
        lastName: row.lastName,
        kind: row.kind,
        status: 'active',
        homeSiteId: site.id,
        usualAreaId: areaBy.get(`${site.id}|${row.area}`) ?? null,
        laborClassId: classBy.get(row.classCode) ?? null,
        leadPersonId: row.leadNumber ? (idOf.get(row.leadNumber) ?? null) : null,
        agencyVendorId: row.kind === 'temp' ? agency.id : null,
        agencyRef: row.agencyRef,
        startDate: addDays(today, row.startOffsetDays),
        language: row.language,
        email: row.userEmail ?? `${row.firstName}.${row.lastName}.${row.number}`.toLowerCase().replace(/[^a-z0-9.]/g, '') + '@crew-seed.example',
        phone: `555-01${row.number.replace(/\D/g, '').slice(-2)}`,
        userId,
        notifyEmail: true,
      };
      const found = byNumber.get(row.number) ?? null;
      if (found) {
        // Idempotent: a person the seed made before is left as it is (and any edit made since is kept).
        if (devPins && !found.pinHash) await tx.update(people).set({ pinHash: hashPin(SEED_PIN), pinSetAt: new Date() }).where(and(eq(people.orgId, ctx.orgId), eq(people.id, found.id)));
        continue;
      }
      const result = await writePerson(tx, ctx, null, input, {
        private: row.emergency ? { emergencyName: `${LAST[(row.number.length * 5) % LAST.length]} family`, emergencyPhone: `555-09${row.number.replace(/\D/g, '').slice(-2)}`, emergencyRelation: 'Family' } : undefined,
        pay: row.wageCents !== null ? { payType: 'hourly', overtimeExempt: false, wageCents: row.wageCents } : undefined,
        options: { source: 'system', sourceRef: `seed:person:${row.number}` },
      });
      idOf.set(row.number, result.id);
      if (devPins) await tx.update(people).set({ pinHash: hashPin(SEED_PIN), pinSetAt: new Date() }).where(and(eq(people.orgId, ctx.orgId), eq(people.id, result.id)));
    }
    return {
      people: plan.length,
      employees: plan.filter((row) => row.kind === 'employee').length,
      temps: plan.filter((row) => row.kind === 'temp').length,
      seasonal: plan.filter((row) => row.kind === 'seasonal').length,
      leads: new Set(plan.map((row) => row.leadNumber).filter(Boolean)).size,
      linked,
      roles,
      classes: CLASSES.length,
    };
  }, db);
});
