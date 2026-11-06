/**
 * Recipe gallery: ready-made sentences built only from clauses the engine supports.
 * Label presets like `@done` are resolved against the board's labels when the recipe opens
 * (see `prepareRecipeDraft`); unresolved presets are left for the user to pick.
 */
import type { ColumnType } from '@/server/db/schema/cell-values';
import type { ColumnDto } from '@/server/services/contracts/dto';
import { clauseDef, tokenIds, type ClauseRole, type ClauseValues } from './clauses';
import { newClause, type AutomationDraft, type ClauseDraft, type TokenResolver } from './draft';
import { columnLabels, type BuilderContext } from './resolver';
import {
  columnTypeMatches,
  describeRelativeDays,
  isPeopleValue,
  type TokenSpec,
  type TokenValue,
} from './tokens';

export const RECIPE_CATEGORIES = [
  { id: 'status', label: 'Status change' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'recurring', label: 'Recurring' },
  { id: 'item-creation', label: 'Item creation' },
  { id: 'due-dates', label: 'Due dates' },
  { id: 'move-item', label: 'Move item' },
  { id: 'dependencies', label: 'Dependencies' },
  { id: 'crm', label: 'CRM' },
] as const;
export type RecipeCategory = (typeof RECIPE_CATEGORIES)[number]['id'];

type ClauseSpec = readonly [type: string, values?: ClauseValues];

export interface Recipe {
  readonly id: string;
  readonly category: RecipeCategory;
  /** Short, scannable purpose line shown under the sentence. */
  readonly blurb: string;
  readonly trigger: ClauseSpec;
  readonly conditions?: readonly ClauseSpec[];
  readonly actions: readonly ClauseSpec[];
  readonly popular?: boolean;
}

const MSG_STATUS = '{name} changed status on {board}';
const DONE = '@done';

export const RECIPES: readonly Recipe[] = [
  // Status change
  {
    id: 'status-notify',
    category: 'status',
    popular: true,
    blurb: 'Keep the right people in the loop the moment work moves forward.',
    trigger: ['status_changed'],
    actions: [['notify', { message: MSG_STATUS }]],
  },
  {
    id: 'status-set-status',
    category: 'status',
    blurb: 'Keep two status columns in sync.',
    trigger: ['status_changed'],
    actions: [['set_status']],
  },
  {
    id: 'status-set-date',
    category: 'status',
    blurb: 'Stamp the date when work reaches a milestone.',
    trigger: ['status_changed', { to: DONE }],
    actions: [['set_date', { offset: 0 }]],
  },
  {
    id: 'status-assign',
    category: 'status',
    blurb: 'Hand off work automatically at each stage.',
    trigger: ['status_changed'],
    actions: [['assign_person']],
  },
  // Notifications
  {
    id: 'assigned-notify',
    category: 'notifications',
    popular: true,
    blurb: 'Let people know when something lands on their plate.',
    trigger: ['person_assigned', { user: '__any__' }],
    actions: [['notify', { message: 'You were assigned to {name}' }]],
  },
  {
    id: 'stuck-notify',
    category: 'notifications',
    blurb: 'Escalate blockers before they become delays.',
    trigger: ['status_changed', { to: '@stuck' }],
    actions: [['notify', { message: '{name} is stuck and needs attention' }]],
  },
  {
    id: 'column-notify',
    category: 'notifications',
    blurb: 'Watch any column for changes.',
    trigger: ['column_changed'],
    actions: [['notify', { message: '{name} was updated on {board}' }]],
  },
  {
    id: 'created-notify',
    category: 'notifications',
    blurb: 'Never miss new work coming in.',
    trigger: ['item_created'],
    actions: [['notify', { message: 'New item: {name}' }]],
  },
  // Recurring
  {
    id: 'recurring-followup',
    category: 'recurring',
    popular: true,
    blurb: 'A repeating reminder: notify, then push the date out again.',
    trigger: ['date_arrived', { offset: 0 }],
    actions: [
      ['notify', { message: 'Time to follow up on {name}' }],
      ['set_date', { offset: 7 }],
    ],
  },
  {
    id: 'recurring-cycle',
    category: 'recurring',
    blurb: 'Reset the status every cycle and schedule the next one.',
    trigger: ['date_arrived', { offset: 0 }],
    actions: [['set_status'], ['set_date', { offset: 30 }]],
  },
  // Item creation
  {
    id: 'created-assign-creator',
    category: 'item-creation',
    popular: true,
    blurb: 'Whoever adds the item owns it.',
    trigger: ['item_created'],
    actions: [['assign_person', { who: { userIds: [], columnKey: null, actor: true } }]],
  },
  {
    id: 'created-set-status',
    category: 'item-creation',
    blurb: 'Start every new item in the right status.',
    trigger: ['item_created'],
    actions: [['set_status']],
  },
  {
    id: 'created-set-date',
    category: 'item-creation',
    blurb: 'Record when each item came in.',
    trigger: ['item_created'],
    actions: [['set_date', { offset: 0 }]],
  },
  {
    id: 'status-create-item',
    category: 'item-creation',
    blurb: 'Spin up the next piece of work on another board.',
    trigger: ['status_changed', { to: DONE }],
    actions: [['create_item', { name: '{name}' }]],
  },
  // Due dates
  {
    id: 'due-tomorrow',
    category: 'due-dates',
    popular: true,
    blurb: 'A heads-up the day before something is due.',
    trigger: ['date_arrived', { offset: -1 }],
    actions: [['notify', { message: '{name} is due tomorrow' }]],
  },
  {
    id: 'due-today-open',
    category: 'due-dates',
    blurb: 'Chase only the items that are still open on the due date.',
    trigger: ['date_arrived', { offset: 0 }],
    conditions: [['status_is']],
    actions: [['notify', { message: '{name} is due today' }]],
  },
  {
    id: 'due-week-update',
    category: 'due-dates',
    blurb: 'Leave a note on the item a week ahead.',
    trigger: ['date_arrived', { offset: -7 }],
    actions: [['create_update', { body: 'Due in 7 days. Please confirm everything is on track.' }]],
  },
  // Move item
  {
    id: 'done-move-group',
    category: 'move-item',
    popular: true,
    blurb: 'File finished work out of the way.',
    trigger: ['status_changed', { to: DONE }],
    actions: [['move_to_group']],
  },
  {
    id: 'status-archive',
    category: 'move-item',
    blurb: 'Keep the board clean by archiving finished items.',
    trigger: ['status_changed', { to: DONE }],
    actions: [['archive_item']],
  },
  {
    id: 'moved-set-status',
    category: 'move-item',
    blurb: 'Moving an item between groups updates its status.',
    trigger: ['item_moved_to_group'],
    actions: [['set_status']],
  },
  {
    id: 'moved-notify',
    category: 'move-item',
    blurb: 'Tell the team when items enter a stage.',
    trigger: ['item_moved_to_group'],
    actions: [['notify', { message: '{name} moved to a new group' }]],
  },
  // Dependencies
  {
    id: 'done-unblock-next',
    category: 'dependencies',
    blurb: 'When one step finishes, the next one becomes ready.',
    trigger: ['status_changed', { to: DONE }],
    actions: [['set_status']],
  },
  {
    id: 'done-handoff-board',
    category: 'dependencies',
    blurb: 'Create the dependent task on another team’s board.',
    trigger: ['status_changed', { to: DONE }],
    actions: [['create_item', { name: 'Follow-up: {name}' }]],
  },
  {
    id: 'date-moved-notify',
    category: 'dependencies',
    blurb: 'Warn the owner when a scheduled date shifts.',
    trigger: ['column_changed'],
    conditions: [['status_is']],
    actions: [['notify', { message: 'The schedule of {name} changed' }]],
  },
  // CRM
  {
    id: 'crm-won',
    category: 'crm',
    popular: true,
    blurb: 'Celebrate and file won deals in one step.',
    trigger: ['status_changed', { to: '@won' }],
    actions: [['move_to_group'], ['notify', { message: '🎉 {name} was won' }]],
  },
  {
    id: 'crm-lost',
    category: 'crm',
    blurb: 'Move lost deals out of the active pipeline.',
    trigger: ['status_changed', { to: '@lost' }],
    actions: [['move_to_group']],
  },
  {
    id: 'crm-new-deal',
    category: 'crm',
    blurb: 'New deals start in the first stage, owned by their creator.',
    trigger: ['item_created'],
    conditions: [['column_is_empty']],
    actions: [['set_status'], ['assign_person', { who: { userIds: [], columnKey: null, actor: true } }]],
  },
  {
    id: 'crm-close-reminder',
    category: 'crm',
    blurb: 'Remind the owner a week before the expected close date.',
    trigger: ['date_arrived', { offset: -7 }],
    conditions: [['status_is']],
    actions: [['notify', { message: '{name} is expected to close in 7 days' }]],
  },
  {
    id: 'crm-won-onboarding',
    category: 'crm',
    blurb: 'Kick off onboarding on another board when a deal closes.',
    trigger: ['status_changed', { to: '@won' }],
    actions: [['create_item', { name: '{name} onboarding' }]],
  },
  {
    id: 'crm-qualified-deal',
    category: 'crm',
    blurb: 'Turn qualified leads into deals automatically.',
    trigger: ['status_changed', { to: '@qualified' }],
    actions: [['create_item', { name: '{name}: new opportunity' }]],
  },
];

function toClause(role: ClauseRole, [type, values]: ClauseSpec): ClauseDraft {
  return newClause(role, type, values ?? {});
}

export function recipeDraft(recipe: Recipe): AutomationDraft {
  return {
    trigger: toClause('trigger', recipe.trigger),
    conditions: (recipe.conditions ?? []).map((spec) => toClause('condition', spec)),
    actions: recipe.actions.map((spec) => toClause('action', spec)),
  };
}

/** Column types a recipe needs that the board does not have. */
export function missingColumnTypes(recipe: Recipe, columns: readonly ColumnDto[]): ColumnType[] {
  const missing = new Set<ColumnType>();
  const draft = recipeDraft(recipe);
  for (const clause of [draft.trigger, ...draft.conditions, ...draft.actions]) {
    if (!clause) continue;
    const def = clauseDef(clause.role, clause.type);
    if (!def) continue;
    for (const token of tokenIds(def)) {
      const spec = def.tokens[token];
      if (spec?.kind !== 'column' || spec.types === 'editable') continue;
      if (!columns.some((column) => columnTypeMatches(spec, column.type))) {
        const first = spec.types[0];
        if (first) missing.add(first);
      }
    }
  }
  return [...missing];
}

const LABEL_HINTS: Readonly<Record<string, readonly string[]>> = {
  done: ['done', 'complete', 'completed', 'finished', 'won', 'closed'],
  stuck: ['stuck', 'blocked', 'at risk'],
  won: ['won', 'closed won'],
  lost: ['lost', 'closed lost'],
  qualified: ['qualified'],
};

function resolveHint(
  hint: string,
  columnKey: string | null,
  columns: readonly ColumnDto[],
): string | null {
  const column = columns.find((entry) => entry.key === columnKey);
  const labels = columnLabels(column);
  const names = LABEL_HINTS[hint] ?? [hint];
  const byName = labels.find((label) => names.includes(label.name.trim().toLowerCase()));
  if (byName) return byName.id;
  if (hint === 'done') return labels.find((label) => label.isDone)?.id ?? null;
  return null;
}

/** Label hints (`@won`, `@done`…) a recipe uses, resolved against any status column. */
export function hintLabelName(hint: string, columns: readonly ColumnDto[]): string | null {
  for (const column of columns) {
    if (column.type !== 'status' || column.hidden) continue;
    const id = resolveHint(hint, column.key, columns);
    if (id) return columnLabels(column).find((label) => label.id === id)?.name ?? null;
  }
  return null;
}

/**
 * Whether every label hint of a recipe resolves on this board. A "changes to Done" recipe is
 * hidden on a board whose status columns have no Done-like label (a Deals board shows Won).
 * Boards without any status column keep the recipe (it shows "Needs a status column").
 */
export function recipeHintsResolve(recipe: Recipe, columns: readonly ColumnDto[]): boolean {
  if (!columns.some((column) => column.type === 'status')) return true;
  const specs = [recipe.trigger, ...(recipe.conditions ?? []), ...recipe.actions];
  return specs.every(([, values]) =>
    Object.values(values ?? {}).every(
      (value) => typeof value !== 'string' || !value.startsWith('@') || hintLabelName(value.slice(1), columns) !== null,
    ),
  );
}

function compatibleColumns(spec: TokenSpec, context: BuilderContext): ColumnDto[] {
  if (spec.kind !== 'column') return [];
  return context.columns.filter((column) => !column.hidden && columnTypeMatches(spec, column.type));
}

/**
 * Fill what can be inferred: a column token with exactly one compatible column, or (for label
 * hints such as `@won`) the status column that has a matching label. Hints that cannot be
 * resolved are cleared so the user picks them.
 */
function prepareClause(clause: ClauseDraft, context: BuilderContext): ClauseDraft {
  const def = clauseDef(clause.role, clause.type);
  if (!def) return clause;
  const values: Record<string, TokenValue> = { ...clause.values };
  for (const token of tokenIds(def)) {
    const spec = def.tokens[token];
    if (spec?.kind !== 'column' || values[token]) continue;
    const options = compatibleColumns(spec, context);
    // A label hint on this column narrows the choice to columns that have such a label.
    const hinted = Object.entries(def.tokens).find(
      ([labelToken, labelSpec]) =>
        labelSpec.kind === 'label' &&
        labelSpec.columnToken === token &&
        String(values[labelToken] ?? '').startsWith('@'),
    );
    if (hinted) {
      const hint = String(values[hinted[0]]).slice(1);
      const match = options.find((column) => resolveHint(hint, column.key, context.columns));
      if (match) {
        values[token] = match.key;
        continue;
      }
    }
    if (options.length === 1 && options[0]) values[token] = options[0].key;
  }
  for (const [token, spec] of Object.entries(def.tokens)) {
    const value = values[token];
    if (spec.kind !== 'label' || typeof value !== 'string' || !value.startsWith('@')) continue;
    const columnKey = values[spec.columnToken];
    values[token] = resolveHint(value.slice(1), typeof columnKey === 'string' ? columnKey : null, context.columns);
  }
  return { ...clause, values };
}

export function prepareRecipeDraft(recipe: Recipe, context: BuilderContext): AutomationDraft {
  const draft = recipeDraft(recipe);
  return {
    trigger: draft.trigger ? prepareClause(draft.trigger, context) : null,
    conditions: draft.conditions.map((clause) => prepareClause(clause, context)),
    actions: draft.actions.map((clause) => prepareClause(clause, context)),
  };
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Resolver for gallery cards: placeholders stay generic, presets read naturally. */
export function genericResolver(term: string, columns: readonly ColumnDto[] = []): TokenResolver {
  return {
    term,
    display(def, _clause, token, value) {
      const spec = def.tokens[token];
      if (!spec) return null;
      if (value === undefined || value === null) {
        // Name the board's own column when there is exactly one of the right type ("Close date").
        if (spec.kind !== 'column' || spec.types === 'editable') return null;
        const types: readonly string[] = spec.types;
        const matches = columns.filter((column) => types.includes(column.type));
        return matches.length === 1 && matches[0] ? matches[0].title : null;
      }
      if (value === '__any__') return 'anyLabel' in spec && spec.anyLabel ? spec.anyLabel : null;
      if (spec.kind === 'label' && typeof value === 'string' && value.startsWith('@'))
        return hintLabelName(value.slice(1), columns) ?? titleCase(value.slice(1));
      if (spec.kind === 'relativeDays' && typeof value === 'number')
        return describeRelativeDays(value, spec.style);
      if (spec.kind === 'people' && isPeopleValue(value) && value.actor) return 'whoever triggered it';
      if (spec.kind === 'text' && typeof value === 'string')
        return spec.maxLength > 600 ? null : `“${value}”`;
      return null;
    },
  };
}
