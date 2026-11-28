/** 5.2 People: people, their private and pay rows, dated wages, agency links and submissions. */
import { boolean, date, integer, jsonb, primaryKey, smallint, text, uuid } from 'drizzle-orm/pg-core';
import { base, createdAt, crewSchema, deletedAt, orgId, src, tstz, updatedAt, version } from './_shared';

export const people = crewSchema.table('people', {
  ...base(),
  number: text('number').notNull(),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  preferredName: text('preferred_name'),
  kind: text('kind').notNull().default('employee'),
  status: text('status').notNull().default('active'),
  homeSiteId: uuid('home_site_id').notNull(),
  usualAreaId: uuid('usual_area_id'),
  laborClassId: uuid('labor_class_id'),
  leadPersonId: uuid('lead_person_id'),
  /** core.vendors row whose kinds hold temp_agency. */
  agencyVendorId: uuid('agency_vendor_id'),
  agencyRef: text('agency_ref'),
  startDate: date('start_date'),
  endDate: date('end_date'),
  userId: uuid('user_id'),
  wmsUserId: text('wms_user_id'),
  email: text('email'),
  phone: text('phone'),
  language: text('language').notNull().default('en'),
  badgeHash: text('badge_hash'),
  pinHash: text('pin_hash'),
  pinSetAt: tstz('pin_set_at'),
  pinFails: smallint('pin_fails').notNull().default(0),
  pinLockedUntil: tstz('pin_locked_until'),
  notifyEmail: boolean('notify_email').notNull().default(true),
  externalRefs: jsonb('external_refs').$type<Record<string, string>>().notNull().default({}),
  notes: text('notes'),
  version: version(),
  deletedAt: deletedAt(),
  ...src(),
});

export const personPrivate = crewSchema.table(
  'person_private',
  {
    orgId: orgId(),
    personId: uuid('person_id').notNull(),
    emergencyName: text('emergency_name'),
    emergencyPhone: text('emergency_phone'),
    emergencyRelation: text('emergency_relation'),
    homeAddress: jsonb('home_address').$type<Record<string, string>>(),
    privateNotes: text('private_notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.personId], name: 'person_private_pkey' })],
);

export const personPay = crewSchema.table(
  'person_pay',
  {
    orgId: orgId(),
    personId: uuid('person_id').notNull(),
    payType: text('pay_type').notNull().default('hourly'),
    overtimeExempt: boolean('overtime_exempt').notNull().default(false),
    updatedBy: uuid('updated_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.personId], name: 'person_pay_pkey' })],
);

export const personWages = crewSchema.table('person_wages', {
  ...base(),
  personId: uuid('person_id').notNull(),
  effectiveFrom: date('effective_from').notNull(),
  wageCents: integer('wage_cents').notNull(),
  note: text('note'),
  sentToPulseAt: tstz('sent_to_pulse_at'),
  version: version(),
  createdBy: uuid('created_by'),
});

export const agencyLinks = crewSchema.table('agency_links', {
  ...base(),
  vendorId: uuid('vendor_id').notNull(),
  siteId: uuid('site_id').notNull(),
  tokenHash: text('token_hash').notNull(),
  tokenPrefix: text('token_prefix'),
  expiresAt: tstz('expires_at').notNull(),
  maxPeople: integer('max_people').notNull().default(50),
  revokedAt: tstz('revoked_at'),
  createdBy: uuid('created_by'),
  deletedAt: deletedAt(),
});

export const agencySubmissions = crewSchema.table('agency_submissions', {
  ...base(),
  linkId: uuid('link_id').notNull(),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  phone: text('phone'),
  email: text('email'),
  agencyRef: text('agency_ref'),
  startDate: date('start_date'),
  language: text('language').notNull().default('en'),
  status: text('status').notNull().default('pending'),
  personId: uuid('person_id'),
  decidedBy: uuid('decided_by'),
  decidedAt: tstz('decided_at'),
  ipHash: text('ip_hash'),
});
