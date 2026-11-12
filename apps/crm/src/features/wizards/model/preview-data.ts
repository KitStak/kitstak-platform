/**
 * Template preview data (pure, deterministic): fills every group of a gallery board with 2-4
 * realistic rows and every empty cell with a plausible value (owners, money, dates, emails,
 * phones, linked records), so previews show what a template is for. Preview only: boards are
 * still created from the template's own sample rows.
 */
import type { GalleryBoard, GalleryColumn, GalleryGroup, GalleryLabel } from '@/server/services/wizards-gallery';

export interface PreviewRow {
  readonly key: string;
  readonly name: string;
  readonly values: Readonly<Record<string, unknown>>;
}

export interface PreviewGroup {
  readonly group: GalleryGroup;
  readonly rows: readonly PreviewRow[];
}

/** Preview-only cell shapes (never persisted). */
export interface PreviewPeople {
  readonly previewPeople: readonly string[];
}
export interface PreviewLinks {
  readonly previewLinks: readonly string[];
}

const PEOPLE = ['Maya Chen', 'Leo Okafor', 'Priya Raman', 'Tomás Silva', 'Hana Sato', 'Noah Fischer', 'Amara Diallo', 'Eli Brooks'];
const COMPANIES = [
  'Brightline Labs',
  'Northgate Freight',
  'Orbit Foods',
  'Cobalt Health',
  'Fernway Studio',
  'Atlas Robotics',
  'Juniper Energy',
  'Meridian Bank',
];
const TITLES = ['VP Operations', 'Head of Sales', 'IT Director', 'COO', 'Procurement lead', 'CFO', 'Product manager', 'Founder'];
const NOTES = ['Send revised proposal', 'Book security review', 'Intro call with CFO', 'Share case study', 'Confirm budget', 'Kickoff next week'];
const AMOUNTS = [48_000, 12_500, 96_000, 7_200, 31_000, 64_500, 18_900, 120_000];

const NAMES_BY_TERM: Readonly<Record<string, readonly string[]>> = {
  deal: [
    'Fleet automation rollout',
    'Warehouse pilot',
    'Q3 expansion · Orbit Foods',
    'Platform renewal · Cobalt',
    'Analytics add-on',
    'Enterprise upgrade',
    'Multi-site license',
    'Starter plan · Fernway',
    'Robotics retrofit · Atlas',
    'Data platform · Meridian',
    'Cold-chain sensors',
    'EMEA rollout · Juniper',
  ],
  lead: ['Avery Collins', 'Jordan Patel', 'Sam Whitaker', 'Riley Moreno', 'Casey Nguyen', 'Morgan Lee', 'Quinn Adler', 'Drew Harper', 'Jamie Ortiz', 'Parker Reed', 'Skyler Brandt', 'Rowan Ellis'],
  contact: ['Avery Collins', 'Jordan Patel', 'Sam Whitaker', 'Riley Moreno', 'Casey Nguyen', 'Morgan Lee', 'Quinn Adler', 'Drew Harper', 'Jamie Ortiz', 'Parker Reed', 'Skyler Brandt', 'Rowan Ellis'],
  candidate: ['Sofia Marin', 'Daniel Kim', 'Grace Owusu', 'Mateo Rossi', 'Ava Lindqvist', 'Ibrahim Haddad', 'Chloe Martin', 'Ravi Shah'],
  'new hire': ['Sofia Marin', 'Daniel Kim', 'Grace Owusu', 'Mateo Rossi', 'Ava Lindqvist', 'Ibrahim Haddad'],
  account: COMPANIES,
  partner: ['Summit Resellers', 'Bluepeak Consulting', 'Nimbus Integrators', 'Harbor Channel Co.', 'Vertex Alliance', 'Keystone Partners'],
  vendor: ['Parcel Pro Logistics', 'Clearline Software', 'Granite Supplies', 'Helix Cloud', 'Openfield Print', 'Swift Couriers'],
  activity: ['Discovery call · Brightline', 'Demo · Northgate Freight', 'Follow-up email', 'Pricing review', 'Quarterly check-in', 'Onsite workshop'],
  project: ['Brightline onboarding', 'Northgate go-live', 'Orbit data migration', 'Cobalt rollout', 'Atlas integration', 'Juniper training'],
  task: ['Draft launch plan', 'Finalize requirements', 'Design review', 'QA sign-off', 'Customer training', 'Retro and handover'],
  quote: ['Q-1042 · Brightline Labs', 'Q-1043 · Orbit Foods', 'Q-1044 · Cobalt Health', 'Q-1045 · Atlas Robotics', 'Q-1046 · Meridian Bank', 'Q-1047 · Fernway'],
  campaign: ['Spring webinar series', 'Q3 product launch', 'Partner newsletter', 'ABM · Fortune 500', 'Retargeting refresh', 'Customer stories'],
  event: ['RevOps Summit booth', 'Customer roundtable', 'Product webinar', 'Partner kickoff', 'Field dinner · Chicago', 'User conference'],
  ticket: ['Can’t export invoices', 'SSO login loop', 'Add field to form', 'Billing address update', 'Slow dashboard load', 'Webhook retries'],
  request: ['New laptop for Maya', 'Contract review · Orbit', 'Access to finance board', 'Vendor onboarding', 'Travel approval', 'Data export'],
  renewal: ['Brightline Labs · 2027', 'Northgate Freight · 2027', 'Orbit Foods · 2027', 'Cobalt Health · 2027', 'Atlas Robotics · 2027', 'Meridian · 2027'],
};

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function pick<T>(pool: readonly T[], index: number): T {
  return pool[((index % pool.length) + pool.length) % pool.length] as T;
}

function isoDay(now: number, offsetDays: number): string {
  return new Date(now + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

function slug(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '');
}

/** Status label that a group stands for ("Closed won" → Won), if any. */
export function labelForGroup(group: GalleryGroup, labels: readonly GalleryLabel[]): GalleryLabel | null {
  const haystack = ` ${normalizeKey(`${group.key} ${group.title}`)} `;
  return (
    labels.find((label) => {
      const id = normalizeKey(label.id);
      const name = normalizeKey(label.name);
      return (id.length > 1 && haystack.includes(` ${id} `)) || (name.length > 1 && haystack.includes(` ${name} `));
    }) ?? null
  );
}

function statusValue(column: GalleryColumn, group: GalleryGroup, groups: readonly GalleryGroup[], seed: number) {
  const labels = column.labels ?? [];
  if (!labels.length) return undefined;
  const matched = labelForGroup(group, labels);
  if (matched) return { labelId: matched.id };
  // Labels other groups stand for (Won / Lost) are not used for open rows.
  const reserved = new Set(groups.map((item) => labelForGroup(item, labels)?.id).filter(Boolean));
  const open = labels.filter((label) => !reserved.has(label.id));
  return { labelId: pick(open.length ? open : labels, seed).id };
}

/** Pipeline stage → close probability, so the preview never shows a Discovery deal at 90%. */
const STAGE_PROBABILITY: readonly (readonly [RegExp, number])[] = [
  [/\b(won|closed won|signed)\b/, 100],
  [/\b(lost|closed lost|churn)/, 0],
  [/negotiat|commit|contract/, 75],
  [/proposal|quote|demo/, 50],
  [/discover|qualif/, 25],
  [/\b(lead|new|prospect|contacted)\b/, 10],
];

export function probabilityForStage(stageName: string): number | null {
  const key = normalizeKey(stageName);
  for (const [pattern, value] of STAGE_PROBABILITY) if (pattern.test(key)) return value;
  return null;
}

/** Whether a column holds a close probability (percent number titled "probability"). */
function isProbability(column: GalleryColumn): boolean {
  return column.type === 'number' && (column.unit === '%' || column.title.toLowerCase().includes('prob'));
}

const DAY = 86_400_000;

/** [start, end] (ms, UTC days) of the calendar quarter `offset` quarters from `now`. */
export function quarterRange(now: number, offset: number): readonly [number, number] {
  const date = new Date(now);
  const quarter = Math.floor(date.getUTCMonth() / 3) + offset;
  const start = Date.UTC(date.getUTCFullYear(), quarter * 3, 1);
  const end = Date.UTC(date.getUTCFullYear(), quarter * 3 + 3, 1) - DAY;
  return [start, end];
}

/**
 * Date for a row, consistent with its group: "This quarter" falls between tomorrow and the
 * quarter end, "Next quarter" inside the next quarter, closed/done groups in the recent past,
 * and everything else in the near future. Never in the past for open work.
 */
export function previewDate(group: Pick<GalleryGroup, 'key' | 'title'>, seed: number, now: number, closed: boolean): string {
  const key = normalizeKey(`${group.key} ${group.title}`);
  const today = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());
  const spread = (from: number, to: number) => {
    const days = Math.max(0, Math.round((to - from) / DAY));
    const steps = [0.15, 0.45, 0.75, 0.3, 0.6, 0.9];
    return new Date(from + Math.round(days * pick(steps, seed)) * DAY).toISOString().slice(0, 10);
  };
  if (/next quarter/.test(key)) {
    const [start, end] = quarterRange(now, 1);
    return spread(start, end);
  }
  if (/this quarter|current quarter/.test(key)) {
    const [, end] = quarterRange(now, 0);
    return spread(today + DAY, Math.max(end, today + DAY));
  }
  if (/next month/.test(key)) return spread(today + 30 * DAY, today + 58 * DAY);
  if (closed) return isoDay(today, -pick([3, 9, 16, 24, 31, 40], seed));
  return isoDay(today, pick([6, 14, 21, 9, 30, 45], seed));
}

function fillValue(
  column: GalleryColumn,
  context: { group: GalleryGroup; groups: readonly GalleryGroup[]; rowName: string; seed: number; now: number; won: boolean | null },
): unknown {
  const { seed, now } = context;
  const title = column.title.toLowerCase();
  switch (column.type) {
    case 'status':
      return statusValue(column, context.group, context.groups, seed);
    case 'dropdown':
      return column.labels?.length ? { labelIds: [pick(column.labels, seed).id] } : undefined;
    case 'people':
      return { previewPeople: seed % 3 === 2 ? [pick(PEOPLE, seed), pick(PEOPLE, seed + 3)] : [pick(PEOPLE, seed)] } satisfies PreviewPeople;
    case 'currency':
      return { amount: pick(AMOUNTS, seed), currency: column.currency ?? 'USD' };
    case 'number':
      if (column.unit === '%' || title.includes('prob')) {
        if (context.won === true) return 100;
        if (context.won === false) return 0;
        return pick([25, 50, 75, 40, 60, 90], seed);
      }
      return pick([3, 12, 8, 24, 5, 16], seed);
    case 'date':
      return { date: previewDate(context.group, seed, now, context.won !== null) };
    case 'timeline': {
      const start = pick([1, 2, 9, 16, 23, 30], seed);
      return { from: isoDay(now, start), to: isoDay(now, start + pick([7, 14, 10, 21], seed)) };
    }
    case 'email': {
      const person = /\s/.test(context.rowName) && !/[·\d]/.test(context.rowName) ? context.rowName : pick(PEOPLE, seed);
      return { email: `${slug(person)}@${slug(pick(COMPANIES, seed)).split('.')[0]}.example` };
    }
    case 'phone':
      return { phone: `+1 415 555 01${String(10 + ((seed * 7) % 89)).padStart(2, '0')}` };
    case 'link':
      return { url: `https://${slug(pick(COMPANIES, seed)).split('.')[0]}.example`, text: pick(COMPANIES, seed) };
    case 'connect_boards':
      return { previewLinks: [pick(title.includes('contact') ? PEOPLE : COMPANIES, seed)] } satisfies PreviewLinks;
    case 'text':
      if (title.includes('title') || title.includes('role') || title.includes('position')) return pick(TITLES, seed);
      if (title.includes('company') || title.includes('account') || title.includes('organization')) return pick(COMPANIES, seed);
      return pick(NOTES, seed);
    case 'long_text':
      return pick(NOTES, seed + 2);
    case 'checkbox':
      return seed % 2 === 0;
    case 'rating':
      return 3 + (seed % 3);
    case 'tags':
      return { tags: [pick(['priority', 'q3', 'expansion', 'inbound', 'strategic'], seed)] };
    case 'country':
      return { code: pick(['US', 'GB', 'DE', 'CA', 'FR', 'NL'], seed) };
    case 'location':
      return { address: pick(['San Francisco, CA', 'Austin, TX', 'London, UK', 'Berlin, DE', 'Toronto, ON'], seed) };
    default:
      return undefined;
  }
}

/** Weighted formula preview for `{a} * {b} / 100` expressions (e.g. forecast value). */
function formulaValue(row: Readonly<Record<string, unknown>>, columns: readonly GalleryColumn[]): number | null {
  const currency = columns.find((column) => column.type === 'currency');
  const percent = columns.find((column) => column.type === 'number' && column.unit === '%');
  const amount = currency ? (row[currency.key] as { amount?: number } | undefined)?.amount : undefined;
  const pct = percent ? row[percent.key] : undefined;
  return typeof amount === 'number' && typeof pct === 'number' ? Math.round((amount * pct) / 100) : null;
}

/** Leading identifier of a row name ("Q-1043 · Orbit Foods" → "q-1043"). */
function nameHead(name: string): string {
  return (name.split(' · ')[0] ?? name).trim().toLowerCase();
}

/**
 * Next pool name; once the pool wraps, record ids ("Q-1044") are renumbered past the highest
 * one in use so two rows never share an id. `usedHeads` is updated with every id handed out.
 */
function uniqueName(pool: readonly string[], cursor: number, usedHeads: Set<string>): string {
  const name = pick(pool, cursor);
  const match = /^([A-Za-z]+-)(\d+)( · .*)?$/.exec(name);
  if (!match) return name;
  let head = nameHead(name);
  if (usedHeads.has(head)) {
    const prefix = match[1]!;
    const highest = Math.max(
      ...[...usedHeads].map((value) => Number(/-(\d+)$/.exec(value)?.[1] ?? 0)),
      Number(match[2]),
    );
    const renamed = `${prefix}${highest + 1}${match[3] ?? ''}`;
    head = nameHead(renamed);
    usedHeads.add(head);
    return renamed;
  }
  usedHeads.add(head);
  return name;
}

function rowNamePool(board: GalleryBoard): readonly string[] | null {
  return NAMES_BY_TERM[normalizeKey(board.itemTerminology)] ?? null;
}

export interface PreviewOptions {
  /** Rows per group (default 3; groups that "close" a pipeline get one fewer). */
  readonly perGroup?: number;
  readonly now?: number;
}

/** Every group of the board with real sample rows first, topped up to `perGroup` rows. */
export function buildPreviewGroups(board: GalleryBoard, options: PreviewOptions = {}): PreviewGroup[] {
  const perGroup = Math.max(1, options.perGroup ?? 3);
  const now = options.now ?? Date.now();
  const pool = rowNamePool(board);
  const used = new Set(board.sampleItems.map((item) => item.name));
  // Also skip pool names that reuse a sample's id ("Q-1043 · …") so record ids stay unique.
  const usedHeads = new Set(board.sampleItems.map((item) => nameHead(item.name)));
  const fresh = pool ? pool.filter((name) => !used.has(name) && !usedHeads.has(nameHead(name))) : [];
  const statusColumn = board.columns.find((column) => column.type === 'status');
  const probabilityColumn = board.columns.find(isProbability);
  let nameCursor = 0;
  let seed = 0;
  /** Generic boards ("Item 1, Item 2…") are numbered top to bottom, ignoring sample names. */
  let ordinal = 0;
  return board.groups.map((group) => {
    const groupLabel = statusColumn?.labels ? labelForGroup(group, statusColumn.labels) : null;
    const won = groupLabel ? /won|done|hired|complete|closed won/.test(normalizeKey(groupLabel.name)) : null;
    const outcome = groupLabel ? (won ? true : /lost|reject|churn/.test(normalizeKey(groupLabel.name)) ? false : null) : null;
    const target = outcome === null ? perGroup : Math.max(1, perGroup - 1);
    const sample = board.sampleItems.filter((item) => item.group === group.key);
    const rows: PreviewRow[] = [];
    for (let index = 0; index < Math.max(target, sample.length); index += 1) {
      const source = sample[index];
      ordinal += 1;
      const name = !pool
        ? `${board.itemTerminology || 'Item'} ${ordinal}`
        : (source?.name ?? uniqueName(fresh.length ? fresh : pool, nameCursor++, usedHeads));
      const values: Record<string, unknown> = { ...(source?.values ?? {}) };
      const rowSeed = seed++;
      for (const column of board.columns) {
        if (column.type === 'name' || values[column.key] !== undefined) continue;
        const value = fillValue(column, { group, groups: board.groups, rowName: name, seed: rowSeed, now, won: outcome });
        if (value !== undefined) values[column.key] = value;
      }
      // Dates in time-boxed groups ("This quarter") always fall inside that window.
      if (/quarter|month/.test(normalizeKey(`${group.key} ${group.title}`))) {
        for (const column of board.columns) {
          if (column.type === 'date') values[column.key] = { date: previewDate(group, rowSeed, now, false) };
        }
      }
      // Probability always follows the row's stage, even over hand-written sample values.
      if (probabilityColumn && statusColumn?.labels) {
        const labelId = (values[statusColumn.key] as { labelId?: string } | undefined)?.labelId;
        const stage = statusColumn.labels.find((label) => label.id === labelId);
        const derived = stage ? probabilityForStage(stage.name) : null;
        if (derived !== null) values[probabilityColumn.key] = derived;
      }
      for (const column of board.columns) {
        if (column.type !== 'formula') continue;
        const computed = formulaValue(values, board.columns);
        if (computed !== null) values[column.key] = { amount: computed, currency: board.columns.find((c) => c.type === 'currency')?.currency ?? 'USD' };
      }
      rows.push({ key: `${group.key}-${index}`, name, values });
    }
    return { group, rows };
  });
}

/** Pixel width per column type for the detail preview table (fixed widths + horizontal scroll). */
export function previewColumnWidth(column: Pick<GalleryColumn, 'type'>): number {
  switch (column.type) {
    case 'name':
      return 240;
    case 'status':
    case 'dropdown':
      return 136;
    case 'people':
      return 92;
    case 'currency':
    case 'formula':
      return 120;
    case 'number':
    case 'rating':
      return 112;
    case 'date':
      return 108;
    case 'timeline':
      return 164;
    case 'email':
      return 220;
    case 'phone':
      return 148;
    case 'long_text':
      return 200;
    case 'checkbox':
      return 88;
    default:
      return 150;
  }
}

/** Thumbnail composition that best signals what a template is for. */
export type ThumbnailLayout = 'kanban' | 'timeline' | 'calendar' | 'form' | 'table' | 'blank';

export function thumbnailLayout(board: Pick<GalleryBoard, 'templateId' | 'views'>): ThumbnailLayout {
  if (board.templateId === 'blank') return 'blank';
  if (board.views.some((view) => view.type === 'form') && /request|ticket|intake/.test(board.templateId)) return 'form';
  const first = board.views.find((view) => view.type !== 'table' && view.type !== 'chart')?.type;
  if (first === 'kanban') return 'kanban';
  if (first === 'timeline') return 'timeline';
  if (first === 'calendar') return 'calendar';
  return 'table';
}

/** The view a thumbnail of this layout depicts, so the highlighted tab matches the drawing. */
export function viewForLayout(
  board: Pick<GalleryBoard, 'views'>,
  layout: ThumbnailLayout,
): GalleryBoard['views'][number] | null {
  const wanted = layout === 'table' || layout === 'blank' ? 'table' : layout;
  return board.views.find((view) => view.type === wanted) ?? board.views[0] ?? null;
}
