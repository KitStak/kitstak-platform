/**
 * KitStak demo plan: a 3PL kitting floor where most clients own the parts. Clients map to the
 * real `core.customers` rows (the same ids as `wms.clients`), eight jobs come from the seeded
 * WMS work orders WO000088 to WO000095, and five jobs link to Projects.
 *
 * The story a reviewer should be able to read in the app:
 * - Stars: Lumen Skincare and NovaForge Electronics.
 * - Apex Threads is the biggest client by revenue and loses money once cost to serve is counted.
 * - "Insert cards" is priced under what it costs to do.
 * - Open jobs in trouble, each for a different reason (see `expect` and the pinned notes).
 * - J-1013 was slow, the line was rebalanced, and its pace has been above target since.
 */
import type { JobSpec, OrgPlan } from './types';

const twoDaysAWeek = (from: number, to: number): number[] => {
  const out: number[] = [];
  for (let j = from; j <= to; j += 1) if (j % 5 !== 0 && j % 5 !== 2) out.push(j);
  return out;
};

const jobs: JobSpec[] = [
  /* Warehouse work orders (dates come from WMS) */
  { n: 'WO000088', wms: 'WO000088', name: 'Voltbyte desk bundle restock', client: 'VLT', type: 'KIT', status: 'completed', start: -24, len: 1, crew: 1, hrs: 2, pace: 6.6, pacePlan: 6, planned: 12, price: 7.25, scrap: 0, items: [{ sku: 'VLT-DOCK', per: 1 }, { sku: 'VLT-CABLE', per: 2 }], matSource: 'wms', expect: 'on_track' },
  { n: 'WO000089', wms: 'WO000089', name: 'Pixel & Pine travel kit', client: 'PXP', type: 'KIT', status: 'cancelled', start: -22, crew: 0, pace: 6, pacePlan: 6, planned: 6, price: 7.25, description: 'Cancelled in the warehouse: the client is winding down the travel kit.' },
  { n: 'WO000090', wms: 'WO000090', name: 'Copperline holiday sampler pre-build', client: 'CPL', type: 'KIT', status: 'completed', start: -18, len: 1, crew: 1, hrs: 3, pace: 8.9, pacePlan: 8, planned: 24, price: 5.25, scrap: 0, expect: 'on_track' },
  { n: 'WO000091', wms: 'WO000091', name: 'Harbor Roast gift box for the November promo', client: 'HRB', type: 'GIFT', status: 'completed', start: -15, len: 1, crew: 1, hrs: 3, pace: 7.4, pacePlan: 6.5, planned: 20, price: 6.25, scrap: 0, expect: 'on_track' },
  { n: 'WO000092', wms: 'WO000092', wmsShortage: true, name: 'Harbor Roast Black Friday gift box build', client: 'HRB', type: 'GIFT', status: 'active', start: -11, crew: 0, pace: 6.5, pacePlan: 6.5, planned: 400, price: 6.25, due: 4, pinned: 'Waiting on beans. The warehouse is short on parts, so the line cannot start.', expect: 'at_risk' },
  { n: 'WO000093', wms: 'WO000093', name: 'Voltbyte weekly desk bundle build', client: 'VLT', type: 'KIT', status: 'active', start: -9, crew: 0, pace: 6, pacePlan: 6, planned: 10, price: 6.5, due: 6, expect: 'heads_up' },
  { n: 'WO000094', wms: 'WO000094', name: 'Apex tee 3-pack for the bundle launch', client: 'APEX', type: 'KIT', status: 'active', start: -8, crew: 0, pace: 14, pacePlan: 14, planned: 15, price: 2.75, due: 6, project: 'APX', expect: 'heads_up' },
  { n: 'WO000095', wms: 'WO000095', name: 'NovaForge Road Warrior kit for the CES samples', client: 'NOVA', type: 'KIT', status: 'planned', start: 3, len: 1, crew: 0, pace: 5, pacePlan: 5, planned: 10, price: 9.0, project: 'NOVA' },

  /* Finished jobs */
  { n: 'J-1001', name: 'Apex Threads fall tee bundle', client: 'APEX', type: 'KIT', status: 'completed', start: -64, len: 24, crew: 18, pace: 45, qm: 0.2, target: 1800, po: 'APX-PO-7731', vas: [{ svc: 'LABEL', share: 1, every: 3, price: '0.0900' }, { svc: 'INSERT', share: 1, every: 2 }, { svc: 'POLY', share: 0.6, every: 4 }], other: [{ cat: 'freight', cents: 184_000, at: 0.5, vendor: 'Great Lakes Freight' }], project: 'APX', expect: 'on_track' },
  { n: 'J-1002', name: 'NovaForge earbud launch kit', client: 'NOVA', type: 'KIT', status: 'completed', start: -64, len: 20, crew: 10, pace: 47.5, qm: 0.37, po: 'NF-22018', vas: [{ svc: 'SHRINK', share: 1, every: 3 }, { svc: 'QC', share: 0.25, every: 4 }], project: 'NOVA', budget: true, expect: 'on_track' },
  { n: 'J-1003', name: 'Copperline fall sampler box', client: 'CPL', type: 'SUB', status: 'completed', start: -60, len: 18, crew: 9, pace: 40.5, qm: 0.32, mat: 0.06, vas: [{ svc: 'PALLET', share: 1 / 640, every: 2 }], project: 'CPL', expect: 'on_track' },
  { n: 'J-1004', name: 'Summit Trail back to school relabel', client: 'SMT', type: 'REWORK', status: 'completed', pricing: 'fixed', start: -58, len: 10, crew: 5, pace: 126, qm: 0.3, mat: 0.012, site: 'KS2', expect: 'on_track' },
  { n: 'J-1006', name: 'Bluebird & Main September subscription box', client: 'BLB', type: 'SUB', status: 'completed', start: -50, len: 15, crew: 11, pace: 38.5, qm: 0.3, owner: 'us', items: [{ sku: 'BX-MAILER-9', per: 1 }, { sku: 'TISSUE-BB', per: 2 }, { sku: 'CARD-INSERT', per: 1 }], vas: [{ svc: 'INSERT', share: 1, every: 3 }], budget: true, expect: 'on_track' },
  { n: 'J-1008', name: 'Voltbyte charger bundle', client: 'VLT', type: 'KIT', status: 'completed', start: -46, len: 18, crew: 9, pace: 46, qm: 0.3, vas: [{ svc: 'BARCODE', share: 1, every: 3 }, { svc: 'PROG', share: 0.2, every: 5 }], expect: 'on_track' },
  { n: 'J-1009', name: 'Lumen Skincare travel minis kit', client: 'LUMEN', type: 'GIFT', status: 'completed', start: -44, len: 15, crew: 6, pace: 49, qm: 0.4, mat: 0.95, owner: 'us', vas: [{ svc: 'QC', share: 1, every: 3 }, { svc: 'SHRINK', share: 1, every: 4 }], expect: 'on_track' },
  {
    n: 'J-1034', name: 'Copperline cold brew sampler', client: 'CPL', type: 'SUB', status: 'completed', start: -40, len: 9, crew: 6, pace: 40, qm: 0.3, mat: 0.1, planned: 48000, setup: 16,
    other: [{ cat: 'packaging', cents: 1_450_000, at: 0, vendor: 'Boxline Supply', note: 'Printed cartons for the full 48,000 run. They cannot go back.' }, { cat: 'equipment', cents: 140_000, at: 0, vendor: 'Midwest Die and Tool', note: 'Cutting die' }],
    pinned: 'The client cut the order from 48,000 to about 16,000 boxes after the cartons were printed.',
    notes: [{ at: 0.6, body: 'Copperline paused two of the three flavors. We stop at the cartons already kitted. Ask sales about a restocking fee for the printed cartons.' }],
    expect: 'losing',
  },
  { n: 'J-1010', name: 'Harbor Roast fall gift set', client: 'HRB', type: 'GIFT', status: 'completed', start: -36, len: 12, crew: 10, pace: 46.5, qm: 0.3, mat: 1.4, owner: 'us', vas: [{ svc: 'GIFTWRAP', share: 0.12, every: 3 }, { svc: 'INSERT', share: 1, every: 3 }], expect: 'on_track' },
  {
    n: 'J-1014', name: 'Orchard Pet Supply treat sampler rush', client: 'ORCH', type: 'KIT', status: 'completed', start: -30, len: 8, crew: 9, pace: 30, qm: 0.2, mat: 0.22, owner: 'us', scrap: 0.045, overtime: 0.85,
    other: [{ cat: 'rework', cents: 236_000, at: 0.7, vendor: 'Second pass crew', note: 'Reopened 2,900 pouches with the wrong date code' }, { cat: 'freight', cents: 118_000, at: 0.95, vendor: 'Great Lakes Freight', note: 'Next day air to make the store date' }],
    pinned: 'Rush job. Overtime every day and a date code mix up that had to be redone.',
    expect: 'losing',
  },
  { n: 'J-1016', name: 'Apex Threads holiday tee 3-pack, wave 1', client: 'APEX', type: 'KIT', status: 'completed', start: -34, len: 16, crew: 18, pace: 44.5, qm: 0.19, target: 1800, po: 'APX-PO-7802', vas: [{ svc: 'LABEL', share: 1, every: 3, price: '0.0900' }, { svc: 'INSERT', share: 1, every: 2 }, { svc: 'POLY', share: 0.6, every: 4 }], project: 'PEAK', expect: 'on_track' },
  { n: 'J-1018', name: 'NovaForge smart plug bundle', client: 'NOVA', type: 'KIT', status: 'completed', start: -31, len: 12, crew: 8, pace: 46, qm: 0.35, unbilled: true, vas: [{ svc: 'SHRINK', share: 1, every: 3 }], expect: 'on_track' },
  { n: 'J-1024', name: 'Bluebird & Main October subscription box', client: 'BLB', type: 'SUB', status: 'completed', start: -29, len: 15, crew: 11, pace: 38, qm: 0.3, owner: 'us', items: [{ sku: 'BX-MAILER-9', per: 1 }, { sku: 'TISSUE-BB', per: 2 }, { sku: 'CARD-INSERT', per: 1 }], vas: [{ svc: 'INSERT', share: 1, every: 3 }], fees: [{ kind: 'credit', at: 0.9, cents: -42_000, desc: 'Credit for 210 boxes with a crushed corner' }], expect: 'on_track' },
  { n: 'J-1021', name: 'Pixel & Pine closeout relabel', client: 'PXP', type: 'REWORK', status: 'on_hold', start: -30, len: 5, crew: 3, pace: 118, qm: 0.26, planned: 40000, site: 'KS2', pinned: 'On hold. The client is winding down and has not sent the rest of the stock.' },

  /* Open jobs that are doing well */
  { n: 'J-1005', name: 'Lumen Skincare launch kit', client: 'LUMEN', type: 'GIFT', status: 'active', start: -24, crew: 5, pace: 50, qm: 0.41, pct: 0.72, owner: 'us', items: [{ sku: 'LUM-GIFTBOX', per: 1 }, { sku: 'LUM-CRINKLE', per: 0.02 }], vas: [{ svc: 'QC', share: 1, every: 3 }, { svc: 'SHRINK', share: 1, every: 4 }], po: 'LUM-0931', budget: true, pinned: 'Star job. The crew beats the target pace most days.', expect: 'on_track' },
  { n: 'J-1007', name: 'NovaForge holiday accessory kit', client: 'NOVA', type: 'KIT', status: 'active', start: -18, crew: 5, pace: 46.5, qm: 0.36, pct: 0.58, items: [{ sku: 'NF-CASE', per: 1 }, { sku: 'NF-USBC', per: 1 }], matSource: 'wms', vas: [{ svc: 'SHRINK', share: 1, every: 3 }, { svc: 'BARCODE', share: 1, every: 4 }], project: 'NOVA', importsTime: true, expect: 'on_track' },
  { n: 'J-1038', name: 'Summit Trail monthly returns program', client: 'SMT', type: 'RETURNS', status: 'active', ongoing: true, start: -64, crew: 3, pace: 14.6, qm: 0.34, site: 'KS2', vas: [{ svc: 'PHOTO', share: 0.5, every: 4 }], fees: [{ kind: 'fee', at: 0.3, cents: 45_000, desc: 'Disposal of units that cannot be sold' }, { kind: 'fee', at: 0.75, cents: 52_000, desc: 'Disposal of units that cannot be sold' }], expect: 'on_track' },
  { n: 'J-1011', name: 'Copperline holiday sampler box', client: 'CPL', type: 'SUB', status: 'active', start: -15, crew: 5, pace: 39.5, qm: 0.34, pct: 0.5, mat: 0.06, vas: [{ svc: 'PALLET', share: 1 / 640, every: 2 }, { svc: 'BUNDLE', share: 0.3, every: 3 }], expect: 'on_track' },
  {
    n: 'J-1013', name: 'Voltbyte desk dock kit', client: 'VLT', type: 'KIT', status: 'active', start: -21, crew: 6, pace: 44, paceFn: (j) => (j < 11 ? 0.66 : 1.09), qm: 0.42, pct: 0.66, holdBack: true, vas: [{ svc: 'BARCODE', share: 1, every: 3 }],
    pinned: 'Slow start: the crew made about 29 units per person per hour. The line was rebalanced on day 11 and has run above the target pace since.',
    notes: [{ at: 0.5, body: 'Moved the cable coil step ahead of the box fold and added a second sealer. Watching pace this week.' }, { at: 0.8, body: 'Pace is holding above 46 since the change. Keeping this layout for the next Voltbyte job.' }],
    expect: 'heads_up',
  },
  { n: 'J-1015', name: 'Apex Threads holiday tee 3-pack, wave 2', client: 'APEX', type: 'KIT', status: 'active', start: -12, crew: 13, pace: 44.5, qm: 0.2, target: 1800, pct: 0.5, items: [{ sku: 'APX-TEE', per: 3 }, { sku: 'APX-BELLY', per: 1 }], matSource: 'wms', vas: [{ svc: 'LABEL', share: 1, every: 3, price: '0.0900' }, { svc: 'INSERT', share: 1, every: 2 }, { svc: 'POLY', share: 0.6, every: 4 }], po: 'APX-PO-7856', project: 'PEAK', sat: 2, expect: 'on_track' },
  { n: 'J-1017', name: 'Orchard Pet Supply holiday toy box', client: 'ORCH', type: 'SUB', status: 'active', start: -10, crew: 4, pace: 39, qm: 0.33, pct: 0.42, owner: 'us', items: [{ sku: 'ORCH-BOX', per: 1 }, { sku: 'ORCH-FILL', per: 0.03 }], expect: 'on_track' },
  { n: 'J-1040', name: 'Bluebird & Main gift card sleeves', client: 'BLB', type: 'REWORK', status: 'active', start: -1, last: -1, crew: 4, pace: 120, paceFn: () => 0.64, qm: 0.4, planned: 60000, mat: 0.012, pinned: 'Started yesterday. First day was slow while the crew learned the fold.', expect: 'heads_up' },
  { n: 'J-1020', name: 'Harbor Roast subscription refill', client: 'HRB', type: 'SUB', status: 'active', start: -30, crew: 4, pace: 38.5, qm: 0.32, pct: 0.86, mat: 0.08, noHours: [8, 9], fixNoHours: true, vas: [{ svc: 'INSERT', share: 1, every: 3 }], priceChange: { at: 0.5, pct: 4, note: 'Yearly price review agreed with Harbor Roast' }, expect: 'on_track' },
  { n: 'J-1022', name: 'Lumen Skincare gift duo', client: 'LUMEN', type: 'GIFT', status: 'active', start: -8, crew: 4, pace: 47.5, qm: 0.39, pct: 0.3, mat: 1.05, owner: 'us', site: 'KS2', vas: [{ svc: 'GIFTWRAP', share: 0.2, every: 2 }], expect: 'on_track' },

  /* Open jobs to watch */
  { n: 'J-1031', name: 'NovaForge accessory bundle', client: 'NOVA', type: 'KIT', status: 'active', start: -14, last: -5, crew: 4, pace: 45.5, qm: 0.34, pct: 0.6, pinned: 'Paused while NovaForge ships the new sleeve art.', expect: 'heads_up' },
  {
    n: 'J-1025', name: 'Voltbyte holiday bundle', client: 'VLT', type: 'KIT', status: 'active', cls: 'TEMP', start: -40, crew: 6, pace: 44, qm: 0.215, target: 2400, pct: 0.84,
    pinned: 'Staffed with agency temps. The agency raised its bill rate 45 days ago and the price to Voltbyte did not move.',
    notes: [{ at: 0.6, body: 'The temp agency rate went up 13%. This job was quoted on the old rate. Ask Voltbyte for a price change on the next order.' }],
    expect: 'heads_up',
  },

  /* Open jobs at risk */
  {
    n: 'J-1023', name: 'Bluebird & Main November subscription box', client: 'BLB', type: 'SUB', status: 'active', start: -13, crew: 6, pace: 38, qm: 0.3, pct: 0.55, owner: 'us',
    items: [{ sku: 'BX-MAILER-9', per: 1, jump: { at: 0.3, x: 1.95 }, waste: 0.02 }, { sku: 'TISSUE-BB', per: 2 }, { sku: 'CARD-INSERT', per: 1 }], vas: [{ svc: 'INSERT', share: 1, every: 3 }],
    pinned: 'The mailer box supplier raised its price and the new lot crushes easily, so more boxes are thrown away.',
    notes: [{ at: 0.4, body: 'New mailer lot costs almost twice as much and we are scrapping about three times as many. Asked purchasing for a second supplier.' }],
    expect: 'at_risk',
  },
  { n: 'J-1027', name: 'Apex Threads retail display build', client: 'APEX', type: 'DISPLAY', status: 'active', start: -12, crew: 5, pace: 9.1, qm: 0.22, target: 1800, pct: 0.5, due: 3, po: 'APX-PO-7861', project: 'PEAK', pinned: 'Due in three work days and about half done.', expect: 'at_risk' },
  {
    n: 'J-1029', name: 'Copperline cafe restock program', client: 'CPL', type: 'SUB', status: 'active', ongoing: true, start: -64, crew: 3, pace: 38, qm: 0.33, mat: 0.05, skip: twoDaysAWeek(34, 64),
    other: [{ cat: 'equipment', cents: 300_000, at: 0.03, vendor: 'PackRight Leasing', note: 'Sealer lease for the dedicated line' }, { cat: 'equipment', cents: 300_000, at: 0.34, vendor: 'PackRight Leasing', note: 'Sealer lease for the dedicated line' }, { cat: 'equipment', cents: 300_000, at: 0.65, vendor: 'PackRight Leasing', note: 'Sealer lease for the dedicated line' }, { cat: 'equipment', cents: 300_000, at: 0.93, vendor: 'PackRight Leasing', note: 'Sealer lease for the dedicated line' }],
    otherPlan: 1850,
    pinned: 'Volume is down. Copperline now sends work two days a week, not five, and the leased sealer costs the same each month.',
    notes: [{ at: 0.6, body: 'Cafe orders dropped after two regions moved to a local packer. The line and the sealer lease are sized for five days a week.' }],
    expect: 'at_risk',
  },

  /* Open jobs losing money */
  {
    n: 'J-1012', name: 'Harbor Roast holiday gift set', client: 'HRB', type: 'GIFT', status: 'active', start: -11, crew: 8, pace: 27, qm: 0.25, pct: 0.45, mat: 0.3, owner: 'us', sat: 1, po: 'HR-5512', vas: [{ svc: 'GIFTWRAP', share: 0.1, every: 3 }, { svc: 'INSERT', share: 1, every: 3 }],
    pinned: 'The crew is far under the target pace. The ribbon tie step takes twice as long as planned.',
    notes: [{ at: 0.5, body: 'Timed the line: the ribbon tie is the slow step. Trying a pre tied bow from the supplier next week.' }],
    expect: 'losing',
  },
  {
    n: 'J-1019', name: 'Summit Trail starter kit relabel', client: 'SMT', type: 'REWORK', status: 'active', pricing: 'fixed', start: -9, crew: 5, pace: 70, quotePace: 126, qm: 0.25, pct: 0.5, mat: 0.012, site: 'KS2',
    pinned: 'Fixed price job. The old labels do not peel clean, so every unit takes far more time than the quote assumed.',
    expect: 'losing',
  },
  {
    n: 'J-1026', name: 'Orchard Pet Supply chew toy 3-pack', client: 'ORCH', type: 'KIT', status: 'active', start: -16, crew: 5, pace: 45, quotePace: 68, qm: 0.18, pct: 0.52, mat: 0.05, owner: 'us',
    pinned: 'The crew beats the target pace. The price is the problem: it was quoted to win the account.',
    notes: [{ at: 0.3, body: 'Sales matched a competitor at this price. At our real pace each pack costs more to make than it sells for. Reprice before the next order.' }],
    expect: 'losing',
  },

  /* Open jobs with holes in the data */
  { n: 'J-1036', name: 'Voltbyte cable kit', client: 'VLT', type: 'KIT', status: 'active', start: -7, crew: 4, pace: 44, qm: 0.32, pct: 0.4, noHours: [2, 4, 5], expect: 'no_data' },
  { n: 'J-1033', name: 'Summit Trail sample pack', client: 'SMT', type: 'KIT', status: 'active', start: 0, crew: 3, pace: 43, noPrice: true, pct: 0.1, site: 'KS2', pinned: 'Started before the price was agreed. Sales owes a number.', expect: 'no_data' },

  /* Coming up */
  { n: 'J-1037', name: 'Lumen Skincare spring launch kit', client: 'LUMEN', type: 'GIFT', status: 'planned', start: 6, len: 14, crew: 0, pace: 46, planned: 42000, qm: 0.4, mat: 1.1, owner: 'us' },
  { n: 'J-1039', name: 'Copperline January sampler box', client: 'CPL', type: 'SUB', status: 'planned', start: 9, len: 10, crew: 0, pace: 38, planned: 24000, qm: 0.32, mat: 0.06 },
];

export const kitstakPlan: OrgPlan = {
  seed: 'kitstak-2026',
  sites: [
    { code: 'MLT1', name: 'MLT1 Main Fulfillment', timezone: 'America/New_York' },
    { code: 'KS2', name: 'KS2 Overflow', timezone: 'America/New_York' },
  ],
  defaultPartsOwner: 'client',
  roles: [
    { email: 'ops.manager@kitstak.io', role: 'manager', seesMoney: true },
    { email: 'j.okafor@kitstak.io', role: 'supervisor', seesMoney: false },
    { email: 't.nguyen@kitstak.io', role: 'supervisor', seesMoney: false },
    { email: 'd.castillo@kitstak.io', role: 'supervisor', seesMoney: false },
    { email: 'finance@kitstak.io', role: 'viewer', seesMoney: true },
    { email: 'cs.team@kitstak.io', role: 'viewer', seesMoney: false },
    { email: 'dana@apexthreads.com', role: 'none' },
    { email: 'marcus@novaforge.io', role: 'none' },
    { email: 'integrations@kitstak.io', role: 'none' },
  ],
  classes: [
    { code: 'PACK', name: 'Packer', color: 'blue', wage: 1650, raisePct: 4, taxBp: 900, benBp: 1200, overhead: 550, isDefault: true },
    { code: 'LEAD', name: 'Line lead', color: 'purple', wage: 2200, raisePct: 4, taxBp: 900, benBp: 1200, overhead: 550, isLead: true },
    { code: 'OPER', name: 'Machine operator', color: 'teal', wage: 1900, raisePct: 4, taxBp: 900, benBp: 1200, overhead: 550 },
    { code: 'HAND', name: 'Material handler', color: 'brown', wage: 1800, raisePct: 3, taxBp: 900, benBp: 1200, overhead: 550 },
    { code: 'TEMP', name: 'Temp packer', kind: 'temp_agency', color: 'orange', wage: 2150, raisePct: 13, taxBp: 0, benBp: 0, overhead: 550 },
  ],
  types: [
    { code: 'KIT', name: 'Kit assembly', unit: 'kits', target: 3000, color: 'blue', icon: 'package', pace: 44, cls: 'PACK' },
    { code: 'SUB', name: 'Subscription box', unit: 'boxes', target: 3000, color: 'pink', icon: 'gift', pace: 38, cls: 'PACK' },
    { code: 'DISPLAY', name: 'Retail display build', unit: 'displays', target: 3200, color: 'indigo', icon: 'store', pace: 9, cls: 'PACK' },
    { code: 'GIFT', name: 'Gift set', unit: 'sets', target: 3000, color: 'berry', icon: 'gift', pace: 46, cls: 'PACK' },
    { code: 'REWORK', name: 'Rework and relabel', unit: 'units', target: 2500, color: 'orange', icon: 'wrench', pace: 120, cls: 'PACK' },
    { code: 'RETURNS', name: 'Returns refurbish', unit: 'units', target: 2800, color: 'teal', icon: 'undo', pace: 14, cls: 'PACK' },
  ],
  services: [
    { code: 'LABEL', name: 'Labeling', unit: 'labels', price: '0.1200', cost: '0.0150', uph: 420, color: 'blue' },
    { code: 'SHRINK', name: 'Shrink wrap', unit: 'units', price: '0.1800', cost: '0.0300', uph: 300, cls: 'OPER', color: 'teal' },
    { code: 'INSERT', name: 'Insert cards', unit: 'cards', price: '0.0700', cost: '0.0120', uph: 330, color: 'red' },
    { code: 'POLY', name: 'Poly bagging', unit: 'bags', price: '0.1500', cost: '0.0200', uph: 340, color: 'sky' },
    { code: 'QC', name: 'Quality check', unit: 'units', price: '0.1000', uph: 520, color: 'green' },
    { code: 'PALLET', name: 'Pallet build', unit: 'pallets', price: '14.0000', cost: '3.2000', uph: 4.2, cls: 'HAND', color: 'brown' },
    { code: 'SPECIAL', name: 'Special project', unit: 'hours', billing: 'per_hour', price: '48.0000', uph: 1, color: 'purple' },
    { code: 'PROG', name: 'Programming', unit: 'units', price: '1.2500', uph: 36, cls: 'OPER', color: 'indigo' },
    { code: 'BARCODE', name: 'Barcode and FNSKU labels', unit: 'labels', price: '0.1400', cost: '0.0100', uph: 430, color: 'dark-blue' },
    { code: 'GIFTWRAP', name: 'Gift wrap', unit: 'units', price: '1.1000', cost: '0.3200', uph: 46, color: 'berry' },
    { code: 'PHOTO', name: 'Photo of each unit', unit: 'photos', price: '0.3500', uph: 120, color: 'yellow' },
    { code: 'BUNDLE', name: 'Bundle and band', unit: 'bundles', price: '0.2200', cost: '0.0300', uph: 190, color: 'lime' },
  ],
  clients: [
    { code: 'APEX', core: 'APX', name: 'Apex Threads Co.', contact: 'Dana Whitfield', email: 'dana@apexthreads.com', target: 1800, color: 'red', terms: 60, notes: 'Biggest client by revenue. Volume deal with thin prices, many chargebacks and rush freight.' },
    { code: 'NOVA', core: 'NVF', name: 'NovaForge Electronics', contact: 'Marcus Oyelaran', email: 'marcus@novaforge.io', color: 'blue', notes: 'Clean forecasts and steady pace. A star account.' },
    { code: 'CPL', core: 'CPL', name: 'Copperline Coffee Co.', contact: 'Priya Raman', email: 'priya@copperlinecoffee.example', color: 'brown' },
    { code: 'BLB', core: 'BLB', name: 'Bluebird & Main', contact: 'Hollis Grant', email: 'hollis@bluebirdandmain.example', owner: 'us', color: 'sky', notes: 'We buy the boxes and fill for this client.' },
    { code: 'VLT', core: 'VLT', name: 'Voltbyte Labs', contact: 'Imani Brooks', email: 'imani@voltbyte.example', color: 'indigo' },
    { code: 'SMT', core: 'SMT', name: 'Summit Trail Gear', contact: 'Cole Jensen', email: 'cole@summittrail.example', color: 'green' },
    { code: 'HRB', core: 'HRB', name: 'Harbor Roast Collective', contact: 'Nadia Park', email: 'nadia@harborroast.example', color: 'orange' },
    { code: 'PXP', core: 'PXP', name: 'Pixel & Pine', contact: 'Jo Linden', email: 'jo@pixelandpine.example', color: 'gray', inactive: true, notes: 'Winding down. No new work planned.' },
    { code: 'LUMEN', name: 'Lumen Skincare', contact: 'Ava Moreno', email: 'ava@lumenskincare.example', owner: 'us', target: 3500, color: 'purple', notes: 'Premium gift sets. Pays on time and plans ahead. A star account.' },
    { code: 'ORCH', name: 'Orchard Pet Supply', contact: 'Ben Castellano', email: 'ben@orchardpet.example', owner: 'us', color: 'lime' },
  ],
  items: [
    { sku: 'BX-MAILER-9', name: 'Mailer box 9 x 6 x 3', cost: '0.4200', by: 'us' },
    { sku: 'TISSUE-BB', name: 'Printed tissue sheet', cost: '0.0450', by: 'us' },
    { sku: 'CARD-INSERT', name: 'Welcome card', cost: '0.0600', by: 'us' },
    { sku: 'LUM-GIFTBOX', name: 'Lumen rigid gift box', cost: '0.9800', by: 'us', client: 'LUMEN' },
    { sku: 'LUM-CRINKLE', name: 'Crinkle paper fill', uom: 'lb', cost: '2.1000', by: 'us', client: 'LUMEN' },
    { sku: 'ORCH-BOX', name: 'Orchard toy box', cost: '0.3600', by: 'us', client: 'ORCH' },
    { sku: 'ORCH-FILL', name: 'Paper fill', uom: 'lb', cost: '1.4000', by: 'us', client: 'ORCH' },
    { sku: 'APX-TEE', name: 'Apex tee, folded', cost: '3.9000', by: 'client', client: 'APEX' },
    { sku: 'APX-BELLY', name: 'Apex belly band', cost: '0.0800', by: 'client', client: 'APEX' },
    { sku: 'NF-CASE', name: 'NovaForge travel case', cost: '2.6000', by: 'client', client: 'NOVA' },
    { sku: 'NF-USBC', name: 'NovaForge USB-C cable 1 m', cost: '1.1500', by: 'client', client: 'NOVA' },
    { sku: 'VLT-DOCK', name: 'Voltbyte desk dock', cost: '14.2000', by: 'client', client: 'VLT' },
    { sku: 'VLT-CABLE', name: 'Voltbyte braided cable', cost: '1.9000', by: 'client', client: 'VLT' },
  ],
  jobs,
  closed: [-38],
  companyCosts: [
    { cat: 'rent', cents: 2_400_000, vendor: 'Lakeshore Industrial Park' },
    { cat: 'utilities', cents: 420_000, vendor: 'City Power and Water' },
    { cat: 'equipment', cents: 580_000, vendor: 'PackRight Leasing', note: 'Forklifts, sealers and conveyors' },
    { cat: 'salaried_staff', cents: 3_100_000, vendor: 'Payroll', note: 'Office, planning and customer service' },
    { cat: 'insurance', cents: 340_000, vendor: 'Harbor Mutual' },
    { cat: 'other', cents: 210_000, vendor: 'Software and supplies' },
  ],
  clientCosts: [
    { client: 'APEX', cat: 'other', cents: 980_000, at: -52, vendor: 'Retail compliance', note: 'Chargeback from the retailer for late cartons. Apex passed it to us.' },
    { client: 'APEX', cat: 'freight', cents: 460_000, at: -44, vendor: 'Great Lakes Freight', note: 'Rush truck we paid for to hit the store date' },
    { client: 'APEX', cat: 'salaried_staff', cents: 520_000, at: -42, vendor: 'Payroll', note: 'Account coordinator who works only on Apex' },
    { client: 'APEX', cat: 'storage', cents: 290_000, at: -40, vendor: 'KS2 overflow', note: 'Overflow pallets stored at no charge' },
    { client: 'APEX', cat: 'other', cents: 740_000, at: -27, vendor: 'Retail compliance', note: 'Chargeback for mixed sizes in a carton' },
    { client: 'APEX', cat: 'salaried_staff', cents: 520_000, at: -21, vendor: 'Payroll', note: 'Account coordinator who works only on Apex' },
    { client: 'APEX', cat: 'storage', cents: 310_000, at: -20, vendor: 'KS2 overflow', note: 'Overflow pallets stored at no charge' },
    { client: 'APEX', cat: 'freight', cents: 580_000, at: -13, vendor: 'Great Lakes Freight', note: 'Second rush truck for the holiday wave' },
    { client: 'APEX', cat: 'other', cents: 890_000, at: -8, vendor: 'Retail compliance', note: 'Chargeback for labels that would not scan' },
    { client: 'APEX', cat: 'salaried_staff', cents: 520_000, at: -4, vendor: 'Payroll', note: 'Account coordinator who works only on Apex' },
    { client: 'APEX', cat: 'storage', cents: 330_000, at: -2, vendor: 'KS2 overflow', note: 'Overflow pallets stored at no charge' },
    { client: 'APEX', cat: 'other', cents: 1_120_000, at: -16, vendor: 'Retail compliance', note: 'Chargeback for a missed delivery window' },
    { client: 'APEX', cat: 'rework', cents: 780_000, at: -30, vendor: 'Returns desk', note: 'Sorting and refolding store returns at no charge' },
    { client: 'APEX', cat: 'freight', cents: 640_000, at: -6, vendor: 'Great Lakes Freight', note: 'Split shipment to three stores at our cost' },
    { client: 'HRB', cat: 'freight', cents: 64_000, at: -18, vendor: 'Great Lakes Freight', note: 'Sample shipment to the buyer' },
    { client: 'NOVA', cat: 'supplies', cents: 38_000, at: -25, vendor: 'Boxline Supply', note: 'Photo samples for the launch' },
    { client: 'BLB', cat: 'storage', cents: 72_000, at: -9, vendor: 'KS2 overflow', note: 'Two weeks of overflow storage' },
  ],
  clientVas: [
    { client: 'APEX', svc: 'SPECIAL', every: 6, qty: 14, price: '34.0000' },
    { client: 'NOVA', svc: 'SPECIAL', every: 9, qty: 6 },
    { client: 'SMT', svc: 'PALLET', every: 7, qty: 9 },
    { client: 'LUMEN', svc: 'PHOTO', every: 8, qty: 160 },
  ],
  clientFees: [
    { client: 'NOVA', kind: 'fee', every: 21, cents: 120_000, desc: 'Monthly account fee' },
    { client: 'LUMEN', kind: 'fee', every: 21, cents: 95_000, desc: 'Monthly account fee' },
    { client: 'SMT', kind: 'fee', every: 21, cents: 60_000, desc: 'Monthly storage fee' },
  ],
  indirect: [
    { reason: 'cleanup', share: 0.45 },
    { reason: 'training', share: 0.3, note: 'New hire training' },
    { reason: 'waiting', share: 0.25, note: 'Waiting on parts from the dock' },
    { reason: 'maintenance', share: 0.2, note: 'Sealer and conveyor checks' },
    { reason: 'break', share: 0.15 },
  ],
  goals: [
    { scope: 'org', metric: 'margin_pct', value: '28' },
    { scope: 'org', metric: 'profit', value: '95000', monthly: true },
    { scope: 'org', metric: 'revenue', value: '420000', monthly: true },
    { scope: 'org', metric: 'utilization_pct', value: '88' },
    { scope: 'org', metric: 'labor_pct_of_revenue', value: '55' },
    { scope: 'client', ref: 'APEX', metric: 'margin_pct', value: '18' },
    { scope: 'client', ref: 'NOVA', metric: 'margin_pct', value: '32' },
    { scope: 'client', ref: 'LUMEN', metric: 'margin_pct', value: '35' },
    { scope: 'job_type', ref: 'KIT', metric: 'units_per_labor_hour', value: '44' },
    { scope: 'job_type', ref: 'GIFT', metric: 'units_per_labor_hour', value: '46' },
    { scope: 'vas_service', ref: 'INSERT', metric: 'margin_pct', value: '30' },
    { scope: 'site', ref: 'KS2', metric: 'margin_pct', value: '26' },
  ],
  views: [
    { page: 'jobs', name: 'Losing money or at risk', config: { tab: 'open', risk: ['losing', 'at_risk'], sort: 'projectedProfit', direction: 'asc' }, isDefault: true },
    { page: 'jobs', name: 'Apex Threads, all jobs', config: { tab: 'all', clientCode: 'APEX', sort: 'startDate', direction: 'desc' } },
    { page: 'profit', name: 'Clients this quarter, worst first', config: { by: 'client', range: 'this_quarter', sort: 'profit', direction: 'asc', compare: true } },
    { page: 'profit', name: 'Extra services, last 30 days', config: { by: 'service', range: 'last_30_days', sort: 'margin', direction: 'asc' } },
    { page: 'alerts', name: 'Mine, still open', config: { status: 'open', assignedTo: 'me' }, shared: false },
  ],
  clientNotes: [
    { client: 'APEX', body: 'Quarterly review: revenue is our largest, yet chargebacks, rush freight, free storage and a full time coordinator eat all of it. Bring the cost to serve page to the renewal talk.' },
    { client: 'LUMEN', body: 'Lumen confirmed the spring launch. Same kit style as the fall launch, so the same line layout should work.' },
    { client: 'NOVA', body: 'NovaForge asked for a quote on a second accessory line for the first quarter.' },
  ],
};
