/**
 * Model for the "Set up your Stak" wizard. The answer names and values are the ones the portal reads
 * at sign-up (`businessType`, `teamSize`, `startMode`; see docs/integration/ONBOARDING.md and
 * docs/billing/CONTRACTS.md section 6), so nobody answers the same question twice. The link to the
 * portal is built by the shared handoff codec in `@kitstak/billing`. Pulse answers follow
 * docs/pulse/SPEC.md (its first run and its feature list).
 */
import { signupUrl } from '@kitstak/billing/handoff';
import type {
  BusinessType,
  HandoffIdentity,
  HandoffSource,
  SignupHandoff,
  StartMode,
  TeamSize,
} from '@kitstak/billing/handoff';
import { LINKS, ROUTES, parseStack, stackParam, startableStack, toStack, walkthroughHref } from '@/components/site-links';
import type { ProductId, Stack } from '@/components/site-links';
import { PROJECTS_CATALOG } from '@/generated/projects/catalog';
import { MAX_SEATS, MAX_WAREHOUSES, normalizeSelection } from './pricing';
import type { BillingInterval, PlanSelection } from './pricing';

export type { BusinessType, StartMode, TeamSize };

export const STEP_IDS = ['stack', 'business', 'shape', 'launch', 'account'] as const;
export type StepId = (typeof STEP_IDS)[number];

export interface Option<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly note: string;
}

export const BUSINESS_TYPES: readonly Option<BusinessType>[] = [
  { value: 'brand', label: 'Brand or e-commerce', note: 'You sell your own products.' },
  { value: 'distributor', label: 'Distributor or wholesale', note: 'You buy, stock and resell.' },
  { value: '3pl', label: '3PL warehouse', note: 'You store and ship for other companies.' },
  { value: 'other', label: 'Something else', note: 'Tell us more once you are in.' },
];

export const TEAM_SIZES: readonly (Option<TeamSize> & { readonly seats: number })[] = [
  { value: 'solo', label: 'Just me', note: '1 user', seats: 1 },
  { value: 'small', label: '2 to 10', note: 'A small team', seats: 5 },
  { value: 'medium', label: '11 to 50', note: 'Several teams', seats: 25 },
  { value: 'large', label: '50+', note: 'A whole operation', seats: 60 },
];

export const START_MODES: readonly Option<StartMode>[] = [
  { value: 'fresh', label: 'Start fresh', note: 'An empty workspace and a short checklist to fill it.' },
  {
    value: 'sample',
    label: 'Explore sample data',
    note: 'Look around a working setup before adding your own.',
  },
  { value: 'import', label: 'Import my data', note: 'Bring spreadsheets in and map the columns.' },
];

export const WMS_NEEDS: readonly Option<string>[] = [
  {
    value: 'receiving',
    label: 'Receiving and putaway',
    note: 'Check in POs and direct stock to a location.',
  },
  { value: 'pick_pack', label: 'Pick, pack and ship', note: 'Waves, jobs, packing stations and labels.' },
  { value: 'counts', label: 'Cycle counts', note: 'Cycle, blind, instant and SKU counts.' },
  { value: 'returns', label: 'Returns', note: 'A return station with RMAs and dispositions.' },
  { value: 'kitting', label: 'Kitting and work orders', note: 'Build kits and track components.' },
  { value: 'billing', label: '3PL client billing', note: 'Bill storage, handling and value-added work.' },
];

export const CRM_BOARDS: readonly Option<string>[] = [
  { value: 'deals', label: 'Deals', note: 'A pipeline with funnel and forecast.' },
  { value: 'leads', label: 'Leads', note: 'Qualify, then convert to a deal.' },
  { value: 'accounts', label: 'Accounts and contacts', note: 'A 360° page for every customer.' },
  { value: 'activities', label: 'Activities', note: 'Calls, meetings and follow-ups.' },
  { value: 'onboarding', label: 'Customer onboarding', note: 'Kick off when a deal is won.' },
  { value: 'renewals', label: 'Renewals', note: 'Know what is coming up.' },
];

/** Built-in Projects templates, read from the Projects app (see scripts/sync-projects.ts). */
export const PROJECT_TEMPLATES: readonly Option<string>[] = PROJECTS_CATALOG.templates.map((t) => ({
  value: t.slug,
  label: t.name,
  note: t.description,
}));

/** What a new Pulse workspace can look at first. Each one is a screen in the Pulse spec. */
export const PULSE_NEEDS: readonly Option<string>[] = [
  { value: 'job_profit', label: 'Profit by job', note: 'What each job earned and what it really cost.' },
  {
    value: 'client_profit',
    label: 'Profit by client and extra service',
    note: 'Which clients and extra services pay.',
  },
  { value: 'daily_log', label: 'Log work', note: 'Units, people and hours for each job, each day.' },
  {
    value: 'plan_actual',
    label: 'Quote vs actual',
    note: 'The quote next to what really happened.',
  },
  { value: 'at_risk', label: 'Jobs at risk', note: 'Open jobs that are off pace or losing money.' },
  { value: 'csv', label: 'CSV import and export', note: 'Bring spreadsheets in and take reports out.' },
];

export interface StakAnswers {
  /** The products chosen, in stack order. Empty until the first step is answered. */
  readonly products: Stack;
  readonly businessType: BusinessType | null;
  readonly teamSize: TeamSize;
  readonly seats: number;
  readonly warehouses: number;
  readonly wmsNeeds: readonly string[];
  readonly crmBoards: readonly string[];
  /** Projects templates to start from (built-in slugs). */
  readonly projectTemplates: readonly string[];
  /** What to see first in Pulse (`PULSE_NEEDS` values). */
  readonly pulseNeeds: readonly string[];
  readonly startMode: StartMode;
  /** Wants the founder-led setup add-on. */
  readonly guided: boolean;
  /** How often to pay. Old saved answers and old links may still say `annual`; it is read as yearly. */
  readonly billing: BillingInterval;
}

export const DEFAULT_ANSWERS: StakAnswers = {
  products: [],
  businessType: null,
  teamSize: 'small',
  seats: 5,
  warehouses: 1,
  wmsNeeds: [],
  crmBoards: [],
  projectTemplates: [],
  pulseNeeds: [],
  startMode: 'fresh',
  guided: false,
  billing: 'monthly',
};

export function hasProduct(answers: StakAnswers, product: ProductId): boolean {
  return answers.products.includes(product);
}

export const hasCrm = (answers: StakAnswers): boolean => hasProduct(answers, 'crm');
export const hasWms = (answers: StakAnswers): boolean => hasProduct(answers, 'wms');
export const hasProjects = (answers: StakAnswers): boolean => hasProduct(answers, 'projects');
export const hasPulse = (answers: StakAnswers): boolean => hasProduct(answers, 'pulse');

/** Whether the required answers for a step are in. `shape` and `launch` have sensible defaults. */
export function canLeaveStep(step: StepId, answers: StakAnswers): boolean {
  if (step === 'stack') return answers.products.length > 0;
  if (step === 'business') return answers.businessType !== null;
  return true;
}

export function withTeamSize(answers: StakAnswers, teamSize: TeamSize): StakAnswers {
  const seats = TEAM_SIZES.find((t) => t.value === teamSize)?.seats ?? answers.seats;
  return { ...answers, teamSize, seats };
}

export function toggleIn(list: readonly string[], value: string): readonly string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/* ------------------------------------------------------------------ Account */

export interface AccountDraft {
  readonly name: string;
  readonly email: string;
  readonly company: string;
}

export const EMPTY_ACCOUNT: AccountDraft = { name: '', email: '', company: '' };

export type AccountErrors = Partial<Record<keyof AccountDraft, string>>;

/** The same limits portal sign-up checks, so an answer that passes here passes there. */
const NAME_MIN = 2;
const NAME_MAX = 100;
const COMPANY_MIN = 2;
const COMPANY_MAX = 80;
const EMAIL_MAX = 120;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function accountErrors(draft: AccountDraft): AccountErrors {
  const name = draft.name.trim();
  const email = draft.email.trim();
  const company = draft.company.trim();
  return {
    ...(name.length < NAME_MIN
      ? { name: 'Enter your full name.' }
      : name.length > NAME_MAX
        ? { name: `Use ${NAME_MAX} characters or fewer.` }
        : {}),
    ...(!EMAIL.test(email) || email.length > EMAIL_MAX ? { email: 'Enter a valid work email.' } : {}),
    ...(company.length < COMPANY_MIN
      ? { company: 'Enter your company or team name.' }
      : company.length > COMPANY_MAX
        ? { company: `Use ${COMPANY_MAX} characters or fewer.` }
        : {}),
  };
}

/* ------------------------------------------------------------------ Hand-off and persistence */

/** The cart the answers describe: the apps open today, the sizes and how often to pay. */
export function selectionOf(answers: StakAnswers): PlanSelection {
  return normalizeSelection({
    products: startableStack(answers.products),
    seats: answers.seats,
    warehouses: answers.warehouses,
    interval: answers.billing,
  });
}

/**
 * Portal sign-up link for a cart, with nothing else. Used by the price calculator and the product
 * pages, where a visitor starts a free trial without the wizard. A product whose app is not open
 * yet is never handed to sign-up; a cart with nothing open gives the plain sign-up page.
 */
export function trialUrl(selection: PlanSelection, source: HandoffSource): string {
  const products = startableStack(selection.products);
  const handoff: SignupHandoff = {
    selection: products.length > 0 ? normalizeSelection({ ...selection, products }) : null,
    profile: {},
    source,
  };
  return signupUrl(LINKS.portal, handoff);
}

/**
 * Portal sign-up link carrying the wizard's answers: the cart (apps, seats, warehouses, period) and
 * the business answers in the query, and name, email and company after the "#". The part after the
 * "#" never reaches a server or a log. The link holds no price: the portal prices the cart itself
 * from the shared catalog. A product whose app is not open yet is never handed to sign-up.
 */
export function handoffUrl(answers: StakAnswers, account?: AccountDraft): string {
  const selection = selectionOf(answers);
  const handoff: SignupHandoff = {
    selection: selection.products.length > 0 ? selection : null,
    profile: {
      ...(answers.businessType ? { businessType: answers.businessType } : {}),
      teamSize: answers.teamSize,
      startMode: answers.startMode,
      guided: answers.guided,
    },
    source: 'wizard',
  };
  const identity: HandoffIdentity | undefined = account
    ? { name: account.name, email: account.email, company: account.company }
    : undefined;
  return signupUrl(LINKS.portal, handoff, identity);
}

/** Reads a saved or linked period. `annual` is the word older answers and links used for yearly. */
function intervalFrom(value: unknown): BillingInterval | null {
  if (value === 'monthly') return 'monthly';
  if (value === 'yearly' || value === 'annual') return 'yearly';
  return null;
}

function oneOf<T extends string>(options: readonly Option<T>[], value: unknown): T | null {
  return options.find((o) => o.value === value)?.value ?? null;
}

function clampInt(value: unknown, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.round(value), 1), max);
}

function knownValues(options: readonly Option<string>[], value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return options.map((o) => o.value).filter((v) => value.includes(v));
}

/**
 * Rebuilds answers from untrusted storage, keeping only values the wizard itself could produce. A
 * product whose app is not open yet is dropped, so an old saved answer cannot carry it to sign-up.
 */
export function parseAnswers(raw: unknown): StakAnswers {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_ANSWERS;
  const data = raw as Record<string, unknown>;
  const savedProducts = Array.isArray(data.products)
    ? toStack(data.products.filter((p): p is string => typeof p === 'string'))
    : // Answers saved before Projects joined the stack carried `focus` instead.
      parseStack(typeof data.focus === 'string' ? data.focus : null);
  return {
    products: startableStack(savedProducts),
    businessType: oneOf(BUSINESS_TYPES, data.businessType),
    teamSize: oneOf(TEAM_SIZES, data.teamSize) ?? DEFAULT_ANSWERS.teamSize,
    seats: clampInt(data.seats, MAX_SEATS, DEFAULT_ANSWERS.seats),
    warehouses: clampInt(data.warehouses, MAX_WAREHOUSES, DEFAULT_ANSWERS.warehouses),
    wmsNeeds: knownValues(WMS_NEEDS, data.wmsNeeds),
    crmBoards: knownValues(CRM_BOARDS, data.crmBoards),
    projectTemplates: knownValues(PROJECT_TEMPLATES, data.projectTemplates),
    pulseNeeds: knownValues(PULSE_NEEDS, data.pulseNeeds),
    startMode: oneOf(START_MODES, data.startMode) ?? DEFAULT_ANSWERS.startMode,
    guided: data.guided === true,
    billing: intervalFrom(data.billing) ?? DEFAULT_ANSWERS.billing,
  };
}

/* ------------------------------------------------------------------ Deep links into the wizard */

export interface WizardPrefill {
  readonly stack: Stack;
  readonly seats: number;
  readonly warehouses: number;
  readonly billing: BillingInterval;
}

/**
 * Wizard link that carries a priced stack from the calculator, so nobody re-enters it. A product
 * whose app is not open yet is left out. If nothing in the stack is open, the link goes to the
 * walkthrough form.
 */
export function wizardHref(prefill: WizardPrefill): string {
  const stack = startableStack(prefill.stack);
  if (stack.length === 0) return walkthroughHref(prefill.stack);
  const params = new URLSearchParams({
    stack: stackParam(stack),
    seats: String(prefill.seats),
    warehouses: String(prefill.warehouses),
    billing: prefill.billing,
  });
  return `${ROUTES.getStarted}?${params.toString()}`;
}

/**
 * True when a link asks only for products nobody can set up yet, such as a link for Pulse alone while
 * Pulse is coming soon. The wizard has nothing to set up for that visitor. It sends them to the walkthrough
 * form, where they would land from any button on the site, and does not open on some other product.
 */
export function asksOnlyForUnopenedProducts(params: URLSearchParams): boolean {
  const asked = parseStack(params.get('stack'));
  return asked.length > 0 && startableStack(asked).length === 0;
}

/**
 * Applies whatever valid prefill values the query string holds on top of `base`. A product whose
 * app is not open yet is ignored, so a typed or old link cannot put it in the stack.
 */
export function applyPrefill(base: StakAnswers, params: URLSearchParams): StakAnswers {
  const stack = startableStack(parseStack(params.get('stack')));
  const seats = params.get('seats');
  const warehouses = params.get('warehouses');
  const billing = params.get('billing');
  return {
    ...base,
    products: stack.length > 0 ? stack : base.products,
    seats: seats === null ? base.seats : clampInt(Number(seats), MAX_SEATS, base.seats),
    warehouses:
      warehouses === null ? base.warehouses : clampInt(Number(warehouses), MAX_WAREHOUSES, base.warehouses),
    billing: intervalFrom(billing) ?? base.billing,
  };
}
