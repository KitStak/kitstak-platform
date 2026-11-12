/**
 * Catch-all for unknown `/api/*` paths: answers the JSON error envelope (404 NOT_FOUND)
 * for every method instead of Next's HTML 404 page, so API clients never parse HTML.
 * Specific routes always win over this optional segment.
 */
import { notFoundError } from '@/server/api/errors';
import { jsonError } from '@/server/api/envelope';

function notFound(): Response {
  return jsonError(notFoundError('API route'));
}

export const GET = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
