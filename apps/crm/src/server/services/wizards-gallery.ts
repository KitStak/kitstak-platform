/**
 * Template-center gallery (wizards module). Pure and client-safe: it maps the board template
 * definitions to a preview-rich DTO (columns, groups, views, sample rows) plus gallery metadata
 * (category, tags, badges), and describes multi-board "solutions" such as the CRM suite.
 */
import type { ColumnType, LabelColor } from '@/server/db/schema/cell-values';
import { getColumnTypeDefinition } from '@/server/db/schema/column-types';
import type { BoardKind, ViewType } from './contracts/dto';
import { BOARD_TEMPLATES, CRM_WORKSPACE_TEMPLATE_IDS, findTemplate } from './templates/crm';
import type { BoardTemplate } from './templates/types';

export const GALLERY_CATEGORIES = [
  'crm',
  'sales',
  'marketing',
  'customer-success',
  'projects',
  'operations',
  'hr',
  'blank',
] as const;
export type GalleryCategory = (typeof GALLERY_CATEGORIES)[number];

export interface GalleryLabel {
  readonly id: string;
  readonly name: string;
  readonly color: LabelColor;
}

export interface GalleryColumn {
  readonly key: string;
  readonly title: string;
  readonly type: ColumnType;
  /** Status / dropdown labels, for previews. */
  readonly labels?: readonly GalleryLabel[];
  readonly currency?: string;
  readonly unit?: string;
}

export interface GalleryGroup {
  readonly key: string;
  readonly title: string;
  readonly color: LabelColor;
}

export interface GallerySampleItem {
  readonly name: string;
  readonly group: string;
  readonly values: Readonly<Record<string, unknown>>;
}

export interface GalleryBoard {
  readonly templateId: string;
  readonly name: string;
  readonly kind: BoardKind;
  readonly itemTerminology: string;
  readonly columns: readonly GalleryColumn[];
  readonly groups: readonly GalleryGroup[];
  readonly views: readonly { readonly type: ViewType; readonly name: string }[];
  readonly sampleItems: readonly GallerySampleItem[];
}

export interface TemplateGalleryEntry {
  readonly id: string;
  /** `board` installs one board via POST /boards; `solution` installs a connected workspace. */
  readonly type: 'board' | 'solution';
  readonly name: string;
  readonly description: string;
  readonly category: GalleryCategory;
  readonly tags: readonly string[];
  readonly accent: LabelColor;
  readonly popular: boolean;
  readonly itemTerminology: string;
  readonly kind: BoardKind;
  readonly includesDashboard: boolean;
  readonly includesAutomations: boolean;
  readonly includesForm: boolean;
  readonly boards: readonly GalleryBoard[];
}

interface GalleryMeta {
  readonly category: GalleryCategory;
  readonly accent: LabelColor;
  readonly tags: readonly string[];
  readonly popular?: boolean;
}

const META: Readonly<Record<string, GalleryMeta>> = {
  blank: { category: 'blank', accent: 'gray', tags: ['any workflow', 'custom process'] },
  'crm-leads': { category: 'crm', accent: 'orange', tags: ['inbound', 'qualification', 'lead score'], popular: true },
  'crm-contacts': { category: 'crm', accent: 'sky', tags: ['people', 'relationships'] },
  'crm-accounts': { category: 'crm', accent: 'indigo', tags: ['companies', 'customers', 'arr'] },
  'crm-deals': { category: 'crm', accent: 'green', tags: ['pipeline', 'forecast', 'opportunities'], popular: true },
  'crm-activities': { category: 'crm', accent: 'pink', tags: ['calls', 'meetings', 'emails'] },
  'sales-quotes': { category: 'sales', accent: 'purple', tags: ['proposals', 'cpq', 'contracts'], popular: true },
  'sales-partners': { category: 'sales', accent: 'teal', tags: ['channel', 'resellers', 'alliances'] },
  'cs-onboarding': { category: 'customer-success', accent: 'orange', tags: ['implementation', 'kickoff'], popular: true },
  'cs-renewals': { category: 'customer-success', accent: 'blue', tags: ['churn', 'expansion', 'arr'] },
  'cs-tickets': { category: 'customer-success', accent: 'red', tags: ['support', 'helpdesk', 'sla'] },
  'mkt-campaigns': { category: 'marketing', accent: 'pink', tags: ['budget', 'channels', 'pipeline'], popular: true },
  'mkt-events': { category: 'marketing', accent: 'purple', tags: ['webinars', 'conferences'] },
  'proj-tracker': { category: 'projects', accent: 'blue', tags: ['tasks', 'gantt', 'planning'], popular: true },
  'ops-vendors': { category: 'operations', accent: 'brown', tags: ['procurement', 'suppliers', 'contracts'] },
  'ops-requests': { category: 'operations', accent: 'sky', tags: ['intake', 'forms', 'service desk'] },
  'hr-recruiting': { category: 'hr', accent: 'green', tags: ['hiring', 'candidates', 'ats'] },
  'hr-onboarding': { category: 'hr', accent: 'purple', tags: ['new hires', 'checklist'] },
};

const FALLBACK_META: GalleryMeta = { category: 'projects', accent: 'blue', tags: [] };
const MAX_SAMPLE_ITEMS = 6;

function readLabels(settings: Record<string, unknown> | undefined): GalleryLabel[] | undefined {
  const raw = settings?.labels;
  if (!Array.isArray(raw)) return undefined;
  return raw
    .filter((label): label is { id: string; name: string; color: LabelColor; isDefault?: boolean } =>
      Boolean(label && typeof label === 'object' && typeof (label as { id?: unknown }).id === 'string'),
    )
    .filter((label) => !label.isDefault)
    .map((label) => ({ id: label.id, name: label.name, color: label.color }));
}

/** Template labels, or the status column's registry defaults (Working on it / Done / Stuck) the board gets on create. */
function labelsFor(type: ColumnType, settings: Record<string, unknown> | undefined): GalleryLabel[] | undefined {
  const own = readLabels(settings);
  if (own?.length || type !== 'status') return own;
  return readLabels(getColumnTypeDefinition('status').defaultSettings() as Record<string, unknown>);
}

export function toGalleryBoard(template: BoardTemplate): GalleryBoard {
  return {
    templateId: template.id,
    name: template.name,
    kind: template.kind,
    itemTerminology: template.itemTerminology,
    columns: template.columns
      .filter((column) => column.scope !== 'subitem' && !column.hidden)
      .map((column) => ({
        key: column.key,
        title: column.title,
        type: column.type,
        ...(labelsFor(column.type, column.settings) ? { labels: labelsFor(column.type, column.settings) } : {}),
        ...(typeof column.settings?.currency === 'string' ? { currency: column.settings.currency } : {}),
        ...(typeof column.settings?.unit === 'string' ? { unit: column.settings.unit } : {}),
      })),
    groups: template.groups.map((group) => ({ key: group.key, title: group.title, color: group.color })),
    views: template.views.map((view) => ({ type: view.type, name: view.name })),
    sampleItems: (template.sampleItems ?? []).slice(0, MAX_SAMPLE_ITEMS).map((item) => ({
      name: item.name,
      group: item.group,
      values: item.values ?? {},
    })),
  };
}

function boardEntry(template: BoardTemplate): TemplateGalleryEntry {
  const meta = META[template.id] ?? FALLBACK_META;
  return {
    id: template.id,
    type: 'board',
    name: template.id === 'blank' ? 'Blank board' : template.name,
    description: template.description,
    category: meta.category,
    tags: meta.tags,
    accent: meta.accent,
    popular: meta.popular ?? false,
    itemTerminology: template.itemTerminology,
    kind: template.kind,
    includesDashboard: false,
    includesAutomations: false,
    includesForm: template.views.some((view) => view.type === 'form'),
    boards: [toGalleryBoard(template)],
  };
}

export const CRM_SUITE_ID = 'solution-crm-suite';

function crmSuiteEntry(): TemplateGalleryEntry {
  const boards = CRM_WORKSPACE_TEMPLATE_IDS.map((id) => findTemplate(id))
    .filter((template): template is BoardTemplate => Boolean(template))
    .map(toGalleryBoard);
  return {
    id: CRM_SUITE_ID,
    type: 'solution',
    name: 'Sales CRM suite',
    description:
      'Leads, Deals, Accounts, Contacts and Activities with every relation prewired, plus a live sales dashboard.',
    category: 'crm',
    tags: ['crm', 'pipeline', 'forecast', 'dashboard', 'connected boards'],
    accent: 'blue',
    popular: true,
    itemTerminology: 'Deal',
    kind: 'deals',
    includesDashboard: true,
    includesAutomations: false,
    includesForm: true,
    boards,
  };
}

/** Every template-center entry: the CRM solution first, then boards in definition order. */
export function buildTemplateGallery(): TemplateGalleryEntry[] {
  return [crmSuiteEntry(), ...BOARD_TEMPLATES.map(boardEntry)];
}
