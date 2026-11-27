/**
 * KitStak org program (docs/programs/SPEC.md 7.2): TEES for the core customer Apex Threads Co.
 * Variant M uses the WMS kit APX-KIT-TEE3, and its daily qty is 40 percent of what WMS can kit
 * (rounded up to 10), so a planned week is more than WMS can build and the planner tint shows.
 */
import type { OrgProgramsSeed } from '../program-types';

/** `capacity` is the seeded WMS net kitting capacity of APX-KIT-TEE3 (summed over warehouses). */
export function kitstakPrograms(capacity: number): OrgProgramsSeed {
  const mQty = String(Math.max(10, Math.ceil((capacity * 0.4) / 10) * 10));
  return {
    slug: 'kitstak',
    me: 'mike',
    people: {
      mike: 'admin@kitstak.io',
      renata: 'ops.manager@kitstak.io',
      thao: 't.nguyen@kitstak.io',
    },
    calendar: { timezone: 'America/Chicago', workingDays: [1, 2, 3, 4, 5], dailyCapacityHours: '64' },
    programs: [
      {
        key: 'TEES',
        name: 'Tee bundle kitting',
        description: 'Three tee bundles for Apex Threads Co., kitted every weekday from stock in the main warehouse.',
        coreCustomer: 'APX',
        unit: { singular: 'kit', plural: 'kits' },
        workingDays: null,
        startOffset: -30,
        color: 'purple',
        icon: 'shirt',
        targetCents: '1000000',
        variants: [
          { key: 'M', name: 'Tee bundle M', sku: 'APX-KIT-TEE3', defaultQty: mQty, coreItemSku: 'APX-KIT-TEE3', stdMinutes: '0.8' },
          { key: 'L', name: 'Tee bundle L', sku: 'APX-TEE-L', defaultQty: '150', stdMinutes: '0.8' },
          { key: 'XL', name: 'Tee bundle XL', sku: 'APX-TEE-XL', defaultQty: '150', stdMinutes: '0.8' },
        ],
        card: {
          lines: [
            { kind: 'per_unit', unitPrice: '1.20' },
            { kind: 'flat_monthly', amountCents: '50000', prorate: true },
          ],
          rules: [],
        },
        schedule: {
          name: 'Weekday tee run',
          pattern: 'weekdays',
          days: [],
          leadDays: 7,
          lines: [
            { variantKey: 'M', qty: mQty },
            { variantKey: 'L', qty: '150' },
            { variantKey: 'XL', qty: '150' },
          ],
        },
        owner: 'mike',
        members: [{ who: 'renata', role: 'editor' }],
        prepTasks: [
          { title: 'Check the M bundle components before Monday', who: 'renata', due: 2, comments: [['renata', 'WMS shows the M bundle short on blank tees for the full week. Ordering more today.']] },
          { title: 'New poly bags for the XL bundle', who: 'thao', due: -6, done: true },
        ],
        async day(api) {
          if (!api.isWorkDay(api.date) || api.isToday) return;
          const builds = await api.builds();
          await api.log(builds.filter((b) => !b.done).map((b) => ({ buildId: b.id, qty: b.plannedQty, done: true })));
        },
      },
    ],
    async finish(api) {
      await api.linkKit('TEES', 'M', 'APX-KIT-TEE3');
    },
  };
}
