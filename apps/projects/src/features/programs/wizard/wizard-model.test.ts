import { describe, expect, it } from 'vitest';
import { programWizardPayloadSchema } from '@/lib/program-types';
import { newValue, type EditorAxis } from '@/features/programs/editors';
import {
  applyCopyInclude,
  basicsProblems,
  emptyState,
  namedCombo,
  oneRunCents,
  readyText,
  stepCaption,
  stepForField,
  syncScheduleLines,
  toPayload,
  variantsProblems,
  visibleSteps,
  wizardProjection,
  wizardVariants,
  type WizardEnv,
  type WizardState,
} from './wizard-model';

const env: WizardEnv = { today: '2026-11-25', userId: 'u1', timezone: 'America/Chicago', workingDays: [1, 2, 3, 4, 5], holidays: [{ date: '2026-11-26', name: 'Thanksgiving' }, { date: '2026-12-25', name: 'Christmas' }] };

function axis(id: string, name: string, values: [string, string][]): EditorAxis {
  let next: EditorAxis = { id, name, values: [] };
  for (const [label, code] of values) next = { ...next, values: [...next.values, newValue(next, label, code)] };
  return next;
}

function glove(): WizardState {
  const base = emptyState(env);
  const size = axis('a1', 'Size', [['Small', 'S'], ['Medium', 'M'], ['Large', 'L'], ['Extra large', 'XL']]);
  const color = axis('a2', 'Color', [['Brown', 'BRN'], ['Yellow', 'YLW']]);
  const xl = size.values[3]!;
  let state: WizardState = {
    ...base,
    start: { ...base.start, mode: 'scratch' },
    basics: { ...base.basics, name: 'Glove kitting', key: 'GLOVE' },
    variants: { ...base.variants, generator: { axes: [size, color], patterns: { name: '', key: '', sku: '' }, overrides: {}, rules: [{ id: 'r1', attributeId: 'a1', valueId: xl.id, op: 'add', amount: '0.25' }], patternsEdited: false } },
    price: { ...base.price, lines: { ...base.price.lines, perUnit: { on: true, price: '1.95', label: null }, monthlyFee: { on: true, amount: '1500', partialMonth: true, chargeWhilePaused: true, label: null } } },
    schedule: { ...base.schedule, name: 'Weekday glove run' },
  };
  state = syncScheduleLines(state);
  return state;
}

describe('wizard model', () => {
  it('makes 8 variants with codes and SKUs', () => {
    const variants = wizardVariants(glove());
    expect(variants).toHaveLength(8);
    expect(variants[0]).toMatchObject({ name: 'Small Brown', key: 'S-BRN', sku: 'GLOVE-S-BRN' });
  });

  it('projects December like E32: $36,920.00 on 22 work days', () => {
    const projection = wizardProjection(glove(), env);
    expect(projection.month).toBe('2026-12');
    expect(projection.workDays).toBe(22);
    expect(projection.totalCents).toBe('3692000');
    expect(projection.basisText).toBe('Based on 22 work days in December');
    expect(oneRunCents(glove())).toBe(BigInt(161000));
  });

  it('builds a payload the server schema accepts, with named combinations', () => {
    const payload = toPayload(glove());
    expect(programWizardPayloadSchema.safeParse(payload).success).toBe(true);
    expect(payload.variants.rows[0]!.comboKey).toBe('Size=S|Color=BRN');
    expect(payload.priceCard.rules).toEqual([{ attributeId: 'Size', valueId: 'XL', op: 'add', amount: '0.25' }]);
    expect(payload.schedule.lines).toHaveLength(8);
    expect(payload.priceCard.lines.map((line) => line.kind)).toEqual(['per_unit', 'flat_monthly']);
  });

  it('checks basics and the key', () => {
    const state = emptyState(env);
    expect(basicsProblems(state)).toMatchObject({ name: 'Give the program a name.', key: 'Add a key.' });
    expect(basicsProblems({ ...state, basics: { ...state.basics, name: 'Glove', key: 'GLOVE' } }, new Map([['GLOVE', 'GLOVE is taken by the project Glove research. Try GLOVK.']])).key).toContain('Try GLOVK');
  });

  it('lets an add rule wait for the card rate on the next step', () => {
    const state = glove();
    const noRate = { ...state, price: { ...state.price, lines: { ...state.price.lines, perUnit: { on: true, price: '', label: null } } } };
    expect(variantsProblems(noRate).rules).toBeUndefined();
  });

  it('hides Start when the URL says how to start and words the caption', () => {
    expect(visibleSteps(true)).toHaveLength(5);
    expect(stepCaption(visibleSteps(false), 'variants')).toBe('Step 3 of 6 · Variants');
    expect(stepForField('basics.key')).toBe('basics');
    expect(stepForField('priceCard.lines')).toBe('price');
  });

  it('copy leaves out what was not ticked', () => {
    const state = applyCopyInclude(glove(), { variants: false, priceCard: false, schedules: true, members: false, links: false }, env);
    expect(wizardVariants(state)).toHaveLength(0);
    expect(state.price.lines.perUnit.price).toBe('');
  });

  it('says how many builds were planned', () => {
    expect(readyText('GLOVE', { builds: 40 }, 7, true)).toBe('GLOVE is ready. 40 builds were planned for the next 7 days.');
    expect(readyText('GLOVE', { builds: 0 }, 7, false)).toBe('GLOVE is ready.');
    expect(namedCombo('a=b', [])).toBe('a=b');
  });
});
