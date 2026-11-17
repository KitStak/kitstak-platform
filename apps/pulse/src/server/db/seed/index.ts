/**
 * `pnpm --filter kitstak-pulse db:seed [--org=<slug>] [--email=<who>] [--seed=<name>] [--keep]`
 *
 * With no arguments it builds the rich demo for both demo orgs (`kitstak` and
 * `northwind-robotics`). `--org` picks one org, `--seed=minimal` the small seed the tests use.
 *
 * Idempotent: wipes the org's Pulse rows under `pulse.allow_purge`, then rebuilds them through
 * the domain layer. Add a seed by registering it in `SEEDS`.
 */
import { closeSeed, ensurePulseOwner, orgBySlug, seedContext, wipeOrg } from './context';
import { seedMinimal } from './minimal';
import { RICH_ORGS, seedRich } from './rich';
import type { DomainContext } from '@/server/domain/_shared';

type Seed = (ctx: DomainContext) => Promise<object>;

/** Seeds by name. The default is `rich`. */
export const SEEDS: Readonly<Record<string, Seed>> = {
  rich: seedRich,
  minimal: seedMinimal,
};

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

async function main(): Promise<void> {
  const name = argument('seed') ?? 'rich';
  const seed = SEEDS[name];
  if (!seed) throw new Error(`Unknown seed "${name}". Known seeds: ${Object.keys(SEEDS).join(', ')}.`);
  const wanted = argument('org');
  const orgs = wanted ? [wanted] : name === 'rich' ? RICH_ORGS : ['kitstak'];
  for (const org of orgs) {
    if (!wanted && !(await orgBySlug(org))) {
      process.stdout.write(`db:seed: org ${org} is not in this database, skipped.\n`);
      continue;
    }
    const ctx = await seedContext(org, argument('email'));
    // Roles are part of the rich demo, so a rich run rebuilds them too.
    if (!process.argv.includes('--keep')) await wipeOrg(ctx.orgId, { roles: name === 'rich' });
    await ensurePulseOwner(ctx);
    const started = Date.now();
    const summary = await seed(ctx);
    process.stdout.write(`db:seed: ${name} for ${org} as ${ctx.userName} in ${Date.now() - started} ms${name === 'rich' ? '' : ` ${JSON.stringify(summary)}`}\n`);
  }
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`db:seed failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => closeSeed());
