/**
 * Minimal seed: a small shop with three labor classes, three clients, five jobs in different
 * states, two weeks of production, time not on a job, paid hours, materials, costs, revenue,
 * extra services, target pace and one goal. Everything is written through the domain layer.
 * Dates are relative to today, so the numbers always look current.
 */
import { addDays, isWorkDay } from '@/lib/profit';
import {
  createClient,
  createJob,
  createJobType,
  createLaborClass,
  createLaborRate,
  createVasService,
  evaluateAlerts,
  listSites,
  saveCost,
  saveIndirectEntry,
  saveMaterialUsage,
  savePaidHours,
  savePlan,
  saveProductionBulk,
  saveRevenue,
  saveStandard,
  saveTarget,
  saveVasEntry,
  setJobStatus,
  updateSettings,
  type DomainContext,
  type ProductionInput,
} from '@/server/domain';

/** The last `count` work days that end yesterday, oldest first. */
function recentWorkDays(today: string, count: number): string[] {
  const days: string[] = [];
  for (let cursor = addDays(today, -1); days.length < count; cursor = addDays(cursor, -1)) if (isWorkDay(cursor)) days.unshift(cursor);
  return days;
}

export interface SeedSummary {
  readonly clients: number;
  readonly jobs: number;
  readonly entries: number;
  readonly alerts: number;
}

export async function seedMinimal(ctx: DomainContext): Promise<SeedSummary> {
  const [site] = await listSites(ctx);
  if (!site) throw new Error('Seed: the org has no site.');
  const today = site.today;
  const days = recentWorkDays(today, 10);
  const first = days[0]!;
  const sample = true;

  await updateSettings(ctx, { defaultLoadedRateCents: 2200 });

  // Labor: the Packer example from the spec ($16.00, 9% taxes, 12% benefits, $2.40 overhead is $21.76 an hour).
  const packer = await createLaborClass(ctx, { code: 'PACK', name: 'Packer', isDefault: true, color: 'blue' });
  const lead = await createLaborClass(ctx, { code: 'LEAD', name: 'Line lead', color: 'purple' });
  const temp = await createLaborClass(ctx, { code: 'TEMP', name: 'Temp packer', kind: 'temp_agency', color: 'orange' });
  await createLaborRate(ctx, { laborClassId: packer.id, effectiveFrom: '2026-01-01', wageCents: 1600, payrollTaxBp: 900, benefitsBp: 1200, otherBurdenBp: 0, overheadPerHourCents: 240, overtimeMultiplier: '1.50', isSample: sample });
  await createLaborRate(ctx, { laborClassId: lead.id, effectiveFrom: '2026-01-01', wageCents: 2200, payrollTaxBp: 900, benefitsBp: 1200, otherBurdenBp: 0, overheadPerHourCents: 240, overtimeMultiplier: '1.50', isSample: sample });
  await createLaborRate(ctx, { laborClassId: temp.id, effectiveFrom: '2026-01-01', wageCents: 2150, payrollTaxBp: 0, benefitsBp: 0, otherBurdenBp: 0, overheadPerHourCents: 240, overtimeMultiplier: '1.50', billRateCents: null, isSample: sample });

  const kitting = await createJobType(ctx, { code: 'KIT', name: 'Kitting', unitLabel: 'kits', defaultLaborClassId: packer.id, targetMarginBp: 3000, color: 'blue', icon: 'package', position: 1 });
  const rework = await createJobType(ctx, { code: 'REWORK', name: 'Rework', unitLabel: 'units', defaultLaborClassId: packer.id, targetMarginBp: 2500, color: 'orange', icon: 'wrench', position: 2 });
  await saveStandard(ctx, { jobTypeId: kitting.id, unitsPerLaborHour: '42.000', effectiveFrom: '2026-01-01', basis: 'typed', note: 'Starting target for kit builds', isSample: sample });
  await saveStandard(ctx, { jobTypeId: rework.id, unitsPerLaborHour: '60.000', effectiveFrom: '2026-01-01', basis: 'typed', isSample: sample });

  const brightside = await createClient(ctx, { code: 'BRIGHT', name: 'Brightside Snacks', contactName: 'Dana Ruiz', contactEmail: 'dana@brightside.example', partsOwner: 'client', targetMarginBp: 3000, color: 'green', isSample: sample });
  const harbor = await createClient(ctx, { code: 'HARBOR', name: 'Harbor Outfitters', contactName: 'Sam Okafor', contactEmail: 'sam@harbor.example', partsOwner: 'us', color: 'teal', isSample: sample });
  const northpeak = await createClient(ctx, { code: 'NPEAK', name: 'Northpeak Coffee', contactName: 'Lee Tran', contactEmail: 'lee@northpeak.example', partsOwner: 'client', color: 'brown', isSample: sample });

  const labeling = await createVasService(ctx, { code: 'LABEL', name: 'Labeling', unitLabel: 'labels', billing: 'per_unit', defaultPrice: '0.1200', defaultCostPerUnit: '0.0150', standardUph: '400.000', defaultLaborClassId: packer.id, color: 'pink' });

  const crew = [
    { laborClassId: packer.id, headcount: 8 },
    { laborClassId: lead.id, headcount: 1 },
  ];

  // 1. A healthy per unit job, about half done.
  const gift = await createJob(ctx, {
    name: 'Holiday gift kits',
    clientId: brightside.id,
    jobTypeId: kitting.id,
    status: 'active',
    plannedUnits: '30000',
    unitPrice: '1.1000',
    materialCostPerUnit: '0.0600',
    defaultLaborClassId: packer.id,
    usualCrew: crew,
    startDate: first,
    dueDate: addDays(today, 12),
    poNumber: 'PO-88214',
    isSample: sample,
    quote: { units: '30000', revenueCents: 3_300_000, laborHours: '715', laborCents: 1_560_000, setupHours: '8', setupCents: 17_400, materialCents: 180_000, otherCents: 60_000, origin: 'sample' },
  });
  // 2. A job whose crew runs well under the target pace: it heads for a loss.
  const sampler = await createJob(ctx, {
    name: 'Trail sampler boxes',
    clientId: harbor.id,
    jobTypeId: kitting.id,
    status: 'active',
    plannedUnits: '12000',
    unitPrice: '1.2500',
    materialCostPerUnit: '0.3800',
    defaultLaborClassId: packer.id,
    usualCrew: [{ laborClassId: packer.id, headcount: 6 }],
    startDate: days[3]!,
    dueDate: addDays(today, 5),
    isSample: sample,
    quote: { units: '12000', revenueCents: 1_500_000, laborHours: '286', laborCents: 622_000, materialCents: 456_000, otherCents: 40_000, origin: 'sample' },
  });
  // 3. A fixed price rework job that earns by progress.
  const relabel = await createJob(ctx, {
    name: 'Relabel 8,000 pouches',
    clientId: northpeak.id,
    jobTypeId: rework.id,
    status: 'active',
    pricingModel: 'fixed',
    fixedPriceCents: 640_000,
    plannedUnits: '8000',
    materialMethod: 'actual',
    partsOwner: 'us',
    defaultLaborClassId: temp.id,
    usualCrew: [{ laborClassId: temp.id, headcount: 4 }],
    startDate: days[5]!,
    dueDate: addDays(today, 8),
    isSample: sample,
    quote: { units: '8000', revenueCents: 640_000, laborHours: '134', laborCents: 320_000, materialCents: 64_000, otherCents: 0, origin: 'sample' },
  });
  // 4. A finished job.
  const display = await createJob(ctx, {
    name: 'Spring display packs',
    clientId: brightside.id,
    jobTypeId: kitting.id,
    status: 'active',
    plannedUnits: '4000',
    unitPrice: '1.3000',
    materialCostPerUnit: '0.0500',
    defaultLaborClassId: packer.id,
    startDate: first,
    dueDate: days[4]!,
    isSample: sample,
    quote: { units: '4000', revenueCents: 520_000, laborHours: '96', laborCents: 209_000, materialCents: 20_000, otherCents: 15_000, origin: 'sample' },
  });
  // 5. Work that has not started yet.
  await createJob(ctx, {
    name: 'Summer cooler kits',
    clientId: harbor.id,
    jobTypeId: kitting.id,
    status: 'planned',
    plannedUnits: '9000',
    unitPrice: '2.1000',
    materialCostPerUnit: '0.7000',
    startDate: addDays(today, 6),
    dueDate: addDays(today, 30),
    isSample: sample,
    quote: { units: '9000', revenueCents: 1_890_000, laborHours: '225', laborCents: 490_000, materialCents: 630_000, otherCents: 50_000, origin: 'sample' },
  });
  await savePlan(ctx, gift.id, 'budget', { units: '30000', revenueCents: 3_300_000, laborHours: '740', laborCents: 1_615_000, setupHours: '8', setupCents: 17_400, materialCents: 180_000, otherCents: 60_000, origin: 'copied_from_quote' });

  const entries: ProductionInput[] = [];
  days.forEach((date, index) => {
    // Holiday gift kits: 9 people, about 44 units per person per hour, a little overtime on two days.
    const overtime = index === 3 || index === 7 ? '6' : '0';
    entries.push({ jobId: gift.id, workDate: date, laborClassId: packer.id, unitsGood: String(1560 + ((index * 37) % 90)), unitsScrap: String(8 + (index % 5)), headcount: '8', hours: index === 0 ? '36' : '32', setupHours: index === 0 ? '4' : '0', overtimeHours: overtime, isSample: sample });
    entries.push({ jobId: gift.id, workDate: date, laborClassId: lead.id, headcount: '1', hours: '4', isSample: sample });
    // Trail sampler boxes: starts on day 4 and runs at about 26 units per person per hour.
    if (index >= 3) entries.push({ jobId: sampler.id, workDate: date, laborClassId: packer.id, unitsGood: String(1180 + ((index * 53) % 140)), unitsScrap: String(22 + (index % 7)), headcount: '6', hours: '48', isSample: sample });
    // Relabel: starts on day 6 with a temp crew.
    if (index >= 5) entries.push({ jobId: relabel.id, workDate: date, laborClassId: temp.id, unitsGood: String(880 + ((index * 29) % 70)), headcount: '4', hours: '16', isSample: sample });
    // Spring display packs: ran the first five days.
    if (index <= 4) entries.push({ jobId: display.id, workDate: date, laborClassId: packer.id, unitsGood: '800', unitsScrap: '5', headcount: '3', hours: '18', isSample: sample });
  });
  await saveProductionBulk(ctx, entries);

  for (const [index, date] of days.entries()) {
    await saveIndirectEntry(ctx, { workDate: date, laborClassId: packer.id, reason: index % 5 === 0 ? 'meeting' : 'cleanup', headcount: '10', hours: index % 5 === 0 ? '5' : '2.5', isSample: sample });
    if (index >= 5) await savePaidHours(ctx, { workDate: date, paidHours: index >= 5 ? '112' : '90', isSample: sample });
  }

  for (const date of days.slice(5)) {
    await saveMaterialUsage(ctx, { jobId: relabel.id, usageDate: date, itemSku: 'LBL-4X6', itemName: 'Pouch label 4 x 6', quantityUsed: '900', quantityScrapped: '18', quantityPlanned: '1650', unitCost: '0.0800', uom: 'each', isSample: sample });
  }
  await saveVasEntry(ctx, { vasServiceId: labeling.id, jobId: gift.id, workDate: days[6]!, quantity: '3000', laborClassId: packer.id, headcount: '1', hours: '8', isSample: sample });
  await saveVasEntry(ctx, { vasServiceId: labeling.id, jobId: gift.id, workDate: days[8]!, quantity: '3200', laborClassId: packer.id, headcount: '1', hours: '8', isSample: sample });

  await saveCost(ctx, { jobId: gift.id, costDate: days[2]!, category: 'freight', amountCents: 28_500, vendor: 'Great Lakes Freight', reference: 'GLF-20418', isSample: sample });
  await saveCost(ctx, { jobId: sampler.id, costDate: days[4]!, category: 'packaging', amountCents: 19_000, vendor: 'Boxline Supply', isSample: sample });
  await saveCost(ctx, { jobId: display.id, costDate: days[1]!, category: 'freight', amountCents: 14_000, vendor: 'Great Lakes Freight', isSample: sample });
  await saveCost(ctx, { costDate: first, category: 'rent', amountCents: 420_000, vendor: 'Lakeshore Industrial Park', note: 'Half month of rent', isSample: sample });
  await saveCost(ctx, { costDate: first, category: 'utilities', amountCents: 61_000, isSample: sample });

  await setJobStatus(ctx, display.id, 'completed', { completedDate: days[4]! });
  await saveRevenue(ctx, { jobId: display.id, revenueDate: days[5]!, kind: 'invoice', description: 'Spring display packs, 4,000 units', quantity: '4000', unitPrice: '1.3000', invoiceNumber: 'INV-1042', isSample: sample });
  await saveRevenue(ctx, { jobId: gift.id, revenueDate: days[4]!, kind: 'invoice', description: 'Holiday gift kits, first 7,900 units', amountCents: 869_000, invoiceNumber: 'INV-1043', isSample: sample });
  await saveRevenue(ctx, { jobId: gift.id, revenueDate: days[6]!, kind: 'fee', description: 'Rush pallet build', amountCents: 18_000, isSample: sample });

  await saveTarget(ctx, { scope: 'org', metric: 'margin_pct', value: '30', isSample: sample });
  await saveTarget(ctx, { scope: 'org', metric: 'units_per_labor_hour', value: '40', isSample: sample });

  const alerts = await evaluateAlerts(ctx);
  return { clients: 3, jobs: 5, entries: entries.length, alerts: alerts.created };
}
