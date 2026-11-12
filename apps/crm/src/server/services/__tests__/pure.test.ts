import { describe, expect, it } from 'vitest';
import { conditionHolds, renderTemplate, triggerMatches } from '@/server/automations-engine/matching';
import { automationRecipeSchema, referencedColumnKeys } from '@/server/automations-engine/recipes';
import { shouldDeliver } from '@/server/realtime/sse';
import { buildEvent } from '@/server/realtime/publisher';
import { statusLabels } from '../templates/types';
import { validateValuesShape, applyPatch, type ValidationColumn } from '../cell-validation';
import { convertValue } from '../columns';
import { computeItemValues, type ComputeColumn } from '../computed';
import { sanitizeFileName, storagePath } from '../files';
import { evaluateFormula, formulaReferences, validateFormula } from '../formula';
import { decodeCursor, encodeCursor, timeIdCursorSchema, toPage } from '../pagination';
import { comparePositions, initialPositions, positionBetween, resolveMovePosition } from '../positions';
import { plainTextToDoc, sanitizeRichText } from '../rich-text';
import { toPrefixTsQuery } from '../search';
import { BOARD_TEMPLATES } from '../templates/crm';
import { parseColumnSettings } from '@/server/db/schema/cell-values';
import { COLUMN_TYPE_REGISTRY } from '@/server/db/schema/column-types';

describe('fractional positions', () => {
  it('generates keys that sort between neighbours (byte-wise, like COLLATE "C")', () => {
    const [a, b, c] = initialPositions(3) as [string, string, string];
    expect(comparePositions(a, b)).toBe(-1);
    const mid = positionBetween(a, b);
    expect(mid > a && mid < b).toBe(true);
    expect(comparePositions(c, b)).toBe(1);
  });

  it('resolves drop targets relative to siblings', () => {
    const [p1, p2, p3] = initialPositions(3) as [string, string, string];
    const siblings = [
      { id: 'a', position: p1 },
      { id: 'b', position: p2 },
      { id: 'c', position: p3 },
    ];
    const afterA = resolveMovePosition(siblings, { afterId: 'a' });
    expect(afterA > p1 && afterA < p2).toBe(true);
    const beforeA = resolveMovePosition(siblings, { beforeId: 'a' });
    expect(beforeA < p1).toBe(true);
    expect(resolveMovePosition(siblings, {}) > p3).toBe(true);
    expect(() => resolveMovePosition(siblings, { afterId: 'missing' })).toThrow();
  });

  it('rejects inverted bounds', () => {
    const [a, b] = initialPositions(2) as [string, string];
    expect(() => positionBetween(b, a)).toThrow();
  });
});

describe('formula engine', () => {
  const values: Record<string, number | string | null> = {
    deal_value: 120_000,
    probability: 40,
    name: 'Acme',
  };
  const resolve = (key: string) => values[key] ?? null;

  it('evaluates arithmetic with precedence and functions', () => {
    expect(evaluateFormula('ROUND({deal_value} * {probability} / 100, 0)', resolve).result).toBe(48_000);
    expect(evaluateFormula('2 + 3 * 4 ^ 2', resolve).result).toBe(50);
    expect(evaluateFormula('-(2 + 3)', resolve).result).toBe(-5);
    expect(evaluateFormula('IF({probability} >= 50, "Commit", "Pipeline")', resolve).result).toBe('Pipeline');
    expect(evaluateFormula('CONCATENATE({name}, " - ", 5)', resolve).result).toBe('Acme - 5');
    expect(evaluateFormula('MAX(1, 9, 3) + MIN(4, 2)', resolve).result).toBe(11);
    expect(evaluateFormula('DAYS("2026-01-10", "2026-01-01")', resolve).result).toBe(9);
  });

  it('reports errors instead of throwing', () => {
    expect(evaluateFormula('1 / 0', resolve)).toEqual({ result: null, error: 'Division by zero' });
    expect(evaluateFormula('FOO(1)', resolve).error).toMatch(/Unknown function/);
    expect(evaluateFormula('(1 + 2', resolve).error).toBeDefined();
    expect(evaluateFormula('', resolve)).toEqual({ result: null });
  });

  it('validates syntax and lists references', () => {
    expect(validateFormula('{a} + {b}')).toEqual({ ok: true });
    expect(validateFormula('{a} +').ok).toBe(false);
    expect(validateFormula('NOPE()').ok).toBe(false);
    expect(formulaReferences('{a} * {b} + {a}')).toEqual(['a', 'b']);
  });

  it('cannot be abused for code execution or unbounded nesting', () => {
    expect(evaluateFormula('constructor.constructor("return 1")()', resolve).error).toBeDefined();
    expect(evaluateFormula(`${'('.repeat(200)}1${')'.repeat(200)}`, resolve).error).toMatch(/nested/);
  });
});

describe('computed columns', () => {
  const stage = parseColumnSettings(
    'status',
    statusLabels([
      ['open', 'Open', 'blue'],
      ['won', 'Won', 'green', true],
    ]),
  );
  const columns: ComputeColumn[] = [
    { key: 'stage', type: 'status', settings: stage },
    { key: 'value', type: 'currency', settings: {} },
    { key: 'prob', type: 'number', settings: {} },
    { key: 'forecast', type: 'formula', settings: { expression: '{value} * {prob} / 100' } },
    { key: 'loop', type: 'formula', settings: { expression: '{loop} + 1' } },
    { key: 'progress', type: 'progress', settings: { sourceColumnKeys: ['stage'] } },
    { key: 'id', type: 'item_id', settings: {} },
    { key: 'updated', type: 'last_updated', settings: {} },
  ];
  const item = {
    id: 'item-1',
    boardId: 'board-1',
    name: 'Deal',
    values: { stage: { labelId: 'won' }, value: { amount: 1_000, currency: 'USD' }, prob: 50 },
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    createdBy: 'u1',
    updatedBy: 'u2',
  };

  it('derives formula, progress, ids and timestamps', () => {
    const computed = computeItemValues(item, columns);
    expect(computed.forecast).toEqual({ result: 500 });
    expect(computed.progress).toBe(100);
    expect(computed.id).toBe('item-1');
    expect(computed.updated).toEqual({ at: '2026-01-02T00:00:00.000Z', userId: 'u2' });
  });

  it('breaks circular formula references', () => {
    expect((computeItemValues(item, columns).loop as { result: unknown }).result).toBe(1);
  });

  it('aggregates mirror values from linked items', () => {
    const mirrorColumns: ComputeColumn[] = [
      { key: 'deals', type: 'connect_boards', settings: {} },
      {
        key: 'pipeline',
        type: 'mirror',
        settings: {
          connectColumnKey: 'deals',
          mirroredColumnKeys: { 'deals-board': 'value' },
          aggregate: 'sum',
        },
      },
    ];
    const linked = new Map([
      [
        'item-1',
        new Map([
          [
            'deals',
            [
              {
                ...item,
                id: 'd1',
                boardId: 'deals-board',
                values: { value: { amount: 100, currency: 'USD' } },
              },
              {
                ...item,
                id: 'd2',
                boardId: 'deals-board',
                values: { value: { amount: 250, currency: 'USD' } },
              },
            ],
          ],
        ]),
      ],
    ]);
    const foreignColumns = new Map([
      ['deals-board', [{ key: 'value', type: 'currency' as const, settings: {} }]],
    ]);
    const computed = computeItemValues(item, mirrorColumns, { linked, foreignColumns });
    expect(computed.pipeline).toEqual({ display: '350', values: [100, 250] });
  });
});

describe('cell validation (per column type)', () => {
  const columns: ValidationColumn[] = [
    { key: 'name', type: 'name', settings: {}, scope: 'item', title: 'Name' },
    {
      key: 'status',
      type: 'status',
      settings: parseColumnSettings('status', statusLabels([['a', 'A', 'blue']])),
      scope: 'item',
      title: 'Status',
    },
    { key: 'amount', type: 'currency', settings: {}, scope: 'item', title: 'Amount' },
    { key: 'email', type: 'email', settings: {}, scope: 'item', title: 'Email' },
    { key: 'rating', type: 'rating', settings: { max: 5 }, scope: 'item', title: 'Rating' },
    { key: 'formula', type: 'formula', settings: { expression: '' }, scope: 'item', title: 'Formula' },
    { key: 'owner', type: 'people', settings: { allowMultiple: false }, scope: 'item', title: 'Owner' },
    { key: 'sub', type: 'text', settings: {}, scope: 'subitem', title: 'Sub' },
  ];

  it('accepts valid values and normalizes the default status label to null', () => {
    const { patch, issues } = validateValuesShape(
      columns,
      { status: { labelId: 'default' }, amount: { amount: 10, currency: 'USD' }, email: { email: 'a@b.co' } },
      'item',
    );
    expect(issues).toEqual([]);
    expect(patch).toEqual({
      status: null,
      amount: { amount: 10, currency: 'USD' },
      email: { email: 'a@b.co' },
    });
  });

  it('rejects unknown labels, bad shapes, computed and wrong-scope columns', () => {
    const { issues } = validateValuesShape(
      columns,
      {
        status: { labelId: 'nope' },
        amount: { amount: 'ten', currency: 'USD' },
        email: { email: 'not-an-email' },
        rating: 9,
        formula: 3,
        name: 'x',
        sub: 'hello',
        unknown: 1,
        owner: { ids: ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'] },
      },
      'item',
    );
    const paths = issues.map((issue) => issue.path).sort();
    expect(paths).toEqual(
      [
        'values.amount',
        'values.email',
        'values.formula',
        'values.name',
        'values.owner',
        'values.rating',
        'values.status',
        'values.sub',
        'values.unknown',
      ].sort(),
    );
  });

  it('applies patches immutably', () => {
    const current = { a: 'x', b: 'y' } as unknown as Record<string, never>;
    const next = applyPatch(current, { a: null, c: 'z' as never });
    expect(next).toEqual({ b: 'y', c: 'z' });
    expect(current).toEqual({ a: 'x', b: 'y' });
  });

  it('converts values between column types', () => {
    expect(convertValue('text', 'number', '42')).toBe(42);
    expect(convertValue('number', 'text', 7)).toBe('7');
    expect(convertValue('text', 'number', 'abc')).toBeNull();
    expect(convertValue('email', 'text', { email: 'a@b.co' })).toBe('a@b.co');
    expect(convertValue('status', 'date', { labelId: 'x' })).toBeNull();
  });
});

describe('rich text sanitizer', () => {
  it('drops unknown nodes, unsafe links and collects mentions', () => {
    const result = sanitizeRichText({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Hi ', marks: [{ type: 'bold' }, { type: 'script' }] }],
        },
        { type: 'mention', attrs: { id: '11111111-1111-4111-8111-111111111111', label: 'Maya' } },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'click',
              marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
            },
          ],
        },
        { type: 'iframe', attrs: { src: 'https://evil.example' } },
        {
          type: 'paragraph',
          attrs: { onclick: 'x' },
          content: [
            {
              type: 'text',
              text: 'ok',
              marks: [{ type: 'link', attrs: { href: 'https://kitstak.example' } }],
            },
          ],
        },
      ],
    });
    const serialized = JSON.stringify(result.doc);
    expect(serialized).not.toContain('javascript:');
    expect(serialized).not.toContain('iframe');
    expect(serialized).not.toContain('onclick');
    expect(serialized).not.toContain('script');
    expect(serialized).toContain('noopener');
    expect(result.mentionedUserIds).toEqual(['11111111-1111-4111-8111-111111111111']);
    expect(result.text).toContain('@Maya');
  });

  it('builds docs from plain text', () => {
    expect(sanitizeRichText(plainTextToDoc('a\nb')).text).toBe('a\nb');
  });
});

describe('automation matching', () => {
  const event = {
    type: 'column_changed' as const,
    boardId: 'b',
    itemId: 'i',
    columnKey: 'stage',
    columnType: 'status' as const,
    before: { labelId: 'proposal' },
    after: { labelId: 'won' },
  };

  it('matches status triggers by target label', () => {
    expect(
      triggerMatches({ type: 'status_changed', config: { columnKey: 'stage', toLabelId: 'won' } }, event),
    ).toBe(true);
    expect(
      triggerMatches({ type: 'status_changed', config: { columnKey: 'stage', toLabelId: 'lost' } }, event),
    ).toBe(false);
    expect(triggerMatches({ type: 'status_changed', config: { columnKey: 'other' } }, event)).toBe(false);
    expect(
      triggerMatches(
        { type: 'item_created', config: {} },
        { type: 'item_created', boardId: 'b', itemId: 'i' },
      ),
    ).toBe(true);
  });

  it('matches person-assigned only for newly added people', () => {
    const assigned = {
      ...event,
      columnKey: 'owner',
      columnType: 'people' as const,
      before: { ids: ['u1'] },
      after: { ids: ['u1', 'u2'] },
    };
    expect(triggerMatches({ type: 'person_assigned', config: { columnKey: 'owner' } }, assigned)).toBe(true);
    expect(
      triggerMatches(
        {
          type: 'person_assigned',
          config: { columnKey: 'owner', userId: '00000000-0000-4000-8000-000000000000' },
        },
        assigned,
      ),
    ).toBe(false);
    expect(
      triggerMatches(
        { type: 'person_assigned', config: { columnKey: 'owner' } },
        { ...assigned, after: { ids: ['u1'] } },
      ),
    ).toBe(false);
  });

  it('evaluates conditions', () => {
    const subject = {
      groupId: 'g1',
      values: { stage: { labelId: 'won' }, amount: { amount: 500, currency: 'USD' } },
    };
    expect(
      conditionHolds({ type: 'status_is', config: { columnKey: 'stage', labelIds: ['won'] } }, subject),
    ).toBe(true);
    expect(
      conditionHolds(
        { type: 'number_compare', config: { columnKey: 'amount', operator: 'gt', value: 100 } },
        subject,
      ),
    ).toBe(true);
    expect(conditionHolds({ type: 'column_is_empty', config: { columnKey: 'missing' } }, subject)).toBe(true);
    expect(
      conditionHolds(
        { type: 'in_group', config: { groupId: '00000000-0000-4000-8000-000000000000' } },
        subject,
      ),
    ).toBe(false);
  });

  it('validates recipes and lists referenced columns', () => {
    const recipe = automationRecipeSchema.parse({
      trigger: { type: 'status_changed', config: { columnKey: 'stage' } },
      actions: [{ type: 'notify', config: { peopleColumnKey: 'owner', message: 'Hi {name}' } }],
    });
    expect(referencedColumnKeys(recipe).sort()).toEqual(['owner', 'stage']);
    expect(() => automationRecipeSchema.parse({ trigger: { type: 'nope' }, actions: [] })).toThrow();
    expect(renderTemplate('{name} on {board}', { name: 'Deal', board: 'Deals' })).toBe('Deal on Deals');
  });
});

describe('templates', () => {
  it('every template has valid column settings, a name column and a default view', () => {
    for (const template of BOARD_TEMPLATES) {
      expect(template.columns.some((column) => column.type === 'name')).toBe(true);
      expect(template.views.filter((view) => view.isDefault)).toHaveLength(1);
      for (const column of template.columns) {
        expect(() =>
          parseColumnSettings(
            column.type,
            column.settings ?? COLUMN_TYPE_REGISTRY[column.type].defaultSettings(),
          ),
        ).not.toThrow();
      }
      const keys = template.columns.map((column) => column.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});

describe('misc helpers', () => {
  it('builds safe prefix tsqueries', () => {
    expect(toPrefixTsQuery("Acme's  robots!")).toBe('acme:* & s:* & robots:*');
    expect(toPrefixTsQuery("&|!():*'")).toBeNull();
  });

  it('round-trips cursors and rejects tampering', () => {
    const cursor = encodeCursor(['2026-01-01T00:00:00.000Z', '11111111-1111-4111-8111-111111111111']);
    expect(decodeCursor(cursor, timeIdCursorSchema)).toEqual([
      '2026-01-01T00:00:00.000Z',
      '11111111-1111-4111-8111-111111111111',
    ]);
    expect(() => decodeCursor('bm90LWpzb24', timeIdCursorSchema)).toThrow();
    expect(toPage([1, 2, 3], 2, (value) => String(value))).toEqual({ items: [1, 2], nextCursor: '2' });
  });

  it('sanitizes file names and storage keys', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('a<b>:c?.pdf')).toBe('abc.pdf');
    expect(() => storagePath('../x')).toThrow();
  });

  it('delivers realtime events only to the right org / board / user', () => {
    const base = {
      orgId: '11111111-1111-4111-8111-111111111111',
      userId: '22222222-2222-4222-8222-222222222222',
      boardId: '33333333-3333-4333-8333-333333333333',
    };
    const event = buildEvent({ type: 'items.changed', orgId: base.orgId, boardId: base.boardId, ids: [] });
    expect(shouldDeliver(event, base)).toBe(true);
    expect(shouldDeliver({ ...event, orgId: '44444444-4444-4444-8444-444444444444' }, base)).toBe(false);
    expect(shouldDeliver({ ...event, boardId: '55555555-5555-4555-8555-555555555555' }, base)).toBe(false);
    const notice = buildEvent({
      type: 'notifications.changed',
      orgId: base.orgId,
      userIds: ['66666666-6666-4666-8666-666666666666'],
    });
    expect(shouldDeliver(notice, base)).toBe(false);
    expect(shouldDeliver({ ...notice, userIds: [base.userId] }, base)).toBe(true);
  });
});
