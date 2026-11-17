import { apiRoute } from '@/server/http/api';
import { myKioskPinState } from '@/server/domain';

/** Whether the signed in person has a kiosk PIN. The PIN itself can never be read. */
export const GET = apiRoute(async ({ ctx }) => myKioskPinState(ctx));
