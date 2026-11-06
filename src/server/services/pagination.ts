/**
 * Opaque cursor pagination. Cursors are base64url JSON tuples validated with Zod on decode,
 * so a tampered cursor yields a 400 instead of a malformed query.
 */
import { z } from 'zod';
import { BadRequestError } from '@/server/http/errors';

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 500;

export const paginationQuerySchema = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export interface Page<T> {
  readonly items: T[];
  readonly nextCursor: string | null;
}

export function encodeCursor(values: readonly (string | number)[]): string {
  return Buffer.from(JSON.stringify(values), 'utf8').toString('base64url');
}

export function decodeCursor<S extends z.ZodType>(cursor: string | undefined, schema: S): z.output<S> | null {
  if (!cursor) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    const result = schema.safeParse(parsed);
    if (result.success) return result.data;
  } catch {
    // fall through
  }
  throw new BadRequestError('The pagination cursor is invalid or expired');
}

/** Cursor for `(timestamp desc, id desc)` feeds. */
export const timeIdCursorSchema = z.tuple([z.iso.datetime(), z.uuid()]);

/**
 * Given `limit + 1` fetched rows, return the page and the cursor built from the last row.
 */
export function toPage<T>(rows: T[], limit: number, cursorOf: (row: T) => string): Page<T> {
  if (rows.length <= limit) return { items: rows, nextCursor: null };
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return { items, nextCursor: last ? cursorOf(last) : null };
}
