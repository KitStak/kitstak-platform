/**
 * Brand copy rule: no em dashes and no double dashes in anything a person reads. This scans the
 * UI source (string literals and JSX text, comments stripped) and the seed data that renders on
 * almost every page.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');
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

  it('has no en dashes in UI source (ranges read "to": "A to Z", "2 to 10")', () => {
    const files = [...walk(path.join(ROOT, 'features')), ...walk(path.join(ROOT, 'components')), ...walk(path.join(ROOT, 'app'))];
    const offenders = files.filter((file) => stripComments(readFileSync(file, 'utf8')).includes(EN_DASH)).map((file) => path.relative(ROOT, file));
    expect(offenders).toEqual([]);
  });

  it('has no double dashes in seed copy', () => {
    const offenders = walk(path.join(ROOT, 'server/db/seed/data')).filter((file) => / -- |\w--\w/.test(stripComments(readFileSync(file, 'utf8'))));
    expect(offenders.map((file) => path.relative(ROOT, file))).toEqual([]);
  });

  it('keeps the program word list out of program UI copy (SPEC 1.4)', () => {
    const offenders = programCopyFiles().flatMap((file) =>
      bannedProgramWords(readFileSync(file, 'utf8')).map((hit) => `${path.relative(ROOT, file)}: "${hit.word}" in "${hit.text}"`),
    );
    expect(offenders).toEqual([]);
  });

  it('has no double dashes in program UI copy', () => {
    const offenders = programCopyFiles().flatMap((file) =>
      uiCopy(readFileSync(file, 'utf8'))
        .filter((text) => / -- |\w--\w/.test(text))
        .map((text) => `${path.relative(ROOT, file)}: "${text}"`),
    );
    expect(offenders).toEqual([]);
  });

  it('reads UI copy, not code identifiers, when it checks the word list', () => {
    const source = [
      "const line = { prorate: true, runRateCents: 0, usage: 'usage' };",
      "const label = 'Prorate the fee';",
      'const html = <p className="pace-x">Keep the pace</p>;',
      "const tip = `Revenue posts to ${name}`;",
      '// prorate in a comment is fine',
      "const ok = 'Charge part of it in a partial month';",
    ].join('\n');
    expect(bannedProgramWords(source).map((hit) => hit.word.toLowerCase()).sort()).toEqual(['pace', 'posts to', 'prorate']);
  });
});

/** SPEC 1.4: words program UI copy never uses (case insensitive, whole word). */
const PROGRAM_BANNED_WORDS = ['true up', 'true-up', 'prorate', 'prorated', 'posts to', 'run rate', 'pace', 'reprice', 'repriced', 'price source', 'usage'] as const;
const BANNED_RE = new RegExp(`(?<![A-Za-z0-9_-])(${PROGRAM_BANNED_WORDS.map((word) => word.replace(/[-\s]/g, (c) => (c === '-' ? '\\-' : '\\s+'))).join('|')})(?![A-Za-z0-9_-])`, 'gi');

/** Files that hold program UI copy: the program folders, and program parts of shared folders. */
function programCopyFiles(): string[] {
  const own = [path.join(ROOT, 'features/programs'), path.join(ROOT, 'app/(app)/programs')].flatMap((dir) => walk(dir));
  const shared = ['views', 'task', 'my-work', 'quick-add', 'home', 'shell', 'command']
    .flatMap((folder) => walk(path.join(ROOT, 'features', folder)))
    .filter((file) => /(program|build|floor|(^|-)runs?[-.])/i.test(path.basename(file)));
  return [...new Set([...own, ...shared])];
}

/**
 * The text a person can read in a TS or TSX source: string and template literals (template
 * expressions removed) and JSX text, comments stripped. Literals that look like identifiers or
 * keys (one lower case token such as 'prorate' or 'per_unit') are code, not copy.
 */
function uiCopy(source: string): string[] {
  const code = stripComments(source);
  const out: string[] = [];
  const literal = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
  for (const match of code.matchAll(literal)) {
    const text = (match[1] ?? match[2] ?? (match[3] ?? '').replace(/\$\{[^}]*\}/g, ' ')).trim();
    if (text && !/^[a-z][A-Za-z0-9_.:/-]*$/.test(text)) out.push(text);
  }
  for (const match of code.matchAll(/>([^<>{}]+)</g)) {
    const text = (match[1] ?? '').trim();
    if (text && /[A-Za-z]/.test(text) && !/[=;()]/.test(text)) out.push(text);
  }
  return out;
}

function bannedProgramWords(source: string): { word: string; text: string }[] {
  return uiCopy(source).flatMap((text) => [...text.matchAll(BANNED_RE)].map((match) => ({ word: match[1] ?? match[0], text })));
}
