/**
 * Scheduled report delivery (M13): every 5 minutes, deliver each active report schedule whose
 * next run is due (XLSX / CSV into Excel Export History plus an emailed link). Logic lives in
 * `src/server/repositories/reports-schedules.ts`.
 */
import { runDueSchedules } from '@/server/repositories/reports-schedules';
import type { SchedulerTask } from '../types';

export const reportSchedulesTask: SchedulerTask = {
  key: 'report-schedules',
  title: 'Scheduled report delivery',
  owner: 'M13',
  configured: true,
  schedule: { kind: 'interval', everyMs: 5 * 60 * 1000 },
  run: async (ctx) => {
    const r = await runDueSchedules(ctx.db, ctx.now);
    if (r.delivered === 0 && r.failed === 0) return { status: 'skipped', message: 'No schedules due' };
    return { status: 'ok', message: `Delivered ${r.delivered} scheduled report(s); ${r.failed} failed` };
  },
};
