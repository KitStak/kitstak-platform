/**
 * Rich demo seed: 90 days of believable work for one org, with a readable story. The plan is
 * picked by org slug. Any other org gets the KitStak plan; sibling links that do not exist in
 * that org are skipped quietly, so the same seed proves the standalone case.
 */
import type { DomainContext } from '@/server/domain/_shared';
import { printSummary, seedRich as runPlan, type RichSummary } from './engine';
import { kitstakPlan } from './kitstak';
import { northwindPlan } from './northwind';
import type { OrgPlan } from './types';
import { asSeed } from '../context';

export const RICH_PLANS: Readonly<Record<string, OrgPlan>> = {
  kitstak: kitstakPlan,
  'northwind-robotics': northwindPlan,
};

/** The orgs `db:seed` fills when no `--org` is given. */
export const RICH_ORGS = Object.keys(RICH_PLANS);

export const seedRich = asSeed(async function seedRich(ctx: DomainContext): Promise<RichSummary> {
  const summary = await runPlan(ctx, RICH_PLANS[ctx.orgSlug] ?? kitstakPlan);
  printSummary(summary);
  return summary;
});
