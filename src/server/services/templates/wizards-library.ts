/**
 * Template-center library (owned by the wizards module). Pure data, client-safe. These boards
 * extend the CRM templates in `crm.ts` with sales, marketing, customer-success, project,
 * operations and HR starters. Every template ships realistic sample rows so the template
 * center can render a live preview and "Include sample data" produces a useful board.
 *
 * Column keys are stable: change them only together with any automation that references them.
 */
import { statusLabels, type BoardTemplate } from './types';

const PRIORITY = statusLabels([
  ['critical', 'Critical', 'dark-blue'],
  ['high', 'High', 'indigo'],
  ['medium', 'Medium', 'purple-light'],
  ['low', 'Low', 'blue-light'],
]);

const WORK_STATUS = statusLabels([
  ['not_started', 'Not started', 'blue-light'],
  ['working', 'Working on it', 'orange'],
  ['stuck', 'Stuck', 'red'],
  ['done', 'Done', 'green', true],
]);

const usd = { currency: 'USD', decimals: 0, summary: 'sum' } as const;

export const QUOTES_TEMPLATE: BoardTemplate = {
  id: 'sales-quotes',
  name: 'Quotes & proposals',
  description: 'Draft, approve and send quotes, then track every proposal to signature.',
  kind: 'custom',
  icon: 'FileSignature',
  category: 'crm',
  itemTerminology: 'Quote',
  primaryStatusColumnKey: 'status',
  columns: [
    { key: 'name', title: 'Quote', type: 'name', width: 280 },
    {
      key: 'status',
      title: 'Status',
      type: 'status',
      settings: statusLabels([
        ['draft', 'Draft', 'blue-light'],
        ['review', 'In review', 'orange'],
        ['sent', 'Sent', 'purple'],
        ['signed', 'Signed', 'green', true],
        ['declined', 'Declined', 'red'],
      ]),
    },
    { key: 'owner', title: 'Owner', type: 'people' },
    { key: 'account', title: 'Account', type: 'text', width: 180 },
    { key: 'amount', title: 'Quote total', type: 'currency', settings: usd },
    { key: 'discount', title: 'Discount', type: 'number', settings: { unit: '%', decimals: 0, summary: 'average' } },
    { key: 'sent_on', title: 'Sent on', type: 'date' },
    { key: 'valid_until', title: 'Valid until', type: 'date' },
    { key: 'document', title: 'Proposal', type: 'link' },
  ],
  groups: [
    { key: 'open', title: 'Open quotes', color: 'orange' },
    { key: 'awaiting', title: 'Awaiting signature', color: 'purple' },
    { key: 'closed', title: 'Closed', color: 'green' },
  ],
  views: [
    { type: 'table', name: 'Main table', config: {}, isDefault: true },
    { type: 'kanban', name: 'Approval flow', config: { kanbanColumnKey: 'status', kanbanCardColumnKeys: ['account', 'amount'] } },
    { type: 'calendar', name: 'Expiry calendar', config: { dateColumnKey: 'valid_until' } },
  ],
  sampleItems: [
    { name: 'Q-1042 · Fleet telematics', group: 'open', values: { status: { labelId: 'review' }, account: 'Northgate Freight', amount: { amount: 48500, currency: 'USD' }, discount: 8, valid_until: { date: '2026-12-15' } } },
    { name: 'Q-1043 · Annual support plan', group: 'open', values: { status: { labelId: 'draft' }, account: 'Brightline Labs', amount: { amount: 12000, currency: 'USD' }, discount: 0, valid_until: { date: '2026-12-01' } } },
    { name: 'Q-1038 · Warehouse expansion', group: 'awaiting', values: { status: { labelId: 'sent' }, account: 'Harbor & Co', amount: { amount: 126000, currency: 'USD' }, discount: 12, sent_on: { date: '2026-10-28' } } },
    { name: 'Q-1031 · Pilot program', group: 'closed', values: { status: { labelId: 'signed' }, account: 'Summit Health', amount: { amount: 22400, currency: 'USD' }, discount: 5, sent_on: { date: '2026-10-02' } } },
  ],
};

export const PARTNERS_TEMPLATE: BoardTemplate = {
  id: 'sales-partners',
  name: 'Partner pipeline',
  description: 'Recruit, enable and grow channel partners with tiering and sourced revenue.',
  kind: 'custom',
  icon: 'Handshake',
  category: 'crm',
  itemTerminology: 'Partner',
  primaryStatusColumnKey: 'stage',
  columns: [
    { key: 'name', title: 'Partner', type: 'name', width: 260 },
    {
      key: 'stage',
      title: 'Stage',
      type: 'status',
      settings: statusLabels([
        ['prospect', 'Prospect', 'sky'],
        ['onboarding', 'Onboarding', 'orange'],
        ['active', 'Active', 'green', true],
        ['paused', 'Paused', 'gray'],
      ]),
    },
    {
      key: 'tier',
      title: 'Tier',
      type: 'status',
      settings: statusLabels([
        ['platinum', 'Platinum', 'dark-blue'],
        ['gold', 'Gold', 'yellow'],
        ['silver', 'Silver', 'blue-light'],
      ]),
    },
    { key: 'manager', title: 'Partner manager', type: 'people' },
    { key: 'region', title: 'Region', type: 'country' },
    { key: 'sourced', title: 'Sourced revenue', type: 'currency', settings: usd },
    { key: 'certified', title: 'Certified reps', type: 'number', settings: { decimals: 0, summary: 'sum' } },
    { key: 'renewal', title: 'Agreement renewal', type: 'date' },
  ],
  groups: [
    { key: 'recruiting', title: 'Recruiting', color: 'sky' },
    { key: 'active', title: 'Active partners', color: 'green' },
  ],
  views: [
    { type: 'table', name: 'Main table', config: {}, isDefault: true },
    { type: 'kanban', name: 'Partner journey', config: { kanbanColumnKey: 'stage' } },
    { type: 'chart', name: 'Revenue by tier', config: { chart: { type: 'bar', xColumnKey: 'tier', yColumnKey: 'sourced', aggregate: 'sum' } } },
  ],
  sampleItems: [
    { name: 'Atlas Integrators', group: 'active', values: { stage: { labelId: 'active' }, tier: { labelId: 'platinum' }, sourced: { amount: 640000, currency: 'USD' }, certified: 14 } },
    { name: 'Copperline Systems', group: 'active', values: { stage: { labelId: 'active' }, tier: { labelId: 'gold' }, sourced: { amount: 215000, currency: 'USD' }, certified: 6 } },
    { name: 'Vertex Advisory', group: 'recruiting', values: { stage: { labelId: 'onboarding' }, tier: { labelId: 'silver' }, sourced: { amount: 0, currency: 'USD' }, certified: 2 } },
    { name: 'Bluefin Partners', group: 'recruiting', values: { stage: { labelId: 'prospect' }, tier: { labelId: 'silver' } } },
  ],
};

export const CAMPAIGNS_TEMPLATE: BoardTemplate = {
  id: 'mkt-campaigns',
  name: 'Campaign planner',
  description: 'Plan multi-channel campaigns, budgets and the pipeline they generate.',
  kind: 'projects',
  icon: 'Megaphone',
  category: 'work',
  itemTerminology: 'Campaign',
  primaryStatusColumnKey: 'status',
  columns: [
    { key: 'name', title: 'Campaign', type: 'name', width: 280 },
    { key: 'status', title: 'Status', type: 'status', settings: WORK_STATUS },
    { key: 'owner', title: 'Owner', type: 'people' },
    {
      key: 'channel',
      title: 'Channel',
      type: 'status',
      settings: statusLabels([
        ['email', 'Email', 'blue'],
        ['paid', 'Paid social', 'pink'],
        ['events', 'Events', 'purple'],
        ['content', 'Content', 'teal'],
        ['webinar', 'Webinar', 'indigo'],
      ]),
    },
    { key: 'timeline', title: 'Timeline', type: 'timeline' },
    { key: 'budget', title: 'Budget', type: 'currency', settings: usd },
    { key: 'leads', title: 'Leads generated', type: 'number', settings: { decimals: 0, summary: 'sum' } },
    { key: 'pipeline', title: 'Pipeline sourced', type: 'currency', settings: usd },
  ],
  groups: [
    { key: 'live', title: 'Live', color: 'green' },
    { key: 'planned', title: 'Planned', color: 'blue' },
    { key: 'wrapped', title: 'Wrapped', color: 'gray', collapsedDefault: true },
  ],
  views: [
    { type: 'table', name: 'Main table', config: {}, isDefault: true },
    { type: 'timeline', name: 'Campaign calendar', config: { dateColumnKey: 'timeline' } },
    { type: 'chart', name: 'Pipeline by channel', config: { chart: { type: 'bar', xColumnKey: 'channel', yColumnKey: 'pipeline', aggregate: 'sum' } } },
  ],
  sampleItems: [
    { name: 'Q4 product launch', group: 'live', values: { status: { labelId: 'working' }, channel: { labelId: 'email' }, timeline: { from: '2026-10-15', to: '2026-12-10' }, budget: { amount: 40000, currency: 'USD' }, leads: 820, pipeline: { amount: 1250000, currency: 'USD' } } },
    { name: 'Logistics summit booth', group: 'live', values: { status: { labelId: 'working' }, channel: { labelId: 'events' }, timeline: { from: '2026-11-12', to: '2026-11-14' }, budget: { amount: 65000, currency: 'USD' }, leads: 240 } },
    { name: 'ROI calculator webinar', group: 'planned', values: { status: { labelId: 'not_started' }, channel: { labelId: 'webinar' }, timeline: { from: '2026-12-03', to: '2026-12-03' }, budget: { amount: 5000, currency: 'USD' } } },
    { name: 'Retargeting · ops leaders', group: 'wrapped', values: { status: { labelId: 'done' }, channel: { labelId: 'paid' }, budget: { amount: 18000, currency: 'USD' }, leads: 410, pipeline: { amount: 380000, currency: 'USD' } } },
  ],
};

export const EVENTS_TEMPLATE: BoardTemplate = {
  id: 'mkt-events',
  name: 'Events & webinars',
  description: 'Run events end to end: venues, registrations, speakers and follow-up.',
  kind: 'projects',
  icon: 'CalendarDays',
  category: 'work',
  itemTerminology: 'Event',
  subitemTerminology: 'Task',
  primaryStatusColumnKey: 'status',
  columns: [
    { key: 'name', title: 'Event', type: 'name', width: 260 },
    { key: 'status', title: 'Status', type: 'status', settings: WORK_STATUS },
    {
      key: 'format',
      title: 'Format',
      type: 'status',
      settings: statusLabels([
        ['in_person', 'In person', 'purple'],
        ['virtual', 'Virtual', 'sky'],
        ['hybrid', 'Hybrid', 'teal'],
      ]),
    },
    { key: 'owner', title: 'Owner', type: 'people' },
    { key: 'date', title: 'Event date', type: 'date' },
    { key: 'location', title: 'Location', type: 'location' },
    { key: 'registrations', title: 'Registrations', type: 'number', settings: { decimals: 0, summary: 'sum' } },
    { key: 'budget', title: 'Budget', type: 'currency', settings: usd },
    { key: 'sub_owner', title: 'Owner', type: 'people', scope: 'subitem' },
    { key: 'sub_status', title: 'Status', type: 'status', scope: 'subitem', settings: WORK_STATUS },
  ],
  groups: [
    { key: 'upcoming', title: 'Upcoming', color: 'purple' },
    { key: 'past', title: 'Past events', color: 'gray', collapsedDefault: true },
  ],
  views: [
    { type: 'table', name: 'Main table', config: {}, isDefault: true },
    { type: 'calendar', name: 'Event calendar', config: { dateColumnKey: 'date' } },
    { type: 'kanban', name: 'By status', config: { kanbanColumnKey: 'status' } },
  ],
  sampleItems: [
    { name: 'Customer advisory dinner', group: 'upcoming', values: { status: { labelId: 'working' }, format: { labelId: 'in_person' }, date: { date: '2026-11-20' }, registrations: 28, budget: { amount: 9000, currency: 'USD' } } },
    { name: 'Automation masterclass', group: 'upcoming', values: { status: { labelId: 'not_started' }, format: { labelId: 'virtual' }, date: { date: '2026-12-09' }, registrations: 312 } },
    { name: 'Field ops roadshow', group: 'upcoming', values: { status: { labelId: 'stuck' }, format: { labelId: 'hybrid' }, date: { date: '2027-01-21' }, budget: { amount: 24000, currency: 'USD' } } },
    { name: 'Spring partner summit', group: 'past', values: { status: { labelId: 'done' }, format: { labelId: 'in_person' }, date: { date: '2026-04-14' }, registrations: 186 } },
  ],
};

export const TICKETS_TEMPLATE: BoardTemplate = {
  id: 'cs-tickets',
  name: 'Support tickets',
  description: 'Triage customer issues by priority and SLA, and see what is blocking resolution.',
  kind: 'custom',
  icon: 'LifeBuoy',
  category: 'work',
  itemTerminology: 'Ticket',
  primaryStatusColumnKey: 'status',
  columns: [
    { key: 'name', title: 'Ticket', type: 'name', width: 300 },
    {
      key: 'status',
      title: 'Status',
      type: 'status',
      settings: statusLabels([
        ['new', 'New', 'sky'],
        ['open', 'Open', 'orange'],
        ['waiting', 'Waiting on customer', 'purple'],
        ['solved', 'Solved', 'green', true],
      ]),
    },
    { key: 'priority', title: 'Priority', type: 'status', settings: PRIORITY },
    { key: 'agent', title: 'Agent', type: 'people' },
    { key: 'customer', title: 'Customer', type: 'text', width: 180 },
    { key: 'requester', title: 'Requester email', type: 'email' },
    {
      key: 'category',
      title: 'Category',
      type: 'dropdown',
      settings: { labels: [
        { id: 'billing', name: 'Billing', color: 'green', position: 0 },
        { id: 'bug', name: 'Bug', color: 'red', position: 1 },
        { id: 'how_to', name: 'How-to', color: 'blue', position: 2 },
        { id: 'feature', name: 'Feature request', color: 'purple', position: 3 },
      ] },
    },
    { key: 'due', title: 'SLA due', type: 'date' },
    { key: 'satisfaction', title: 'CSAT', type: 'rating', settings: { max: 5 } },
  ],
  groups: [
    { key: 'queue', title: 'Queue', color: 'orange' },
    { key: 'escalated', title: 'Escalated', color: 'red' },
    { key: 'solved', title: 'Solved', color: 'green', collapsedDefault: true },
  ],
  views: [
    { type: 'table', name: 'Main table', config: {}, isDefault: true },
    { type: 'kanban', name: 'Ticket board', config: { kanbanColumnKey: 'status', kanbanCardColumnKeys: ['priority', 'agent'] } },
    { type: 'chart', name: 'Tickets by priority', config: { chart: { type: 'pie', xColumnKey: 'priority', aggregate: 'count' } } },
  ],
  sampleItems: [
    { name: 'Invoice shows wrong tax rate', group: 'queue', values: { status: { labelId: 'open' }, priority: { labelId: 'high' }, customer: 'Harbor & Co', category: { labelIds: ['billing'] }, due: { date: '2026-11-06' } } },
    { name: 'Route optimizer timeout', group: 'escalated', values: { status: { labelId: 'open' }, priority: { labelId: 'critical' }, customer: 'Northgate Freight', category: { labelIds: ['bug'] }, due: { date: '2026-11-05' } } },
    { name: 'How do I export by region?', group: 'queue', values: { status: { labelId: 'waiting' }, priority: { labelId: 'low' }, customer: 'Summit Health', category: { labelIds: ['how_to'] } } },
    { name: 'SSO login loop on Safari', group: 'solved', values: { status: { labelId: 'solved' }, priority: { labelId: 'medium' }, customer: 'Brightline Labs', category: { labelIds: ['bug'] }, satisfaction: 5 } },
  ],
};

export const PROJECT_TRACKER_TEMPLATE: BoardTemplate = {
  id: 'proj-tracker',
  name: 'Project tracker',
  description: 'Plan projects with owners, timelines and progress your stakeholders can follow.',
  kind: 'projects',
  icon: 'FolderKanban',
  category: 'work',
  itemTerminology: 'Task',
  subitemTerminology: 'Subtask',
  primaryStatusColumnKey: 'status',
  columns: [
    { key: 'name', title: 'Task', type: 'name', width: 300 },
    { key: 'owner', title: 'Owner', type: 'people' },
    { key: 'status', title: 'Status', type: 'status', settings: WORK_STATUS },
    { key: 'priority', title: 'Priority', type: 'status', settings: PRIORITY },
    { key: 'timeline', title: 'Timeline', type: 'timeline' },
    { key: 'effort', title: 'Effort (h)', type: 'number', settings: { decimals: 0, summary: 'sum' } },
    { key: 'progress', title: 'Progress', type: 'progress', settings: { sourceColumnKeys: ['status'] } },
    { key: 'sub_owner', title: 'Owner', type: 'people', scope: 'subitem' },
    { key: 'sub_status', title: 'Status', type: 'status', scope: 'subitem', settings: WORK_STATUS },
  ],
  groups: [
    { key: 'this_week', title: 'This week', color: 'blue' },
    { key: 'next_week', title: 'Next week', color: 'purple' },
    { key: 'done', title: 'Done', color: 'green', collapsedDefault: true },
  ],
  views: [
    { type: 'table', name: 'Main table', config: {}, isDefault: true },
    { type: 'timeline', name: 'Gantt', config: { dateColumnKey: 'timeline' } },
    { type: 'kanban', name: 'Kanban', config: { kanbanColumnKey: 'status' } },
  ],
  sampleItems: [
    { name: 'Finalize requirements', group: 'this_week', values: { status: { labelId: 'done' }, priority: { labelId: 'high' }, timeline: { from: '2026-11-02', to: '2026-11-04' }, effort: 6 } },
    { name: 'Design review', group: 'this_week', values: { status: { labelId: 'working' }, priority: { labelId: 'medium' }, timeline: { from: '2026-11-05', to: '2026-11-07' }, effort: 4 } },
    { name: 'Vendor security check', group: 'this_week', values: { status: { labelId: 'stuck' }, priority: { labelId: 'critical' }, timeline: { from: '2026-11-04', to: '2026-11-08' }, effort: 8 } },
    { name: 'Pilot rollout plan', group: 'next_week', values: { status: { labelId: 'not_started' }, priority: { labelId: 'medium' }, timeline: { from: '2026-11-10', to: '2026-11-14' }, effort: 12 } },
  ],
};

export const VENDORS_TEMPLATE: BoardTemplate = {
  id: 'ops-vendors',
  name: 'Vendor management',
  description: 'Keep contracts, spend, risk and renewals for every supplier in one place.',
  kind: 'custom',
  icon: 'Truck',
  category: 'work',
  itemTerminology: 'Vendor',
  primaryStatusColumnKey: 'status',
  columns: [
    { key: 'name', title: 'Vendor', type: 'name', width: 260 },
    {
      key: 'status',
      title: 'Status',
      type: 'status',
      settings: statusLabels([
        ['evaluating', 'Evaluating', 'sky'],
        ['approved', 'Approved', 'green', true],
        ['under_review', 'Under review', 'orange'],
        ['offboarded', 'Offboarded', 'gray'],
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
    { key: 'owner', title: 'Business owner', type: 'people' },
    { key: 'spend', title: 'Annual spend', type: 'currency', settings: usd },
    { key: 'contract_end', title: 'Contract end', type: 'date' },
    { key: 'contact', title: 'Vendor contact', type: 'email' },
    { key: 'documents', title: 'Contract', type: 'files' },
  ],
  groups: [
    { key: 'critical', title: 'Critical suppliers', color: 'red' },
    { key: 'standard', title: 'Standard suppliers', color: 'blue' },
  ],
  views: [
    { type: 'table', name: 'Main table', config: {}, isDefault: true },
    { type: 'calendar', name: 'Renewals', config: { dateColumnKey: 'contract_end' } },
    { type: 'chart', name: 'Spend by risk', config: { chart: { type: 'bar', xColumnKey: 'risk', yColumnKey: 'spend', aggregate: 'sum' } } },
  ],
  sampleItems: [
    { name: 'Coastal Logistics', group: 'critical', values: { status: { labelId: 'approved' }, risk: { labelId: 'medium' }, spend: { amount: 420000, currency: 'USD' }, contract_end: { date: '2027-03-31' } } },
    { name: 'Ironclad Security', group: 'critical', values: { status: { labelId: 'under_review' }, risk: { labelId: 'high' }, spend: { amount: 96000, currency: 'USD' }, contract_end: { date: '2026-12-31' } } },
    { name: 'Paperless Print Co', group: 'standard', values: { status: { labelId: 'approved' }, risk: { labelId: 'low' }, spend: { amount: 14000, currency: 'USD' } } },
    { name: 'Nimbus Cloud Hosting', group: 'standard', values: { status: { labelId: 'evaluating' }, risk: { labelId: 'medium' }, spend: { amount: 58000, currency: 'USD' } } },
  ],
};

export const REQUESTS_TEMPLATE: BoardTemplate = {
  id: 'ops-requests',
  name: 'Request intake',
  description: 'Collect internal requests with a form, prioritize them and track delivery.',
  kind: 'custom',
  icon: 'Inbox',
  category: 'work',
  itemTerminology: 'Request',
  primaryStatusColumnKey: 'status',
  columns: [
    { key: 'name', title: 'Request', type: 'name', width: 300 },
    {
      key: 'status',
      title: 'Status',
      type: 'status',
      settings: statusLabels([
        ['submitted', 'Submitted', 'sky'],
        ['approved', 'Approved', 'purple'],
        ['in_progress', 'In progress', 'orange'],
        ['delivered', 'Delivered', 'green', true],
        ['rejected', 'Rejected', 'red'],
      ]),
    },
    { key: 'priority', title: 'Priority', type: 'status', settings: PRIORITY },
    { key: 'requester', title: 'Requester', type: 'email' },
    {
      key: 'team',
      title: 'Team',
      type: 'dropdown',
      settings: { labels: [
        { id: 'sales', name: 'Sales', color: 'green', position: 0 },
        { id: 'finance', name: 'Finance', color: 'yellow', position: 1 },
        { id: 'ops', name: 'Operations', color: 'blue', position: 2 },
        { id: 'it', name: 'IT', color: 'indigo', position: 3 },
      ] },
    },
    { key: 'assignee', title: 'Assignee', type: 'people' },
    { key: 'due', title: 'Needed by', type: 'date' },
    { key: 'details', title: 'Details', type: 'long_text', width: 240 },
  ],
  groups: [
    { key: 'new', title: 'New requests', color: 'sky' },
    { key: 'active', title: 'In flight', color: 'orange' },
    { key: 'closed', title: 'Closed', color: 'gray', collapsedDefault: true },
  ],
  views: [
    { type: 'table', name: 'Main table', config: {}, isDefault: true },
    { type: 'form', name: 'Request form', config: { formColumnKeys: ['requester', 'team', 'priority', 'due', 'details'] } },
    { type: 'kanban', name: 'Workflow', config: { kanbanColumnKey: 'status' } },
  ],
  sampleItems: [
    { name: 'New laptop for SDR hire', group: 'new', values: { status: { labelId: 'submitted' }, priority: { labelId: 'medium' }, team: { labelIds: ['it'] }, due: { date: '2026-11-17' } } },
    { name: 'Q1 territory map refresh', group: 'active', values: { status: { labelId: 'in_progress' }, priority: { labelId: 'high' }, team: { labelIds: ['sales'] }, due: { date: '2026-12-01' } } },
    { name: 'Vendor W-9 collection', group: 'active', values: { status: { labelId: 'approved' }, priority: { labelId: 'low' }, team: { labelIds: ['finance'] } } },
    { name: 'Dock scheduling tool', group: 'closed', values: { status: { labelId: 'delivered' }, priority: { labelId: 'high' }, team: { labelIds: ['ops'] } } },
  ],
};

export const RECRUITING_TEMPLATE: BoardTemplate = {
  id: 'hr-recruiting',
  name: 'Recruiting pipeline',
  description: 'Move candidates from application to offer with scorecards and interview dates.',
  kind: 'custom',
  icon: 'UserSearch',
  category: 'work',
  itemTerminology: 'Candidate',
  primaryStatusColumnKey: 'stage',
  columns: [
    { key: 'name', title: 'Candidate', type: 'name', width: 260 },
    {
      key: 'stage',
      title: 'Stage',
      type: 'status',
      settings: statusLabels([
        ['applied', 'Applied', 'sky'],
        ['screen', 'Phone screen', 'blue'],
        ['interview', 'Interviewing', 'purple'],
        ['offer', 'Offer', 'orange'],
        ['hired', 'Hired', 'green', true],
        ['declined', 'Not moving forward', 'gray'],
      ]),
    },
    { key: 'role', title: 'Role', type: 'text', width: 180 },
    { key: 'recruiter', title: 'Recruiter', type: 'people' },
    { key: 'email', title: 'Email', type: 'email' },
    { key: 'interview', title: 'Next interview', type: 'date' },
    { key: 'score', title: 'Scorecard', type: 'rating', settings: { max: 5 } },
    { key: 'resume', title: 'Resume', type: 'files' },
  ],
  groups: [
    { key: 'sales', title: 'Sales roles', color: 'green' },
    { key: 'ops', title: 'Operations roles', color: 'blue' },
  ],
  views: [
    { type: 'table', name: 'Main table', config: {}, isDefault: true },
    { type: 'kanban', name: 'Hiring funnel', config: { kanbanColumnKey: 'stage', kanbanCardColumnKeys: ['role', 'score'] } },
    { type: 'calendar', name: 'Interviews', config: { dateColumnKey: 'interview' } },
  ],
  sampleItems: [
    { name: 'Riley Okafor', group: 'sales', values: { stage: { labelId: 'interview' }, role: 'Account executive', interview: { date: '2026-11-09' }, score: 4 } },
    { name: 'Sam Lindqvist', group: 'sales', values: { stage: { labelId: 'offer' }, role: 'SDR team lead', score: 5 } },
    { name: 'Priya Raman', group: 'ops', values: { stage: { labelId: 'screen' }, role: 'Revenue operations', interview: { date: '2026-11-12' } } },
    { name: 'Diego Marín', group: 'ops', values: { stage: { labelId: 'applied' }, role: 'Logistics analyst' } },
  ],
};

export const EMPLOYEE_ONBOARDING_TEMPLATE: BoardTemplate = {
  id: 'hr-onboarding',
  name: 'Employee onboarding',
  description: 'Give every new hire a ready-to-go first 30 days with owners for each step.',
  kind: 'projects',
  icon: 'BadgeCheck',
  category: 'work',
  itemTerminology: 'New hire',
  subitemTerminology: 'Step',
  primaryStatusColumnKey: 'status',
  columns: [
    { key: 'name', title: 'New hire', type: 'name', width: 260 },
    { key: 'status', title: 'Status', type: 'status', settings: WORK_STATUS },
    { key: 'manager', title: 'Manager', type: 'people' },
    {
      key: 'department',
      title: 'Department',
      type: 'status',
      settings: statusLabels([
        ['sales', 'Sales', 'green'],
        ['cs', 'Customer success', 'teal'],
        ['ops', 'Operations', 'blue'],
        ['marketing', 'Marketing', 'pink'],
      ]),
    },
    { key: 'start_date', title: 'Start date', type: 'date' },
    { key: 'equipment', title: 'Equipment ready', type: 'checkbox' },
    { key: 'progress', title: 'Progress', type: 'progress', settings: { sourceColumnKeys: ['status'] } },
    { key: 'sub_owner', title: 'Owner', type: 'people', scope: 'subitem' },
    { key: 'sub_status', title: 'Status', type: 'status', scope: 'subitem', settings: WORK_STATUS },
  ],
  groups: [
    { key: 'starting', title: 'Starting soon', color: 'purple' },
    { key: 'ramping', title: 'Ramping (first 30 days)', color: 'orange' },
    { key: 'complete', title: 'Complete', color: 'green', collapsedDefault: true },
  ],
  views: [
    { type: 'table', name: 'Main table', config: {}, isDefault: true },
    { type: 'calendar', name: 'Start dates', config: { dateColumnKey: 'start_date' } },
    { type: 'kanban', name: 'By status', config: { kanbanColumnKey: 'status' } },
  ],
  sampleItems: [
    { name: 'Morgan Ellis · AE', group: 'starting', values: { status: { labelId: 'not_started' }, department: { labelId: 'sales' }, start_date: { date: '2026-11-16' }, equipment: true } },
    { name: 'Taylor Brooks · CSM', group: 'ramping', values: { status: { labelId: 'working' }, department: { labelId: 'cs' }, start_date: { date: '2026-10-26' }, equipment: true } },
    { name: 'Jamie Chen · Ops analyst', group: 'ramping', values: { status: { labelId: 'stuck' }, department: { labelId: 'ops' }, start_date: { date: '2026-11-02' }, equipment: false } },
  ],
};

/** Library templates in template-center order. */
export const WIZARD_LIBRARY_TEMPLATES: readonly BoardTemplate[] = [
  QUOTES_TEMPLATE,
  PARTNERS_TEMPLATE,
  CAMPAIGNS_TEMPLATE,
  EVENTS_TEMPLATE,
  TICKETS_TEMPLATE,
  PROJECT_TRACKER_TEMPLATE,
  VENDORS_TEMPLATE,
  REQUESTS_TEMPLATE,
  RECRUITING_TEMPLATE,
  EMPLOYEE_ONBOARDING_TEMPLATE,
];
