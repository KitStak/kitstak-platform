/**
 * Natural-language quick add: "Call Acme tomorrow !high @maya #sales +OPS".
 *
 * Pure and deterministic (pass `today`), so it runs the same on every keystroke in the browser
 * and in unit tests. Recognised tokens:
 *   - Dates:     today, tonight, tomorrow (tmr, tmrw), fri / friday, this fri, next fri,
 *                in 3 days, in two weeks, in a month, next week, next month, end of week (eow),
 *                end of month (eom), this weekend, dec 5, 5 dec, december 5th 2027, 12/5,
 *                12/5/2027, 2026-12-05. A leading "on", "by" or "due" is swallowed with it.
 *                When several dates appear, the last one wins (the rest stay in the title).
 *   - Priority:  !urgent !high !medium !low !none, !p1..!p4, !1..!4, !!!! (urgent) !!! (high) !! (medium)
 *   - Assignee:  @maya, @maya.chen, @mchen (email name), @me. A unique prefix is enough.
 *   - Labels:    #sales, #sales-lead (matches the label "Sales lead"). Unknown names become new labels.
 *   - Project:   +OPS (key) or +operations (name). A unique prefix is enough.
 *
 * Tokens that don't resolve (an @name nobody has) are reported with `value: null` and stay in the
 * title. Users can dismiss a chip: pass its `id` in `ignore` and that text is treated as plain words.
 */
import { addDaysIso, isIsoDate, parseIsoDate, startOfWeekIso, toIsoDate, type IsoDate } from './dates';
import type { Priority } from './constants';

export type QuickAddTokenKind = 'date' | 'priority' | 'assignee' | 'label' | 'project';

export interface QuickAddToken {
  /** Stable id for dismissing: `${kind}:${raw lowercased}`. */
  readonly id: string;
  readonly kind: QuickAddTokenKind;
  /** Character range in the input (end exclusive). */
  readonly start: number;
  readonly end: number;
  /** The exact text matched, e.g. "next fri" or "@maya". */
  readonly raw: string;
  /** Resolved value: ISO date, priority, user id, label id, project id. null = not found (or a new label). */
  readonly value: string | null;
  /** Friendly text for the chip ("Fri, Nov 20", "High", "Maya Chen", "sales (new)"). */
  readonly display: string;
  /** For labels: the label name to create when `value` is null. */
  readonly name?: string;
  /** True when the token is unusable (unknown person or project). Such text stays in the title. */
  readonly unresolved?: boolean;
}

export interface QuickAddPerson {
  readonly id: string;
  readonly name: string;
  readonly email?: string | null;
}
export interface QuickAddProject {
  readonly id: string;
  readonly key: string;
  readonly name: string;
}
export interface QuickAddLabel {
  readonly id: string;
  readonly name: string;
}

export interface QuickAddParseOptions {
  /** Viewer-local today (`YYYY-MM-DD`). */
  readonly today: IsoDate;
  readonly people?: readonly QuickAddPerson[];
  readonly projects?: readonly QuickAddProject[];
  readonly labels?: readonly QuickAddLabel[];
  /** Resolves `@me`. */
  readonly meId?: string | null;
  /** Token ids the user dismissed (kept as plain text). */
  readonly ignore?: ReadonlySet<string> | readonly string[];
}

export interface QuickAddParse {
  /** Input with every resolved token removed and spaces tidied. */
  readonly title: string;
  readonly dueDate: IsoDate | null;
  readonly priority: Priority | null;
  readonly assigneeId: string | null;
  readonly projectId: string | null;
  /** Existing label ids (deduped). */
  readonly labelIds: readonly string[];
  /** Names of labels that don't exist yet (deduped, original casing). */
  readonly newLabels: readonly string[];
  /** Every recognised token in input order (resolved and unresolved). */
  readonly tokens: readonly QuickAddToken[];
}

// --- Shared bits -----------------------------------------------------------------------------

const B = '(?<![\\p{L}\\p{N}_@#+!/-])'; // left boundary: not inside a word or another token
const E = '(?![\\p{L}\\p{N}_/-])'; // right boundary

const WEEKDAYS: Readonly<Record<string, number>> = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
};
const WEEKDAY_RE = 'sunday|sun|monday|mon|tuesday|tues|tue|wednesday|weds|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat';

const PLAIN_WEEKDAY_RE = 'sunday|monday|mon|tuesday|tues|tue|wednesday|weds|wed|thursday|thurs|thur|thu|friday|fri|saturday';

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};
const MONTH_RE = 'january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec';

const NUMBER_WORDS: Readonly<Record<string, number>> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};
const COUNT_WORDS_RE = 'a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve';

const LEAD = '(?:(?:on|by|due|before)\\s+)?';

const SHORT_DATE = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const SHORT_DATE_YEAR = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

/** "Today", "Tomorrow", "Fri, Nov 20", "Mon, Jan 4, 2027". */
export function describeDueDate(date: IsoDate, today: IsoDate): string {
  if (date === today) return 'Today';
  if (date === addDaysIso(today, 1)) return 'Tomorrow';
  const value = parseIsoDate(date);
  return value.getFullYear() === parseIsoDate(today).getFullYear() ? SHORT_DATE.format(value) : SHORT_DATE_YEAR.format(value);
}

function addMonthsIso(value: IsoDate, months: number): IsoDate {
  const date = parseIsoDate(value);
  const day = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() + months);
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(day, last));
  return toIsoDate(date);
}

function weekdayOf(value: IsoDate): number {
  return parseIsoDate(value).getDay();
}

function isoFrom(year: number, month: number, day: number): IsoDate | null {
  const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return isIsoDate(iso) ? iso : null;
}

/** Month/day without a year: this year, or next year if that day already passed. */
function upcomingMonthDay(month: number, day: number, today: IsoDate): IsoDate | null {
  const year = parseIsoDate(today).getFullYear();
  const thisYear = isoFrom(year, month, day);
  if (thisYear && thisYear >= today) return thisYear;
  const nextYear = isoFrom(year + 1, month, day);
  // Feb 29 in a non-leap year: fall back to whichever is valid.
  return nextYear ?? thisYear;
}

function normalizeYear(raw: string): number {
  const n = Number(raw);
  return raw.length <= 2 ? 2000 + n : n;
}

function countOf(raw: string): number {
  const lower = raw.toLowerCase();
  return NUMBER_WORDS[lower] ?? Number(lower);
}

// --- Dates -----------------------------------------------------------------------------------

interface DateRule {
  readonly re: RegExp;
  readonly resolve: (match: RegExpExecArray, today: IsoDate) => IsoDate | null;
}

function nextWeekday(m: RegExpExecArray, today: IsoDate): IsoDate {
  const target = WEEKDAYS[m[1]!.toLowerCase()]!;
  return addDaysIso(today, (target - weekdayOf(today) + 7) % 7 || 7);
}

const rule = (pattern: string, resolve: DateRule['resolve']): DateRule => ({
  re: new RegExp(`${B}${LEAD}(?:${pattern})${E}`, 'giu'),
  resolve,
});

const DATE_RULES: readonly DateRule[] = [
  // ISO 2026-12-05
  rule('(\\d{4})-(\\d{1,2})-(\\d{1,2})', (m) => isoFrom(Number(m[1]), Number(m[2]), Number(m[3]))),
  // 12/5, 12/5/27, 12/5/2027 (month first)
  rule('(\\d{1,2})/(\\d{1,2})(?:/(\\d{2}|\\d{4}))?', (m, today) =>
    m[3] ? isoFrom(normalizeYear(m[3]), Number(m[1]), Number(m[2])) : upcomingMonthDay(Number(m[1]), Number(m[2]), today),
  ),
  // dec 5, december 5th, dec 5 2027, dec 5, 2027
  rule(`(${MONTH_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`, (m, today) => {
    const month = MONTHS[m[1]!.toLowerCase()]!;
    return m[3] ? isoFrom(Number(m[3]), month, Number(m[2])) : upcomingMonthDay(month, Number(m[2]), today);
  }),
  // 5 dec, 5th of december, 5 dec 2027
  rule(`(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_RE})(?:,?\\s+(\\d{4}))?`, (m, today) => {
    const month = MONTHS[m[2]!.toLowerCase()]!;
    return m[3] ? isoFrom(Number(m[3]), month, Number(m[1])) : upcomingMonthDay(month, Number(m[1]), today);
  }),
  rule('today|tonight|this evening', (_m, today) => today),
  rule('tomorrow|tmrw|tmr|tmw', (_m, today) => addDaysIso(today, 1)),
  rule('day after tomorrow', (_m, today) => addDaysIso(today, 2)),
  // "in 3 days", "in 2w", "in two weeks", "in a month" (digits may touch the unit; words may not).
  rule(`in\\s+(?:(\\d{1,3})\\s*|(${COUNT_WORDS_RE})\\s+)(days?|d|weeks?|wks?|w|months?|mos?|years?|yrs?)`, (m, today) => {
    const n = countOf(m[1] ?? m[2]!);
    if (!Number.isFinite(n) || n < 0 || n > 999) return null;
    const unit = m[3]!.toLowerCase();
    if (unit.startsWith('d')) return addDaysIso(today, n);
    if (unit.startsWith('w')) return addDaysIso(today, n * 7);
    if (unit.startsWith('m')) return addMonthsIso(today, n);
    return addMonthsIso(today, n * 12);
  }),
  // "next week" = Monday of next week; "next month" = the 1st of next month.
  rule('next\\s+week', (_m, today) => addDaysIso(startOfWeekIso(today), 7)),
  rule('next\\s+month', (_m, today) => {
    const date = parseIsoDate(today);
    return toIsoDate(new Date(date.getFullYear(), date.getMonth() + 1, 1));
  }),
  rule('next\\s+year', (_m, today) => `${parseIsoDate(today).getFullYear() + 1}-01-01`),
  // End of week = this Friday (or today if it's already the weekend → next Friday).
  rule('end\\s+of\\s+(?:the\\s+)?week|eow', (_m, today) => {
    return addDaysIso(today, (5 - weekdayOf(today) + 7) % 7);
  }),
  rule('end\\s+of\\s+(?:the\\s+)?month|eom', (_m, today) => {
    const date = parseIsoDate(today);
    return toIsoDate(new Date(date.getFullYear(), date.getMonth() + 1, 0));
  }),
  rule('(?:this\\s+)?weekend', (_m, today) => {
    const day = weekdayOf(today);
    if (day === 6 || day === 0) return today;
    return addDaysIso(today, 6 - day);
  }),
  // next fri = the Friday of next week (Monday-start weeks).
  rule(`next\\s+(${WEEKDAY_RE})`, (m, today) => {
    const target = WEEKDAYS[m[1]!.toLowerCase()]!;
    return addDaysIso(startOfWeekIso(today), 7 + ((target + 6) % 7));
  }),
  // this fri = the coming Friday, today included.
  rule(`this\\s+(${WEEKDAY_RE})`, (m, today) => {
    const target = WEEKDAYS[m[1]!.toLowerCase()]!;
    return addDaysIso(today, (target - weekdayOf(today) + 7) % 7);
  }),
  // fri = the next Friday after today. "sat" and "sun" are everyday words, so on their own they
  // only count with a lead-in ("on sat", "by sun"); "saturday" / "sunday" always count.
  { re: new RegExp(`${B}${LEAD}(${PLAIN_WEEKDAY_RE})${E}`, 'giu'), resolve: nextWeekday },
  { re: new RegExp(`${B}(?:on|by|due|before)\\s+(sat|sun)${E}`, 'giu'), resolve: nextWeekday },
];

interface Span {
  readonly start: number;
  readonly end: number;
}

const overlaps = (a: Span, b: Span) => a.start < b.end && b.start < a.end;

function findDates(text: string, today: IsoDate): { start: number; end: number; raw: string; value: IsoDate }[] {
  const found: { start: number; end: number; raw: string; value: IsoDate }[] = [];
  for (const { re, resolve } of DATE_RULES) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text))) {
      const value = resolve(match, today);
      if (value) found.push({ start: match.index, end: match.index + match[0].length, raw: match[0], value });
      if (match[0].length === 0) re.lastIndex += 1;
    }
  }
  // Longest match wins where candidates overlap ("next fri" beats "fri", "dec 5 2027" beats "dec 5").
  found.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
  const kept: typeof found = [];
  for (const candidate of found) if (!kept.some((k) => overlaps(k, candidate))) kept.push(candidate);
  return kept.sort((a, b) => a.start - b.start);
}

// --- Priority, people, labels, projects ------------------------------------------------------

const PRIORITY_WORDS: Readonly<Record<string, Priority>> = {
  urgent: 'urgent', u: 'urgent', p1: 'urgent', '1': 'urgent', critical: 'urgent', asap: 'urgent',
  high: 'high', h: 'high', p2: 'high', '2': 'high', important: 'high',
  medium: 'medium', med: 'medium', m: 'medium', normal: 'medium', p3: 'medium', '3': 'medium',
  low: 'low', l: 'low', p4: 'low', '4': 'low',
  none: 'none', no: 'none',
};
const BANGS: Readonly<Record<number, Priority>> = { 2: 'medium', 3: 'high', 4: 'urgent' };

const PRIORITY_TEXT: Readonly<Record<Priority, string>> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  none: 'No priority',
};

const SIGIL_RE = /(?<![\p{L}\p{N}_])([!@#+])([\p{L}\p{N}][\p{L}\p{N}._-]*|!{1,3})?/gu;

/** Lowercase, no spaces/dots/dashes/underscores — "Maya Chen" and "maya.chen" both → "mayachen". */
function squash(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[\s._-]+/g, '');
}

/** Exact match first, then a unique prefix. */
function pick<T>(items: readonly T[], query: string, keys: (item: T) => readonly string[]): T | null {
  const q = squash(query);
  if (!q) return null;
  const exact = items.filter((item) => keys(item).some((key) => squash(key) === q));
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) return null;
  const prefix = items.filter((item) => keys(item).some((key) => squash(key).startsWith(q)));
  return prefix.length === 1 ? prefix[0]! : null;
}

function personKeys(person: QuickAddPerson): string[] {
  const parts = person.name.trim().split(/\s+/).filter(Boolean);
  const keys = [person.name, ...parts];
  if (parts.length > 1) keys.push(`${parts[0]![0] ?? ''}${parts.at(-1)}`); // mchen
  if (person.email) keys.push(person.email.split('@')[0]!);
  return keys;
}

const trimTrailingPunctuation = (raw: string) => raw.replace(/[.,;:!?)\]]+$/u, '');

// --- Main ------------------------------------------------------------------------------------

export function tokenId(kind: QuickAddTokenKind, raw: string): string {
  return `${kind}:${raw.trim().toLowerCase()}`;
}

export function parseQuickAdd(input: string, options: QuickAddParseOptions): QuickAddParse {
  const text = input ?? '';
  const ignore = new Set(options.ignore ?? []);
  const people = options.people ?? [];
  const projects = options.projects ?? [];
  const labels = options.labels ?? [];
  const tokens: QuickAddToken[] = [];

  // 1. Sigil tokens (!priority, @person, #label, +project).
  SIGIL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  const sigilSpans: Span[] = [];
  while ((match = SIGIL_RE.exec(text))) {
    const sigil = match[1]!;
    const body = match[2] ?? '';
    const start = match.index;
    if (sigil === '!') {
      const bangs = body.startsWith('!') ? body.length + 1 : 0;
      const after = text[start + match[0].length];
      if (after && !/[\s,.;:)]/.test(after)) continue;
      const priority = bangs ? BANGS[bangs] : PRIORITY_WORDS[body.toLowerCase()];
      if (!priority) continue;
      const raw = match[0];
      tokens.push({ id: tokenId('priority', raw), kind: 'priority', start, end: start + raw.length, raw, value: priority, display: PRIORITY_TEXT[priority] });
      sigilSpans.push({ start, end: start + raw.length });
      continue;
    }
    if (!body || body.startsWith('!')) continue;
    const name = trimTrailingPunctuation(body);
    if (!name) continue;
    const raw = `${sigil}${name}`;
    const end = start + raw.length;
    sigilSpans.push({ start, end });
    if (sigil === '@') {
      const person = name.toLowerCase() === 'me' && options.meId ? (people.find((p) => p.id === options.meId) ?? { id: options.meId, name: 'Me' }) : pick(people, name, personKeys);
      tokens.push(
        person
          ? { id: tokenId('assignee', raw), kind: 'assignee', start, end, raw, value: person.id, display: name.toLowerCase() === 'me' ? 'Me' : person.name }
          : { id: tokenId('assignee', raw), kind: 'assignee', start, end, raw, value: null, display: `No one named ${name}`, unresolved: true },
      );
    } else if (sigil === '#') {
      if (!/\p{L}/u.test(name)) continue; // "#42" is a reference, not a label
      // Exact names only: "#bug" must not silently become an existing "bugfix" label.
      const resolved = labels.find((l) => squash(l.name) === squash(name)) ?? null;
      const pretty = name.replace(/[-_]+/g, ' ');
      tokens.push(
        resolved
          ? { id: tokenId('label', raw), kind: 'label', start, end, raw, value: resolved.id, display: resolved.name }
          : { id: tokenId('label', raw), kind: 'label', start, end, raw, value: null, display: `${pretty} (new)`, name: pretty },
      );
    } else {
      const project = pick(projects, name, (p) => [p.key, p.name]);
      tokens.push(
        project
          ? { id: tokenId('project', raw), kind: 'project', start, end, raw, value: project.id, display: project.name }
          : { id: tokenId('project', raw), kind: 'project', start, end, raw, value: null, display: `No project called ${name}`, unresolved: true },
      );
    }
  }

  // 2. Dates in the remaining text (never inside a sigil token).
  const dates = findDates(text, options.today).filter((d) => !sigilSpans.some((s) => overlaps(s, d)));
  for (const date of dates) {
    tokens.push({ id: tokenId('date', date.raw), kind: 'date', start: date.start, end: date.end, raw: date.raw, value: date.value, display: describeDueDate(date.value, options.today) });
  }

  // 3. Drop dismissed tokens; among the rest, the last date / priority / assignee / project wins.
  const active = tokens.filter((t) => !ignore.has(t.id)).sort((a, b) => a.start - b.start);
  const lastOf = (kind: QuickAddTokenKind) => [...active].reverse().find((t) => t.kind === kind && !t.unresolved);
  const due = lastOf('date');
  const priority = lastOf('priority');
  const assignee = lastOf('assignee');
  const project = lastOf('project');
  const usedSingles = new Set([due, priority, assignee, project].filter(Boolean));
  const labelTokens = active.filter((t) => t.kind === 'label');
  const shown = active.filter((t) => t.kind === 'label' || t.unresolved || usedSingles.has(t));

  // 4. Title = input minus the tokens that were applied.
  const removed = shown.filter((t) => !t.unresolved);
  let title = '';
  let cursor = 0;
  for (const token of removed) {
    title += `${text.slice(cursor, token.start)} `;
    cursor = token.end;
  }
  title += text.slice(cursor);
  title = title
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/^[\s,;:–—-]+|[\s,;:–—-]+$/g, '')
    .trim();

  const labelIds = [...new Set(labelTokens.filter((t) => t.value).map((t) => t.value as string))];
  const seenNew = new Set<string>();
  const newLabels: string[] = [];
  for (const token of labelTokens) {
    if (token.value || !token.name) continue;
    const key = squash(token.name);
    if (seenNew.has(key)) continue;
    seenNew.add(key);
    newLabels.push(token.name);
  }

  return {
    title,
    dueDate: due?.value ?? null,
    priority: (priority?.value as Priority | undefined) ?? null,
    assigneeId: assignee?.value ?? null,
    projectId: project?.value ?? null,
    labelIds,
    newLabels,
    tokens: shown,
  };
}

/** Splits the input into plain and token segments for highlighting the text box. */
export function segmentQuickAdd(input: string, tokens: readonly QuickAddToken[]): { text: string; token: QuickAddToken | null }[] {
  const out: { text: string; token: QuickAddToken | null }[] = [];
  let cursor = 0;
  for (const token of [...tokens].sort((a, b) => a.start - b.start)) {
    if (token.start < cursor) continue;
    if (token.start > cursor) out.push({ text: input.slice(cursor, token.start), token: null });
    out.push({ text: input.slice(token.start, token.end), token });
    cursor = token.end;
  }
  if (cursor < input.length) out.push({ text: input.slice(cursor), token: null });
  return out;
}
