import { z } from 'zod';
import { listKioskJobs } from '@/server/domain';
import { kioskRoute, kioskToken } from '../_kiosk';

/** The job cards of an unlocked tablet. */
export const POST = kioskRoute(
  z.object({ token: kioskToken, session: z.string().min(20).max(400) }),
  { limit: 60 },
  (data) => listKioskJobs(data.token, data.session),
);
