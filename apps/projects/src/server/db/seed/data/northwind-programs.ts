/**
 * Northwind Robotics programs (docs/programs/SPEC.md 7.1). Four programs for four CRM accounts,
 * run day by day from their start to today. GLOVE is exact (no random noise) so the 7.4 seed
 * check values hold on a 2026-11-25 run; the others follow their story with a seeded random.
 */
import type { IsoDate } from '@/lib/program-types';
import type { DayApi, OrgProgramsSeed, ProgramSeed, SeedLogRow } from '../program-types';

const SIZES = [
  { label: 'Small', code: 'S' },
  { label: 'Medium', code: 'M' },
  { label: 'Large', code: 'L' },
  { label: 'XL', code: 'XL' },
] as const;
const COLORS = [
  { label: 'Brown', code: 'BRN', color: 'brown' },
  { label: 'Yellow', code: 'YLW', color: 'yellow' },
] as const;

const GLOVE_VARIANTS = SIZES.flatMap((size) =>
  COLORS.map((color) => ({
    key: `${size.code}-${color.code}`,
    name: `${size.label} ${color.label}`,
    sku: `GLOVE-${size.code}-${color.code}`,
    attrs: { Size: size.code, Color: color.code },
    // The variant dot follows the Color attribute: Brown kits are brown, Yellow kits are yellow.
    color: color.color,
    defaultQty: '100',
    stdMinutes: '0.6',
  })),
);

/** Day offsets of the 2026-11-25 story, snapped to a work day when the seed runs on another date. */
const STORY = {
  slowWeekStart: -44, // Oct 12, a Monday: five days at half batches
  rushRate: -7, // Nov 18: XL Yellow build rate $2.05
  overPlan: -5, // Nov 20: Small Brown built 112
  shortPro: -21, // Nov 4: Pro closed short at 230
  unplannedRefill: -14, // Nov 11: Refill row of 40
} as const;

const doneAll = (rows: readonly { readonly id: string; readonly plannedQty: string; readonly done: boolean }[], qty?: (row: { readonly id: string; readonly plannedQty: string }) => string): SeedLogRow[] =>
  rows.filter((row) => !row.done).map((row) => ({ buildId: row.id, qty: qty ? qty(row) : row.plannedQty, done: true }));

/** The first work day on or after `offset` (so a story day never lands on a weekend). */
function storyDay(api: DayApi, offset: number): IsoDate {
  let date = addDays(api.today, offset);
  for (let i = 0; i < 7 && !api.isWorkDay(date); i += 1) date = addDays(date, 1);
  return date;
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const glove: ProgramSeed = {
  key: 'GLOVE',
  name: 'Glove kitting',
  description: 'Work glove kits for Gripwell Safety Supply: eight size and color kits every work day, shipped to their regional warehouses.',
  account: 'Gripwell Safety Supply',
  deal: 'Gripwell Safety Supply · Glove kitting program',
  unit: { singular: 'kit', plural: 'kits' },
  workingDays: null,
  startOffset: -71,
  color: 'amber',
  icon: 'hand',
  targetCents: '3200000',
  axes: [
    { name: 'Size', values: SIZES },
    { name: 'Color', values: COLORS },
  ],
  patterns: { name: '{Size} {Color}', key: '{Size.code}-{Color.code}', sku: '{program}-{Size.code}-{Color.code}' },
  variants: GLOVE_VARIANTS,
  card: {
    lines: [
      { kind: 'per_unit', unitPrice: '1.85' },
      { kind: 'flat_monthly', amountCents: '150000', prorate: true },
      { kind: 'monthly_minimum', amountCents: '3000000', prorate: true },
    ],
    rules: [{ axis: 'Size', value: 'XL', op: 'set', amount: '2.10' }],
  },
  oneTime: [{ label: 'Setup fee', amountCents: '250000' }],
  schedule: { name: 'Weekday glove run', pattern: 'weekdays', days: [], leadDays: 7, lines: GLOVE_VARIANTS.map((v) => ({ variantKey: v.key, qty: '100' })) },
  owner: 'maya',
  members: [
    { who: 'sofia', role: 'editor' },
    { who: 'aisha', role: 'viewer' },
  ],
  prepTasks: [
    { title: 'Confirm the January glove forecast with Gripwell', who: 'sofia', due: 6, comments: [['sofia', 'Asked their buyer for the January numbers by Friday.'], ['maya', 'Thanks. If XL keeps growing we may add a second shift on Tuesdays.']], watchers: ['maya'] },
    { title: 'Restock liner cartons for December', who: 'liam', due: 3, comments: [['liam', 'Ordered 40 cases of liners. Delivery is set for next Tuesday.']] },
    { title: 'Print new carton labels with the v2 SKUs', who: 'hannah', due: -24, done: true },
    { title: 'Quarterly business review deck for Gripwell', who: 'maya', due: 14, watchers: ['sofia', 'daniel'] },
    { title: 'Swap the bench layout for the XL line', who: 'ethan', due: -10, done: true, comments: [['ethan', 'Moved the XL bins next to the sealer. Pace on XL is up about 8 percent.']] },
  ],
  async day(api) {
    if (!api.isWorkDay(api.date)) return;
    const builds = await api.builds();
    if (builds.length === 0) return;
    const slowStart = storyDay(api, STORY.slowWeekStart);
    const slowEnd = addDays(slowStart, 4);
    if (api.isToday) {
      // Five done at 100, Large Yellow building at 60, both XL planned with no output.
      const order = ['S-BRN', 'S-YLW', 'M-BRN', 'M-YLW', 'L-BRN'];
      const rows: SeedLogRow[] = builds.filter((b) => b.variantKey && order.includes(b.variantKey)).map((b) => ({ buildId: b.id, qty: '100', done: true }));
      const building = builds.find((b) => b.variantKey === 'L-YLW');
      if (building) rows.push({ buildId: building.id, qty: '60' });
      await api.log(rows);
      return;
    }
    if (api.date >= slowStart && api.date <= slowEnd) {
      if (api.date === slowStart) for (const build of builds) await api.comment(build.id, 'sofia', 'Liner supply short, ran half batches.');
      await api.log(doneAll(builds, () => '50'));
      return;
    }
    if (api.date === storyDay(api, STORY.rushRate)) {
      const rush = builds.find((b) => b.variantKey === 'XL-YLW');
      if (rush) await api.rateOverride(rush.id, '2.05', 'Rush order credit');
    }
    const overPlan = api.date === storyDay(api, STORY.overPlan);
    await api.log(doneAll(builds, (row) => (overPlan && builds.find((b) => b.id === row.id)?.variantKey === 'S-BRN' ? '112' : row.plannedQty)));
    // Builders log their bench time in the open month (Pulse labor per variant).
    if (api.offset >= -20) {
      for (const [index, build] of builds.entries()) await api.time(build.id, index % 2 === 0 ? 'liam' : 'hannah', 55 + Math.round(api.random(`${build.id}:time`) * 15), false);
    }
  },
};

const dude: ProgramSeed = {
  key: 'DUDE',
  name: 'Grooming kits',
  description: 'Starter, Pro and Refill grooming kits for Dude Brothers Outfitters, built Monday, Wednesday and Friday.',
  account: 'Dude Brothers Outfitters',
  deal: 'Dude Brothers · Grooming kit program',
  unit: { singular: 'kit', plural: 'kits' },
  workingDays: [1, 3, 5],
  startOffset: -65,
  color: 'blue',
  icon: 'scissors',
  targetCents: '3600000',
  variants: [
    { key: 'STARTER', name: 'Starter kit', sku: 'DUDE-STARTER', defaultQty: '250', stdMinutes: '0.9' },
    { key: 'PRO', name: 'Pro kit', sku: 'DUDE-PRO', defaultQty: '250', unitPrice: '3.90', stdMinutes: '1.2' },
    { key: 'REFILL', name: 'Refill pack', sku: 'DUDE-REFILL', defaultQty: '250', stdMinutes: '0.5' },
  ],
  card: {
    lines: [
      { kind: 'per_unit', unitPrice: '3.40' },
      { kind: 'per_order', amountCents: '4500', label: 'Batch fee' },
      { kind: 'flat_monthly', amountCents: '75000', prorate: true },
    ],
    rules: [],
  },
  schedule: {
    name: 'MWF run',
    pattern: 'custom_days',
    days: [1, 3, 5],
    leadDays: 7,
    lines: ['STARTER', 'PRO', 'REFILL'].map((variantKey) => ({ variantKey, qty: '250' })),
  },
  owner: 'maya',
  members: [
    { who: 'ethan', role: 'editor' },
    { who: 'aisha', role: 'viewer' },
  ],
  prepTasks: [
    { title: 'Find a second supplier for Pro razors', who: 'ethan', due: 4, comments: [['ethan', 'Two quotes in. Both can ship 2,000 razors a week from December.']], watchers: ['maya'] },
    { title: 'Update the Refill insert card', who: 'hannah', due: -12, done: true },
    { title: 'Count the razor safety caps on hand', who: 'liam', due: 1 },
  ],
  async day(api) {
    if (!api.isWorkDay(api.date) || api.isToday) return;
    const builds = await api.builds();
    if (api.date === storyDay(api, STORY.unplannedRefill)) {
      await api.log([...doneAll(builds), { newVariantKey: 'REFILL', qty: '40', done: true, note: 'Extra refills for a store opening' }]);
      return;
    }
    if (api.date === storyDay(api, STORY.shortPro)) {
      const pro = builds.find((b) => b.variantKey === 'PRO');
      const others = builds.filter((b) => b.variantKey !== 'PRO');
      if (pro) {
        await api.log([...doneAll(others), { buildId: pro.id, qty: '230' }], { closeShort: [{ buildId: pro.id, reason: 'Out of Pro razors' }] });
        await api.comment(pro.id, 'ethan', 'Out of Pro razors after 230 kits. The next lot lands Friday.');
        return;
      }
    }
    await api.log(doneAll(builds));
  },
};

const mahco: ProgramSeed = {
  key: 'MAHCO',
  name: 'Hardware packs',
  description: 'Hinge, bracket and fastener packs for Mahco Hardware Supply. One Monday run a week, built over three days.',
  account: 'Mahco Hardware Supply',
  deal: 'Mahco Hardware · Hardware pack program',
  unit: { singular: 'pack', plural: 'packs' },
  workingDays: null,
  startOffset: -72,
  color: 'slate',
  icon: 'wrench',
  targetCents: '1200000',
  variants: [
    { key: 'HINGE-A', name: 'Hinge pack A', sku: 'MAHCO-HINGE-A', defaultQty: '500', stdMinutes: '0.4' },
    { key: 'HINGE-B', name: 'Hinge pack B', sku: 'MAHCO-HINGE-B', defaultQty: '500', stdMinutes: '0.4' },
    { key: 'BRACKET', name: 'Bracket pack', sku: 'MAHCO-BRACKET', defaultQty: '500', stdMinutes: '0.5' },
    { key: 'FASTENER', name: 'Fastener pack', sku: 'MAHCO-FASTENER', defaultQty: '500', stdMinutes: '0.3' },
  ],
  card: {
    lines: [
      { kind: 'per_unit', unitPrice: '0.95' },
      { kind: 'per_hour', rateCents: 4200, label: 'Sort and recount' },
      { kind: 'monthly_minimum', amountCents: '1200000', prorate: true },
    ],
    rules: [],
  },
  schedule: {
    name: 'Monday hardware run',
    pattern: 'custom_days',
    days: [1],
    leadDays: 7,
    lines: ['HINGE-A', 'HINGE-B', 'BRACKET', 'FASTENER'].map((variantKey) => ({ variantKey, qty: '500' })),
  },
  owner: 'maya',
  members: [
    { who: 'ethan', role: 'editor' },
    { who: 'aisha', role: 'viewer' },
  ],
  prepTasks: [
    { title: 'Sort and recount returned packs', who: 'ethan', due: 2, billableTime: { who: 'ethan', weekdays: [2, 4], minutes: [60, 75, 90, 105, 120] }, comments: [['ethan', 'Returns from the Dallas store were mixed. Recounting by hand before we restock.']] },
    { title: 'Ask Mahco about a bigger Monday order', who: 'maya', due: 5, watchers: ['ethan'], comments: [['maya', 'We are under the $12,000 minimum most months. A bigger Monday run would help both of us.']] },
    { title: 'Replace the bracket scale', who: 'liam', due: -18, done: true },
    { title: 'Label the new fastener bins', who: 'hannah', due: -3, done: true },
  ],
  async day(api) {
    if (!api.isWorkDay(api.date)) return;
    // Each Monday run is built over Monday (200), Tuesday (200) and Wednesday (100, then done).
    for (const [back, qty, done] of [
      [0, '200', false],
      [1, '200', false],
      [2, '100', true],
    ] as const) {
      const runDay = addDays(api.date, -back);
      const builds = (await api.builds(runDay)).filter((b) => !b.done);
      if (builds.length === 0) continue;
      if (api.isToday && back === 0) continue;
      await api.log(builds.map((b) => ({ buildId: b.id, qty, done })));
      // The run's builds span Monday to the last output day, so the timeline shows real bars.
      if (done) for (const build of builds) await api.span(build.id, runDay, api.date);
      if (back === 0 && api.offset >= -25) for (const build of builds) await api.time(build.id, 'liam', 40 + Math.round(api.random(`${build.id}:bench`) * 20), false);
    }
  },
};

/** Standard 180 to 320 and Gift 20 to 60 a day (Gift rises in the current month). */
function ecommQty(api: DayApi, variantKey: string | null): string {
  const r = api.random(`${api.date}:${variantKey}`);
  if (variantKey === 'GIFT') return String(Math.round(api.offset > -25 ? 40 + r * 20 : 20 + r * 25));
  return String(Math.round(180 + r * 140));
}

const ecomm: ProgramSeed = {
  key: 'ECOMM',
  name: 'Order kitting',
  description: 'Standard and gift orders packed for Brightcart Online shoppers, Monday to Saturday.',
  account: 'Brightcart Online',
  deal: 'Brightcart · Order kitting',
  unit: { singular: 'order', plural: 'orders' },
  workingDays: [1, 2, 3, 4, 5, 6],
  startOffset: -65,
  color: 'green',
  icon: 'shopping-cart',
  targetCents: '2200000',
  variants: [
    { key: 'STANDARD', name: 'Standard order', sku: 'BC-STANDARD', defaultQty: '240', stdMinutes: '1.5' },
    { key: 'GIFT', name: 'Gift order', sku: 'BC-GIFT', defaultQty: '40', unitPrice: '3.25', stdMinutes: '2.5' },
  ],
  card: {
    lines: [
      { kind: 'per_unit', unitPrice: '2.75' },
      { kind: 'flat_monthly', amountCents: '200000', prorate: true },
    ],
    rules: [],
  },
  schedule: {
    name: 'Daily orders',
    pattern: 'custom_days',
    days: [1, 2, 3, 4, 5, 6],
    leadDays: 7,
    lines: [
      { variantKey: 'STANDARD', qty: '240', qtyByWeekday: { '6': '120', '1': '300' } },
      { variantKey: 'GIFT', qty: '40' },
    ],
    // Black Friday is planned by hand (900 Standard, 160 Gift).
    skipDates: (today) => [blackFriday(today)],
  },
  owner: 'maya',
  members: [
    { who: 'sofia', role: 'editor' },
    { who: 'aisha', role: 'viewer' },
  ],
  prepTasks: [
    { title: 'Staff the Black Friday shift', who: 'sofia', due: 1, comments: [['sofia', 'Six packers on Friday, two of them from the Mahco line.']], watchers: ['maya'] },
    { title: 'Gift wrap paper for December', who: 'hannah', due: 4 },
    { title: 'Review the 200 bad orders with Brightcart', who: 'maya', due: -13, done: true, comments: [['maya', 'Wrong insert in 200 orders. We credited them and added a second check at pack out.']] },
  ],
  async day(api) {
    const friday = blackFriday(api.today);
    if (api.date === addDays(friday, -10)) {
      await api.newBuilds([
        { variantKey: 'STANDARD', date: friday, qty: '900' },
        { variantKey: 'GIFT', date: friday, qty: '160' },
      ]);
    }
    if (!api.isWorkDay(api.date) || api.isToday) return;
    const builds = await api.builds();
    await api.log(builds.filter((b) => !b.done).map((b) => ({ buildId: b.id, qty: ecommQty(api, b.variantKey), done: true })));
  },
};

/** The day after Thanksgiving in the run year. */
function blackFriday(today: IsoDate): IsoDate {
  return addDays(workspaceHolidays(today)[0]!.date, 1);
}

/** Fourth Thursday of November and Christmas, for the run year. */
export function workspaceHolidays(today: IsoDate): { date: IsoDate; name: string }[] {
  const year = Number(today.slice(0, 4));
  const first = new Date(Date.UTC(year, 10, 1));
  const thursday = 1 + ((4 - first.getUTCDay() + 7) % 7) + 21;
  return [
    { date: `${year}-11-${String(thursday).padStart(2, '0')}`, name: 'Thanksgiving' },
    { date: `${year}-12-25`, name: 'Christmas Day' },
  ];
}

export const northwindPrograms: OrgProgramsSeed = {
  slug: 'northwind-robotics',
  me: 'maya',
  people: {
    maya: 'maya@northwind-robotics.example',
    daniel: 'daniel@northwind-robotics.example',
    liam: 'liam@northwind-robotics.example',
    ethan: 'ethan@northwind-robotics.example',
    sofia: 'sofia@northwind-robotics.example',
    hannah: 'hannah@northwind-robotics.example',
    aisha: 'aisha@northwind-robotics.example',
  },
  calendar: { timezone: 'America/Chicago', workingDays: [1, 2, 3, 4, 5], dailyCapacityHours: '80' },
  programs: [glove, dude, mahco, ecomm],
  async orgDay(api) {
    // v2 of the GLOVE card is published ten days before the month it starts.
    if (api.date === addDays(api.monthStart(0), -10)) {
      await api.publishVersion('GLOVE', {
        effectiveFrom: api.monthStart(0),
        lines: [
          { kind: 'per_unit', unitPrice: '1.95' },
          { kind: 'flat_monthly', amountCents: '150000', prorate: true },
          { kind: 'monthly_minimum', amountCents: '3000000', prorate: true },
        ],
        rules: [{ axis: 'Size', value: 'XL', op: 'add', amount: '0.25' }],
        by: 'maya',
      });
    }
    // September closes on its second work day after, October on Nov 3 (second work day of November).
    if (api.date === api.nthWorkDay(api.monthStart(-1), 2)) await api.closeMonth('GLOVE', api.monthStart(-2).slice(0, 7), 'maya');
    if (api.date === api.nthWorkDay(api.monthStart(0), 2)) await api.closeMonth('GLOVE', api.monthStart(-1).slice(0, 7), 'maya');
    // Brightcart credit for 200 bad orders, the 10th of this month.
    if (api.date === addDays(api.monthStart(0), 9)) {
      await api.adjustment('ECOMM', { label: 'Credit for 200 bad orders', amountCents: '-55000', reason: 'Wrong insert in 200 orders', countsTowardMinimum: false, by: 'maya' });
    }
  },
  async finish(api) {
    // Draft v3 from Jan 1, waiting for review (asked by Sofia).
    await api.draftVersion('GLOVE', {
      effectiveFrom: api.monthStart(2),
      lines: [
        { kind: 'per_unit', unitPrice: '1.99' },
        { kind: 'flat_monthly', amountCents: '150000', prorate: true },
        { kind: 'monthly_minimum', amountCents: '3000000', prorate: true },
      ],
      rules: [{ axis: 'Size', value: 'XL', op: 'add', amount: '0.25' }],
      by: 'sofia',
      askReview: true,
      note: 'Liner costs went up 4 percent. Gripwell agreed to $1.99 from January.',
    });
    await api.projectBuild('FRA', { title: 'Sample kits for trade show', qty: '100', offset: 2, by: 'maya' });
    await api.wizardDraft({ title: 'Winter liner add on', step: 2, deal: 'Gripwell Safety Supply · Winter liner add on', by: 'maya' });
    await api.template('GLOVE', { name: 'Glove style kitting', description: 'Size by color glove kits on a weekday run, with a monthly fee and minimum.', by: 'maya' });
  },
};
