/**
 * Scheduler task "kit-inventory-recalc" (M08; replaces the 0.6 stub). Rewrites
 * `kit_inventory_stats` every 15 minutes; the Kit Inventory report also offers Recalculate Now.
 */
import { KIT_RECALC_EVERY_MS } from '@/lib/grid-defs/work-orders/kits';
import { recalcKitInventory } from '@/server/repositories/kits';
import type { SchedulerTask } from '../types';

export const task: SchedulerTask = {
  key: 'kit-inventory-recalc',
  title: 'Kit inventory recalculation',
  owner: 'M08',
  configured: true,
  schedule: { kind: 'interval', everyMs: KIT_RECALC_EVERY_MS },
  run: async ({ db, now }) => {
    const result = await recalcKitInventory(db, now);
    return { status: 'ok', message: `${result.rows} kit rows recalculated` };
  },
};
