/**
 * Filter trees shared by every client-side filter engine (board table, board views, exports).
 *
 * A view's `filters` is `{ conjunction, rules, groups? }`: `groups` holds nested condition
 * groups (one level in the UI, two accepted). A few "rich" operators are compiled down to the
 * classic ones every engine already understands, so engines only need `compileFilterTree` +
 * `matchFilterTree` around their existing rule matcher:
 *
 *   eq n        → gte n AND lte n          (numbers)
 *   neq n       → lt n OR gt n             (numbers)
 *   range [a,b] → gte a AND lte b          (numbers)
 *   within p    → between / before / after (relative dates, resolved against "today")
 *
 * Pure and client-safe.
 */

export const RICH_FILTER_OPERATORS = ['eq', 'neq', 'range', 'within'] as const;

export const RELATIVE_DATE_PRESETS = [
  'overdue',
  'today',
  'yesterday',
  'tomorrow',
  'this_week',
  'last_week',
  'next_week',
  'this_month',
  'last_month',
  'next_month',
  'past_7_days',
  'next_7_days',
  'past_30_days',
  'next_30_days',
  'past',
  'future',
] as const;
export type RelativeDatePreset = (typeof RELATIVE_DATE_PRESETS)[number];

export const RELATIVE_DATE_LABELS: Readonly<Record<RelativeDatePreset, string>> = {
  overdue: 'Overdue',
  today: 'Today',
  yesterday: 'Yesterday',
  tomorrow: 'Tomorrow',
  this_week: 'This week',
  last_week: 'Last week',
  next_week: 'Next week',
  this_month: 'This month',
  last_month: 'Last month',
  next_month: 'Next month',
  past_7_days: 'Past 7 days',
  next_7_days: 'Next 7 days',
  past_30_days: 'Past 30 days',
  next_30_days: 'Next 30 days',
  past: 'In the past',
  future: 'In the future',
};

export function isRelativeDatePreset(value: unknown): value is RelativeDatePreset {
  return typeof value === 'string' && (RELATIVE_DATE_PRESETS as readonly string[]).includes(value);
}

export interface TreeRule {
  readonly columnKey: string;
  readonly operator: string;
  readonly value?: unknown;
}

export interface TreeGroup<R extends TreeRule = TreeRule> {
  readonly conjunction?: 'and' | 'or';
  readonly rules?: readonly R[];
  readonly groups?: readonly TreeGroup<R>[];
}

export interface CompiledGroup {
  readonly conjunction: 'and' | 'or';
  readonly rules: readonly TreeRule[];
  readonly groups: readonly CompiledGroup[];
}

export type RelativeRange =
  | { readonly kind: 'between'; readonly from: string; readonly to: string }
  | { readonly kind: 'before'; readonly date: string }
  | { readonly kind: 'after'; readonly date: string };

const MAX_DEPTH = 3;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Local calendar date as `YYYY-MM-DD`. */
export function isoDay(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  next.setDate(next.getDate() + days);
  return next;
}

function startOfWeek(date: Date): Date {
  // Weeks start on Monday.
  return addDays(date, -((date.getDay() + 6) % 7));
}

function monthRange(year: number, month: number): RelativeRange {
  const from = new Date(year, month, 1);
  const to = new Date(year, month + 1, 0);
  return { kind: 'between', from: isoDay(from), to: isoDay(to) };
}

/** Resolve a relative date preset against `now` (local time). */
export function resolveRelativeDate(preset: RelativeDatePreset, now: Date = new Date()): RelativeRange {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = (offset: number) => isoDay(addDays(today, offset));
  const week = (offset: number): RelativeRange => {
    const start = addDays(startOfWeek(today), offset * 7);
    return { kind: 'between', from: isoDay(start), to: isoDay(addDays(start, 6)) };
  };
  switch (preset) {
    case 'overdue':
    case 'past':
      return { kind: 'before', date: day(0) };
    case 'future':
      return { kind: 'after', date: day(0) };
    case 'today':
      return { kind: 'between', from: day(0), to: day(0) };
    case 'yesterday':
      return { kind: 'between', from: day(-1), to: day(-1) };
    case 'tomorrow':
      return { kind: 'between', from: day(1), to: day(1) };
    case 'this_week':
      return week(0);
    case 'last_week':
      return week(-1);
    case 'next_week':
      return week(1);
    case 'this_month':
      return monthRange(today.getFullYear(), today.getMonth());
    case 'last_month':
      return monthRange(today.getFullYear(), today.getMonth() - 1);
    case 'next_month':
      return monthRange(today.getFullYear(), today.getMonth() + 1);
    case 'past_7_days':
      return { kind: 'between', from: day(-7), to: day(0) };
    case 'next_7_days':
      return { kind: 'between', from: day(0), to: day(7) };
    case 'past_30_days':
      return { kind: 'between', from: day(-30), to: day(0) };
    case 'next_30_days':
      return { kind: 'between', from: day(0), to: day(30) };
  }
}

function numberOrNull(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function group(conjunction: 'and' | 'or', rules: TreeRule[]): CompiledGroup {
  return { conjunction, rules, groups: [] };
}

/** One rule → a classic rule, or a small group of classic rules. */
function compileRule(rule: TreeRule, now: Date): TreeRule | CompiledGroup {
  const { columnKey } = rule;
  switch (rule.operator) {
    case 'eq':
    case 'neq': {
      const target = numberOrNull(rule.value);
      if (target === null) return group('and', []);
      return rule.operator === 'eq'
        ? group('and', [
            { columnKey, operator: 'gte', value: target },
            { columnKey, operator: 'lte', value: target },
          ])
        : group('or', [
            { columnKey, operator: 'lt', value: target },
            { columnKey, operator: 'gt', value: target },
          ]);
    }
    case 'range': {
      const [low, high] = Array.isArray(rule.value) ? rule.value.map(numberOrNull) : [null, null];
      const rules: TreeRule[] = [];
      if (low !== null && low !== undefined) rules.push({ columnKey, operator: 'gte', value: low });
      if (high !== null && high !== undefined) rules.push({ columnKey, operator: 'lte', value: high });
      return group('and', rules);
    }
    case 'within': {
      if (!isRelativeDatePreset(rule.value)) return group('and', []);
      const range = resolveRelativeDate(rule.value, now);
      if (range.kind === 'between') return { columnKey, operator: 'between', value: [range.from, range.to] };
      return { columnKey, operator: range.kind, value: range.date };
    }
    default:
      return rule;
  }
}

function isGroup(value: TreeRule | CompiledGroup): value is CompiledGroup {
  return 'groups' in value && Array.isArray((value as CompiledGroup).groups);
}

/** Normalize + compile a (possibly malformed) filter tree. */
export function compileFilterTree(input: TreeGroup | null | undefined, now: Date = new Date(), depth = 0): CompiledGroup {
  const conjunction = input?.conjunction === 'or' ? 'or' : 'and';
  const rules: TreeRule[] = [];
  const groups: CompiledGroup[] = [];
  for (const rule of input?.rules ?? []) {
    if (!rule || typeof rule.columnKey !== 'string') continue;
    const compiled = compileRule(rule, now);
    if (isGroup(compiled)) groups.push(compiled);
    else rules.push(compiled);
  }
  if (depth < MAX_DEPTH) {
    for (const child of input?.groups ?? []) {
      if (child && typeof child === 'object') groups.push(compileFilterTree(child, now, depth + 1));
    }
  }
  return { conjunction, rules, groups };
}

/** Drop rules `keep` rejects (e.g. rules on deleted columns), recursively. */
export function pruneFilterTree(tree: CompiledGroup, keep: (rule: TreeRule) => boolean): CompiledGroup {
  return {
    conjunction: tree.conjunction,
    rules: tree.rules.filter(keep),
    groups: tree.groups.map((child) => pruneFilterTree(child, keep)),
  };
}

/** Does the tree hold any rule at all (an empty group never narrows anything)? */
export function treeHasRules(tree: TreeGroup | null | undefined): boolean {
  if (!tree) return false;
  return (tree.rules?.length ?? 0) > 0 || (tree.groups ?? []).some(treeHasRules);
}

/** Rules in the tree, depth first (for counts and chips). */
export function flattenTreeRules<R extends TreeRule>(tree: TreeGroup<R> | null | undefined): R[] {
  if (!tree) return [];
  return [...(tree.rules ?? []), ...(tree.groups ?? []).flatMap((child) => flattenTreeRules(child))];
}

/**
 * Evaluate a compiled tree with the engine's own leaf matcher. Empty groups pass; with no
 * rules at all the tree matches everything.
 */
export function matchFilterTree(tree: CompiledGroup, test: (rule: TreeRule) => boolean): boolean {
  const children: (() => boolean)[] = [];
  for (const rule of tree.rules) children.push(() => test(rule));
  for (const child of tree.groups) {
    if (treeHasRules(child)) children.push(() => matchFilterTree(child, test));
  }
  if (children.length === 0) return true;
  return tree.conjunction === 'or' ? children.some((run) => run()) : children.every((run) => run());
}
