import { apiRoute } from '@/server/http/api';
import { getProgramsAvailability } from '@/server/domain';

/** Whether the program tracker can be shown (`ProgramsAvailabilityDTO`): hide the nav item and pages when `available` is false. */
export const GET = apiRoute(async ({ ctx }) => getProgramsAvailability(ctx));
