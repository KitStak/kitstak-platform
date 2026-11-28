/**
 * `pnpm --filter kitstak-crew db:seed [--org=<slug>]` (docs/crew/SPEC.md section 10).
 *
 * Phase 0 seeds the setup rows for org `kitstak`: settings, sites MLT1 (default) and KS2 with the
 * Federal preset, and five areas per site. Phase 1 adds labor classes, the Brightway Staffing
 * agency, 48 people with their leads and logins, and the explicit Crew roles. Idempotent: run it as often as you like. Later phases
 * add people, schedules, punches and the `northwind-robotics` and `crew-only` stories.
 */
import { closeSeed, seedContext } from './context';
import { seedPhase0 } from './phase0';
import { SEED_PIN, seedPhase1 } from './phase1';

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

async function main(): Promise<void> {
  const slug = argument('org') ?? 'kitstak';
  if (slug !== 'kitstak') throw new Error(`Phases 0 and 1 have a seed for org kitstak only (asked for ${slug}).`);
  const ctx = await seedContext(slug);
  const started = Date.now();
  const summary = await seedPhase0(ctx);
  process.stdout.write(`db:seed: phase 0 for ${slug} as ${ctx.userName} in ${Date.now() - started} ms ${JSON.stringify(summary)}\n`);
  const crew = await seedPhase1(ctx);
  process.stdout.write(`db:seed: phase 1 for ${slug} in ${Date.now() - started} ms ${JSON.stringify(crew)}\n`);
  if (process.env.NODE_ENV !== 'production') process.stdout.write(`db:seed: every seeded person has kiosk PIN ${SEED_PIN} (local dev only)\n`);
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`db:seed failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => closeSeed());
