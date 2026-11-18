import { apiRoute } from '@/server/http/api';
import { listReportSchedules } from '@/server/domain';

/** Report schedules of the workspace (`ReportScheduleDTO[]`). Schedules that build money are left out for readers without `money:read`. */
export const GET = apiRoute(async ({ ctx }) => listReportSchedules(ctx));
