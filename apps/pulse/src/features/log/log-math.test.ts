import { describe, expect, it } from 'vitest';
import type { ProductionEntryDTO } from '@/lib/types';
import {
  EMPTY_VALUES,
  applyField,
  crewQuestion,
  freeSlot,
  lineSlot,
  missingLaborWords,
  dailyGoal,
  hoursEachFrom,
  isBlank,
  isBlockPaste,
  lineProblem,
  moneyReadout,
  paceTone,
  parsePasted,
  parseTyped,
  planPaste,
  rowReadout,
  sameValues,
  tidy,
  toPayload,
  valuesFromEntry,
} from './log-math';

const entry = (patch: Partial<ProductionEntryDTO> = {}): ProductionEntryDTO => ({
  id: 'e1',
  siteId: 's1',
  jobId: 'j1',
  jobNumber: 'J-1001',
  jobName: 'Holiday kit',
  workDate: '2026-11-17',
  shift: 'day',
  laborClassId: 'c1',
  unitsGood: '4032.000',
  unitsScrap: '12.000',
  unitsRework: '0.000',
  headcount: '12.00',
  hours: '96.00',
  overtimeHours: '4.00',
  setupHours: '0.00',
  hoursConfirmed: true,
  pmTaskId: null,
  taskUnits: null,
  note: null,
  rateCents: 2176,
  overtimeRateCents: 3048,
  laborCostCents: 212384,
  sharedCents: 10000,
  baseRevenueCents: 504000,
  stdMaterialCents: 50000,
  stdScrapCents: 0,
  needsRate: false,
  enteredBy: null,
  source: 'manual',
  sourceRef: null,
  isSample: false,
  version: 1,
  createdBy: null,
  createdAt: '2026-11-17T12:00:00.000Z',
  updatedAt: '2026-11-17T12:00:00.000Z',
  deletedAt: null,
  locked: false,
  moneyHidden: false,
  ...patch,
});

describe('typed numbers', () => {
  it('reads what people type', () => {
    expect(parseTyped('1,250')).toBe(1250);
    expect(parseTyped(' 12.50 ')).toBe(12.5);
    expect(parseTyped('')).toBe(0);
    expect(parseTyped('.5')).toBe(0.5);
    expect(parseTyped('abc')).toBeNull();
    expect(parseTyped('-3')).toBeNull();
    expect(parseTyped('.')).toBeNull();
  });

  it('shows stored decimals the short way', () => {
    expect(tidy('12.00')).toBe('12');
    expect(tidy('7.500')).toBe('7.5');
    expect(tidy('0.000')).toBe('');
    expect(tidy(null)).toBe('');
  });

  it('works hours each back out of labor hours and people', () => {
    expect(hoursEachFrom('96.00', '12.00')).toBe('8');
    expect(hoursEachFrom('97.5', '13')).toBe('7.5');
    expect(hoursEachFrom('10', null)).toBe('');
  });
});

describe('the people times hours each helper', () => {
  it('fills labor hours from people and hours each', () => {
    let values = applyField(EMPTY_VALUES, 'people', '12');
    values = applyField(values, 'hoursEach', '8');
    expect(values.hours).toBe('96');
    values = applyField(values, 'people', '13');
    expect(values.hours).toBe('104');
  });

  it('keeps a typed labor hours total and shows the hours each it means', () => {
    let values = applyField(applyField(EMPTY_VALUES, 'people', '12'), 'hoursEach', '8');
    values = applyField(values, 'hours', '90');
    expect(values.hours).toBe('90');
    expect(values.hoursEach).toBe('7.5');
  });

  it('turns a line into the exact strings the server stores', () => {
    const values = applyField(
      applyField({ ...EMPTY_VALUES, unitsGood: '4,032', note: '  first run ' }, 'people', '12'),
      'hoursEach',
      '8',
    );
    expect(toPayload(values)).toEqual({
      unitsGood: '4032.000',
      unitsScrap: '0.000',
      unitsRework: '0.000',
      headcount: '12.00',
      hours: '96.00',
      overtimeHours: '0.00',
      setupHours: '0.00',
      note: 'first run',
      laborClassId: null,
      pmTaskId: null,
      taskUnits: null,
    });
  });

  it('sends the task and its units, and leaves task units out when blank', () => {
    const tagged = { ...EMPTY_VALUES, hours: '8', people: '1', pmTaskId: 't-1', taskUnits: '1,080' };
    expect(toPayload(tagged)).toMatchObject({ pmTaskId: 't-1', taskUnits: '1080.000' });
    expect(toPayload({ ...tagged, taskUnits: '' })).toMatchObject({ pmTaskId: 't-1', taskUnits: null });
  });

  it('asks for a task before it takes task units', () => {
    expect(lineProblem({ ...EMPTY_VALUES, taskUnits: '40' })).toBe('Task units need a task. Pick the task, or clear Task units.');
    expect(lineProblem({ ...EMPTY_VALUES, taskUnits: '40', pmTaskId: 't-1' })).toBeNull();
    expect(lineProblem({ ...EMPTY_VALUES, taskUnits: 'many', pmTaskId: 't-1' })).toBe('Task units must be a number of 0 or more.');
  });

  it('counts a task change and task units as a change, and task units as not blank', () => {
    const base = { ...EMPTY_VALUES, hours: '8' };
    expect(sameValues(base, { ...base, pmTaskId: 't-1' })).toBe(false);
    expect(sameValues({ ...base, pmTaskId: 't-1' }, { ...base, pmTaskId: 't-1', taskUnits: '5' })).toBe(false);
    expect(isBlank({ ...EMPTY_VALUES, taskUnits: '5' })).toBe(false);
  });

  it('round trips a saved entry', () => {
    const values = valuesFromEntry(entry());
    expect(values).toMatchObject({
      unitsGood: '4032',
      unitsScrap: '12',
      people: '12',
      hoursEach: '8',
      hours: '96',
      overtime: '4',
    });
    expect(sameValues(values, valuesFromEntry(entry()))).toBe(true);
    expect(sameValues(values, { ...values, unitsGood: '4033' })).toBe(false);
    expect(isBlank(values)).toBe(false);
    expect(isBlank(EMPTY_VALUES)).toBe(true);
  });
});

describe('line checks', () => {
  it('says what is wrong in plain words', () => {
    expect(lineProblem({ ...EMPTY_VALUES, unitsGood: 'abc' })).toBe('Units must be a number of 0 or more.');
    // The server keeps these ceilings; the row says so in plain words before it is sent.
    expect(lineProblem({ ...EMPTY_VALUES, unitsGood: '100000000' })).toBe(
      'Units is too big. Type a number under 100,000,000.',
    );
    expect(lineProblem({ ...EMPTY_VALUES, unitsGood: '99999999' })).toBeNull();
    expect(lineProblem({ ...EMPTY_VALUES, people: '10000' })).toBe('People is too big. Type a number under 10,000.');
    expect(lineProblem({ ...EMPTY_VALUES, hoursEach: '-2', hours: '8' })).toBe(
      'Hours each must be a number of 0 or more.',
    );
    expect(lineProblem({ ...EMPTY_VALUES, hours: '8', overtime: '9' })).toBe(
      'Overtime cannot be more than the labor hours.',
    );
    expect(lineProblem({ ...EMPTY_VALUES, hours: '8', setup: '9' })).toBe(
      'Setup hours cannot be more than the labor hours.',
    );
    expect(lineProblem({ ...EMPTY_VALUES, people: '1', hoursEach: '30', hours: '30' })).toBe(
      'Hours each cannot be more than 24.',
    );
    expect(lineProblem(valuesFromEntry(entry()))).toBeNull();
  });

  it('asks "Is that right?" for labor hours typed as hours each (SPEC 4.4)', () => {
    const typo = { ...EMPTY_VALUES, people: '12', hours: '9.6' };
    expect(crewQuestion(typo, '8.00')).toBe(
      '9.6 labor hours for 12 people is 0.8 hours each. A full shift of 8 hours each would be 96 labor hours. Is that right?',
    );
    expect(crewQuestion({ ...EMPTY_VALUES, people: '12', hours: '96' }, '8.00')).toBeNull();
    // A short run with an honest hours each is normal and is not questioned.
    expect(crewQuestion({ ...EMPTY_VALUES, people: '3', hours: '6' }, '8.00')).toBeNull();
  });

  it('asks with the numbers that are on screen after labor hours is typed over', () => {
    // People 4, hours each 8, then labor hours 3.2: the grid works hours each back out to 0.8.
    let values = applyField(applyField(EMPTY_VALUES, 'people', '4'), 'hoursEach', '8');
    expect(values.hours).toBe('32');
    values = applyField(values, 'hours', '3.2');
    expect(values.hoursEach).toBe('0.8');
    const question = crewQuestion(values, '8.00');
    expect(question).toBe('3.2 labor hours for 4 people is 0.8 hours each. A full shift of 8 hours each would be 32 labor hours. Is that right?');
    // Every number of the row is in the question, and the hours each that was replaced is not called typed.
    expect(question).toContain(`${values.hoursEach} hours each`);
    expect(question).not.toContain('You typed');
    expect(crewQuestion({ ...EMPTY_VALUES, people: '1', hours: '20' }, '8.00')).toBe('20 labor hours for 1 person is 20 hours each. A full shift of 8 hours each would be 8 labor hours. Is that right?');
  });

  it('names the empty field on a job with units and no labor hours', () => {
    expect(missingLaborWords([{ people: '4', hoursEach: '' }])).toBe('Add the hours each');
    expect(missingLaborWords([{ people: '', hoursEach: '8' }])).toBe('Add people');
    expect(missingLaborWords([{ people: '', hoursEach: '' }])).toBe('Add people and the hours each');
    expect(missingLaborWords([{ people: '0', hoursEach: '' }, { people: '', hoursEach: '' }])).toBe('Add people and the hours each');
    expect(missingLaborWords([])).toBe('Add people and the hours each');
  });
});

describe('paste from a spreadsheet', () => {
  it('reads tabs, Windows line ends and quoted cells', () => {
    expect(parsePasted('1\t2\r\n3\t4\r\n')).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
    expect(parsePasted('"a ""b"""\t"line\nbreak"')).toEqual([['a "b"', 'line\nbreak']]);
    expect(isBlockPaste('12')).toBe(false);
    expect(isBlockPaste('12\n')).toBe(false);
    expect(isBlockPaste('12\t3')).toBe(true);
  });

  const lines = [
    { key: 'a', jobNumber: 'J-1001' },
    { key: 'b', jobNumber: 'J-1002' },
    { key: 'c', jobNumber: 'J-1003' },
  ];

  it('lays a block down from the cell that has focus', () => {
    const plan = planPaste(
      [
        ['100', '2'],
        ['200', ''],
      ],
      lines,
      'b',
      'unitsGood',
    );
    expect(plan.byJob).toBe(false);
    expect(plan.changes.get('b')).toEqual({ unitsGood: '100', unitsScrap: '2' });
    expect(plan.changes.get('c')).toEqual({ unitsGood: '200' });
    expect(plan.skipped).toBe(0);
  });

  it('counts rows that fall off the end', () => {
    const plan = planPaste([['1'], ['2'], ['3']], lines, 'b', 'people');
    expect(plan.changes.size).toBe(2);
    expect(plan.skipped).toBe(1);
  });

  it('sends rows to their job when the first column holds job numbers, and skips the header', () => {
    const plan = planPaste(
      [
        ['Job', 'Units', 'People', 'Hours each'],
        ['j-1003', '960', '2', '4'],
        ['J-1001', '300', '1', '8'],
      ],
      lines,
      'a',
      'note',
    );
    expect(plan.byJob).toBe(true);
    expect(plan.changes.get('c')).toEqual({ unitsGood: '960', people: '2', hoursEach: '4' });
    expect(plan.changes.get('a')).toEqual({ unitsGood: '300', people: '1', hoursEach: '8' });
    expect(plan.skipped).toBe(0);
  });
});

describe('the live readout', () => {
  const row = {
    usualCrew: [
      { laborClassId: 'c1', headcount: 12 },
      { laborClassId: 'c2', headcount: 1 },
    ],
    targetUph: '44.000',
  };

  it('uses units over labor hours less setup, through the pure library', () => {
    const readout = rowReadout(
      row,
      [
        { ...EMPTY_VALUES, unitsGood: '4032', hours: '96', setup: '4' },
        { ...EMPTY_VALUES, hours: '4' },
      ],
      '8.00',
    );
    expect(readout.units).toBe(4032);
    expect(readout.hours).toBe(100);
    expect(readout.paceHours).toBe(96);
    expect(readout.uph).toBe(42);
    expect(readout.productivityBp).toBe(9545);
    expect(readout.tone).toBe('good');
    expect(readout.goalUnits).toBe(13 * 8 * 44);
  });

  it('colors the pace by the workspace thresholds', () => {
    expect(paceTone(null)).toBe('none');
    expect(paceTone(10000, { watchBp: 9500, riskBp: 8000 })).toBe('good');
    expect(paceTone(9000, { watchBp: 9500, riskBp: 8000 })).toBe('watch');
    expect(paceTone(7900, { watchBp: 9500, riskBp: 8000 })).toBe('bad');
  });

  it('has no goal without a usual crew or a target', () => {
    expect(dailyGoal({ usualCrew: [], targetUph: '44' }, '8')).toBeNull();
    expect(dailyGoal({ usualCrew: row.usualCrew, targetUph: null }, '8')).toBeNull();
  });

  it('adds up the stamped money of the saved entries with the profit library', () => {
    const money = moneyReadout([entry()]);
    // $5,040.00 earned, $2,123.84 labor, $500.00 materials, $100.00 shared.
    expect(money).toMatchObject({
      revenueCents: 504000,
      laborCents: 212384,
      materialCents: 50000,
      sharedCents: 10000,
      costCents: 272384,
      profitCents: 231616,
      marginBp: 4596,
      rateCents: 2176,
    });
    expect(money?.laborPerUnitCents).toBe(53);
    expect(money).toMatchObject({ jobsNoHours: 0, marginProfitCents: 231616 });
  });

  it('shows no margin for a job with units and no labor hours, and leaves it out of the day', () => {
    // 100 units at $1.25 with people typed and no hours: $125.00 earned, no labor cost yet.
    const noHours = entry({ id: 'e2', jobId: 'j2', unitsGood: '100.000', headcount: '4.00', hours: '0.00', overtimeHours: '0.00', laborCostCents: 0, sharedCents: 0, baseRevenueCents: 12500, stdMaterialCents: 0 });
    const alone = moneyReadout([noHours]);
    expect(alone).toMatchObject({ revenueCents: 12500, laborCents: 0, marginBp: null, jobsNoHours: 1 });
    // The day: earned goes up by $125.00, and the margin stays the margin of the job that has hours.
    const day = moneyReadout([entry(), noHours]);
    expect(day).toMatchObject({ revenueCents: 516500, marginBp: 4596, jobsNoHours: 1, marginProfitCents: 231616 });
    // A second crew line with no hours on a job that has hours is still one whole job.
    const twoLines = moneyReadout([entry(), entry({ id: 'e3', unitsGood: '0.000', hours: '0.00', laborCostCents: 0, sharedCents: 0, baseRevenueCents: 0, stdMaterialCents: 0 })]);
    expect(twoLines).toMatchObject({ jobsNoHours: 0, marginBp: 4596 });
  });

  it('never shows money to a reader who may not see it', () => {
    expect(
      moneyReadout([
        entry({
          moneyHidden: true,
          laborCostCents: null,
          baseRevenueCents: null,
          sharedCents: null,
          stdMaterialCents: null,
          rateCents: null,
        }),
      ]),
    ).toBeNull();
  });
});

describe('lineSlot and freeSlot', () => {
  it('treats no labor class as the job default', () => {
    expect(lineSlot('day', null, null, 'c1')).toBe(lineSlot('day', 'c1', null, 'c1'));
    expect(lineSlot('day', 'c1', 't1', 'c1')).not.toBe(lineSlot('day', 'c1', null, 'c1'));
  });

  it('puts the same class on no task when a build line from Projects holds it on a task', () => {
    // Arrange: the only class is on two build lines, each on its own task.
    const taken = new Set([lineSlot('day', 'c1', 'build-a', null), lineSlot('day', 'c1', 'build-b', null)]);
    // Act
    const slot = freeSlot({ taken, shift: 'day', defaultClassId: 'c1', classIds: ['c1'], taskIds: [null, null, 't1'] });
    // Assert
    expect(slot).toEqual({ laborClassId: 'c1', pmTaskId: null });
  });

  it('tries every class on a task before the next task', () => {
    const taken = new Set([lineSlot('day', 'c1', 't1', null)]);
    const slot = freeSlot({ taken, shift: 'day', defaultClassId: null, classIds: ['c1', 'c2'], taskIds: ['t1', null] });
    expect(slot).toEqual({ laborClassId: 'c2', pmTaskId: 't1' });
  });

  it('returns null when every class and task is taken', () => {
    const taken = new Set([lineSlot('day', 'c1', null, null)]);
    expect(freeSlot({ taken, shift: 'day', defaultClassId: null, classIds: ['c1'], taskIds: [null] })).toBeNull();
  });
});
