import { z } from 'zod';
import { getKioskState } from '@/server/domain';
import { DomainError } from '@/server/errors';
import { kioskRoute, kioskToken } from '../_kiosk';

/** The lock screen of a floor tablet: site, today and the names that can unlock it. */
export const POST = kioskRoute(z.object({ token: kioskToken }), { limit: 60 }, async (data) => {
  const state = await getKioskState(data.token);
  if (!state) throw new DomainError('NOT_FOUND', 'This link is not active. Ask a manager to make a new one.');
  return state;
});
