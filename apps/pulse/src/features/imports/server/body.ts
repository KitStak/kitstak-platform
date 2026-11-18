/** Reads and checks the JSON body of an import route. Problems come back as a plain 422. */
import 'server-only';
import type { z } from 'zod';
import { DomainError } from '@/server/errors';
import { readJson } from '@/server/http/api';

export async function parseBody<S extends z.ZodType>(request: Request, schema: S): Promise<z.output<S>> {
  const parsed = schema.safeParse(await readJson(request));
  if (parsed.success) return parsed.data;
  const fields: Record<string, string> = {};
  for (const issue of parsed.error.issues) fields[issue.path.join('.') || 'form'] ??= issue.message;
  throw new DomainError('VALIDATION', 'Some of what was sent needs another look.', fields);
}
