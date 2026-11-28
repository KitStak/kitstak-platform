/**
 * One writer of the books (docs/ledger/SPEC.md 4.3): no file but posting.ts inserts journal rows,
 * through Drizzle or raw SQL. The ESLint rule covers Drizzle inserts; this scan covers SQL text.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');
const WRITER = path.join(ROOT, 'server', 'domain', 'posting.ts');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

describe('one writer of journal rows', () => {
  it('only posting.ts inserts into journal_entries or journal_lines', () => {
    const offenders = walk(ROOT)
      .filter((file) => file !== WRITER)
      .filter((file) => {
        const text = readFileSync(file, 'utf8');
        return /insert\s+into\s+"?ledger"?\."?journal_(entries|lines)/i.test(text) || /\.insert\(\s*journal(Entries|Lines)\b/.test(text);
      })
      .map((file) => path.relative(ROOT, file));
    expect(offenders).toEqual([]);
  });

  it('posting.ts is the writer it claims to be', () => {
    const text = readFileSync(WRITER, 'utf8');
    expect(text).toMatch(/\.insert\(journalEntries\)/);
    expect(text).toMatch(/\.insert\(journalLines\)/);
    expect(text).toMatch(/pg_advisory_xact_lock/);
  });
});
