/**
 * The copy rules, checked for everything this package can put on a screen or in an email
 * (docs/billing/SPEC.md section 0, CONTRACTS section 20): no em dash, no en dash, no double dash, no
 * "coming soon", no lorem ipsum, and no sentence over 20 words.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATALOG, PRODUCT_IDS, priceTermsLabel, productListLabel, type PlanSelection } from '../src/catalog';
import { EMAIL_TEMPLATE_IDS } from '../src/email-types';
import { emailAuditSummary, emailContent } from '../src/emails/render';
import { SAMPLE_EMAIL_PAYLOADS } from '../src/emails/samples';
import { BILLING_ERROR_COPY } from '../src/errors';
import { PLAN_BADGE_LABELS } from '../src/plan-state';
import { quote, quoteSummaryLines } from '../src/quote';
import { buildStripeSpec, formatDryRun } from '../scripts/stripe-setup-lib';
import { DOUBLE_DASH, EM_DASH, EN_DASH, copyProblems, forbiddenIn } from './support/copy';
import { scanFiles, walk } from './support/source-scan';

const PACKAGE_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(PACKAGE_ROOT, '..', '..');

describe('copy rules: source scan', () => {
  it('the billing package has no dashes or placeholders in anything a person reads', () => {
    const files = [...walk(path.join(PACKAGE_ROOT, 'src')), ...walk(path.join(PACKAGE_ROOT, 'scripts'))].filter(
      // Test support is not copy. It names the forbidden characters on purpose.
      (file) => !file.includes(`${path.sep}testing${path.sep}`),
    );
    expect(files.length).toBeGreaterThan(40);
    expect(scanFiles(files, REPO_ROOT)).toEqual([]);
  });

  it('the shared plan banner, lock screen and plan summary follow the same rules', () => {
    const ui = path.join(REPO_ROOT, 'packages', 'ui', 'src');
    const files = [...walk(path.join(ui, 'plan-banner')), ...walk(path.join(ui, 'plan-lock')), ...walk(path.join(ui, 'plan-summary'))];
    expect(files.length).toBeGreaterThan(0);
    expect(scanFiles(files, REPO_ROOT)).toEqual([]);
  });
});

describe('copy rules: sentences of 20 words or fewer', () => {
  it('every billing error message', () => {
    for (const [code, message] of Object.entries(BILLING_ERROR_COPY)) {
      expect(copyProblems(message), code).toEqual([]);
      // An error names the problem in a full sentence.
      expect(message, code).toMatch(/[.?]$/);
    }
  });

  it('every email: subject, preview line, heading, body, button and footer', () => {
    for (const template of EMAIL_TEMPLATE_IDS) {
      const content = emailContent(template, SAMPLE_EMAIL_PAYLOADS[template]);
      const strings = [content.subject, content.preheader, content.heading, content.footer, content.button?.label ?? ''];
      for (const block of content.blocks) {
        if (block.kind === 'text' || block.kind === 'note') strings.push(block.text);
        if (block.kind === 'facts') for (const row of block.rows) strings.push(row.label, row.value);
        if (block.kind === 'lines') strings.push(block.total.label, ...block.rows.map((row) => row.label));
      }
      for (const text of strings) expect(copyProblems(text), `${template}: ${text}`).toEqual([]);
      const logged = emailAuditSummary(template, 'billing@northwind.example');
      if (logged) expect(copyProblems(logged), template).toEqual([]);
    }
  });

  it('the catalog words: taglines, price terms, badges and the quote lines', () => {
    const strings: string[] = [...Object.values(PLAN_BADGE_LABELS)];
    for (const id of PRODUCT_IDS) {
      strings.push(CATALOG.products[id].name, CATALOG.products[id].tagline, priceTermsLabel(id, 'monthly'), priceTermsLabel(id, 'yearly'));
    }
    strings.push(productListLabel(PRODUCT_IDS));
    const everything: PlanSelection = { products: [...PRODUCT_IDS], seats: 12, warehouses: 2, interval: 'yearly' };
    const q = quote(everything);
    strings.push(...q.lines.map((line) => line.math), ...quoteSummaryLines(q).map((line) => line.label));
    if (q.pulseSeatNote) strings.push(q.pulseSeatNote);
    for (const text of strings) expect(copyProblems(text), text).toEqual([]);
  });

  it('what the setup script prints', () => {
    for (const line of formatDryRun(buildStripeSpec())) expect(forbiddenIn(line), line).toEqual([]);
  });
});

describe('copy rules: the checker itself', () => {
  it('finds each kind of break, and leaves code alone', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'kitstak-copy-'));
    try {
      const bad = path.join(dir, 'bad.tsx');
      const good = path.join(dir, 'good.tsx');
      writeFileSync(
        bad,
        [
          `export const a = 'Wait ${EM_DASH} what';`,
          `export const b = 'Pages 2${EN_DASH}10';`,
          `export const c = 'One ${DOUBLE_DASH} two';`,
          `export const d = <p>This is coming soon</p>;`,
          `export const e = 'Lorem ipsum';`,
        ].join('\n'),
      );
      writeFileSync(
        good,
        [
          `// A comment may say anything ${EM_DASH} it is not copy.`,
          `export const a = 'var(${DOUBLE_DASH}ks-color)';`,
          `export const b = <div className="[${DOUBLE_DASH}gap:4px]">Plain words.</div>;`,
          `export const c = 'https://kitstak.app/billing';`,
        ].join('\n'),
      );
      expect(scanFiles([bad], dir).map((problem) => problem.rule).sort()).toEqual(['coming soon', 'double dash', 'em dash', 'en dash', 'lorem']);
      expect(scanFiles([good], dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('counts words per sentence and keeps money whole', () => {
    expect(copyProblems('You pay $395.20 today. Then $395.20 each month.')).toEqual([]);
    const long = `${Array.from({ length: 21 }, () => 'word').join(' ')}.`;
    expect(copyProblems(long).map((problem) => problem.rule)).toEqual(['long sentence']);
    expect(copyProblems(`Short. ${long} Short again.`)).toHaveLength(1);
  });
});
