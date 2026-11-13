/**
 * Brand copy rule: no em dashes and no double dashes in anything a person reads. This scans the
 * UI source (string literals and JSX text, comments stripped) and the seed data that renders on
 * almost every page.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');
const EM_DASH = String.fromCharCode(0x2014);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

/** Drops block and line comments (good enough for our sources: no `//` inside UI strings). */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"'`])\/\/.*$/gm, '$1');
}

describe('copy rules', () => {
  it('has no em dashes in UI source or seed data', () => {
    const files = [...walk(path.join(ROOT, 'features')), ...walk(path.join(ROOT, 'components')), ...walk(path.join(ROOT, 'app')), ...walk(path.join(ROOT, 'server/db/seed'))];
    const offenders = files.filter((file) => stripComments(readFileSync(file, 'utf8')).includes(EM_DASH)).map((file) => path.relative(ROOT, file));
    expect(offenders).toEqual([]);
  });

  it('has no double dashes in seed copy', () => {
    const offenders = walk(path.join(ROOT, 'server/db/seed/data')).filter((file) => / -- |\w--\w/.test(stripComments(readFileSync(file, 'utf8'))));
    expect(offenders.map((file) => path.relative(ROOT, file))).toEqual([]);
  });
});
