/**
 * Pickers come from the KitStak primitives, never from the browser: `Select` or `GridSelect` for a
 * list and `IsoDatePicker` or `DatePicker` for a day. A native `<select>` or date input looks and
 * behaves differently on every device and does not match the rest of the app. This scans the UI
 * source so one cannot slip back in.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx$/.test(name) && !/\.test\.tsx$/.test(name)) out.push(full);
  }
  return out;
}

const stripComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"'`])\/\/.*$/gm, '$1');

const NATIVE: readonly { readonly what: string; readonly pattern: RegExp }[] = [
  { what: 'a native <select>', pattern: /<select[\s>]/ },
  { what: 'a native date input', pattern: /type=(?:"|'|\{')(?:date|month|week|datetime-local)/ },
  { what: 'an input whose type can turn into a native date input', pattern: /type=\{[^}]*'date'[^}]*\}/ },
];

describe('native pickers', () => {
  it('no screen draws a native select or a native date input', () => {
    const found: string[] = [];
    for (const file of ['features', 'components', 'app'].flatMap((dir) => walk(path.join(ROOT, dir)))) {
      const source = stripComments(readFileSync(file, 'utf8'));
      for (const { what, pattern } of NATIVE) if (pattern.test(source)) found.push(`${path.relative(ROOT, file)}: ${what}`);
    }
    expect(found).toEqual([]);
  });
});
