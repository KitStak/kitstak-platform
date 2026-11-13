/**
 * Deterministic demo data for the /dev/cells gallery: one column of every type, two groups of
 * realistic CRM items (dates relative to today so overdue / due-soon accents show), users,
 * teams, files and connectable items. Dev only.
 */
import type { ColumnType } from '@/server/db/schema/cell-values';
import { COLUMN_TYPES } from '@/server/db/schema/cell-values';
import { COLUMN_TYPE_REGISTRY } from '@/server/db/schema/column-types';
import type { ColumnDto, FileDto, GroupDto, ItemDto, TeamDto, UserSummaryDto } from '@/server/services/contracts/dto';
import type { ConnectCandidate, GeoPlace } from '@/features/cells';

export const BOARD_ID = '00000000-0000-4000-8000-0000000000b1';
/** Deterministic, realistic-looking v4 uuids (the Item ID column shows the first 8 hex chars). */
const uuid = (n: number) => {
  const head = ((Math.imul(n, 2654435761) >>> 0) ^ 0x5bd1e995).toString(16).padStart(8, '0');
  return `${head}-0000-4000-8000-${String(n).padStart(12, '0')}`;
};

export const USERS: UserSummaryDto[] = [
  { id: uuid(101), name: 'Maya Chen', email: 'maya@northwind.example', image: null, title: 'Head of Sales' },
  { id: uuid(102), name: 'Diego Alvarez', email: 'diego@northwind.example', image: null, title: 'Account Executive' },
  { id: uuid(103), name: 'Priya Natarajan', email: 'priya@northwind.example', image: null, title: 'Solutions Engineer' },
  { id: uuid(104), name: 'Tom Becker', email: 'tom@northwind.example', image: null, title: 'SDR' },
  { id: uuid(105), name: 'Aisha Bello', email: 'aisha@northwind.example', image: null, title: 'Customer Success' },
  { id: uuid(106), name: 'Lars Holm', email: 'lars@northwind.example', image: null, title: 'RevOps' },
];

export const TEAMS: TeamDto[] = [
  { id: uuid(201), name: 'Enterprise AEs', memberIds: [uuid(101), uuid(102)], createdAt: '2026-01-01T00:00:00Z' },
  { id: uuid(202), name: 'Solutions', memberIds: [uuid(103)], createdAt: '2026-01-01T00:00:00Z' },
];

export const GROUPS: GroupDto[] = [
  { id: uuid(301), boardId: BOARD_ID, title: 'Open pipeline', color: 'blue', position: 'a0', collapsedDefault: false, archivedAt: null },
  { id: uuid(302), boardId: BOARD_ID, title: 'Closing this quarter', color: 'purple', position: 'a1', collapsedDefault: false, archivedAt: null },
];

const SETTINGS: Partial<Record<ColumnType, unknown>> = {
  status: {
    labels: [
      { id: 'working', name: 'Working on it', color: 'orange', position: 0 },
      { id: 'review', name: 'Waiting for review', color: 'purple', position: 1 },
      { id: 'done', name: 'Done', color: 'green', position: 2, isDone: true },
      { id: 'stuck', name: 'Stuck', color: 'red', position: 3 },
      { id: 'default', name: '', color: 'gray', position: 4, isDefault: true },
    ],
  },
  dropdown: {
    labels: [
      { id: 'core', name: 'Core platform', color: 'blue', position: 0 },
      { id: 'analytics', name: 'Analytics', color: 'teal', position: 1 },
      { id: 'integrations', name: 'Integrations', color: 'purple', position: 2 },
      { id: 'support', name: 'Premium support', color: 'orange', position: 3 },
    ],
  },
  number: { unit: 'seats', unitPosition: 'suffix', decimals: 0, format: 'plain', summary: 'sum' },
  currency: { currency: 'USD', decimals: 0, summary: 'sum' },
  rating: { max: 5 },
  people: { allowMultiple: true, allowTeams: true },
  date: { includeTime: false, format: 'short' },
  connect_boards: { boardIds: [], allowMultiple: true },
  button: { label: 'Send quote', color: 'blue' },
  formula: { expression: '{deal_value} * {probability}' },
  tags: { suggestions: ['enterprise', 'renewal', 'inbound', 'partner', 'q4-push'] },
  phone: { defaultCountry: 'US' },
};

const TITLES: Partial<Record<ColumnType, string>> = {
  name: 'Deal',
  text: 'Next step',
  long_text: 'Notes',
  status: 'Stage',
  people: 'Owner',
  date: 'Close date',
  timeline: 'Pilot window',
  number: 'Seats',
  currency: 'Deal value',
  email: 'Contact email',
  phone: 'Phone',
  link: 'Website',
  dropdown: 'Products',
  tags: 'Tags',
  checkbox: 'Signed NDA',
  rating: 'Fit',
  progress: 'Progress',
  files: 'Files',
  connect_boards: 'Account',
  mirror: 'Account tier',
  formula: 'Weighted',
  location: 'HQ',
  country: 'Country',
  last_updated: 'Last updated',
  creation_log: 'Created',
  item_id: 'Item ID',
  button: 'Quote',
};

export const COLUMNS: ColumnDto[] = COLUMN_TYPES.map((type, index) => {
  const definition = COLUMN_TYPE_REGISTRY[type];
  return {
    id: uuid(400 + index),
    boardId: BOARD_ID,
    key: type === 'name' ? 'name' : type,
    title: TITLES[type] ?? definition.label,
    description: null,
    type,
    scope: 'item',
    settings: (SETTINGS[type] ?? definition.defaultSettings()) as ColumnDto['settings'],
    width: Math.max(definition.defaultWidth, type === 'name' ? 240 : 0),
    position: `a${index.toString(36)}`,
    hidden: false,
    required: false,
  };
});

/** A second status column with light label colors (proves the dark-text contrast rule). */
export const PRIORITY_COLUMN: ColumnDto = {
  ...(COLUMNS.find((column) => column.type === 'status') as ColumnDto),
  id: uuid(499),
  key: 'priority',
  title: 'Priority',
  settings: {
    labels: [
      { id: 'critical', name: 'Critical', color: 'dark-blue', position: 0 },
      { id: 'high', name: 'High', color: 'red-light', position: 1 },
      { id: 'medium', name: 'Medium', color: 'yellow-light', position: 2 },
      { id: 'low', name: 'Low', color: 'teal-light', position: 3 },
      { id: 'default', name: '', color: 'gray', position: 4, isDefault: true },
    ],
  } as ColumnDto['settings'],
};

function isoOffset(days: number): string {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export const FILES: FileDto[] = [
  { id: uuid(601), name: 'MSA-redline-v3.pdf', mime: 'application/pdf', size: 482_113, boardId: BOARD_ID, itemId: uuid(501), updateId: null, columnKey: 'files', uploadedBy: uuid(101), createdAt: '2026-10-02T10:00:00Z', url: '' },
  { id: uuid(602), name: 'Pricing-model.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 91_004, boardId: BOARD_ID, itemId: uuid(501), updateId: null, columnKey: 'files', uploadedBy: uuid(102), createdAt: '2026-10-03T10:00:00Z', url: '' },
  { id: uuid(603), name: 'Kickoff-deck.pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', size: 2_402_113, boardId: BOARD_ID, itemId: uuid(501), updateId: null, columnKey: 'files', uploadedBy: uuid(103), createdAt: '2026-10-04T10:00:00Z', url: '' },
  { id: uuid(604), name: 'Security-questionnaire.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 120_442, boardId: BOARD_ID, itemId: uuid(501), updateId: null, columnKey: 'files', uploadedBy: uuid(103), createdAt: '2026-10-05T10:00:00Z', url: '' },
  { id: uuid(605), name: 'Logos.zip', mime: 'application/zip', size: 5_120_000, boardId: BOARD_ID, itemId: uuid(502), updateId: null, columnKey: 'files', uploadedBy: uuid(104), createdAt: '2026-10-06T10:00:00Z', url: '' },
];

/** Mock place-search results for the location editor. */
export const PLACES: GeoPlace[] = [
  { id: 'p1', name: '350 5th Ave', address: '350 5th Ave, New York, NY 10118, USA', lat: 40.7484, lng: -73.9857 },
  { id: 'p2', name: 'Dallas', address: 'Dallas, TX, USA', lat: 32.7767, lng: -96.797 },
  { id: 'p3', name: 'Hamburg', address: 'Hamburg, Germany', lat: 53.5511, lng: 9.9937 },
  { id: 'p4', name: 'Austin', address: 'Austin, TX, USA', lat: 30.2672, lng: -97.7431 },
  { id: 'p5', name: 'London', address: 'London, United Kingdom', lat: 51.5072, lng: -0.1276 },
  { id: 'p6', name: '1 Market St', address: '1 Market St, San Francisco, CA 94105, USA', lat: 37.7941, lng: -122.3951 },
  { id: 'p7', name: 'Toronto', address: 'Toronto, ON, Canada', lat: 43.6532, lng: -79.3832 },
];

export const CONNECTABLE: ConnectCandidate[] = [
  { id: uuid(701), name: 'Acme Robotics', boardId: uuid(900), boardName: 'Accounts', groupTitle: 'Strategic' },
  { id: uuid(702), name: 'Globex Logistics', boardId: uuid(900), boardName: 'Accounts', groupTitle: 'Strategic' },
  { id: uuid(703), name: 'Initech', boardId: uuid(900), boardName: 'Accounts', groupTitle: 'Mid-market' },
  { id: uuid(704), name: 'Umbrella Health', boardId: uuid(900), boardName: 'Accounts', groupTitle: 'Mid-market' },
  { id: uuid(705), name: 'Stark Manufacturing', boardId: uuid(900), boardName: 'Accounts', groupTitle: 'Enterprise' },
  { id: uuid(706), name: 'Wayne Freight', boardId: uuid(900), boardName: 'Accounts', groupTitle: 'Enterprise' },
];

interface Seed {
  readonly name: string;
  readonly group: 0 | 1;
  readonly values: Record<string, unknown>;
  readonly computed?: Record<string, unknown>;
}

const SEEDS: Seed[] = [
  {
    name: 'Acme Robotics · platform expansion',
    group: 0,
    values: {
      text: 'Send revised MSA',
      long_text: 'Champion: VP Ops.\nNeeds SOC 2 report before legal review.\nBudget approved for FY27.',
      status: { labelId: 'working' },
      priority: { labelId: 'critical' },
      people: { ids: [uuid(101), uuid(103), uuid(104), uuid(105)] },
      date: { date: isoOffset(-3) },
      timeline: { from: isoOffset(-20), to: isoOffset(25) },
      number: 1250,
      currency: { amount: 1_150_000, currency: 'USD' },
      email: { email: 'jordan.lee@acme.example', label: 'Jordan Lee' },
      phone: { phone: '+12145550163', country: 'US' },
      link: { url: 'https://www.acme.example/pricing' },
      dropdown: { labelIds: ['core', 'analytics', 'integrations'] },
      tags: { tags: ['enterprise', 'q4-push', 'renewal'] },
      checkbox: true,
      rating: 4,
      files: { fileIds: [uuid(601), uuid(602), uuid(603), uuid(604)] },
      connect_boards: { itemIds: [uuid(701)] },
      location: { address: 'Dallas, TX, USA', lat: 32.7767, lng: -96.797 },
      country: { code: 'US' },
    },
    computed: { mirror: { display: 'Strategic', values: ['Strategic'] }, formula: { result: 862500 } },
  },
  {
    name: 'Globex · logistics suite',
    group: 0,
    values: {
      text: 'Security review call',
      status: { labelId: 'review' },
      priority: { labelId: 'high' },
      people: { ids: [uuid(102)], teamIds: [uuid(201)] },
      date: { date: isoOffset(0), time: '15:30' },
      timeline: { from: isoOffset(-5), to: isoOffset(40) },
      number: 300,
      currency: { amount: 284_500, currency: 'EUR' },
      email: { email: 'procurement@globex.example' },
      phone: { phone: '+442079460958', country: 'GB' },
      link: { url: 'https://globex.example', text: 'Globex site' },
      dropdown: { labelIds: ['core'] },
      tags: { tags: ['inbound'] },
      rating: 3,
      files: { fileIds: [uuid(605)] },
      connect_boards: { itemIds: [uuid(702), uuid(703), uuid(704)] },
      location: { address: 'Hamburg, Germany' },
      country: { code: 'DE' },
    },
    computed: { mirror: { display: 'Strategic, Mid-market', values: ['Strategic', 'Mid-market'] }, formula: { result: 142250 } },
  },
  {
    name: 'Initech · renewal',
    group: 0,
    values: {
      status: { labelId: 'stuck' },
      priority: { labelId: 'medium' },
      people: { ids: [uuid(106)] },
      date: { date: isoOffset(2) },
      number: 42.5,
      currency: { amount: 18_900, currency: 'USD' },
      rating: 2,
      checkbox: false,
      country: { code: 'CA' },
    },
    computed: { formula: { result: null, error: 'Unknown column {probability}' } },
  },
  {
    name: 'Umbrella Health · pilot',
    group: 1,
    values: {
      text: 'Signed · kickoff Monday',
      status: { labelId: 'done' },
      priority: { labelId: 'low' },
      people: { ids: [uuid(105), uuid(103)] },
      date: { date: isoOffset(-6) },
      timeline: { from: isoOffset(-60), to: isoOffset(-2) },
      number: 75,
      currency: { amount: 96_000, currency: 'USD' },
      dropdown: { labelIds: ['support'] },
      checkbox: true,
      rating: 5,
      country: { code: 'JP' },
    },
    computed: { formula: { result: 96000 } },
  },
  {
    name: 'Stark Manufacturing · new logo',
    group: 1,
    values: {
      status: { labelId: 'working' },
      people: { ids: [uuid(102), uuid(104)] },
      date: { date: isoOffset(18) },
      timeline: { from: isoOffset(3), to: isoOffset(33) },
      currency: { amount: 640_000, currency: 'USD' },
      checkbox: true,
      tags: { tags: ['partner'] },
    },
  },
  { name: 'Wayne Freight · discovery', group: 1, values: {} },
];

const created = new Date(Date.now() - 3 * 86_400_000).toISOString();

export const ITEMS: ItemDto[] = SEEDS.map((seed, index) => ({
  id: uuid(501 + index),
  boardId: BOARD_ID,
  groupId: GROUPS[seed.group]?.id ?? uuid(301),
  parentItemId: null,
  name: seed.name,
  position: `a${index}`,
  values: seed.values as ItemDto['values'],
  computed: {
    item_id: uuid(501 + index),
    last_updated: { at: new Date(Date.now() - (index + 1) * 47 * 60_000).toISOString(), userId: USERS[index % USERS.length]?.id ?? null },
    creation_log: { at: created, userId: USERS[(index + 2) % USERS.length]?.id ?? null },
    button: null,
    ...(seed.computed ?? {}),
  },
  subitemCount: 0,
  updateCount: 0,
  createdBy: USERS[0]?.id ?? null,
  updatedBy: USERS[1]?.id ?? null,
  createdAt: created,
  updatedAt: new Date().toISOString(),
  archivedAt: null,
  deletedAt: null,
}));

/** An item with nothing set (empty states). */
export const EMPTY_ITEM: ItemDto = { ...(ITEMS[ITEMS.length - 1] as ItemDto), id: uuid(599), name: 'Empty item', values: {}, computed: { item_id: uuid(599), button: null, formula: { result: null }, mirror: { display: '', values: [] } } };
