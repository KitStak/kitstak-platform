/**
 * The copy rules for every portal screen (docs/billing/SPEC.md section 0): no em dash, no en dash, no
 * double dash, no "coming soon" and no lorem ipsum in anything a person reads. This scans string
 * literals and JSX text of the portal source, with comments stripped. The rule set is the same one
 * `packages/billing/tests/copy-rules.test.ts` applies to the billing package and the shared banner.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(__dirname, '..');
const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

/** Drops block and line comments. A `//` after a colon or inside a quote is a URL, not a comment. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"'`\\])\/\/.*$/gm, '$1');
}

/** Text a person reads: string and template literals plus JSX text. */
function readableText(source: string): string[] {
  const clean = stripComments(source);
  const strings = clean.match(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g) ?? [];
  const jsxText = clean.match(/>[^<>{}]+</g) ?? [];
  return [...strings, ...jsxText];
}

/** CSS custom properties (`var(--x)`, `[--x:1]`, `--tw-x`) are code, not copy. */
function withoutCssVariables(line: string): string {
  return line.replace(/var\(--[\w-]+(?:,[^)]*)?\)|\[--[\w-]+[^\]]*\]|--[a-z][\w-]*/g, '');
}

const UI_DIRS = ['app', 'components', 'features', 'lib', 'server'];
const files = UI_DIRS.flatMap((dir) => walk(path.join(SRC, dir)));
const shown = (file: string) => path.relative(SRC, file);

interface Problem {
  readonly file: string;
  readonly sample: string;
}

function linesMatching(test: (line: string) => boolean): Problem[] {
  const problems: Problem[] = [];
  for (const file of files) {
    for (const text of readableText(readFileSync(file, 'utf8'))) {
      for (const line of text.split('\n')) {
        if (test(line)) problems.push({ file: shown(file), sample: line.trim().slice(0, 120) });
      }
    }
  }
  return problems;
}

describe('portal copy rules', () => {
  it('scans the whole portal source', () => {
    expect(files.length).toBeGreaterThan(80);
    // The signup and billing screens are in the scan.
    for (const part of ['app/(auth)/signup', 'app/(app)/billing', 'features/billing', 'app/dev/outbox', 'features/billing-activity']) {
      expect(files.some((file) => shown(file).split(path.sep).join('/').startsWith(part)), part).toBe(true);
    }
  });

  it('has no em dash anywhere outside comments', () => {
    const offenders = files.filter((file) => stripComments(readFileSync(file, 'utf8')).includes(EM_DASH)).map(shown);
    expect(offenders).toEqual([]);
  });

  it('has no en dash anywhere outside comments (ranges read "to": "1 to 3 months")', () => {
    const offenders = files.filter((file) => stripComments(readFileSync(file, 'utf8')).includes(EN_DASH)).map(shown);
    expect(offenders).toEqual([]);
  });

  it('has no double dash in anything a person reads', () => {
    expect(linesMatching((line) => /(^|[\s\w.,;:!?])--(?=[\s\w]|$)/.test(withoutCssVariables(line)))).toEqual([]);
  });

  it('never says "coming soon" and has no placeholder text', () => {
    expect(linesMatching((line) => /coming soon/i.test(line))).toEqual([]);
    expect(linesMatching((line) => /\blorem\b|\bipsum\b/i.test(line))).toEqual([]);
  });
});
