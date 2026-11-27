import { apiRoute } from '@/server/http/api';
import { oneOf } from '@/server/http/params';
import { listSavedViews } from '@/server/domain';
import { SAVED_VIEW_PAGES } from '@/lib/constants';

/** The caller's saved views plus shared ones. `?page=jobs|profit|log|labor|reports|alerts`. */
export const GET = apiRoute(async ({ ctx, searchParams }) => listSavedViews(ctx, oneOf(searchParams, 'page', SAVED_VIEW_PAGES)));
