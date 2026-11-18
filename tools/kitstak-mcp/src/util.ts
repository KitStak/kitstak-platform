/** Helpers shared by every module's tools. */
import { z } from 'zod';
import { MAX_LIMIT } from './config.js';

export const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

export function json(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

export function fail(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}

/** An ILIKE pattern matching `q` literally anywhere. */
export function like(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export const limitArg = z
  .number()
  .int()
  .min(1)
  .max(MAX_LIMIT)
  .optional()
  .describe(`Max rows (default 50, max ${MAX_LIMIT}).`);

export const dateArg = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}/)
  .optional();

/** Strips HTML tags and collapses whitespace (rich-text descriptions). */
export function plainText(html: string | null | undefined, max = 2_000): string | null {
  if (!html) return null;
  const text = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
}
