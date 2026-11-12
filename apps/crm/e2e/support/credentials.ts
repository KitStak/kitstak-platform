/**
 * Demo admin credentials for the QA harness.
 *
 * Source order: `E2E_EMAIL` + `E2E_PASSWORD` env vars, then the seed README
 * (`src/server/db/seed/README.md`), which the seed owner keeps in sync with the seed source.
 * The README parser accepts the common shapes: `Email: a@b.c` / `Password: x` lines,
 * markdown tables with Email/Password columns, and inline code spans.
 */
import { existsSync, readFileSync } from 'node:fs';
import { SEED_README } from './paths';

export interface Credentials {
  readonly email: string;
  readonly password: string;
  readonly source: string;
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

function stripMarkdown(value: string): string {
  return value.replace(/[`*_]/g, '').trim();
}

/** Markdown table: header row contains "email" and "password". Prefer a row mentioning admin/owner. */
function fromTable(lines: readonly string[]): { email: string; password: string } | null {
  for (let i = 0; i < lines.length; i += 1) {
    const header = lines[i];
    if (!header.includes('|') || !/email/i.test(header) || !/password/i.test(header)) continue;
    const cells = (row: string) => row.split('|').slice(1, -1).map(stripMarkdown);
    const headerCells = cells(header).map((cell) => cell.toLowerCase());
    const emailCol = headerCells.findIndex((cell) => cell.includes('email'));
    const passwordCol = headerCells.findIndex((cell) => cell.includes('password'));
    const rows: string[][] = [];
    for (let j = i + 2; j < lines.length && lines[j].includes('|'); j += 1) rows.push(cells(lines[j]));
    const valid = rows.filter(
      (row) => EMAIL_RE.test(row[emailCol] ?? '') && (row[passwordCol] ?? '').length > 0,
    );
    const preferred = valid.find((row) => /admin|owner/i.test(row.join(' '))) ?? valid[0];
    if (preferred) return { email: preferred[emailCol], password: preferred[passwordCol] };
  }
  return null;
}

/** Key/value lines: first email after an "admin"/"owner" mention (else first), nearest password after it. */
function fromLines(lines: readonly string[]): { email: string; password: string } | null {
  const emailLines = lines
    .map((line, index) => ({ index, match: EMAIL_RE.exec(line), line }))
    .filter(
      (entry): entry is { index: number; match: RegExpExecArray; line: string } => entry.match !== null,
    );
  if (emailLines.length === 0) return null;
  const adminIndex = lines.findIndex((line) => /admin|owner/i.test(line));
  const start = emailLines.find((entry) => adminIndex >= 0 && entry.index >= adminIndex) ?? emailLines[0];

  const passwordRe = /password[^:=`\n]*[:=]?\s*`([^`]+)`|password\s*[:=]\s*([^\s|`]+)/i;
  for (let i = start.index; i < Math.min(lines.length, start.index + 6); i += 1) {
    const match = passwordRe.exec(lines[i]);
    const password = match?.[1] ?? match?.[2];
    if (password) return { email: start.match[0], password: password.trim() };
  }
  return null;
}

export function parseSeedReadme(markdown: string): { email: string; password: string } | null {
  const lines = markdown.split(/\r?\n/);
  return fromTable(lines) ?? fromLines(lines);
}

export function loadCredentials(): Credentials {
  const email = process.env.E2E_EMAIL?.trim();
  const password = process.env.E2E_PASSWORD;
  if (email && password) return { email, password, source: 'E2E_EMAIL/E2E_PASSWORD' };

  if (!existsSync(SEED_README)) {
    throw new Error(`No demo credentials: set E2E_EMAIL/E2E_PASSWORD or document them in ${SEED_README}.`);
  }
  const parsed = parseSeedReadme(readFileSync(SEED_README, 'utf8'));
  if (!parsed) {
    throw new Error(
      `Could not find demo admin credentials in ${SEED_README}. Expected e.g. "Email: \`admin@…\`" and ` +
        '"Password: `…`" lines or a table with Email/Password columns. Or set E2E_EMAIL/E2E_PASSWORD.',
    );
  }
  return { ...parsed, source: SEED_README };
}
