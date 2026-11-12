import { isApiError } from '@/lib/api-client';

/** How long a user create / save may take before the drawer gives up and offers Retry. */
export const SAVE_TIMEOUT_MS = 20_000;

/** Plain-language reason a user save failed, shown in the drawer's Retry panel. */
export function describeSaveError(error: unknown, timedOut: boolean): string {
  if (timedOut) return "The server didn't respond in time.";
  if (isApiError(error)) {
    if (error.status === 0) return "Couldn't reach the server. Check your connection.";
    if (error.status >= 500) return 'The server hit an error. Try again in a moment.';
    return error.message;
  }
  if (error instanceof TypeError) return "Couldn't reach the server. Check your connection.";
  return 'Something went wrong.';
}

/** Field validation and stale-version errors are shown on the form; everything else gets the Retry panel. */
export function needsRetryPanel(error: unknown): boolean {
  if (!isApiError(error)) return true;
  return error.code !== 'CONFLICT' && Object.keys(error.fieldErrors).length === 0;
}
