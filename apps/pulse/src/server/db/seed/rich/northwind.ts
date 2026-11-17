/**
 * Northwind Robotics demo plan: a kitting and integration cell that buys its own parts and
 * builds install, spare part and field service kits for robot deployments. This org has no
 * warehouse and no `core.customers`: clients are made in Pulse and linked to CRM account items,
 * jobs are linked to real won CRM deals and to Projects. It proves Pulse standing on CRM and
 * Projects alone.
 *
 * The story:
 * - Stars: Frontier Aerospace and Evergreen Retail Group.
 * - Lakeshore Components looks big and loses money once warranty work, rush freight and
 *   site visits are counted.
 * - "Serial capture" is priced under what it costs to do.
 * - J-1013 was slow, the bench layout was fixed, and its pace has been above target since.
 */
import type { JobSpec, OrgPlan } from './types';

const jobs: JobSpec[] = [
  /* Finished jobs */
  { n: 'J-1001', name: 'Frontier Aerospace pick-assist install kits', client: 'FRONTIER', type: 'INSTALL', status: 'completed', start: -64, len: 20, crew: 4, help: 'TEST', pace: 3.5, qm: 0.37, mat: 22, deal: 'Frontier Aerospace: Pick-assist robots pilot (phase 2)', project: 'FRA', vas: [{ svc: 'SERIAL', share: 1, every: 2 }, { svc: 'KITTEST', share: 1, every: 3 }], budget: true, expect: 'on_track' },
  { n: 'J-1002', name: 'Cobalt Foods palletizing install kits', client: 'COBALT', type: 'INSTALL', status: 'completed', start: -62, len: 16, crew: 4, help: 'TEST', pace: 3.45, qm: 0.32, mat: 24, deal: 'Cobalt Foods · Palletizing cells', project: 'CBP', vas: [{ svc: 'CRATE', share: 0.04, every: 2 }], expect: 'on_track' },
  { n: 'J-1003', name: 'Evergreen pick-assist spare parts kits', client: 'EVERGREEN', type: 'SPARE', status: 'completed', start: -58, len: 14, crew: 3, pace: 9.8, qm: 0.35, mat: 9, deal: 'Evergreen Retail Group · Pick-assist robots renewal', vas: [{ svc: 'LABEL', share: 1, every: 3 }], expect: 'on_track' },
  { n: 'J-1004', name: 'Lakeshore DC6 retrofit kits', client: 'LAKESHORE', type: 'RETRO', status: 'completed', start: -55, len: 18, crew: 6, pace: 2.6, qm: 0.26, target: 2400, mat: 31, deal: 'Lakeshore Components DC6 automation', vas: [{ svc: 'SERIAL', share: 1, every: 2 }, { svc: 'FIRMWARE', share: 0.5, every: 3 }], expect: 'on_track' },
  { n: 'J-1005', name: 'Highline Freight palletizing spare kits', client: 'HIGHLINE', type: 'SPARE', status: 'completed', start: -45, len: 10, crew: 3, pace: 9.8, qm: 0.32, mat: 8.5, deal: 'Highline Freight · Palletizing cells renewal', expect: 'on_track' },
  { n: 'J-1006', name: 'Bluestone Foods forklift field service kits', client: 'BLUESTONE', type: 'FIELD', status: 'completed', start: -42, len: 12, crew: 3, pace: 6.6, qm: 0.33, mat: 12, deal: 'Bluestone Foods · Autonomous forklifts', vas: [{ svc: 'DOCS', share: 1, every: 3 }], expect: 'on_track' },
  {
    n: 'J-1007', name: 'Driftwood Freight sortation install kits', client: 'DRIFTWOOD', type: 'INSTALL', status: 'completed', start: -36, len: 4, crew: 4, help: 'TEST', pace: 3.3, qm: 0.32, mat: 23, planned: 1400, setup: 14, deal: 'Driftwood Freight: Sortation robots pilot',
    other: [{ cat: 'packaging', cents: 2_650_000, at: 0, vendor: 'FoamCraft', note: 'Custom foam trays cut for all 1,400 kits. They fit nothing else.' }, { cat: 'equipment', cents: 480_000, at: 0, vendor: 'Benchmark Tooling', note: 'Torque fixture for this kit' }],
    pinned: 'Driftwood cut the pilot from 1,400 kits to about 400 after the foam trays were made.',
    notes: [{ at: 0.6, body: 'Pilot scope was cut to under a third. Trays and fixture are already paid for. Ask sales about billing the unused trays.' }],
    expect: 'losing',
  },
  { n: 'J-1008', name: 'Evergreen AMR fleet install kits', client: 'EVERGREEN', type: 'INSTALL', status: 'completed', start: -38, len: 18, crew: 5, pace: 3.5, qm: 0.38, mat: 22, deal: 'Evergreen Retail Group · AMR fleet', unbilled: true, vas: [{ svc: 'SERIAL', share: 1, every: 2 }, { svc: 'CALIB', share: 0.1, every: 3 }], expect: 'on_track' },
  { n: 'J-1026', name: 'Cobalt Foods palletizing spare parts kits', client: 'COBALT', type: 'SPARE', status: 'completed', start: -30, len: 12, crew: 3, pace: 9.6, qm: 0.33, mat: 9, deal: 'Cobalt Foods · Palletizing cells', vas: [{ svc: 'LABEL', share: 1, every: 3 }], expect: 'on_track' },
  { n: 'J-1027', name: 'Orion Fulfillment DC3 retrofit kits', client: 'ORION', type: 'RETRO', status: 'completed', start: -32, len: 14, crew: 4, help: 'TEST', pace: 2.55, qm: 0.33, mat: 31, deal: 'Orion Fulfillment DC3 automation', vas: [{ svc: 'FIRMWARE', share: 0.5, every: 3 }], expect: 'on_track' },
  { n: 'J-1028', name: 'Frontier Aerospace pick-assist field service kits', client: 'FRONTIER', type: 'FIELD', status: 'completed', start: -28, len: 12, crew: 3, pace: 6.5, qm: 0.36, mat: 12, deal: 'Frontier Aerospace: Pick-assist robots pilot (phase 2)', project: 'FRA', vas: [{ svc: 'DOCS', share: 1, every: 3 }], expect: 'on_track' },
  { n: 'J-1009', name: 'Orion Fulfillment DC2 survey demo units', client: 'ORION', type: 'DEMO', status: 'on_hold', start: -20, len: 4, crew: 2, pace: 0.5, qm: 0.3, mat: 40, planned: 30, project: 'ORN', pinned: 'On hold until the site survey has a new date.' },

  /* Open jobs that are doing well */
  { n: 'J-1010', name: 'Frontier Aerospace spare parts program', client: 'FRONTIER', type: 'SPARE', status: 'active', ongoing: true, start: -64, crew: 2, pace: 9.5, qm: 0.37, mat: 9, project: 'FRA', importsTime: true, vas: [{ svc: 'LABEL', share: 1, every: 4 }], fees: [{ kind: 'fee', at: 0.35, cents: 85_000, desc: 'Expedite fee, same day ship' }, { kind: 'fee', at: 0.8, cents: 85_000, desc: 'Expedite fee, same day ship' }], expect: 'on_track' },
  { n: 'J-1011', name: 'Evergreen AMR field service kits', client: 'EVERGREEN', type: 'FIELD', status: 'active', start: -20, crew: 2, pace: 6.3, qm: 0.36, pct: 0.66, mat: 12, deal: 'Evergreen Retail Group · AMR fleet', vas: [{ svc: 'DOCS', share: 1, every: 3 }, { svc: 'KITTEST', share: 0.5, every: 3 }], budget: true, expect: 'on_track' },
  { n: 'J-1012', name: 'Cobalt Foods spare parts kits', client: 'COBALT', type: 'SPARE', status: 'active', start: -12, crew: 2, pace: 9.3, qm: 0.34, pct: 0.5, owner: 'us', items: [{ sku: 'SP-BELT', per: 1 }, { sku: 'SP-FUSE', per: 4 }], deal: 'Cobalt Foods · Palletizing cells', project: 'CBP', expect: 'on_track' },
  {
    n: 'J-1013', name: 'Bluestone Foods forklift install kits', client: 'BLUESTONE', type: 'INSTALL', status: 'active', start: -16, crew: 3, help: 'TEST', pace: 3.2, paceFn: (j) => (j < 6 ? 0.68 : 1.1), qm: 0.42, pct: 0.62, mat: 22, holdBack: true, deal: 'Bluestone Foods · Autonomous forklifts',
    pinned: 'Slow first week: builders walked to the cage for every harness. The bench was restocked kanban style on day 6 and pace has been above target since.',
    notes: [{ at: 0.45, body: 'Moved harness and bracket bins to the bench and added a second torque driver. Watching pace this week.' }, { at: 0.8, body: 'Pace is holding near 3.5 kits per person per hour. Keeping this bench layout.' }],
    expect: 'on_track',
  },
  { n: 'J-1014', name: 'Highline Freight retrofit kits', client: 'HIGHLINE', type: 'RETRO', status: 'active', start: -9, crew: 2, help: 'TEST', pace: 2.5, qm: 0.37, pct: 0.36, mat: 31, deal: 'Highline Freight · Palletizing cells renewal', expect: 'on_track' },
  { n: 'J-1015', name: 'Frontier Aerospace field service kits', client: 'FRONTIER', type: 'FIELD', status: 'active', start: -5, crew: 2, pace: 6.2, qm: 0.36, pct: 0.22, mat: 12, deal: 'Frontier Aerospace: Robot-as-a-Service plan pilot', project: 'FRA', expect: 'on_track' },

  /* Open jobs to watch */
  { n: 'J-1016', name: 'Orion Fulfillment DC3 install kits', client: 'ORION', type: 'INSTALL', status: 'active', start: -13, last: -5, crew: 2, help: 'TEST', pace: 3.3, qm: 0.36, pct: 0.55, mat: 23, deal: 'Orion Fulfillment DC3 automation', project: 'ORN', pinned: 'Paused: waiting on the revised bracket drawing from Orion.', expect: 'heads_up' },
  {
    n: 'J-1017', name: 'Evergreen retrofit kits', client: 'EVERGREEN', type: 'RETRO', status: 'active', start: -14, crew: 2, help: 'TEST', pace: 2.5, qm: 0.42, pct: 0.6, owner: 'us',
    items: [{ sku: 'RK-HARNESS', per: 1, jump: { at: 0.4, x: 1.14 } }, { sku: 'RK-BRACKET', per: 2 }, { sku: 'RK-FASTEN', per: 1 }], deal: 'Evergreen Retail Group · Pick-assist robots renewal',
    pinned: 'The harness went up 14% on the last lot. Still a good job, worth a look at the next quote.',
    expect: 'heads_up',
  },

  /* Open jobs at risk */
  {
    n: 'J-1019', name: 'Lakeshore controller rework', client: 'LAKESHORE', type: 'REWORK', status: 'active', cls: 'CONTRACT', start: -40, crew: 5, pace: 5, qm: 0.14, pct: 0.85, deal: 'Lakeshore Components: Pick-assist robots pilot',
    pinned: 'Staffed with contract assemblers. The agency raised its bill rate 45 days ago and the price to Lakeshore did not move.',
    notes: [{ at: 0.6, body: 'Contract rate went up 12%. This job was quoted on the old rate with a thin margin. Ask Lakeshore for a change order.' }],
    expect: 'at_risk',
  },
  { n: 'J-1020', name: 'Bluestone Foods demo unit prep', client: 'BLUESTONE', type: 'DEMO', status: 'active', start: -10, crew: 2, pace: 0.51, qm: 0.34, pct: 0.45, mat: 40, due: 2, pinned: 'Due in two work days and under half done.', expect: 'at_risk' },

  /* Open jobs losing money */
  {
    n: 'J-1021', name: 'Lakeshore demo units for ProMat', client: 'LAKESHORE', type: 'DEMO', status: 'active', start: -12, crew: 3, pace: 0.27, qm: 0.24, pct: 0.5, mat: 40, project: 'PMAT', sat: 1,
    pinned: 'Each demo unit takes far longer than planned. The firmware flash fails about one time in three and has to be redone.',
    notes: [{ at: 0.5, body: 'Timed the bench: flashing is the slow step. Engineering is sending a fixed loader this week.' }],
    expect: 'losing',
  },
  {
    n: 'J-1022', name: 'Driftwood Freight retrofit kits', client: 'DRIFTWOOD', type: 'RETRO', status: 'active', start: -11, crew: 2, help: 'TEST', pace: 2.4, qm: 0.2, pct: 0.5, owner: 'us',
    items: [{ sku: 'RK-HARNESS', per: 1, jump: { at: 0.2, x: 2.3 }, waste: 0.03 }, { sku: 'RK-BRACKET', per: 2 }, { sku: 'RK-FASTEN', per: 1 }], deal: 'Driftwood Freight: Sortation robots pilot',
    pinned: 'The usual harness is out of stock. The stand in part costs more than twice as much and more of them fail the pull test.',
    notes: [{ at: 0.3, body: 'Buying the stand in harness at more than double the price to hold the ship date. Each kit now costs more than it sells for.' }],
    expect: 'losing',
  },
  {
    n: 'J-1023', name: 'Highline Freight spare parts kits', client: 'HIGHLINE', type: 'SPARE', status: 'active', start: -14, crew: 2, pace: 9.2, quotePace: 19, qm: 0.04, pct: 0.55, mat: 4,
    pinned: 'The crew beats the target pace. The price is the problem: the quote assumed twice the pace anyone has ever made.',
    notes: [{ at: 0.3, body: 'This was priced from the old bagged kit, not the boxed kit. Reprice before the first quarter order.' }],
    expect: 'losing',
  },

  /* Open job with holes in the data */
  { n: 'J-1018', name: 'Cobalt Foods field service kits', client: 'COBALT', type: 'FIELD', status: 'active', start: -6, crew: 2, pace: 6.1, qm: 0.33, pct: 0.4, mat: 12, noHours: [1, 3, 4], expect: 'no_data' },

  /* Coming up */
  { n: 'J-1024', name: 'Frontier Aerospace RaaS install kits', client: 'FRONTIER', type: 'INSTALL', status: 'planned', start: 5, len: 15, crew: 0, pace: 3.2, planned: 420, qm: 0.36, mat: 22, deal: 'Frontier Aerospace: Robot-as-a-Service plan pilot', project: 'FRA' },
  { n: 'J-1025', name: 'Highline Freight spare kits for the first quarter', client: 'HIGHLINE', type: 'SPARE', status: 'planned', start: 8, len: 10, crew: 0, pace: 9, planned: 1800, qm: 0.32, mat: 8.5 },
];

export const northwindPlan: OrgPlan = {
  seed: 'northwind-2026',
  sites: [{ code: 'AUS1', name: 'Austin build cell', timezone: 'America/Chicago' }],
  defaultPartsOwner: 'us',
  roles: [
    { email: 'daniel@northwind-robotics.example', role: 'admin', seesMoney: true },
    { email: 'ethan@northwind-robotics.example', role: 'manager', seesMoney: true },
    { email: 'sofia@northwind-robotics.example', role: 'manager', seesMoney: true },
    { email: 'hannah@northwind-robotics.example', role: 'supervisor', seesMoney: false },
    { email: 'liam@northwind-robotics.example', role: 'supervisor', seesMoney: false },
    { email: 'aisha@northwind-robotics.example', role: 'viewer', seesMoney: true },
    { email: 'lucas@northwind-robotics.example', role: 'none' },
  ],
  classes: [
    { code: 'BUILD', name: 'Kit builder', color: 'blue', wage: 2100, raisePct: 4, taxBp: 900, benBp: 1400, overhead: 650, isDefault: true },
    { code: 'LEAD', name: 'Cell lead', color: 'purple', wage: 3100, raisePct: 4, taxBp: 900, benBp: 1400, overhead: 650, isLead: true },
    { code: 'TECH', name: 'Technician', color: 'teal', wage: 2900, raisePct: 4, taxBp: 900, benBp: 1400, overhead: 650 },
    { code: 'TEST', name: 'Tester', color: 'green', wage: 2600, raisePct: 3, taxBp: 900, benBp: 1400, overhead: 650 },
    { code: 'CONTRACT', name: 'Contract assembler', kind: 'temp_agency', color: 'orange', wage: 3400, raisePct: 12, taxBp: 0, benBp: 0, overhead: 650 },
  ],
  types: [
    { code: 'INSTALL', name: 'Install kit build', unit: 'kits', target: 3000, color: 'blue', icon: 'package', pace: 3.2, cls: 'BUILD' },
    { code: 'SPARE', name: 'Spare parts kit', unit: 'kits', target: 3000, color: 'teal', icon: 'boxes', pace: 9, cls: 'BUILD' },
    { code: 'FIELD', name: 'Field service kit', unit: 'kits', target: 3000, color: 'green', icon: 'briefcase', pace: 6, cls: 'BUILD' },
    { code: 'RETRO', name: 'Retrofit kit', unit: 'kits', target: 3000, color: 'indigo', icon: 'wrench', pace: 2.4, cls: 'BUILD' },
    { code: 'DEMO', name: 'Demo unit prep', unit: 'units', target: 2500, color: 'berry', icon: 'cpu', pace: 0.5, cls: 'TECH' },
    { code: 'REWORK', name: 'Rework', unit: 'units', target: 2500, color: 'orange', icon: 'undo', pace: 5, cls: 'BUILD' },
  ],
  services: [
    { code: 'LABEL', name: 'Labeling', unit: 'labels', price: '0.4500', cost: '0.0400', uph: 150, color: 'blue' },
    { code: 'FOAM', name: 'Foam cutting', unit: 'inserts', price: '3.2000', cost: '0.9000', uph: 28, color: 'gray' },
    { code: 'SERIAL', name: 'Serial capture', unit: 'scans', price: '0.6000', uph: 46, color: 'red' },
    { code: 'FIRMWARE', name: 'Firmware load', unit: 'units', price: '9.5000', uph: 8, cls: 'TECH', color: 'indigo' },
    { code: 'QC', name: 'Quality check', unit: 'kits', price: '2.4000', uph: 26, cls: 'TEST', color: 'green' },
    { code: 'CRATE', name: 'Crating', unit: 'crates', price: '95.0000', cost: '38.0000', uph: 0.9, color: 'brown' },
    { code: 'CALIB', name: 'Calibration', unit: 'units', price: '48.0000', uph: 1.5, cls: 'TEST', color: 'purple' },
    { code: 'EXPEDITE', name: 'Expedite', unit: 'orders', price: '180.0000', uph: 0.5, color: 'orange' },
    { code: 'KITTEST', name: 'Kit function test', unit: 'kits', price: '5.5000', uph: 13, cls: 'TEST', color: 'teal' },
    { code: 'DOCS', name: 'Document pack', unit: 'packs', price: '1.6000', cost: '0.3500', uph: 55, color: 'sky' },
  ],
  clients: [
    { code: 'FRONTIER', crmAccount: 'Frontier Aerospace', name: 'Frontier Aerospace', contact: 'Rachel Kim', email: 'rachel.kim@frontieraerospace.example', target: 3200, color: 'blue', notes: 'Clear forecasts, on time parts approvals. A star account.' },
    { code: 'EVERGREEN', crmAccount: 'Evergreen Retail Group', name: 'Evergreen Retail Group', contact: 'Tom Alvarez', email: 'tom.alvarez@evergreenretail.example', color: 'green', notes: 'Two won deals this year. Steady repeat kit work. A star account.' },
    { code: 'LAKESHORE', crmAccount: 'Lakeshore Components', name: 'Lakeshore Components', contact: 'Greta Olsen', email: 'greta.olsen@lakeshorecomponents.example', target: 2400, color: 'red', terms: 60, notes: 'Large account with thin prices, many warranty claims and rush shipments.' },
    { code: 'COBALT', crmAccount: 'Cobalt Foods', name: 'Cobalt Foods', contact: 'Miguel Santos', email: 'miguel.santos@cobaltfoods.example', color: 'indigo' },
    { code: 'ORION', crmAccount: 'Orion Fulfillment', name: 'Orion Fulfillment', contact: 'Dee Walker', email: 'dee.walker@orionfulfillment.example', color: 'purple' },
    { code: 'HIGHLINE', crmAccount: 'Highline Freight', name: 'Highline Freight', contact: 'Sam Whitaker', email: 'sam.whitaker@highlinefreight.example', color: 'teal' },
    { code: 'BLUESTONE', crmAccount: 'Bluestone Foods', name: 'Bluestone Foods', contact: 'Ines Duarte', email: 'ines.duarte@bluestonefoods.example', color: 'sky' },
    { code: 'DRIFTWOOD', crmAccount: 'Driftwood Freight', name: 'Driftwood Freight', contact: 'Paul Becker', email: 'paul.becker@driftwoodfreight.example', color: 'brown' },
  ],
  items: [
    { sku: 'RK-HARNESS', name: 'Retrofit wiring harness', cost: '19.5000', by: 'us' },
    { sku: 'RK-BRACKET', name: 'Sensor bracket', cost: '4.2000', by: 'us' },
    { sku: 'RK-FASTEN', name: 'Fastener pack', uom: 'pack', cost: '3.1000', by: 'us' },
    { sku: 'SP-BELT', name: 'Drive belt', cost: '6.4000', by: 'us' },
    { sku: 'SP-FUSE', name: 'Fuse 10 A', cost: '0.6500', by: 'us' },
  ],
  jobs,
  closed: [-38],
  companyCosts: [
    { cat: 'rent', cents: 1_150_000, vendor: 'Tech Ridge Commerce Park' },
    { cat: 'utilities', cents: 190_000, vendor: 'Austin Energy' },
    { cat: 'equipment', cents: 310_000, vendor: 'Benchmark Tooling', note: 'Test benches and torque tools' },
    { cat: 'salaried_staff', cents: 1_900_000, vendor: 'Payroll', note: 'Planning, purchasing and quality' },
    { cat: 'insurance', cents: 160_000, vendor: 'Lone Star Mutual' },
    { cat: 'other', cents: 95_000, vendor: 'Software and supplies' },
  ],
  clientCosts: [
    { client: 'LAKESHORE', cat: 'rework', cents: 640_000, at: -50, vendor: 'Warranty', note: 'Replaced 40 retrofit kits under warranty at no charge' },
    { client: 'LAKESHORE', cat: 'freight', cents: 380_000, at: -41, vendor: 'Lone Star Air Freight', note: 'Next day air we paid for to cover a late parts approval' },
    { client: 'LAKESHORE', cat: 'outside_service', cents: 520_000, at: -33, vendor: 'Field visit', note: 'Two day site visit to sort out a kit mix up' },
    { client: 'LAKESHORE', cat: 'rework', cents: 710_000, at: -19, vendor: 'Warranty', note: 'Second warranty batch: wrong bracket revision' },
    { client: 'LAKESHORE', cat: 'freight', cents: 440_000, at: -12, vendor: 'Lone Star Air Freight', note: 'Rush shipment for the DC6 go live' },
    { client: 'LAKESHORE', cat: 'outside_service', cents: 480_000, at: -5, vendor: 'Field visit', note: 'On site rework support for a week' },
    { client: 'LAKESHORE', cat: 'storage', cents: 150_000, at: -3, vendor: 'Cage storage', note: 'Parts held for three months at no charge' },
    { client: 'LAKESHORE', cat: 'rework', cents: 920_000, at: -27, vendor: 'Warranty', note: 'Third warranty batch: harness pinout changed after we built' },
    { client: 'LAKESHORE', cat: 'salaried_staff', cents: 680_000, at: -24, vendor: 'Payroll', note: 'Engineer on loan to Lakeshore for three weeks' },
    { client: 'LAKESHORE', cat: 'freight', cents: 510_000, at: -8, vendor: 'Lone Star Air Freight', note: 'Air freight for the controller rework' },
    { client: 'LAKESHORE', cat: 'other', cents: 880_000, at: -15, vendor: 'Contract penalty', note: 'Late delivery penalty on the DC6 retrofit' },
    { client: 'LAKESHORE', cat: 'outside_service', cents: 1_240_000, at: -36, vendor: 'Third party lab', note: 'Outside test lab to prove the retrofit kits met spec' },
    { client: 'COBALT', cat: 'freight', cents: 42_000, at: -20, vendor: 'Lone Star Air Freight', note: 'Sample kit to the plant' },
    { client: 'EVERGREEN', cat: 'supplies', cents: 26_000, at: -15, vendor: 'Uline', note: 'Demo cases for the store walk' },
  ],
  clientVas: [
    { client: 'LAKESHORE', svc: 'EXPEDITE', every: 6, qty: 2, price: '90.0000' },
    { client: 'FRONTIER', svc: 'CALIB', every: 7, qty: 6 },
    { client: 'EVERGREEN', svc: 'QC', every: 8, qty: 60 },
    { client: 'ORION', svc: 'FOAM', every: 9, qty: 40 },
  ],
  clientFees: [
    { client: 'FRONTIER', kind: 'fee', every: 21, cents: 150_000, desc: 'Monthly program fee' },
    { client: 'EVERGREEN', kind: 'fee', every: 21, cents: 110_000, desc: 'Monthly program fee' },
  ],
  indirect: [
    { reason: 'cleanup', share: 0.4 },
    { reason: 'training', share: 0.3, note: 'New builder training' },
    { reason: 'waiting', share: 0.3, note: 'Waiting on parts from purchasing' },
    { reason: 'maintenance', share: 0.2, note: 'Bench and tool checks' },
    { reason: 'meeting', share: 0.15 },
  ],
  goals: [
    { scope: 'org', metric: 'margin_pct', value: '30' },
    { scope: 'org', metric: 'profit', value: '45000', monthly: true },
    { scope: 'org', metric: 'revenue', value: '160000', monthly: true },
    { scope: 'org', metric: 'utilization_pct', value: '85' },
    { scope: 'client', ref: 'FRONTIER', metric: 'margin_pct', value: '34' },
    { scope: 'client', ref: 'EVERGREEN', metric: 'margin_pct', value: '32' },
    { scope: 'client', ref: 'LAKESHORE', metric: 'margin_pct', value: '20' },
    { scope: 'job_type', ref: 'INSTALL', metric: 'units_per_labor_hour', value: '3.2' },
    { scope: 'vas_service', ref: 'SERIAL', metric: 'margin_pct', value: '30' },
  ],
  views: [
    { page: 'jobs', name: 'Losing money or at risk', config: { tab: 'open', risk: ['losing', 'at_risk'], sort: 'projectedProfit', direction: 'asc' }, isDefault: true },
    { page: 'jobs', name: 'Jobs from won deals', config: { tab: 'all', link: 'crm_deal', sort: 'startDate', direction: 'desc' } },
    { page: 'profit', name: 'Clients this quarter, worst first', config: { by: 'client', range: 'this_quarter', sort: 'profit', direction: 'asc', compare: true } },
    { page: 'profit', name: 'Extra services, last 30 days', config: { by: 'service', range: 'last_30_days', sort: 'margin', direction: 'asc' } },
    { page: 'alerts', name: 'Mine, still open', config: { status: 'open', assignedTo: 'me' }, shared: false },
  ],
  clientNotes: [
    { client: 'LAKESHORE', body: 'Account review: second largest by revenue, yet warranty swaps, rush freight and site visits take more than the jobs earn. Bring the cost to serve page to the renewal call.' },
    { client: 'FRONTIER', body: 'Frontier signed the RaaS pilot. Install kits start next week, same kit as phase 2.' },
    { client: 'EVERGREEN', body: 'Evergreen wants a standing field service kit order from January.' },
  ],
};
