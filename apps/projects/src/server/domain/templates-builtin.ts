/**
 * Built-in project templates available to every org (id `builtin:<slug>`). Plain language,
 * realistic steps, dates as offsets from the project start. Org-saved templates live in pm.templates.
 */
import type { TemplatePayload } from '@/lib/template-types';
import { countTemplateTaskTree, withScheduledStarts } from '@/lib/template-math';

export interface BuiltinTemplate {
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly category: string;
  readonly icon: string;
  readonly color: string;
  readonly payload: TemplatePayload;
}

const KANBAN = [
  { key: 'todo', name: 'To do', category: 'todo', color: 'gray', isDefault: true },
  { key: 'doing', name: 'In progress', category: 'in_progress', color: 'blue' },
  { key: 'review', name: 'In review', category: 'in_progress', color: 'purple' },
  { key: 'done', name: 'Done', category: 'done', color: 'green' },
] as const;

const BUILTIN_TEMPLATE_SOURCE: readonly BuiltinTemplate[] = [
  {
    slug: 'product-launch',
    name: 'Product launch',
    description: 'Take a new product from plan to launch day: messaging, assets, training and go-live.',
    category: 'Marketing',
    icon: 'rocket',
    color: 'red',
    payload: {
      durationDays: 42,
      defaultView: 'timeline',
      statuses: [...KANBAN],
      sections: [
        { key: 'plan', name: 'Plan' },
        { key: 'build', name: 'Build the launch kit' },
        { key: 'launch', name: 'Launch week' },
        { key: 'after', name: 'After launch' },
      ],
      labels: [
        { key: 'copy', name: 'Copy', color: 'blue' },
        { key: 'design', name: 'Design', color: 'pink' },
        { key: 'sales', name: 'Sales', color: 'green' },
      ],
      milestones: [
        { key: 'kit', name: 'Launch kit ready', dueOffsetDays: 28 },
        { key: 'live', name: 'Launch day', dueOffsetDays: 35 },
      ],
      tasks: [
        { key: 'brief', title: 'Write the launch brief', sectionKey: 'plan', priority: 'high', dueOffsetDays: 3, description: '<p>Who is it for, what problem it solves, and what success looks like.</p>' },
        { key: 'goals', title: 'Agree on launch goals and numbers to track', sectionKey: 'plan', dueOffsetDays: 5 },
        { key: 'msg', title: 'Draft key messages and positioning', sectionKey: 'plan', labelKeys: ['copy'], dueOffsetDays: 8 },
        { key: 'page', title: 'Build the product page', sectionKey: 'build', labelKeys: ['design', 'copy'], startOffsetDays: 9, dueOffsetDays: 20, subtasks: [{ title: 'Write page copy' }, { title: 'Design hero image' }, { title: 'Add pricing table' }] },
        { key: 'deck', title: 'Create the sales deck', sectionKey: 'build', labelKeys: ['sales'], startOffsetDays: 12, dueOffsetDays: 22 },
        { key: 'email', title: 'Write the launch email', sectionKey: 'build', labelKeys: ['copy'], dueOffsetDays: 24 },
        { key: 'train', title: 'Train the sales and support teams', sectionKey: 'build', labelKeys: ['sales'], dueOffsetDays: 27 },
        { key: 'kitdone', title: 'Launch kit sign-off', sectionKey: 'build', isMilestone: true, milestoneKey: 'kit', dueOffsetDays: 28 },
        { key: 'go', title: 'Publish the page and send the email', sectionKey: 'launch', priority: 'urgent', milestoneKey: 'live', dueOffsetDays: 35 },
        { key: 'social', title: 'Post on social channels', sectionKey: 'launch', dueOffsetDays: 35 },
        { key: 'review', title: 'Review results after two weeks', sectionKey: 'after', dueOffsetDays: 42 },
      ],
      dependencies: [
        { blockingKey: 'brief', blockedKey: 'msg' },
        { blockingKey: 'msg', blockedKey: 'page' },
        { blockingKey: 'msg', blockedKey: 'email' },
        { blockingKey: 'page', blockedKey: 'go' },
      ],
      automations: [
        { name: 'Tell the owner when the launch kit is approved', trigger: { type: 'task_completed' }, conditions: [{ field: 'title', op: 'contains', value: 'sign-off' }], actions: [{ type: 'notify', target: 'project_owner' }] },
      ],
    },
  },
  {
    slug: 'client-onboarding',
    name: 'Client onboarding',
    description: 'Welcome a new client: kickoff, account setup, data import, training and first review.',
    category: 'Customer success',
    icon: 'handshake',
    color: 'green',
    payload: {
      durationDays: 30,
      defaultView: 'list',
      asksForCustomer: true,
      statuses: [
        { key: 'todo', name: 'Not started', category: 'todo', color: 'gray', isDefault: true },
        { key: 'doing', name: 'Working on it', category: 'in_progress', color: 'blue' },
        { key: 'client', name: 'Waiting on client', category: 'in_progress', color: 'orange' },
        { key: 'done', name: 'Done', category: 'done', color: 'green' },
      ],
      sections: [
        { key: 'kickoff', name: 'Kickoff' },
        { key: 'setup', name: 'Set up' },
        { key: 'golive', name: 'Go live' },
      ],
      labels: [{ key: 'client', name: 'Client action', color: 'orange' }],
      milestones: [{ key: 'live', name: 'Client live', dueOffsetDays: 21 }],
      tasks: [
        { key: 'welcome', title: 'Send the welcome email', sectionKey: 'kickoff', priority: 'high', dueOffsetDays: 1 },
        { key: 'call', title: 'Hold the kickoff call', sectionKey: 'kickoff', dueOffsetDays: 3, subtasks: [{ title: 'Share the agenda' }, { title: 'Confirm main contacts' }, { title: 'Agree on the go-live date' }] },
        { key: 'access', title: 'Create the client accounts', sectionKey: 'setup', dueOffsetDays: 5 },
        { key: 'data', title: 'Collect product and customer data', sectionKey: 'setup', labelKeys: ['client'], dueOffsetDays: 9 },
        { key: 'import', title: 'Import the data and check it', sectionKey: 'setup', dueOffsetDays: 12 },
        { key: 'training', title: 'Run the training session', sectionKey: 'golive', dueOffsetDays: 18 },
        { key: 'live', title: 'Go live', sectionKey: 'golive', isMilestone: true, milestoneKey: 'live', priority: 'urgent', dueOffsetDays: 21 },
        { key: 'checkin', title: '30-day check-in', sectionKey: 'golive', dueOffsetDays: 30 },
      ],
      dependencies: [
        { blockingKey: 'data', blockedKey: 'import' },
        { blockingKey: 'import', blockedKey: 'live' },
      ],
      automations: [
        { name: 'Flag work that is waiting on the client', trigger: { type: 'status_changed', toStatusId: 'client' }, actions: [{ type: 'add_label', labelId: 'client' }] },
      ],
    },
  },
  {
    slug: 'warehouse-go-live',
    name: 'Warehouse go-live',
    description: 'Bring a client live in the warehouse: setup, receiving, inventory, test orders and launch.',
    category: 'Operations',
    icon: 'warehouse',
    color: 'orange',
    payload: {
      durationDays: 35,
      defaultView: 'board',
      asksForCustomer: true,
      statuses: [...KANBAN],
      sections: [
        { key: 'setup', name: 'Setup' },
        { key: 'inbound', name: 'Receiving and stock' },
        { key: 'outbound', name: 'Orders and shipping' },
      ],
      labels: [
        { key: 'wms', name: 'WMS setup', color: 'teal' },
        { key: 'floor', name: 'Warehouse floor', color: 'orange' },
      ],
      milestones: [
        { key: 'stock', name: 'First stock received', dueOffsetDays: 14 },
        { key: 'live', name: 'First orders shipped', dueOffsetDays: 30 },
      ],
      tasks: [
        { key: 'client', title: 'Create the client in the WMS', sectionKey: 'setup', labelKeys: ['wms'], priority: 'high', dueOffsetDays: 2 },
        { key: 'skus', title: 'Load products and barcodes', sectionKey: 'setup', labelKeys: ['wms'], dueOffsetDays: 6 },
        { key: 'locations', title: 'Assign storage locations', sectionKey: 'setup', labelKeys: ['floor'], dueOffsetDays: 8 },
        { key: 'carriers', title: 'Set up carriers and shipping rules', sectionKey: 'setup', labelKeys: ['wms'], dueOffsetDays: 10 },
        { key: 'asn', title: 'Get the first delivery notice (ASN)', sectionKey: 'inbound', dueOffsetDays: 11 },
        { key: 'receive', title: 'Receive and put away the first delivery', sectionKey: 'inbound', labelKeys: ['floor'], milestoneKey: 'stock', dueOffsetDays: 14 },
        { key: 'count', title: 'Cycle count the new stock', sectionKey: 'inbound', labelKeys: ['floor'], dueOffsetDays: 16 },
        { key: 'test', title: 'Ship five test orders', sectionKey: 'outbound', dueOffsetDays: 22, subtasks: [{ title: 'Pick and pack' }, { title: 'Print labels' }, { title: 'Confirm tracking' }] },
        { key: 'channel', title: 'Connect the sales channel', sectionKey: 'outbound', labelKeys: ['wms'], dueOffsetDays: 25 },
        { key: 'go', title: 'Go live with real orders', sectionKey: 'outbound', isMilestone: true, milestoneKey: 'live', priority: 'urgent', dueOffsetDays: 30 },
        { key: 'review', title: 'Review the first week with the client', sectionKey: 'outbound', dueOffsetDays: 35 },
      ],
      dependencies: [
        { blockingKey: 'skus', blockedKey: 'receive' },
        { blockingKey: 'receive', blockedKey: 'test' },
        { blockingKey: 'test', blockedKey: 'go' },
        { blockingKey: 'channel', blockedKey: 'go' },
      ],
    },
  },
  {
    slug: 'sales-handoff',
    name: 'Sales deal handoff',
    description: 'A deal is won in the CRM. Hand it to the delivery team with nothing lost: notes, contacts, kickoff and first delivery.',
    category: 'Sales',
    icon: 'briefcase',
    color: 'blue',
    payload: {
      durationDays: 21,
      defaultView: 'board',
      asksForCustomer: true,
      statuses: [
        { key: 'todo', name: 'To do', category: 'todo', color: 'gray', isDefault: true },
        { key: 'doing', name: 'In progress', category: 'in_progress', color: 'blue' },
        { key: 'sales', name: 'Needs sales input', category: 'in_progress', color: 'yellow' },
        { key: 'done', name: 'Done', category: 'done', color: 'green' },
      ],
      sections: [
        { key: 'handoff', name: 'Handoff' },
        { key: 'kickoff', name: 'Kickoff' },
        { key: 'deliver', name: 'First delivery' },
      ],
      labels: [
        { key: 'sales', name: 'Sales', color: 'blue' },
        { key: 'delivery', name: 'Delivery', color: 'green' },
        { key: 'billing', name: 'Billing', color: 'purple' },
      ],
      customFields: [{ key: 'value', name: 'Deal value', type: 'currency', config: { currency: 'USD', precision: 0 } }],
      milestones: [
        { key: 'kickoff', name: 'Kickoff held', dueOffsetDays: 5 },
        { key: 'first', name: 'First delivery', dueOffsetDays: 18 },
      ],
      tasks: [
        { key: 'notes', title: 'Write the handoff notes from the CRM deal', sectionKey: 'handoff', labelKeys: ['sales'], priority: 'high', dueOffsetDays: 1, subtasks: [{ title: 'What was promised' }, { title: 'Key contacts and roles' }, { title: 'Pricing and contract dates' }] },
        { key: 'contract', title: 'Attach the signed contract', sectionKey: 'handoff', labelKeys: ['sales'], dueOffsetDays: 1 },
        { key: 'meet', title: 'Internal handoff meeting (sales + delivery)', sectionKey: 'handoff', dueOffsetDays: 2 },
        { key: 'invoice', title: 'Send the first invoice', sectionKey: 'handoff', labelKeys: ['billing'], dueOffsetDays: 3 },
        { key: 'kick', title: 'Kickoff call with the client', sectionKey: 'kickoff', labelKeys: ['delivery'], isMilestone: true, milestoneKey: 'kickoff', priority: 'high', dueOffsetDays: 5 },
        { key: 'plan', title: 'Share the delivery plan with the client', sectionKey: 'kickoff', labelKeys: ['delivery'], dueOffsetDays: 7 },
        { key: 'build', title: 'Deliver the first piece of work', sectionKey: 'deliver', labelKeys: ['delivery'], dueOffsetDays: 15 },
        { key: 'first', title: 'First delivery review with the client', sectionKey: 'deliver', isMilestone: true, milestoneKey: 'first', dueOffsetDays: 18 },
        { key: 'thanks', title: 'Thank-you note and referral ask from sales', sectionKey: 'deliver', labelKeys: ['sales'], dueOffsetDays: 21 },
      ],
      dependencies: [
        { blockingKey: 'notes', blockedKey: 'meet' },
        { blockingKey: 'meet', blockedKey: 'kick' },
        { blockingKey: 'kick', blockedKey: 'plan' },
        { blockingKey: 'build', blockedKey: 'first' },
      ],
      automations: [
        { name: 'Ask sales when the team is stuck', trigger: { type: 'status_changed', toStatusId: 'sales' }, actions: [{ type: 'notify', target: 'project_owner', message: '{task} needs input from sales' }] },
        { name: 'Thank the client after the first delivery', trigger: { type: 'task_completed' }, conditions: [{ field: 'title', op: 'contains', value: 'First delivery review' }], actions: [{ type: 'create_follow_up', title: 'Send a thank-you and ask for feedback', dueInDays: 2, assignTo: 'assignee' }] },
      ],
    },
  },
  {
    slug: 'sprint',
    name: 'Two-week sprint',
    description: 'Plan, build and review a two-week sprint with a backlog, points and a demo.',
    category: 'Engineering',
    icon: 'zap',
    color: 'blue',
    payload: {
      durationDays: 14,
      defaultView: 'board',
      statuses: [
        { key: 'backlog', name: 'Backlog', category: 'todo', color: 'gray', isDefault: true },
        { key: 'todo', name: 'Ready', category: 'todo', color: 'sky' },
        { key: 'doing', name: 'In progress', category: 'in_progress', color: 'blue', wipLimit: 5 },
        { key: 'review', name: 'Code review', category: 'in_progress', color: 'purple', wipLimit: 3 },
        { key: 'done', name: 'Done', category: 'done', color: 'green' },
      ],
      labels: [
        { key: 'bug', name: 'Bug', color: 'red' },
        { key: 'feature', name: 'Feature', color: 'blue' },
        { key: 'chore', name: 'Chore', color: 'gray' },
      ],
      customFields: [{ key: 'area', name: 'Area', type: 'select', config: { options: [{ id: 'web', label: 'Web app', color: 'blue' }, { id: 'api', label: 'API', color: 'purple' }, { id: 'mobile', label: 'Mobile', color: 'green' }] } }],
      tasks: [
        { title: 'Sprint planning', statusKey: 'todo', dueOffsetDays: 0, estimatePoints: 1 },
        { title: 'Fix login timeout on slow networks', statusKey: 'todo', labelKeys: ['bug'], priority: 'high', estimatePoints: 3 },
        { title: 'Add export to CSV on reports', statusKey: 'todo', labelKeys: ['feature'], estimatePoints: 5 },
        { title: 'Upgrade the build tools', statusKey: 'backlog', labelKeys: ['chore'], estimatePoints: 2 },
        { title: 'Sprint demo', dueOffsetDays: 13, isMilestone: true },
        { title: 'Retrospective', dueOffsetDays: 14, estimatePoints: 1 },
      ],
      automations: [
        { name: 'Bugs start as high priority', trigger: { type: 'label_added', labelId: 'bug' }, actions: [{ type: 'set_priority', priority: 'high' }] },
      ],
    },
  },
  {
    slug: 'event',
    name: 'Event plan',
    description: 'Run an event from venue to follow-up: budget, speakers, promotion and the day itself.',
    category: 'Marketing',
    icon: 'calendar-days',
    color: 'purple',
    payload: {
      durationDays: 60,
      defaultView: 'calendar',
      statuses: [...KANBAN],
      sections: [
        { key: 'plan', name: 'Planning' },
        { key: 'promo', name: 'Promotion' },
        { key: 'day', name: 'Event day' },
        { key: 'follow', name: 'Follow-up' },
      ],
      customFields: [{ key: 'cost', name: 'Cost', type: 'currency', config: { currency: 'USD', precision: 2 } }],
      milestones: [{ key: 'day', name: 'Event day', dueOffsetDays: 50 }],
      tasks: [
        { title: 'Set the budget', sectionKey: 'plan', priority: 'high', dueOffsetDays: 4 },
        { title: 'Book the venue', sectionKey: 'plan', priority: 'high', dueOffsetDays: 10 },
        { title: 'Confirm speakers', sectionKey: 'plan', dueOffsetDays: 20 },
        { title: 'Order food and drinks', sectionKey: 'plan', dueOffsetDays: 40 },
        { title: 'Open registration', sectionKey: 'promo', dueOffsetDays: 15 },
        { title: 'Send invitations', sectionKey: 'promo', dueOffsetDays: 18 },
        { title: 'Send reminder emails', sectionKey: 'promo', dueOffsetDays: 47 },
        { title: 'Run the event', sectionKey: 'day', isMilestone: true, milestoneKey: 'day', priority: 'urgent', dueOffsetDays: 50 },
        { title: 'Send thank-you notes and slides', sectionKey: 'follow', dueOffsetDays: 53 },
        { title: 'Share the results report', sectionKey: 'follow', dueOffsetDays: 60 },
      ],
    },
  },
  {
    slug: 'marketing-campaign',
    name: 'Marketing campaign',
    description: 'Plan and run a campaign across channels, with content, approvals and results.',
    category: 'Marketing',
    icon: 'megaphone',
    color: 'pink',
    payload: {
      durationDays: 30,
      defaultView: 'board',
      statuses: [
        { key: 'idea', name: 'Ideas', category: 'todo', color: 'gray', isDefault: true },
        { key: 'doing', name: 'Writing', category: 'in_progress', color: 'blue' },
        { key: 'approve', name: 'Needs approval', category: 'in_progress', color: 'yellow' },
        { key: 'sched', name: 'Scheduled', category: 'in_progress', color: 'teal' },
        { key: 'done', name: 'Published', category: 'done', color: 'green' },
      ],
      labels: [
        { key: 'email', name: 'Email', color: 'blue' },
        { key: 'social', name: 'Social', color: 'pink' },
        { key: 'ads', name: 'Ads', color: 'orange' },
        { key: 'blog', name: 'Blog', color: 'purple' },
      ],
      tasks: [
        { title: 'Pick the campaign goal and audience', statusKey: 'doing', priority: 'high', dueOffsetDays: 2 },
        { title: 'Write the blog post', labelKeys: ['blog'], dueOffsetDays: 8 },
        { title: 'Design social posts', labelKeys: ['social'], dueOffsetDays: 10 },
        { title: 'Write the email series', labelKeys: ['email'], dueOffsetDays: 12, subtasks: [{ title: 'Email 1: the problem' }, { title: 'Email 2: the fix' }, { title: 'Email 3: the offer' }] },
        { title: 'Set up the ads', labelKeys: ['ads'], dueOffsetDays: 14 },
        { title: 'Check results halfway', dueOffsetDays: 20 },
        { title: 'Write the wrap-up report', dueOffsetDays: 30 },
      ],
      automations: [
        { name: 'Ask the owner to approve content', trigger: { type: 'status_changed', toStatusId: 'approve' }, actions: [{ type: 'notify', target: 'project_owner', message: '{task} is ready for your approval' }] },
      ],
    },
  },
];

/** Built-ins with start dates filled in so every dated task draws a real bar on the timeline. */
export const BUILTIN_TEMPLATES: readonly BuiltinTemplate[] = BUILTIN_TEMPLATE_SOURCE.map((template) => ({
  ...template,
  payload: withScheduledStarts(template.payload),
}));

export function findBuiltinTemplate(id: string): BuiltinTemplate | undefined {
  const slug = id.startsWith('builtin:') ? id.slice('builtin:'.length) : id;
  return BUILTIN_TEMPLATES.find((template) => template.slug === slug);
}

/** All tasks including subtasks (what instantiation inserts). */
export function countTemplateTasks(payload: TemplatePayload): number {
  const counts = countTemplateTaskTree(payload);
  return counts.tasks + counts.subtasks;
}
