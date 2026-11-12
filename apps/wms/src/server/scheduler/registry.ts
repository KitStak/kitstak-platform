/** Every scheduler task. Stubs (0.6) are listed so health/admin views can show them. */
import { exportsCleanupTask } from './tasks/exports-cleanup';
import { snapshotTask } from './tasks/snapshot';
import { reportSchedulesTask } from './tasks/report-schedules';
import { task as billingPeriods } from './tasks/billing-periods';
import { task as channelMethods } from './tasks/channel-methods';
import { task as kitInventoryRecalc } from './tasks/kit-inventory-recalc';
import { task as waveRules } from './tasks/wave-rules';
import { task as eodAutoClose } from './tasks/eod-auto-close';
import type { SchedulerTask } from './types';

export const SCHEDULER_TASKS: readonly SchedulerTask[] = Object.freeze([
  snapshotTask,
  exportsCleanupTask,
  waveRules,
  channelMethods,
  billingPeriods,
  kitInventoryRecalc,
  eodAutoClose,
  reportSchedulesTask,
]);
