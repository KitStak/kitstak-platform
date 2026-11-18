import { z } from 'zod';
import { unlockKiosk } from '@/server/domain';
import { kioskRoute, kioskToken } from '../_kiosk';

/** Name plus PIN gives a 12 hour kiosk session for one site and the job cards. */
export const POST = kioskRoute(
  z.object({ token: kioskToken, userId: z.guid(), pin: z.string().regex(/^\d{4}$/, 'Type 4 digits.') }),
  { limit: 20 },
  (data) => unlockKiosk(data.token, { userId: data.userId, pin: data.pin }),
);
