/**
 * CRM board templates. Column keys are stable and referenced by the seed, dashboards and
 * automations — change them only together.
 */
import { labels, statusLabels, type BoardTemplate } from './types';
import { WIZARD_LIBRARY_TEMPLATES } from './wizards-library';

export const DEAL_STAGE_LABELS = statusLabels([
  ['lead', 'Lead', 'sky'],
  ['discovery', 'Discovery', 'blue'],
  ['proposal', 'Proposal', 'purple'],
  ['negotiation', 'Negotiation', 'orange'],
  ['won', 'Won', 'green', true],
  ['lost', 'Lost', 'red'],
]);

export const PRIORITY_LABELS = statusLabels([
  ['critical', 'Critical', 'dark-blue'],
  ['high', 'High', 'indigo'],
  ['medium', 'Medium', 'purple-light'],
  ['low', 'Low', 'blue-light'],
]);

const SOURCE_LABELS = statusLabels([
  ['website', 'Website', 'blue'],
  ['referral', 'Referral', 'green'],
  ['event', 'Event', 'purple'],
  ['outbound', 'Outbound', 'orange'],
  ['partner', 'Partner', 'teal'],
  ['linkedin', 'LinkedIn', 'dark-blue'],
  ['webinar', 'Webinar', 'pink'],
]);

export const LEADS_TEMPLATE: BoardTemplate = {
  id: 'crm-leads',
  name: 'Leads',
  description: 'Capture, qualify and route inbound and outbound leads.',
  kind: 'leads',
  icon: 'UserPlus',
  category: 'crm',
  itemTerminology: 'Lead',
  primaryStatusColumnKey: 'status',
  columns: [
    { key: 'name', title: 'Lead', type: 'name', width: 300 },
    {
      key: 'status',
      title: 'Status',
      type: 'status',
      settings: statusLabels([
        ['new', 'New lead', 'sky'],
        ['working', 'Working on it', 'orange'],
        ['contacted', 'Contacted', 'purple'],
        ['qualified', 'Qualified', 'green', true],
        ['unqualified', 'Unqualified', 'red'],
        ['nurturing', 'Nurturing', 'yellow'],
      ]),
    },
    { key: 'owner', title: 'Owner', type: 'people' },
    { key: 'company', title: 'Company', type: 'text', width: 180 },
    { key: 'job_title', title: 'Title', type: 'text', width: 170 },
    { key: 'email', title: 'Email', type: 'email' },
    { key: 'phone', title: 'Phone', type: 'phone' },
    { key: 'source', title: 'Source', type: 'status', settings: SOURCE_LABELS },
    { key: 'lead_score', title: 'Lead score', type: 'number', settings: { summary: 'average', decimals: 0 } },
    { key: 'priority', title: 'Priority', type: 'status', settings: PRIORITY_LABELS },
    { key: 'country', title: 'Country', type: 'country' },
    { key: 'created', title: 'Created', type: 'creation_log' },
  ],
  groups: [
    { key: 'new', title: 'New leads', color: 'sky' },
    { key: 'active', title: 'Active leads', color: 'orange' },
    { key: 'qualified', title: 'Qualified', color: 'green' },
    { key: 'disqualified', title: 'Disqualified', color: 'gray', collapsedDefault: true },
  ],
  views: [
    { type: 'table', name: 'Main table', config: {}, isDefault: true },
    {
      type: 'kanban',
      name: 'Lead funnel',
      config: { kanbanColumnKey: 'status', kanbanCardColumnKeys: ['owner', 'company', 'lead_score'] },
    },
    {
      type: 'chart',
      name: 'By source',
      config: { chart: { type: 'donut', xColumnKey: 'source', aggregate: 'count' } },
    },
    {
      type: 'form',
      name: 'Lead capture form',
      config: { formColumnKeys: ['company', 'job_title', 'email', 'phone', 'source'] },
    },
  ],
  sampleItems: [
    {
      name: 'Avery Collins',
      group: 'new',
      values: { company: 'Brightline Labs', status: { labelId: 'new' } },
    },
    {
      name: 'Jordan Patel',
      group: 'active',
      values: { company: 'Northgate Freight', status: { labelId: 'working' } },
    },
  ],
};

export const CONTACTS_TEMPLATE: BoardTemplate = {
  id: 'crm-contacts',
  name: 'Contacts',
  description: 'Every person you sell to, with their account and deals in one place.',
  kind: 'contacts',
  icon: 'Contact',
  category: 'crm',
  itemTerminology: 'Contact',
  columns: [
    { key: 'name', title: 'Contact', type: 'name', width: 280 },
    { key: 'email', title: 'Email', type: 'email' },
    { key: 'phone', title: 'Phone', type: 'phone' },
    { key: 'job_title', title: 'Title', type: 'text', width: 180 },
    {
      key: 'account',
      title: 'Account',
      type: 'connect_boards',
      connectTemplate: 'crm-accounts',
      reciprocalKey: 'contacts',
      settings: { allowMultiple: false },
    },
    {
      key: 'deals',
      title: 'Deals',
      type: 'connect_boards',
      connectTemplate: 'crm-deals',
      reciprocalKey: 'contacts',
    },
    {
      key: 'type',
      title: 'Type',
      type: 'status',
      settings: statusLabels([
        ['customer', 'Customer', 'green'],
        ['prospect', 'Prospect', 'blue'],
        ['partner', 'Partner', 'purple'],
        ['champion', 'Champion', 'orange'],
        ['former', 'Former customer', 'brown'],
      ]),
    },
    { key: 'owner', title: 'Owner', type: 'people' },
    { key: 'last_contacted', title: 'Last contacted', type: 'date' },
    { key: 'linkedin', title: 'LinkedIn', type: 'link' },
    { key: 'country', title: 'Country', type: 'country' },
  ],
  groups: [
    { key: 'decision', title: 'Decision makers', color: 'purple' },
    { key: 'champions', title: 'Champions & influencers', color: 'green' },
    { key: 'other', title: 'Other contacts', color: 'blue' },
  ],
  views: [
    { type: 'table', name: 'Main table', config: {}, isDefault: true },
    { type: 'kanban', name: 'By type', config: { kanbanColumnKey: 'type' } },
  ],
};

export const ACCOUNTS_TEMPLATE: BoardTemplate = {
  id: 'crm-accounts',
  name: 'Accounts',
  description: 'Companies you work with: firmographics, ARR, health and relationships.',
  kind: 'accounts',
  icon: 'Building2',
  category: 'crm',
  itemTerminology: 'Account',
  columns: [
    { key: 'name', title: 'Account', type: 'name', width: 280 },
    {
      key: 'industry',
      title: 'Industry',
      type: 'dropdown',
      settings: labels([
        ['manufacturing', 'Manufacturing', 'blue'],
        ['logistics', 'Logistics', 'orange'],
        ['healthcare', 'Healthcare', 'green'],
        ['automotive', 'Automotive', 'dark-blue'],
        ['aerospace', 'Aerospace', 'purple'],
        ['retail', 'Retail', 'pink'],
        ['energy', 'Energy', 'yellow'],
        ['food', 'Food & beverage', 'peach'],
        ['pharma', 'Pharma', 'teal'],
        ['electronics', 'Electronics', 'indigo'],
      ]),
    },
    {
      key: 'size',
      title: 'Company size',
      type: 'status',
      settings: statusLabels([
        ['s1', '1–50', 'sky'],
        ['s2', '51–200', 'blue'],
        ['s3', '201–1,000', 'purple'],
        ['s4', '1,001–5,000', 'indigo'],
        ['s5', '5,000+', 'dark-blue'],
      ]),
    },
    {
      key: 'arr',
      title: 'ARR',
      type: 'currency',
      settings: { currency: 'USD', decimals: 0, summary: 'sum' },
    },
    {
      key: 'region',
      title: 'Region',
      type: 'status',
      settings: statusLabels([
        ['na', 'North America', 'blue'],
        ['emea', 'EMEA', 'purple'],
        ['apac', 'APAC', 'teal'],
        ['latam', 'LATAM', 'orange'],
      ]),
    },
    {
      key: 'health',
      title: 'Health',
      type: 'status',
      settings: statusLabels([
        ['healthy', 'Healthy', 'green', true],
        ['watch', 'Needs attention', 'yellow'],
        ['at_risk', 'At risk', 'red'],
      ]),
    },
    { key: 'owner', title: 'Account owner', type: 'people' },
    { key: 'website', title: 'Website', type: 'link' },
    {
      key: 'contacts',
      title: 'Contacts',
      type: 'connect_boards',
      connectTemplate: 'crm-contacts',
      reciprocalKey: 'account',
    },
    {
      key: 'deals',
      title: 'Deals',
      type: 'connect_boards',
      connectTemplate: 'crm-deals',
      reciprocalKey: 'account',
    },
    {
      key: 'pipeline_value',
      title: 'Pipeline value',
      type: 'mirror',
      settings: { connectColumnKey: 'deals', mirroredColumnKeys: {}, aggregate: 'sum' },
      mirrorOf: { templateId: 'crm-deals', columnKey: 'deal_value' },
      description: 'Sum of connected deal values',
    },
    { key: 'hq', title: 'HQ', type: 'location' },
  ],
  groups: [
    { key: 'customers', title: 'Customers', color: 'green' },
    { key: 'prospects', title: 'Prospects', color: 'blue' },
    { key: 'churned', title: 'Churned', color: 'gray', collapsedDefault: true },
  ],
  views: [
    { type: 'table', name: 'Main table', config: {}, isDefault: true },
    {
      type: 'chart',
      name: 'ARR by region',
      config: { chart: { type: 'bar', xColumnKey: 'region', yColumnKey: 'arr', aggregate: 'sum' } },
    },
    { type: 'kanban', name: 'Account health', config: { kanbanColumnKey: 'health' } },
  ],
};

export const DEALS_TEMPLATE: BoardTemplate = {
  id: 'crm-deals',
  name: 'Deals',
  description: 'Manage your sales pipeline from first meeting to signed contract.',
  kind: 'deals',
  icon: 'Handshake',
  category: 'crm',
  itemTerminology: 'Deal',
  primaryStatusColumnKey: 'stage',
  columns: [
    { key: 'name', title: 'Deal', type: 'name', width: 520 },
    { key: 'stage', title: 'Stage', type: 'status', settings: DEAL_STAGE_LABELS },
    { key: 'owner', title: 'Owner', type: 'people' },
    {
      key: 'deal_value',
      title: 'Deal value',
      type: 'currency',
      settings: { currency: 'USD', decimals: 0, summary: 'sum' },
    },
    {
      // Deliberately narrow: the values are 2–3 digit percentages, so the name column keeps
      // the width (the header may ellipsize; the column menu shows the full title).
      key: 'probability',
      title: 'Close probability',
      type: 'number',
      width: 140,
      settings: { unit: '%', unitPosition: 'suffix', decimals: 0, summary: 'average' },
    },
    {
      key: 'forecast',
      title: 'Forecast value',
      type: 'formula',
      settings: { expression: 'ROUND({deal_value} * {probability} / 100, 0)' },
      description: 'Deal value weighted by close probability',
    },
    { key: 'close_date', title: 'Expected close', type: 'date' },
    { key: 'priority', title: 'Priority', type: 'status', settings: PRIORITY_LABELS },
    { key: 'timeline', title: 'Timeline', type: 'timeline' },
    {
      key: 'account',
      title: 'Account',
      type: 'connect_boards',
      connectTemplate: 'crm-accounts',
      reciprocalKey: 'deals',
      settings: { allowMultiple: false },
    },
    {
      key: 'contacts',
      title: 'Contacts',
      type: 'connect_boards',
      connectTemplate: 'crm-contacts',
      reciprocalKey: 'deals',
    },
    { key: 'source', title: 'Source', type: 'status', settings: SOURCE_LABELS },
    { key: 'next_step', title: 'Next step', type: 'text', width: 220 },
    { key: 'last_updated', title: 'Last updated', type: 'last_updated' },
  ],
  groups: [
    { key: 'this_quarter', title: 'This quarter', color: 'blue' },
    { key: 'next_quarter', title: 'Next quarter', color: 'purple' },
    { key: 'closed_won', title: 'Closed won', color: 'green' },
    { key: 'closed_lost', title: 'Closed lost', color: 'red', collapsedDefault: true },
  ],
  views: [
    { type: 'table', name: 'Main table', config: {}, isDefault: true },
    {
      type: 'kanban',
      name: 'Pipeline',
      config: { kanbanColumnKey: 'stage', kanbanCardColumnKeys: ['owner', 'deal_value', 'close_date'] },
    },
    { type: 'calendar', name: 'Close dates', config: { dateColumnKey: 'close_date' } },
    {
      type: 'chart',
      name: 'Pipeline by stage',
      config: { chart: { type: 'bar', xColumnKey: 'stage', yColumnKey: 'deal_value', aggregate: 'sum' } },
    },
    {
      type: 'table',
      name: 'Forecast',
      config: {
        groupBy: 'stage',
        sort: [{ columnKey: 'close_date', direction: 'asc' }],
        hiddenColumnKeys: ['timeline', 'source', 'next_step', 'contacts'],
        filters: {
          conjunction: 'and',
          rules: [{ columnKey: 'stage', operator: 'none_of', value: ['won', 'lost'] }],
        },
      },
    },
    { type: 'timeline', name: 'Deal timeline', config: { dateColumnKey: 'timeline' } },
  ],
  sampleItems: [
    {
      name: 'Fleet automation rollout',
      group: 'this_quarter',
      values: { stage: { labelId: 'proposal' }, probability: 50 },
    },
    {
      name: 'Warehouse pilot',
      group: 'next_quarter',
      values: { stage: { labelId: 'discovery' }, probability: 25 },
    },
  ],
};

export const ACTIVITIES_TEMPLATE: BoardTemplate = {
  id: 'crm-activities',
  name: 'Activities',
  description: 'Calls, meetings and emails logged against your deals and contacts.',
  kind: 'activities',
  icon: 'PhoneCall',
  category: 'crm',
  itemTerminology: 'Activity',
  primaryStatusColumnKey: 'status',
  columns: [
    { key: 'name', title: 'Activity', type: 'name', width: 300 },
    {
      key: 'type',
      title: 'Type',
      type: 'status',
      settings: statusLabels([
        ['call', 'Call', 'blue'],
        ['meeting', 'Meeting', 'purple'],
        ['email', 'Email', 'sky'],
        ['demo', 'Demo', 'orange'],
        ['task', 'Task', 'teal'],
      ]),
    },
    {
      key: 'status',
      title: 'Status',
      type: 'status',
      settings: statusLabels([
        ['planned', 'Planned', 'blue'],
        ['done', 'Done', 'green', true],
        ['cancelled', 'Cancelled', 'red'],
      ]),
    },
    { key: 'owner', title: 'Owner', type: 'people' },
    { key: 'date', title: 'Date', type: 'date', settings: { includeTime: true } },
    {
      key: 'duration',
      title: 'Duration',
      type: 'number',
      settings: { unit: 'min', decimals: 0, summary: 'sum' },
    },
    {
      key: 'deal',
      title: 'Deal',
      type: 'connect_boards',
      connectTemplate: 'crm-deals',
      settings: { allowMultiple: false },
    },
    { key: 'contact', title: 'Contact', type: 'connect_boards', connectTemplate: 'crm-contacts' },
    { key: 'notes', title: 'Notes', type: 'long_text', width: 260 },
  ],
  groups: [
    { key: 'upcoming', title: 'Upcoming', color: 'blue' },
    { key: 'completed', title: 'Completed', color: 'green' },
  ],
  views: [
    { type: 'table', name: 'Main table', config: {}, isDefault: true },
    { type: 'calendar', name: 'Calendar', config: { dateColumnKey: 'date' } },
    {
      type: 'chart',
      name: 'Activity mix',
      config: { chart: { type: 'pie', xColumnKey: 'type', aggregate: 'count' } },
    },
  ],
};

export const ONBOARDING_TEMPLATE: BoardTemplate = {
  id: 'cs-onboarding',
  name: 'Customer onboarding',
  description: 'Run every new customer onboarding as a project with tasks.',
  kind: 'projects',
  icon: 'Rocket',
  category: 'work',
  itemTerminology: 'Project',
  subitemTerminology: 'Task',
  primaryStatusColumnKey: 'status',
  columns: [
    { key: 'name', title: 'Project', type: 'name', width: 300 },
    { key: 'owner', title: 'CSM', type: 'people' },
    {
      key: 'status',
      title: 'Status',
      type: 'status',
      settings: statusLabels([
        ['not_started', 'Not started', 'blue-light'],
        ['working', 'Working on it', 'orange'],
        ['stuck', 'Stuck', 'red'],
        ['done', 'Done', 'green', true],
      ]),
    },
    { key: 'priority', title: 'Priority', type: 'status', settings: PRIORITY_LABELS },
    {
      key: 'account',
      title: 'Account',
      type: 'connect_boards',
      connectTemplate: 'crm-accounts',
      settings: { allowMultiple: false },
    },
    { key: 'timeline', title: 'Timeline', type: 'timeline' },
    { key: 'kickoff', title: 'Kickoff', type: 'date' },
    { key: 'progress', title: 'Progress', type: 'progress', settings: { sourceColumnKeys: ['status'] } },
    { key: 'units', title: 'Robots deployed', type: 'number', settings: { decimals: 0, summary: 'sum' } },
    { key: 'sub_owner', title: 'Owner', type: 'people', scope: 'subitem' },
    {
      key: 'sub_status',
      title: 'Status',
      type: 'status',
      scope: 'subitem',
      settings: statusLabels([
        ['todo', 'To do', 'blue-light'],
        ['working', 'Working on it', 'orange'],
        ['stuck', 'Stuck', 'red'],
        ['done', 'Done', 'green', true],
      ]),
    },
    { key: 'sub_due', title: 'Due date', type: 'date', scope: 'subitem' },
  ],
  groups: [
    { key: 'active', title: 'Active onboardings', color: 'orange' },
    { key: 'scheduled', title: 'Scheduled', color: 'blue' },
    { key: 'live', title: 'Live customers', color: 'green' },
  ],
  views: [
    { type: 'table', name: 'Main table', config: {}, isDefault: true },
    { type: 'timeline', name: 'Gantt', config: { dateColumnKey: 'timeline' } },
    { type: 'kanban', name: 'Kanban', config: { kanbanColumnKey: 'status' } },
  ],
};

export const RENEWALS_TEMPLATE: BoardTemplate = {
  id: 'cs-renewals',
  name: 'Renewals',
  description: 'Track upcoming renewals, risk and expansion.',
  kind: 'custom',
  icon: 'RefreshCcw',
  category: 'work',
  itemTerminology: 'Renewal',
  primaryStatusColumnKey: 'stage',
  columns: [
    { key: 'name', title: 'Renewal', type: 'name', width: 280 },
    {
      key: 'account',
      title: 'Account',
      type: 'connect_boards',
      connectTemplate: 'crm-accounts',
      settings: { allowMultiple: false },
    },
    {
      key: 'stage',
      title: 'Stage',
      type: 'status',
      settings: statusLabels([
        ['upcoming', 'Upcoming', 'blue'],
        ['negotiating', 'Negotiating', 'orange'],
        ['renewed', 'Renewed', 'green', true],
        ['churned', 'Churned', 'red'],
      ]),
    },
    {
      key: 'risk',
      title: 'Risk',
      type: 'status',
      settings: statusLabels([
        ['low', 'Low', 'green'],
        ['medium', 'Medium', 'yellow'],
        ['high', 'High', 'red'],
      ]),
    },
    { key: 'owner', title: 'CSM', type: 'people' },
    { key: 'renewal_date', title: 'Renewal date', type: 'date' },
    {
      key: 'arr',
      title: 'Current ARR',
      type: 'currency',
      settings: { currency: 'USD', decimals: 0, summary: 'sum' },
    },
    {
      key: 'expansion',
      title: 'Expansion',
      type: 'currency',
      settings: { currency: 'USD', decimals: 0, summary: 'sum' },
    },
    {
      key: 'probability',
      title: 'Renewal probability',
      type: 'number',
      settings: { unit: '%', decimals: 0, summary: 'average' },
    },
  ],
  groups: [
    { key: 'next_90', title: 'Next 90 days', color: 'orange' },
    { key: 'later', title: 'Later this year', color: 'blue' },
    { key: 'closed', title: 'Closed', color: 'green' },
  ],
  views: [
    { type: 'table', name: 'Main table', config: {}, isDefault: true },
    { type: 'calendar', name: 'Renewal calendar', config: { dateColumnKey: 'renewal_date' } },
    {
      type: 'chart',
      name: 'ARR by risk',
      config: { chart: { type: 'bar', xColumnKey: 'risk', yColumnKey: 'arr', aggregate: 'sum' } },
    },
  ],
};

export const BLANK_TEMPLATE: BoardTemplate = {
  id: 'blank',
  name: 'New board',
  description: 'Start from scratch with the essentials.',
  kind: 'custom',
  icon: 'LayoutGrid',
  category: 'blank',
  itemTerminology: 'Item',
  primaryStatusColumnKey: 'status',
  columns: [
    { key: 'name', title: 'Item', type: 'name', width: 300 },
    { key: 'owner', title: 'Owner', type: 'people' },
    { key: 'status', title: 'Status', type: 'status' },
    { key: 'date', title: 'Date', type: 'date' },
  ],
  groups: [
    { key: 'group_1', title: 'Group Title', color: 'blue' },
    { key: 'group_2', title: 'Group Title', color: 'purple' },
  ],
  views: [{ type: 'table', name: 'Main table', config: {}, isDefault: true }],
  sampleItems: [
    { name: 'Item 1', group: 'group_1' },
    { name: 'Item 2', group: 'group_1' },
    { name: 'Item 3', group: 'group_2' },
  ],
};

export const BOARD_TEMPLATES: readonly BoardTemplate[] = [
  BLANK_TEMPLATE,
  LEADS_TEMPLATE,
  CONTACTS_TEMPLATE,
  ACCOUNTS_TEMPLATE,
  DEALS_TEMPLATE,
  ACTIVITIES_TEMPLATE,
  ONBOARDING_TEMPLATE,
  RENEWALS_TEMPLATE,
  ...WIZARD_LIBRARY_TEMPLATES,
];

/** Default CRM workspace created by onboarding (in creation order). */
export const CRM_WORKSPACE_TEMPLATE_IDS = [
  'crm-leads',
  'crm-deals',
  'crm-accounts',
  'crm-contacts',
  'crm-activities',
] as const;

export function findTemplate(id: string): BoardTemplate | undefined {
  return BOARD_TEMPLATES.find((template) => template.id === id);
}
