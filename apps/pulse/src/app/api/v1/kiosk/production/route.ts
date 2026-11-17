import { z } from 'zod';
import { saveKioskProduction } from '@/server/domain';
import { headcount, hours, isoDate, quantity, text } from '@/server/actions/schemas';
import { kioskRoute, kioskToken } from '../_kiosk';

const schema = z.object({
  token: kioskToken,
  session: z.string().min(20).max(400),
  clientRef: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  jobId: z.guid(),
  workDate: isoDate.nullable().optional(),
  unitsGood: quantity,
  unitsScrap: quantity.optional(),
  headcount,
  hoursEach: hours,
  note: text(500).nullable().optional(),
});

/** Saves one tablet entry. The `clientRef` makes a retry safe: the same entry is never logged twice. */
export const POST = kioskRoute(schema, { limit: 120 }, ({ token, session, ...entry }) => saveKioskProduction(token, session, entry));
