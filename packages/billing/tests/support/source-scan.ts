/**
 * Reads source files the way a person reads a screen: string literals, template literals and JSX
 * text, with comments and code stripped away. The copy rules tests scan with this.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

export function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

/** Drops block and line comments (good enough for our sources: no `//` inside UI strings but URLs). */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"'`\\])\/\/.*$/gm, '$1');
}

/** Text a person reads: string and template literals plus JSX text. */
export function readableText(source: string): string[] {
  const clean = stripComments(source);
  const strings = clean.match(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g) ?? [];
  const jsxText = clean.match(/>[^<>{}]+</g) ?? [];
  return [...strings, ...jsxText];
}

/** CSS custom properties (`var(--x)`, `[--x:1]`, `--tw-x`) and SQL comments are code, not copy. */
export function withoutCssVariables(line: string): string {
  return line.replace(/var\(--[\w-]+(?:,[^)]*)?\)|\[--[\w-]+[^\]]*\]|--[a-z][\w-]*/g, '');
}

export interface SourceProblem {
  readonly file: string;
  readonly rule: string;
  readonly sample: string;
}

const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);
const DOUBLE_DASH_IN_COPY = /(^|[\s\w.,;:!?])--(?=[\s\w]|$)/;

/** Every break of the dash and placeholder rules in a list of files. Paths are shown relative to `root`. */
export function scanFiles(files: readonly string[], root: string): SourceProblem[] {
  const problems: SourceProblem[] = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const shown = path.relative(root, file);
    const code = stripComments(source);
    if (code.includes(EM_DASH)) problems.push({ file: shown, rule: 'em dash', sample: sampleAround(code, EM_DASH) });
    if (code.includes(EN_DASH)) problems.push({ file: shown, rule: 'en dash', sample: sampleAround(code, EN_DASH) });
    for (const text of readableText(source)) {
      for (const line of text.split('\n')) {
        if (DOUBLE_DASH_IN_COPY.test(withoutCssVariables(line))) problems.push({ file: shown, rule: 'double dash', sample: line.trim().slice(0, 120) });
        if (/coming soon/i.test(line)) problems.push({ file: shown, rule: 'coming soon', sample: line.trim().slice(0, 120) });
        if (/\blorem\b/i.test(line)) problems.push({ file: shown, rule: 'lorem', sample: line.trim().slice(0, 120) });
      }
    }
  }
  return problems;
}

function sampleAround(text: string, needle: string): string {
  const index = text.indexOf(needle);
  return text.slice(Math.max(0, index - 40), index + 40).replace(/\s+/g, ' ').trim();
}
