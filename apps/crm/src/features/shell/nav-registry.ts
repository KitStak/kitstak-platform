/**
 * Navigation registry shared by the command palette's "Go to" group: every destination the
 * sidebar can reach (primary nav, CRM pages, dashboards, admin, trash, workspace overviews),
 * with search keywords and G-chord hints. Pure (no React) so it is unit-tested.
 */
import { routes } from './routes';

export type NavIconKey =
  | 'home'
  | 'mywork'
  | 'inbox'
  | 'pipeline'
  | 'deals'
  | 'leads'
  | 'contacts'
  | 'accounts'
  | 'activities'
  | 'duplicates'
  | 'dashboards'
  | 'automations'
  | 'import'
  | 'trash'
  | 'admin'
  | 'settings'
  | 'workspace';

export interface NavCommand {
  readonly id: string;
  readonly label: string;
  readonly keywords: string;
  readonly href: string;
  readonly icon: NavIconKey;
  /** G-chord hint ("G H"). */
  readonly hint?: string;
  /** Secondary line (e.g. "Workspace"). */
  readonly meta?: string;
  /** Workspace color for workspace overview rows. */
  readonly color?: string;
}

export type CrmObjectKey = 'deals' | 'leads' | 'contacts' | 'accounts' | 'activities';

export interface NavRegistryInput {
  readonly orgSlug: string;
  /** Primary CRM board ids by object (absent while loading or when not provisioned). */
  readonly crmBoards?: Partial<Record<CrmObjectKey, { readonly id: string }>>;
  readonly workspaces?: readonly { readonly id: string; readonly name: string; readonly color?: string | null }[];
  readonly canAdmin?: boolean;
}

/** G-chord second keys, shared with `useShellHotkeys`. */
export const G_CHORDS: Readonly<Record<string, (orgSlug: string) => string>> = {
  h: routes.home,
  m: routes.myWork,
  i: routes.inbox,
  d: (orgSlug) => `/${orgSlug}/dashboards`,
  p: (orgSlug) => `/${orgSlug}/crm/pipeline`,
};

const CRM_OBJECTS: readonly { key: CrmObjectKey; label: string; keywords: string }[] = [
  { key: 'deals', label: 'Deals', keywords: 'crm deals opportunities sales board' },
  { key: 'leads', label: 'Leads', keywords: 'crm leads prospects board' },
  { key: 'contacts', label: 'Contacts', keywords: 'crm contacts people customers board' },
  { key: 'accounts', label: 'Accounts', keywords: 'crm accounts companies organizations board' },
  { key: 'activities', label: 'Activities', keywords: 'crm activities calls meetings emails board' },
];

export function buildNavCommands(input: NavRegistryInput): NavCommand[] {
  const { orgSlug } = input;
  const list: NavCommand[] = [
    { id: 'go-home', label: 'Home', keywords: 'go home start overview', href: routes.home(orgSlug), icon: 'home', hint: 'G H' },
    { id: 'go-mywork', label: 'My work', keywords: 'go my work tasks due assigned', href: routes.myWork(orgSlug), icon: 'mywork', hint: 'G M' },
    { id: 'go-inbox', label: 'Inbox', keywords: 'go inbox notifications updates mentions', href: routes.inbox(orgSlug), icon: 'inbox', hint: 'G I' },
  ];
  const crm = input.crmBoards ?? {};
  if (crm.deals) {
    list.push({ id: 'go-pipeline', label: 'Pipeline', keywords: 'crm pipeline forecast cockpit funnel deals', href: `/${orgSlug}/crm/pipeline`, icon: 'pipeline', hint: 'G P', meta: 'CRM' });
  }
  for (const object of CRM_OBJECTS) {
    const board = crm[object.key];
    if (!board) continue;
    list.push({ id: `go-${object.key}`, label: object.label, keywords: object.keywords, href: routes.board(orgSlug, board.id), icon: object.key, meta: 'CRM' });
  }
  if (crm.contacts || crm.accounts) {
    list.push({ id: 'go-duplicates', label: 'Duplicates', keywords: 'crm duplicates merge dedupe', href: `/${orgSlug}/crm/duplicates`, icon: 'duplicates', meta: 'CRM' });
  }
  list.push(
    { id: 'go-dashboards', label: 'Dashboards', keywords: 'dashboards reports charts widgets analytics', href: `/${orgSlug}/dashboards`, icon: 'dashboards', hint: 'G D' },
    { id: 'go-automations', label: 'Automations', keywords: 'automations rules recipes workflows', href: `/${orgSlug}/automations`, icon: 'automations' },
    { id: 'go-import', label: 'Import', keywords: 'import csv excel upload data', href: routes.importData(orgSlug), icon: 'import' },
    { id: 'go-trash', label: 'Trash', keywords: 'trash deleted archive restore recycle bin', href: routes.trash(orgSlug), icon: 'trash' },
    { id: 'go-settings', label: 'Profile settings', keywords: 'settings profile preferences account', href: routes.profile(orgSlug), icon: 'settings' },
  );
  if (input.canAdmin) {
    list.push({ id: 'go-admin', label: 'Admin', keywords: 'admin administration members users permissions security billing settings', href: routes.admin(orgSlug), icon: 'admin' });
  }
  for (const workspace of input.workspaces ?? []) {
    list.push({
      id: `go-ws-${workspace.id}`,
      label: workspace.name,
      keywords: 'workspace overview',
      href: routes.workspace(orgSlug, workspace.id),
      icon: 'workspace',
      meta: 'Workspace overview',
      color: workspace.color ?? undefined,
    });
  }
  return list;
}

/** Default "Go to" rows shown with an empty query (not the whole registry). */
export const DEFAULT_NAV_IDS: ReadonlySet<string> = new Set(['go-home', 'go-mywork', 'go-inbox', 'go-pipeline', 'go-dashboards']);
