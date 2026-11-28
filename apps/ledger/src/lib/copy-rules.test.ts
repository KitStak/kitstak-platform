/**
 * Brand copy rule: no em dashes and no double dashes in anything a person reads. This scans the
 * UI source (string literals and JSX text, comments stripped): features, components, app and lib,
 * plus the seed data once it exists.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');
const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);

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

const UI_DIRS = ['features', 'components', 'app', 'lib'];
/** The dash cleaner names the characters it removes (regex literals), so it is not copy. */
const NOT_COPY = new Set([path.join(ROOT, 'lib', 'undash.ts')]);
const uiFiles = (): string[] => UI_DIRS.flatMap((dir) => walk(path.join(ROOT, dir))).filter((file) => !NOT_COPY.has(file));
const seedDir = path.join(ROOT, 'server/db/seed');
const seedFiles = (): string[] => (existsSync(seedDir) ? walk(seedDir) : []);

/** Text a person reads: string and template literals plus JSX text, with code stripped away. */
function readableText(source: string): string {
  const clean = stripComments(source);
  const strings = clean.match(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g) ?? [];
  const jsxText = clean.match(/>[^<>{}]+</g) ?? [];
  return [...strings, ...jsxText].join('\n');
}

describe('copy rules', () => {
  it('has no em dashes in UI source or seed data', () => {
    const offenders = [...uiFiles(), ...seedFiles()].filter((file) => stripComments(readFileSync(file, 'utf8')).includes(EM_DASH)).map((file) => path.relative(ROOT, file));
    expect(offenders).toEqual([]);
  });

  it('has no en dashes in UI source (ranges read "to": "A to Z", "2 to 10")', () => {
    const offenders = uiFiles().filter((file) => stripComments(readFileSync(file, 'utf8')).includes(EN_DASH)).map((file) => path.relative(ROOT, file));
    expect(offenders).toEqual([]);
  });

  it('has no double dashes in anything a person reads', () => {
    // CSS custom properties (`var(--x)`, `[--x:1]`, `--tw-`) are code, not copy.
    const offenders = [...uiFiles(), ...seedFiles()]
      .filter((file) =>
        readableText(readFileSync(file, 'utf8'))
          .split('\n')
          .some((line) => /(^|[\s\w.,;:!?])--(?=[\s\w]|$)/.test(line.replace(/var\(--[\w-]+(?:,[^)]*)?\)|\[--[\w-]+[^\]]*\]|--[a-z][\w-]*/g, ''))),
      )
      .map((file) => path.relative(ROOT, file));
    expect(offenders).toEqual([]);
  });
});

/**
 * SPEC section 0: KitStak's own plan is never shown in Ledger. "Billing" is a Portal word; Ledger
 * says "invoicing". Allowed: the chart account the spec names ("Software and subscriptions") and
 * the core role name `billing`, which is code.
 */
describe('Ledger words', () => {
  const ALLOWED = [/Software and subscriptions/g, /'billing'/g, /`billing`/g];
  it('never says billing or subscription on screen', () => {
    const offenders = uiFiles().filter((file) => {
      let text = readableText(readFileSync(file, 'utf8'));
      for (const pattern of ALLOWED) text = text.replace(pattern, '');
      return /\bbilling\b|\bsubscriptions?\b/i.test(text);
    });
    expect(offenders.map((file) => path.relative(ROOT, file))).toEqual([]);
  });
});
