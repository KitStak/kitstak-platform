/**
 * Model for the "Set up your Stak" wizard. The answer names and values match the portal's own
 * welcome wizard profile (`focus`, `businessType`, `teamSize`, `startMode`; see
 * docs/integration/ONBOARDING.md) so the answers can be handed to the portal at sign-up. The
 * portal's `focus` only knows the CRM and the WMS, so the full product set travels separately as
 * `products`.
 */
import { LINKS, ROUTES, parseStack, stackParam, toStack } from '@/components/site-links';
import type { ProductId, Stack } from '@/components/site-links';
import { PROJECTS_CATALOG } from '@/generated/projects/catalog';
import { PRICING } from './pricing';
import type { Billing } from './pricing';

export type BusinessType = '3pl' | 'brand' | 'distributor' | 'other';
export type TeamSize = 'solo' | 'small' | 'medium' | 'large';
export type StartMode = 'fresh' | 'sample' | 'import';

export const STEP_IDS = ['stack', 'business', 'shape', 'launch', 'account'] as const;
export type StepId = (typeof STEP_IDS)[number];

export interface Option<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly note: string;
}

export const BUSINESS_TYPES: readonly Option<BusinessType>[] = [
  { value: '3pl', label: '3PL warehouse', note: 'You store and ship for other companies.' },
  { value: 'brand', label: 'Brand or e-commerce', note: 'You sell your own products.' },
  { value: 'distributor', label: 'Distributor or wholesale', note: 'You buy, stock and resell.' },
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
  { value: 'sample', label: 'Explore sample data', note: 'Look around a working setup before adding your own.' },
  { value: 'import', label: 'Import my data', note: 'Bring spreadsheets in and map the columns.' },
];

export const WMS_NEEDS: readonly Option<string>[] = [
  { value: 'receiving', label: 'Receiving and putaway', note: 'Check in POs and direct stock to a location.' },
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
  readonly startMode: StartMode;
  /** Wants the founder-led setup add-on. */
  readonly guided: boolean;
  readonly billing: Billing;
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
  startMode: 'fresh',
  guided: false,
  billing: 'annual',
};

export function hasProduct(answers: StakAnswers, product: ProductId): boolean {
  return answers.products.includes(product);
}

export const hasCrm = (answers: StakAnswers): boolean => hasProduct(answers, 'crm');
export const hasWms = (answers: StakAnswers): boolean => hasProduct(answers, 'wms');
export const hasProjects = (answers: StakAnswers): boolean => hasProduct(answers, 'projects');

/** The portal profile's `focus` (CRM and WMS only), or null when neither is in the stack. */
export function portalFocus(stack: Stack): 'crm' | 'wms' | 'both' | null {
  const crm = stack.includes('crm');
  const wms = stack.includes('wms');
  return crm && wms ? 'both' : crm ? 'crm' : wms ? 'wms' : null;
}

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

/* ------------------------------------------------------------------ Setup plan */

export interface PlanStep {
  readonly key: string;
  readonly app: 'Portal' | 'CRM' | 'WMS' | 'Projects';
  readonly title: string;
  readonly note: string;
  readonly isDone: boolean;
}

/**
 * The checklist a new organization sees after sign-up, in the order the portal uses: solo teams
 * skip the invite, 3PLs and distributors start in the warehouse, everyone else starts in the CRM.
 * Titles are the canonical onboarding step titles. Projects runs its own first-run (a starter
 * project from a built-in template and a guided tour), so its step comes last.
 */
export function setupPlan(answers: StakAnswers): readonly PlanStep[] {
  const isImport = answers.startMode === 'import';
  const isSample = answers.startMode === 'sample';

  const crm: readonly PlanStep[] = [
    {
      key: 'create_workspace',
      app: 'CRM',
      title: 'Create your CRM workspace',
      note: isSample ? 'Start from a template with sample records.' : 'Pick the boards your team will work from.',
      isDone: false,
    },
    { key: 'first_deal', app: 'CRM', title: 'Add your first deal', note: 'One real deal makes the pipeline click.', isDone: false },
  ];
  const wms: readonly PlanStep[] = [
    { key: 'create_warehouse', app: 'WMS', title: 'Create your warehouse', note: 'Name it and generate its locations.', isDone: false },
    {
      key: 'build_catalog',
      app: 'WMS',
      title: 'Build your product catalog',
      note: isImport ? 'Import your SKUs from a spreadsheet.' : 'Add the products you stock.',
      isDone: false,
    },
    { key: 'first_order', app: 'WMS', title: 'Create your first order', note: 'Take one order from allocation to label.', isDone: false },
  ];

  const chosenTemplate = PROJECT_TEMPLATES.find((t) => answers.projectTemplates.includes(t.value));
  const projects: readonly PlanStep[] = [
    {
      key: 'first_project',
      app: 'Projects',
      title: 'Start your first project',
      note: chosenTemplate
        ? `From the ${chosenTemplate.label} template, with its tasks, dates and rules in place.`
        : isSample
          ? 'Open the sample project and take the short tour.'
          : 'Pick a template or start from a blank board.',
      isDone: false,
    },
  ];

  const isWarehouseFirst = answers.businessType === '3pl' || answers.businessType === 'distributor';
  const crmSteps = hasCrm(answers) ? crm : [];
  const wmsSteps = hasWms(answers) ? wms : [];

  return [
    { key: 'profile', app: 'Portal', title: 'Tell us about your business', note: 'Done here.', isDone: true },
    ...(answers.teamSize === 'solo'
      ? []
      : [{ key: 'invite_team', app: 'Portal' as const, title: 'Invite your team', note: 'One invite covers every app.', isDone: false }]),
    ...(isWarehouseFirst ? [...wmsSteps, ...crmSteps] : [...crmSteps, ...wmsSteps]),
    ...(hasProjects(answers) ? projects : []),
  ];
}

/* ------------------------------------------------------------------ Account */

export interface AccountDraft {
  readonly name: string;
  readonly email: string;
  readonly company: string;
}

export const EMPTY_ACCOUNT: AccountDraft = { name: '', email: '', company: '' };

export type AccountErrors = Partial<Record<keyof AccountDraft, string>>;

const MAX_FIELD = 120;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function accountErrors(draft: AccountDraft): AccountErrors {
  const name = draft.name.trim();
  const email = draft.email.trim();
  const company = draft.company.trim();
  return {
    ...(name === '' ? { name: 'Enter your name.' } : name.length > MAX_FIELD ? { name: 'That name is too long.' } : {}),
    ...(email === ''
      ? { email: 'Enter your work email.' }
      : !EMAIL.test(email) || email.length > MAX_FIELD
        ? { email: 'That does not look like an email address.' }
        : {}),
    ...(company === ''
      ? { company: 'Enter your company or team name.' }
      : company.length > MAX_FIELD
        ? { company: 'That name is too long.' }
        : {}),
  };
}

/* ------------------------------------------------------------------ Hand-off and persistence */

/**
 * Portal sign-up link carrying the setup answers. Only the non-personal profile answers travel in
 * the URL; name, email and company never do.
 */
export function handoffUrl(answers: StakAnswers): string {
  const params = new URLSearchParams();
  const focus = portalFocus(answers.products);
  if (focus) params.set('focus', focus);
  if (answers.products.length > 0) params.set('products', stackParam(answers.products));
  if (answers.businessType) params.set('businessType', answers.businessType);
  params.set('teamSize', answers.teamSize);
  params.set('startMode', answers.startMode);
  return `${LINKS.portal}/signup?${params.toString()}`;
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

/** Rebuilds answers from untrusted storage, keeping only values the wizard itself could produce. */
export function parseAnswers(raw: unknown): StakAnswers {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_ANSWERS;
  const data = raw as Record<string, unknown>;
  const savedProducts = Array.isArray(data.products)
    ? toStack(data.products.filter((p): p is string => typeof p === 'string'))
    : // Answers saved before Projects joined the stack carried `focus` instead.
      parseStack(typeof data.focus === 'string' ? data.focus : null);
  return {
    products: savedProducts,
    businessType: oneOf(BUSINESS_TYPES, data.businessType),
    teamSize: oneOf(TEAM_SIZES, data.teamSize) ?? DEFAULT_ANSWERS.teamSize,
    seats: clampInt(data.seats, PRICING.crm.max, DEFAULT_ANSWERS.seats),
    warehouses: clampInt(data.warehouses, PRICING.wms.max, DEFAULT_ANSWERS.warehouses),
    wmsNeeds: knownValues(WMS_NEEDS, data.wmsNeeds),
    crmBoards: knownValues(CRM_BOARDS, data.crmBoards),
    projectTemplates: knownValues(PROJECT_TEMPLATES, data.projectTemplates),
    startMode: oneOf(START_MODES, data.startMode) ?? DEFAULT_ANSWERS.startMode,
    guided: data.guided === true,
    billing: data.billing === 'monthly' ? 'monthly' : DEFAULT_ANSWERS.billing,
  };
}

/* ------------------------------------------------------------------ Deep links into the wizard */

export interface WizardPrefill {
  readonly stack: Stack;
  readonly seats: number;
  readonly warehouses: number;
  readonly billing: Billing;
}

/** Wizard link that carries a priced stack from the calculator, so nobody re-enters it. */
export function wizardHref(prefill: WizardPrefill): string {
  const params = new URLSearchParams({
    stack: stackParam(prefill.stack),
    seats: String(prefill.seats),
    warehouses: String(prefill.warehouses),
    billing: prefill.billing,
  });
  return `${ROUTES.getStarted}?${params.toString()}`;
}

/** Applies whatever valid prefill values the query string holds on top of `base`. */
export function applyPrefill(base: StakAnswers, params: URLSearchParams): StakAnswers {
  const stack = parseStack(params.get('stack'));
  const seats = params.get('seats');
  const warehouses = params.get('warehouses');
  const billing = params.get('billing');
  return {
    ...base,
    products: stack.length > 0 ? stack : base.products,
    seats: seats === null ? base.seats : clampInt(Number(seats), PRICING.crm.max, base.seats),
    warehouses: warehouses === null ? base.warehouses : clampInt(Number(warehouses), PRICING.wms.max, base.warehouses),
    billing: billing === 'monthly' || billing === 'annual' ? billing : base.billing,
  };
}
