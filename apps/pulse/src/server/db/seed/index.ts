/**
 * `pnpm --filter kitstak-pulse db:seed [--org=<slug>] [--email=<who>] [--seed=<name>] [--keep]`
 *
 * Idempotent: wipes the org's Pulse rows under `pulse.allow_purge`, then rebuilds them through
 * the domain layer. Add a seed by registering it in `SEEDS`.
 */
import { closeSeed, ensurePulseOwner, seedContext, wipeOrg } from './context';
import { seedMinimal } from './minimal';
import type { DomainContext } from '@/server/domain/_shared';

type Seed = (ctx: DomainContext) => Promise<object>;

/** Seeds by name. The default is `minimal`. */
export const SEEDS: Readonly<Record<string, Seed>> = {
  minimal: seedMinimal,
};

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

async function main(): Promise<void> {
  const org = argument('org') ?? 'kitstak';
  const name = argument('seed') ?? 'minimal';
  const seed = SEEDS[name];
  if (!seed) throw new Error(`Unknown seed "${name}". Known seeds: ${Object.keys(SEEDS).join(', ')}.`);
  const ctx = await seedContext(org, argument('email'));
  if (!process.argv.includes('--keep')) await wipeOrg(ctx.orgId);
  await ensurePulseOwner(ctx);
  const started = Date.now();
  const summary = await seed(ctx);
  process.stdout.write(`db:seed - ${name} for ${org} as ${ctx.userName}: ${JSON.stringify(summary)} in ${Date.now() - started} ms\n`);
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`db:seed failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => closeSeed());
