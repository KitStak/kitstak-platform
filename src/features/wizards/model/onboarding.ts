/**
 * Welcome / onboarding flow model (pure): steps, options, per-step validation, the starter
 * recommendation and the payload sent to POST /api/v1/onboarding.
 */
import { z } from 'zod';
import type { Invitee } from './invites';

export const ONBOARDING_STEPS = [
  { id: 'about', title: 'About you', optional: false },
  { id: 'team', title: 'Team size', optional: true },
  { id: 'manage', title: 'What you manage', optional: true },
  { id: 'starter', title: 'Starter CRM', optional: false },
  { id: 'invite', title: 'Invite teammates', optional: true },
  { id: 'done', title: 'Done', optional: false },
] as const;
export type OnboardingStepId = (typeof ONBOARDING_STEPS)[number]['id'];

export const ROLE_OPTIONS = [
  { id: 'sdr', label: 'Sales development', hint: 'Prospecting and qualifying' },
  { id: 'ae', label: 'Account executive', hint: 'Running deals to close' },
  { id: 'manager', label: 'Sales leader', hint: 'Coaching and forecasting' },
  { id: 'founder', label: 'Founder or exec', hint: 'Owning the number' },
  { id: 'cs', label: 'Customer success', hint: 'Onboarding and renewals' },
  { id: 'revops', label: 'Revenue operations', hint: 'Process and reporting' },
  { id: 'marketing', label: 'Marketing', hint: 'Campaigns and pipeline' },
  { id: 'other', label: 'Something else', hint: 'We’ll keep it flexible' },
] as const;
export type RoleId = (typeof ROLE_OPTIONS)[number]['id'];

export const TEAM_SIZES = ['1', '2-5', '6-20', '21-100', '101-500', '500+'] as const;
export type TeamSize = (typeof TEAM_SIZES)[number];

export const MANAGE_OPTIONS = [
  { id: 'leads', label: 'Leads' },
  { id: 'deals', label: 'Deals & pipeline' },
  { id: 'contacts', label: 'Contacts' },
  { id: 'accounts', label: 'Accounts' },
  { id: 'activities', label: 'Calls & meetings' },
  { id: 'onboarding', label: 'Customer onboarding' },
  { id: 'renewals', label: 'Renewals' },
  { id: 'quotes', label: 'Quotes & proposals' },
] as const;
export type ManageId = (typeof MANAGE_OPTIONS)[number]['id'];

export const STARTERS = [
  {
    id: 'full',
    title: 'Full sales CRM',
    description: 'Leads, Deals, Accounts, Contacts and Activities, connected, plus a sales dashboard.',
    templateIds: ['crm-leads', 'crm-deals', 'crm-accounts', 'crm-contacts', 'crm-activities'],
  },
  {
    id: 'pipeline',
    title: 'Pipeline essentials',
    description: 'Deals with the Accounts and Contacts they belong to. Add leads any time.',
    templateIds: ['crm-deals', 'crm-accounts', 'crm-contacts'],
  },
  {
    id: 'prospecting',
    title: 'Prospecting',
    description: 'Leads, Contacts and Activities to work outbound lists and log every touch.',
    templateIds: ['crm-leads', 'crm-contacts', 'crm-activities'],
  },
  {
    id: 'success',
    title: 'Customer success',
    description: 'Accounts, Contacts, onboarding projects and renewals in one place.',
    templateIds: ['crm-accounts', 'crm-contacts', 'cs-onboarding', 'cs-renewals'],
  },
] as const;
export type StarterId = (typeof STARTERS)[number]['id'];

export interface OnboardingDraft {
  readonly organizationName: string;
  readonly role: RoleId | null;
  readonly teamSize: TeamSize | null;
  readonly manages: readonly ManageId[];
  readonly starter: StarterId | null;
  readonly withSampleData: boolean;
  readonly invitees: readonly Invitee[];
}

export const EMPTY_DRAFT: OnboardingDraft = {
  organizationName: '',
  role: null,
  teamSize: null,
  manages: [],
  starter: null,
  withSampleData: true,
  invitees: [],
};

export const ORG_NAME_MIN = 2;
export const ORG_NAME_MAX = 80;

export function validateStep(step: OnboardingStepId, draft: OnboardingDraft): Record<string, string> {
  if (step === 'about') {
    const name = draft.organizationName.trim();
    if (name.length < ORG_NAME_MIN) return { organizationName: 'Enter your company or team name (2+ characters).' };
    if (name.length > ORG_NAME_MAX) return { organizationName: `Use ${ORG_NAME_MAX} characters or fewer.` };
  }
  return {};
}

/** Starter that fits what the user told us (role + what they manage). */
export function recommendStarter(draft: Pick<OnboardingDraft, 'role' | 'manages'>): StarterId {
  const manages = new Set(draft.manages);
  if (draft.role === 'cs' || ((manages.has('onboarding') || manages.has('renewals')) && !manages.has('deals')))
    return 'success';
  if (draft.role === 'sdr' || (manages.has('leads') && !manages.has('deals') && !manages.has('accounts')))
    return 'prospecting';
  if (draft.role === 'ae' && !manages.has('leads')) return 'pipeline';
  return 'full';
}

export function starterById(id: StarterId) {
  return STARTERS.find((starter) => starter.id === id) ?? STARTERS[0];
}

/** Extra boards implied by "what you manage" that the starter does not already include. */
export function starterTemplateIds(starter: StarterId, manages: readonly ManageId[]): string[] {
  const ids: string[] = [...starterById(starter).templateIds];
  const extras: Partial<Record<ManageId, string>> = {
    onboarding: 'cs-onboarding',
    renewals: 'cs-renewals',
    quotes: 'sales-quotes',
  };
  for (const manage of manages) {
    const extra = extras[manage];
    if (extra && !ids.includes(extra)) ids.push(extra);
  }
  return ids.slice(0, 10);
}

/** Every board a starter (plus "what you manage" extras) can install: previews for /welcome. */
export const STARTER_PREVIEW_IDS: readonly string[] = [
  ...new Set([...STARTERS.flatMap((starter) => starter.templateIds), 'cs-onboarding', 'cs-renewals', 'sales-quotes']),
];

export function workspaceNameFor(starter: StarterId): string {
  return starter === 'success' ? 'Customer Success' : 'Sales CRM';
}

export function fallbackOrgName(firstName: string): string {
  const first = firstName.trim();
  return first ? `${first}’s team` : 'My team';
}

export interface OnboardingPayload {
  readonly organizationName: string;
  readonly workspaceName: string;
  readonly templateIds: readonly string[];
  readonly withSampleData: boolean;
  readonly teamSize?: TeamSize;
  readonly role?: string;
  readonly manages?: readonly string[];
  readonly useCase?: string;
}

export function buildOnboardingPayload(draft: OnboardingDraft, firstName: string): OnboardingPayload {
  const starter = draft.starter ?? recommendStarter(draft);
  const name = draft.organizationName.trim();
  return {
    organizationName: name.length >= ORG_NAME_MIN ? name.slice(0, ORG_NAME_MAX) : fallbackOrgName(firstName),
    workspaceName: workspaceNameFor(starter),
    templateIds: starterTemplateIds(starter, draft.manages),
    withSampleData: draft.withSampleData,
    ...(draft.teamSize ? { teamSize: draft.teamSize } : {}),
    ...(draft.role ? { role: draft.role } : {}),
    ...(draft.manages.length ? { manages: [...draft.manages] } : {}),
    useCase: `starter:${starter}`,
  };
}

// Draft persistence (resume where you left off) ----------------------------------------------

const DRAFT_KEY = 'kitstak.welcome.draft.v1';

const draftSchema = z.object({
  step: z.number().int().min(0).max(ONBOARDING_STEPS.length - 1),
  draft: z.object({
    organizationName: z.string().max(200),
    role: z.enum(ROLE_OPTIONS.map((option) => option.id) as [RoleId, ...RoleId[]]).nullable(),
    teamSize: z.enum(TEAM_SIZES).nullable(),
    manages: z.array(z.enum(MANAGE_OPTIONS.map((option) => option.id) as [ManageId, ...ManageId[]])).max(20),
    starter: z.enum(STARTERS.map((starter) => starter.id) as [StarterId, ...StarterId[]]).nullable(),
    withSampleData: z.boolean(),
    invitees: z
      .array(
        z.object({
          email: z.string().max(320),
          role: z.enum(['admin', 'member', 'viewer', 'guest']),
          name: z.string().max(120).optional(),
        }),
      )
      .max(50),
  }),
});

export interface SavedDraft {
  readonly step: number;
  readonly draft: OnboardingDraft;
}

export function loadDraft(storage: Pick<Storage, 'getItem'> | null): SavedDraft | null {
  try {
    const raw = storage?.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = draftSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    // Never resume on the "done" step: the org would not exist yet.
    const step = Math.min(parsed.data.step, ONBOARDING_STEPS.length - 2);
    return { step, draft: parsed.data.draft };
  } catch {
    return null;
  }
}

export function saveDraft(storage: Pick<Storage, 'setItem'> | null, value: SavedDraft): void {
  try {
    storage?.setItem(DRAFT_KEY, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

export function clearDraft(storage: Pick<Storage, 'removeItem'> | null): void {
  try {
    storage?.removeItem(DRAFT_KEY);
  } catch {
    /* storage unavailable */
  }
}

// Retry safety -------------------------------------------------------------------------------

export interface OrgMembershipLike {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly role: string;
}

/**
 * After a POST /onboarding whose response was lost, find the organization that request created:
 * one the user owns, that was not there before the first attempt, with the submitted name.
 * Retrying then continues to it instead of creating a duplicate.
 */
export function findCommittedOrg<T extends OrgMembershipLike>(
  organizations: readonly T[],
  knownIds: ReadonlySet<string>,
  organizationName: string,
): T | null {
  const wanted = organizationName.trim().toLowerCase();
  return (
    organizations.find(
      (org) => !knownIds.has(org.id) && org.role === 'owner' && org.name.trim().toLowerCase() === wanted,
    ) ?? null
  );
}
