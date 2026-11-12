/**
 * Axe accessibility scan helper (WCAG 2.x A/AA).
 *
 *   await expectNoA11yViolations(page);                       // serious + critical
 *   await expectNoA11yViolations(page, { include: "main", minImpact: "moderate" });
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

export type Impact = "minor" | "moderate" | "serious" | "critical";

const IMPACT_RANK: Readonly<Record<Impact, number>> = {
  minor: 0,
  moderate: 1,
  serious: 2,
  critical: 3,
};

export const DEFAULT_TAGS: readonly string[] = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

export interface A11yOptions {
  /** CSS selector(s) to scope the scan to. */
  readonly include?: string | readonly string[];
  /** CSS selector(s) to leave out (third-party widgets, known issues with tickets). */
  readonly exclude?: string | readonly string[];
  /** Lowest impact that fails the check. Default "serious". */
  readonly minImpact?: Impact;
  /** Rule ids to disable for this scan. */
  readonly disableRules?: readonly string[];
  readonly tags?: readonly string[];
}

export interface A11yViolation {
  readonly id: string;
  readonly impact: Impact | null;
  readonly help: string;
  readonly helpUrl: string;
  readonly targets: readonly string[];
}

const asList = (value: string | readonly string[] | undefined): readonly string[] =>
  value === undefined ? [] : typeof value === "string" ? [value] : value;

export function meetsImpact(impact: Impact | null | undefined, min: Impact): boolean {
  // Unknown impact is treated as serious so it is never silently dropped.
  const rank = impact ? IMPACT_RANK[impact] : IMPACT_RANK.serious;
  return rank >= IMPACT_RANK[min];
}

export function formatViolations(violations: readonly A11yViolation[]): string {
  return violations
    .map((v) => {
      const targets = v.targets.slice(0, 5).join(", ");
      const more = v.targets.length > 5 ? ` (+${v.targets.length - 5} more)` : "";
      return `[${v.impact ?? "unknown"}] ${v.id}: ${v.help}\n    at ${targets}${more}\n    ${v.helpUrl}`;
    })
    .join("\n");
}

export async function scanA11y(page: Page, options: A11yOptions = {}): Promise<readonly A11yViolation[]> {
  let builder = new AxeBuilder({ page }).withTags([...(options.tags ?? DEFAULT_TAGS)]);
  for (const selector of asList(options.include)) builder = builder.include(selector);
  for (const selector of asList(options.exclude)) builder = builder.exclude(selector);
  if (options.disableRules && options.disableRules.length > 0) {
    builder = builder.disableRules([...options.disableRules]);
  }
  const results = await builder.analyze();
  const minImpact = options.minImpact ?? "serious";
  return results.violations
    .filter((v) => meetsImpact(v.impact as Impact | null | undefined, minImpact))
    .map((v) => ({
      id: v.id,
      impact: (v.impact ?? null) as Impact | null,
      help: v.help,
      helpUrl: v.helpUrl,
      targets: v.nodes.map((n) => n.target.join(" ")),
    }));
}

export async function expectNoA11yViolations(page: Page, options: A11yOptions = {}): Promise<void> {
  const violations = await scanA11y(page, options);
  expect(violations, `Accessibility violations on ${page.url()}:\n${formatViolations(violations)}`).toEqual([]);
}
