/**
 * Create-board setup rules (pure): "what are you managing" options, the template each CRM
 * object seeds, item terminology, validation and the remembered privacy per workspace.
 */
import type { BoardKind, BoardPrivacy } from '@/server/services/contracts/dto';

export const BOARD_NAME_MAX = 120;
export const TERMINOLOGY_MAX = 40;

export type ManagingId =
  | 'deals'
  | 'leads'
  | 'contacts'
  | 'accounts'
  | 'activities'
  | 'projects'
  | 'tasks'
  | 'items'
  | 'custom';

export interface ManagingOption {
  readonly id: ManagingId;
  readonly label: string;
  /** Singular noun used on "+ Add deal", counts and toasts. */
  readonly singular: string;
  /** Template seeded when the board is started blank (CRM objects get real columns). */
  readonly templateId: string;
  readonly kind: BoardKind;
}

export const MANAGING_OPTIONS: readonly ManagingOption[] = [
  { id: 'deals', label: 'Deals', singular: 'Deal', templateId: 'crm-deals', kind: 'deals' },
  { id: 'leads', label: 'Leads', singular: 'Lead', templateId: 'crm-leads', kind: 'leads' },
  { id: 'contacts', label: 'Contacts', singular: 'Contact', templateId: 'crm-contacts', kind: 'contacts' },
  { id: 'accounts', label: 'Accounts', singular: 'Account', templateId: 'crm-accounts', kind: 'accounts' },
  { id: 'activities', label: 'Activities', singular: 'Activity', templateId: 'crm-activities', kind: 'activities' },
  { id: 'projects', label: 'Projects', singular: 'Project', templateId: 'proj-tracker', kind: 'projects' },
  { id: 'tasks', label: 'Tasks', singular: 'Task', templateId: 'blank', kind: 'custom' },
  { id: 'items', label: 'Items', singular: 'Item', templateId: 'blank', kind: 'custom' },
  { id: 'custom', label: 'Custom…', singular: '', templateId: 'blank', kind: 'custom' },
];

export function managingOption(id: ManagingId): ManagingOption {
  return MANAGING_OPTIONS.find((option) => option.id === id) ?? (MANAGING_OPTIONS[7] as ManagingOption);
}

/** Best managing chip for a template's terminology (falls back to Custom with that noun). */
export function managingForTerminology(terminology: string): ManagingId {
  const match = MANAGING_OPTIONS.find(
    (option) => option.id !== 'custom' && option.singular.toLowerCase() === terminology.trim().toLowerCase(),
  );
  return match?.id ?? 'custom';
}

export interface BoardSetupState {
  readonly name: string;
  readonly managing: ManagingId;
  readonly customTerm: string;
  readonly privacy: BoardPrivacy;
  readonly workspaceId: string | null;
  readonly folderId: string | null;
  readonly withSampleData: boolean;
}

export interface BoardSetupErrors {
  readonly name?: string;
  readonly customTerm?: string;
  readonly workspaceId?: string;
}

export function terminologyFor(state: Pick<BoardSetupState, 'managing' | 'customTerm'>): string {
  if (state.managing === 'custom') return state.customTerm.trim();
  return managingOption(state.managing).singular;
}

export function validateBoardSetup(state: BoardSetupState): BoardSetupErrors {
  const errors: { name?: string; customTerm?: string; workspaceId?: string } = {};
  const name = state.name.trim();
  if (!name) errors.name = 'Give your board a name.';
  else if (name.length > BOARD_NAME_MAX) errors.name = `Use ${BOARD_NAME_MAX} characters or fewer.`;
  if (state.managing === 'custom') {
    const term = state.customTerm.trim();
    if (!term) errors.customTerm = 'Tell us what one row is called, e.g. “Shipment”.';
    else if (term.length > TERMINOLOGY_MAX) errors.customTerm = `Use ${TERMINOLOGY_MAX} characters or fewer.`;
  }
  if (!state.workspaceId) errors.workspaceId = 'Choose a workspace.';
  return errors;
}

export function hasErrors(errors: BoardSetupErrors): boolean {
  return Boolean(errors.name || errors.customTerm || errors.workspaceId);
}

/**
 * Template to instantiate. A chosen gallery template always wins; a blank start seeds the
 * chosen CRM object's template so a "Deals" board arrives with Stage, Value, Close date…
 */
export function resolveTemplateId(baseTemplateId: string | null, managing: ManagingId): string {
  if (baseTemplateId && baseTemplateId !== 'blank') return baseTemplateId;
  return managingOption(managing).templateId;
}

/** Lower-case plural-free noun for the "+ Add deal" preview. */
export function addItemLabel(terminology: string): string {
  const term = terminology.trim() || 'item';
  return `New ${term.charAt(0).toLowerCase()}${term.slice(1)}`;
}

const PRIVACY_KEY = 'kitstak.wizards.privacy.v1';

function readPrivacyMap(storage: Pick<Storage, 'getItem'> | null): Record<string, BoardPrivacy> {
  try {
    const raw = storage?.getItem(PRIVACY_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, BoardPrivacy] =>
          entry[1] === 'main' || entry[1] === 'private' || entry[1] === 'shareable',
      ),
    );
  } catch {
    return {};
  }
}

function browserStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Last privacy chosen in this workspace (WZ-012), defaulting to Main. */
export function rememberedPrivacy(workspaceId: string | null, storage = browserStorage()): BoardPrivacy {
  if (!workspaceId) return 'main';
  return readPrivacyMap(storage)[workspaceId] ?? 'main';
}

export function rememberPrivacy(workspaceId: string, privacy: BoardPrivacy, storage = browserStorage()): void {
  try {
    const next = { ...readPrivacyMap(storage), [workspaceId]: privacy };
    storage?.setItem(PRIVACY_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable: the default applies next time */
  }
}
