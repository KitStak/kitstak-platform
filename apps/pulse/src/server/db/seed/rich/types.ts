/**
 * The shape of a rich demo plan. A plan is plain data: the engine (`engine.ts`) turns it into
 * rows through the domain layer. Day positions are work day offsets from today: 0 is today,
 * -1 the work day before, and so on. Money typed here is dollars unless the name says cents.
 */
import type { CostCategory, IndirectReason, JobStatusValue, PulseStatus, RevenueKind, TargetMetric, TargetScope } from '@/lib/constants';
import type { PulseRole } from '@/lib/permissions';

export interface SiteSpec {
  code: string;
  name: string;
  timezone: string;
}

export interface ClassSpec {
  code: string;
  name: string;
  kind?: 'employee' | 'temp_agency';
  color: string;
  /** Hourly wage in cents before the raise. */
  wage: number;
  /** The raise 45 days ago, in percent. */
  raisePct: number;
  taxBp: number;
  benBp: number;
  /** Overhead per hour in cents. */
  overhead: number;
  isDefault?: boolean;
  isLead?: boolean;
}

export interface TypeSpec {
  code: string;
  name: string;
  unit: string;
  /** Target margin in basis points. */
  target: number;
  color: string;
  icon: string;
  /** Target pace: units per person per hour. */
  pace: number;
  cls: string;
}

export interface ServiceSpec {
  code: string;
  name: string;
  unit: string;
  billing?: 'per_unit' | 'per_hour' | 'flat';
  price: string;
  /** Supplies cost per unit. */
  cost?: string;
  /** How many units one person really does in an hour. */
  uph: number;
  cls?: string;
  color: string;
}

export interface ClientSpec {
  code: string;
  name: string;
  contact: string;
  email: string;
  owner?: 'us' | 'client';
  target?: number;
  color: string;
  /** `core.customers.code` to link to, when the org has core customers. */
  core?: string;
  /** CRM account item name to link to, when the org runs CRM. */
  crmAccount?: string;
  inactive?: boolean;
  terms?: number;
  notes?: string;
}

export interface ItemSpec {
  sku: string;
  name: string;
  uom?: string;
  cost: string;
  by?: 'us' | 'client';
  client?: string;
}

export interface JobSpec {
  /** Job number. Pulse made jobs use `J-<n>`. */
  n: string;
  name: string;
  client: string;
  type: string;
  site?: string;
  status: JobStatusValue;
  ongoing?: boolean;
  pricing?: 'per_unit' | 'fixed' | 'hourly';
  /** First work day, as an offset from today. */
  start: number;
  /** Work days the job ran (completed and on hold jobs). Active jobs run to `last`. */
  len?: number;
  /** Last day with entries for an active job (default 0, today). */
  last?: number;
  crew: number;
  cls?: string;
  hrs?: number;
  /** Real pace, units per person per hour. */
  pace: number;
  /** Target pace when it differs from the job type's. */
  pacePlan?: number;
  /** Pace the quote assumed, when the quote was wrong. Defaults to the target pace. */
  quotePace?: number;
  /** Factor on the pace by job day (`j` of `n` days). */
  paceFn?: (j: number, n: number) => number;
  scrap?: number;
  /** How far through the planned units an active job is today (0 to 1). */
  pct?: number;
  /** Planned units, when not derived from `pct` or from what was made. */
  planned?: number;
  /** Margin the quote aimed for (0.30 is 30%). The price is worked out from it. */
  qm?: number;
  /** A typed unit price (or bill rate per hour for hourly jobs) that wins over `qm`. */
  price?: number;
  /** Standard material cost per unit that we buy. */
  mat?: number;
  /** Planned material per unit when the plan was different. */
  matPlan?: number;
  /** Tracked parts (material method "actual"). */
  items?: { sku: string; per: number; jump?: { at: number; x: number }; waste?: number }[];
  matSource?: 'wms' | 'manual';
  owner?: 'us' | 'client';
  setup?: number;
  other?: { cat: CostCategory; cents: number; at: number; vendor?: string; note?: string }[];
  otherPlan?: number;
  target?: number;
  /** Due date as a work day offset from today. Derived when left out. */
  due?: number;
  po?: string;
  ownerEmail?: string;
  /** Job days (0 based) with units and no hours. */
  noHours?: number[];
  /** The missing hours were added later (a correction). */
  fixNoHours?: boolean;
  /** Job days with nothing logged. */
  skip?: number[];
  /** A second labor class that helps a few hours each day (hours only, no units). */
  help?: string;
  /** Days after the cut are saved late, so alerts raised by the slow start clear by themselves. */
  holdBack?: boolean;
  /** The job has no price yet. */
  noPrice?: boolean;
  /** Share of days with a little overtime. */
  overtime?: number;
  /** How many of the latest Saturdays the job worked. */
  sat?: number;
  vas?: { svc: string; share: number; every?: number; price?: string }[];
  fees?: { kind: RevenueKind; at: number; cents: number; desc: string }[];
  /** Leave the last invoice out: finished work that is not billed yet. */
  unbilled?: boolean;
  priceChange?: { at: number; pct: number; note: string };
  budget?: boolean;
  wms?: string;
  wmsShortage?: boolean;
  deal?: string;
  project?: string;
  importsTime?: boolean;
  pinned?: string;
  notes?: { at: number; body: string }[];
  description?: string;
  /** What the story needs this job to show. Checked after the seed and printed. */
  expect?: PulseStatus | 'none';
}

export interface OrgPlan {
  seed: string;
  sites: SiteSpec[];
  defaultPartsOwner: 'us' | 'client';
  /** Pulse roles. `login` also makes the person a demo sign in when no other seed made them. */
  roles: { email: string; role: PulseRole; seesMoney?: boolean; login?: { name: string; orgRole: 'member' | 'viewer'; password: string } }[];
  classes: ClassSpec[];
  types: TypeSpec[];
  services: ServiceSpec[];
  clients: ClientSpec[];
  items: ItemSpec[];
  jobs: JobSpec[];
  /** Work day offsets when the floor was closed. */
  closed: number[];
  /** Company costs per month, in cents. */
  companyCosts: { cat: CostCategory; cents: number; vendor: string; note?: string }[];
  clientCosts: { client: string; cat: CostCategory; cents: number; at: number; vendor?: string; note: string }[];
  clientVas: { client: string; svc: string; every: number; qty: number; price?: string }[];
  clientFees: { client: string; kind: RevenueKind; every: number; cents: number; desc: string }[];
  indirect: { reason: IndirectReason; share: number; note?: string }[];
  goals: { scope: TargetScope; ref?: string; metric: TargetMetric; value: string; monthly?: boolean }[];
  views: { page: 'jobs' | 'profit' | 'log' | 'labor' | 'reports' | 'alerts'; name: string; config: Record<string, unknown>; shared?: boolean; isDefault?: boolean }[];
  clientNotes: { client: string; body: string }[];
}
