import { describe, expect, it } from 'vitest';
import { automationRecipeSchema } from '@/server/automations-engine/recipes';
import type { ColumnDto, GroupDto, UserSummaryDto } from '@/server/services/contracts/dto';
import { explainRunError } from './run-errors';
import { missingColumnTypes, prepareRecipeDraft, RECIPES, recipeDraft, genericResolver } from './catalog';
import { CLAUSES, clauseDef, tokenIds } from './clauses';
import {
  autoName,
  compileDraft,
  draftFromAutomation,
  draftParts,
  draftProblems,
  EMPTY_DRAFT,
  itemPhrase,
  missingTokens,
  newClause,
  partsToText,
} from './draft';
import { createResolver, joinAlternatives, type BuilderContext } from './resolver';
import { ANY, describeRelativeDays, isTokenSet } from './tokens';
import { summarizeUsage } from './usage';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function column(key: string, type: ColumnDto['type'], settings: Record<string, unknown> = {}): ColumnDto {
  return {
    id: `col-${key}`,
    boardId: uuid(1),
    key,
    title: key.charAt(0).toUpperCase() + key.slice(1).replace('_', ' '),
    description: null,
    type,
    scope: 'item',
    settings: settings as ColumnDto['settings'],
    width: 140,
    position: 'a',
    hidden: false,
    required: false,
  };
}

const STAGE_LABELS = {
  labels: [
    { id: 'lead', name: 'Lead', color: 'orange', position: 0 },
    { id: 'won', name: 'Won', color: 'green', position: 1, isDone: true },
    { id: 'lost', name: 'Lost', color: 'gray', position: 2 },
  ],
};

const groups: GroupDto[] = [
  {
    id: uuid(10),
    boardId: uuid(1),
    title: 'Open',
    color: 'blue',
    position: 'a',
    collapsedDefault: false,
    archivedAt: null,
  },
  {
    id: uuid(11),
    boardId: uuid(1),
    title: 'Closed won',
    color: 'green',
    position: 'b',
    collapsedDefault: false,
    archivedAt: null,
  },
];
const users: UserSummaryDto[] = [
  { id: uuid(20), name: 'Maya Chen', email: 'maya@example.com', image: null, title: null },
];

const context: BuilderContext = {
  boardId: uuid(1),
  term: 'Deal',
  columns: [
    column('name', 'name'),
    column('stage', 'status', STAGE_LABELS),
    column('owner', 'people'),
    column('close_date', 'date'),
    column('amount', 'currency'),
  ],
  groups,
  users,
  boards: [],
};

describe('clause catalog', () => {
  it('covers every trigger, condition and action the engine supports', () => {
    const roles = { trigger: 6, condition: 6, action: 9 };
    for (const [role, count] of Object.entries(roles)) {
      expect(CLAUSES.filter((clause) => clause.role === role)).toHaveLength(count);
    }
  });

  it('declares a spec for every token used in a sentence', () => {
    for (const def of CLAUSES)
      for (const token of tokenIds(def)) expect(def.tokens[token], `${def.type}.${token}`).toBeDefined();
  });
});

describe('draft round trip', () => {
  const stored = {
    trigger: {
      type: 'status_changed',
      config: { columnKey: 'stage', toLabelId: 'won', fromLabelId: 'lead' },
    },
    conditions: [{ type: 'status_is', config: { columnKey: 'stage', labelIds: ['lead', 'won'] } }],
    actions: [
      { type: 'move_to_group', config: { groupId: uuid(11) } },
      {
        type: 'notify',
        config: { userIds: [uuid(20)], peopleColumnKey: 'owner', message: '{name} was won' },
      },
      {
        type: 'create_item',
        config: { boardId: uuid(2), nameTemplate: '{name} onboarding', copyValues: { owner: 'owner' } },
      },
    ],
  };

  it('compiles a stored automation back to an equivalent recipe (unexposed fields preserved)', () => {
    const draft = draftFromAutomation(stored);
    const result = compileDraft(draft, { name: 'Won' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.input.trigger).toEqual(stored.trigger);
    expect(result.input.conditions).toEqual(stored.conditions);
    expect(result.input.actions[1]).toEqual({ type: 'notify', config: stored.actions[1]?.config });
    expect(result.input.actions[2]?.config).toMatchObject({
      copyValues: { owner: 'owner' },
      nameTemplate: '{name} onboarding',
    });
  });

  it('drops the column mapping when the create_item target board changes', () => {
    const draft = draftFromAutomation(stored);
    const create = draft.actions[2];
    if (!create) throw new Error('missing clause');
    const changed = {
      ...draft,
      actions: [
        draft.actions[0]!,
        draft.actions[1]!,
        { ...create, values: { ...create.values, board: uuid(3) } },
      ],
    };
    const result = compileDraft(changed, { name: 'x' });
    expect(result.ok && result.input.actions[2]?.config).toEqual({
      boardId: uuid(3),
      copyValues: {},
      nameTemplate: '{name} onboarding',
    });
  });

  it('renders a plain-English sentence with resolved names', () => {
    const text = partsToText(draftParts(draftFromAutomation(stored), createResolver(context)));
    expect(text).toContain('When Stage changes to Won');
    expect(text).toContain('and only if Stage is Lead or Won');
    expect(text).toContain('move the deal to Closed won');
    expect(text).toContain('notify people in Owner and Maya Chen');
  });

  it('flags deleted references instead of crashing', () => {
    const text = partsToText(
      draftParts(
        draftFromAutomation({
          trigger: { type: 'column_changed', config: { columnKey: 'gone' } },
          conditions: [],
          actions: [{ type: 'archive_item' }],
        }),
        createResolver(context),
      ),
    );
    expect(text).toBe('When deleted column changes, then archive the deal');
  });
});

describe('validation', () => {
  it('reports problems for an empty draft', () => {
    expect(draftProblems(EMPTY_DRAFT)).toEqual(['no-trigger', 'no-action']);
    expect(compileDraft(EMPTY_DRAFT, { name: 'x' })).toEqual({
      ok: false,
      message: 'Choose what starts the automation',
    });
  });

  it('lists missing tokens in sentence order and treats "any" as set', () => {
    const draft = {
      trigger: newClause('trigger', 'status_changed', { column: 'stage', to: ANY }),
      conditions: [],
      actions: [newClause('action', 'notify', { message: 'Hi' })],
    };
    expect(missingTokens(draft).map((entry) => entry.token)).toEqual(['who']);
    const compiled = compileDraft(draft, { name: 'x' });
    expect(compiled).toEqual({ ok: false, message: 'Fill in all fields' });
  });

  it('accepts a complete draft and validates with the engine schema', () => {
    const draft = {
      trigger: newClause('trigger', 'date_arrived', { column: 'close_date', offset: -7 }),
      conditions: [
        newClause('condition', 'number_compare', { column: 'amount', operator: 'gte', value: 1000 }),
      ],
      actions: [newClause('action', 'set_date', { column: 'close_date', offset: 7 })],
    };
    const compiled = compileDraft(draft, { name: 'Bump' });
    expect(compiled.ok).toBe(true);
    if (compiled.ok) expect(automationRecipeSchema.safeParse(compiled.input).success).toBe(true);
    expect(autoName(draft, createResolver(context))).toBe(
      'When it’s 7 days before Close date, and only if Amount is at least 1,000, then set Close date to 7 days from today',
    );
  });

  it('isTokenSet handles each value shape', () => {
    const people = clauseDef('action', 'notify')?.tokens.who;
    if (!people) throw new Error('missing');
    expect(isTokenSet(people, { userIds: [], columnKey: null, actor: false })).toBe(false);
    expect(isTokenSet(people, { userIds: [], columnKey: 'owner', actor: false })).toBe(true);
  });
});

describe('recipes', () => {
  it('every recipe only uses known clauses', () => {
    for (const recipe of RECIPES) {
      const draft = recipeDraft(recipe);
      for (const clause of [draft.trigger, ...draft.conditions, ...draft.actions]) {
        expect(clause && clauseDef(clause.role, clause.type), `${recipe.id}:${clause?.type}`).toBeTruthy();
      }
    }
  });

  it('prefills single compatible columns and resolves label hints', () => {
    const recipe = RECIPES.find((entry) => entry.id === 'crm-won');
    if (!recipe) throw new Error('missing recipe');
    const draft = prepareRecipeDraft(recipe, context);
    expect(draft.trigger?.values).toMatchObject({ column: 'stage', to: 'won' });
    expect(missingTokens(draft).map((entry) => entry.token)).toEqual(['group', 'who']);
  });

  it('clears label hints that do not exist on the board', () => {
    const recipe = RECIPES.find((entry) => entry.id === 'stuck-notify');
    if (!recipe) throw new Error('missing recipe');
    expect(prepareRecipeDraft(recipe, context).trigger?.values.to).toBeNull();
  });

  it('reports missing column types', () => {
    const recipe = RECIPES.find((entry) => entry.id === 'due-tomorrow');
    if (!recipe) throw new Error('missing recipe');
    expect(missingColumnTypes(recipe, context.columns)).toEqual([]);
    expect(missingColumnTypes(recipe, [column('stage', 'status', STAGE_LABELS)])).toEqual(['date']);
  });

  it('renders generic gallery sentences', () => {
    const recipe = RECIPES.find((entry) => entry.id === 'status-notify');
    if (!recipe) throw new Error('missing recipe');
    expect(partsToText(draftParts(recipeDraft(recipe), genericResolver('Item')))).toBe(
      'When status changes to something, then notify someone with a message',
    );
  });
});

describe('helpers', () => {
  it('formats relative days', () => {
    expect(describeRelativeDays(0, 'trigger')).toBe('the day of');
    expect(describeRelativeDays(-1, 'trigger')).toBe('1 day before');
    expect(describeRelativeDays(3, 'trigger')).toBe('3 days after');
    expect(describeRelativeDays(0, 'action')).toBe('today');
    expect(describeRelativeDays(7, 'action')).toBe('7 days from today');
    expect(describeRelativeDays(-2, 'action')).toBe('2 days ago');
  });

  it('joins alternatives', () => {
    expect(joinAlternatives([])).toBeNull();
    expect(joinAlternatives(['A'])).toBe('A');
    expect(joinAlternatives(['A', 'B', 'C'])).toBe('A, B or C');
    expect(joinAlternatives(['A', 'B', 'C', 'D'])).toBe('A, B or 2 others');
  });

  it('uses the right article for terminology', () => {
    expect(itemPhrase('Deal')).toBe('a deal');
    expect(itemPhrase('Account')).toBe('an account');
    expect(itemPhrase('')).toBe('an item');
  });

  it('summarizes usage with warning and danger thresholds and a forecast', () => {
    expect(summarizeUsage({ used: 100, allowance: 1000, dayOfMonth: 10, daysInMonth: 30 })).toMatchObject({
      tone: 'primary',
      forecast: 300,
      forecastOver: false,
    });
    expect(summarizeUsage({ used: 800, allowance: 1000, dayOfMonth: 15, daysInMonth: 30 }).tone).toBe(
      'warning',
    );
    expect(summarizeUsage({ used: 1200, allowance: 1000, dayOfMonth: 15, daysInMonth: 30 })).toMatchObject({
      tone: 'danger',
      percent: 100,
    });
  });

  it('explains run errors in plain language', () => {
    expect(explainRunError(null)).toBeNull();
    expect(explainRunError('Column "stage" does not exist on this board')?.title).toMatch(/column/i);
    expect(explainRunError('You have view-only access to this board')?.title).toBe('Missing permissions');
  });
});
