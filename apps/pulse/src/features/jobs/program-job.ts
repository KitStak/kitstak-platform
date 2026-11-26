/**
 * A program job on the Jobs pages (docs/programs/PULSE_PROGRAMS_SPEC.md 5.3 and 5.4): the words
 * and the card price, as pure functions so the screens and the tests share them.
 *
 * A program job holds the labor, timesheets and materials of one KitStak program. Its plan and
 * prices come from the program in Projects, never from a quote or a price typed on the job.
 */
import { resolveUnitPrice } from '@kitstak/programs-engine/price';
import type { CardVersion, IsoDate } from '@kitstak/programs-engine/types';
import type { JobProgramRefDTO } from '@/lib/program-types';

/** The muted line under the Jobs list. Null when no program is tracked. */
export function trackedProgramsLine(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  return count === 1 ? '1 program is tracked under Programs.' : `${count} programs are tracked under Programs.`;
}

/** The banner on the job page of a program job (`/jobs/J-1040?view=job`). */
export function programJobBanner(key: string): string {
  return `This job holds the labor and costs of the ${key} program. See the program for its plan and profit.`;
}

/**
 * What takes the place of the Quote and Budget and the Plan vs actual tabs. The second line only
 * shows when a quote or a budget was typed on the job before it held the program: it is kept in
 * `pulse.job_plans`, never deleted, and never used (spec 1.5).
 */
export function programPlanLines(key: string, typed: { readonly quote: boolean; readonly budget: boolean }): string[] {
  const lines = [`Plans come from the ${key} program in Projects.`];
  if (typed.quote && typed.budget) lines.push('The quote and budget typed on this job are kept but not used.');
  else if (typed.quote) lines.push('The quote typed on this job is kept but not used.');
  else if (typed.budget) lines.push('The budget typed on this job is kept but not used.');
  return lines;
}

/** "Prices come from GLOVE price card v2 in Projects." */
export function programPriceLine(key: string, cardVersion: number | null): string {
  return cardVersion === null ? `Prices come from the ${key} price card in Projects.` : `Prices come from ${key} price card v${cardVersion} in Projects.`;
}

/**
 * The price of a program job today, from the card in force: `single` when every live variant
 * pays the same price for one unit (or the program has no variants and the card has one price),
 * `varies` when they do not, `none` when the card has no price for one unit.
 */
export type ProgramJobPrice =
  | { readonly kind: 'single'; readonly unitPrice: string }
  | { readonly kind: 'varies' }
  | { readonly kind: 'none' };

export function programJobPrice(versions: readonly CardVersion[], variantIds: readonly string[], today: IsoDate): ProgramJobPrice {
  const ids = variantIds.length > 0 ? variantIds : [null];
  const prices = new Set<string>();
  for (const variantId of ids) {
    const resolved = resolveUnitPrice({ workDate: today, variantId, buildOverride: null, versions });
    if (resolved.source === 'none') continue;
    prices.add(resolved.unitPrice);
  }
  if (prices.size === 0) return { kind: 'none' };
  if (prices.size > 1) return { kind: 'varies' };
  return { kind: 'single', unitPrice: [...prices][0] as string };
}

/** The tabs a program job shows: no Plan vs actual, its plan comes from the program. */
export function programJobTabs<T extends string>(tabs: readonly T[], isProgramJob: boolean): T[] {
  return isProgramJob ? tabs.filter((tab) => tab !== 'plan') : [...tabs];
}

/** What the job page knows about the program a job holds. */
export interface JobProgramPageDTO {
  readonly program: JobProgramRefDTO;
  /** The card price today. Null for a reader who may not see money, or when the card could not be read. */
  readonly price: ProgramJobPrice | null;
}

/** Where `/jobs/J-1040` goes: the program page, unless `?view=job` asks for the job itself. Only the job's front page moves. */
export function programJobRedirect(input: { readonly tab: string; readonly view: string | null | undefined; readonly program: JobProgramRefDTO | null }): string | null {
  if (!input.program || input.tab !== 'overview' || input.view === 'job') return null;
  return input.program.path;
}
