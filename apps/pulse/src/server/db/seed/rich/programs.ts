/**
 * Jobs fed by Projects programs (docs/programs/SPEC.md 7.3). Runs after the Projects seed made
 * the programs: each `bills_to` job is made, linked to its program (the same link Pulse makes from
 * the job page), and every program day it billed from the start is posted to it; a `related` job
 * keeps its own money. Then `syncPrograms` writes the `pmb`, `pmf` and `pmt` rows, and the parity
 * check compares every program month in Pulse with what Projects stored (`readProgramMonth`).
 * The seed fails when they differ by a cent. A program that is not in Projects is skipped quietly.
 */
import { sql } from 'drizzle-orm';
import { linkRecords, type Executor as LinkExecutor } from '@kitstak/db/record-links';
import { readProgramMonth, type Executor as ProgramsExecutor } from '@kitstak/db/programs';
import { db } from '@/server/db';
import { addDays, startOfMonth } from '@/lib/profit';
import { createJob, linkProgramToJob, rows, savePlan, saveProductionBulk, saveRevenue, syncPrograms, type DomainContext, type ProductionInput } from '@/server/domain';
import type { OrgPlan } from './types';

export interface ProgramJobsInput {
  readonly clientIds: ReadonlyMap<string, string>;
  readonly typeIds: ReadonlyMap<string, string>;
  readonly siteId: string;
  readonly laborClassId: string;
  readonly today: string;
  readonly log: (text: string) => void;
}

export interface ProgramParityRow {
  readonly job: string;
  readonly program: string;
  readonly month: string;
  readonly pulseCents: bigint;
  readonly projectsCents: bigint;
}

const usd = (cents: bigint): string => `$${(Number(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from.slice(0, 7); m <= to.slice(0, 7); ) {
    out.push(m);
    const [y, mm] = m.split('-').map(Number) as [number, number];
    m = new Date(Date.UTC(y, mm, 1)).toISOString().slice(0, 7);
  }
  return out;
}

/** Makes the program jobs, posts the program days to them and syncs. Returns the job ids. */
export async function seedProgramJobs(ctx: DomainContext, plan: OrgPlan, input: ProgramJobsInput): Promise<{ jobIds: string[]; parity: ProgramParityRow[] }> {
  const specs = plan.programJobs ?? [];
  if (specs.length === 0) return { jobIds: [], parity: [] };
  const ready = await rows<{ ok: boolean }>(db, sql`SELECT to_regclass('pm.program_ledger') IS NOT NULL AND to_regclass('core.record_links') IS NOT NULL AS ok`).catch(() => [{ ok: false }]);
  if (!ready[0]?.ok) {
    input.log('Projects programs are not installed here, program jobs skipped');
    return { jobIds: [], parity: [] };
  }
  const jobIds: string[] = [];
  const billed: { jobId: string; number: string; programId: string; key: string; start: string }[] = [];
  for (const spec of specs) {
    const [program] = await rows<{ id: string; key: string; name: string; start: string }>(
      db,
      sql`SELECT id::text, key, name, start_date::text AS start FROM pm.projects WHERE org_id = ${ctx.orgId} AND key = ${spec.program} AND kind = 'program' AND deleted_at IS NULL`,
    );
    if (!program) {
      input.log(`${spec.n}: program ${spec.program} is not in Projects, skipped`);
      continue;
    }
    const clientId = input.clientIds.get(spec.client);
    const jobTypeId = input.typeIds.get(spec.type);
    if (!clientId || !jobTypeId) throw new Error(`Seed: ${spec.n} needs client ${spec.client} and type ${spec.type}`);
    const ongoing = spec.relation === 'bills_to';
    // Crew lines: each program day totals crew x hours, counting the time builders logged in
    // Projects that day (it reaches the job as pmt rows after the sync).
    const crewDays: { day: string; hours: number }[] = [];
    let loggedInWindow = 0;
    if (ongoing && spec.crew && spec.hours) {
      const days = await rows<{ day: string }>(db, sql`SELECT DISTINCT work_date::text AS day FROM pm.build_output WHERE program_id = ${program.id}::uuid AND deleted_at IS NULL AND qty > 0 ORDER BY 1`);
      const logged = await rows<{ day: string; hours: string }>(
        db,
        sql`SELECT (started_at AT TIME ZONE 'America/Chicago')::date::text AS day, (sum(duration_minutes) / 60.0)::text AS hours
              FROM pm.time_entries WHERE project_id = ${program.id}::uuid AND deleted_at IS NULL GROUP BY 1`,
      );
      const loggedBy = new Map(logged.map((row) => [row.day, Number(row.hours)]));
      for (const d of days) crewDays.push({ day: d.day, hours: Math.max(0.5, spec.crew * spec.hours - (loggedBy.get(d.day) ?? 0)) });
      loggedInWindow = logged.filter((row) => row.day > addDays(input.today, -30) && row.day <= input.today).reduce((n, row) => n + Number(row.hours), 0);
    }
    // The plan's hours are the hours of the last 30 days (the window the risk check uses), so the
    // plan, the target pace and the labor so far tell one story.
    const windowHours = crewDays.filter((d) => d.day > addDays(input.today, -30)).reduce((n, d) => n + d.hours, 0) + loggedInWindow;
    const planHours = spec.plan && windowHours > 0 ? Math.round(windowHours) : null;
    // The target pace is what the crew made an hour in that window (rounded down), and the plan's
    // units are that pace over the plan hours, so the quote assumes the same pace as the target.
    const [windowUnits] = await rows<{ units: string | null }>(
      db,
      sql`SELECT sum(qty)::text AS units FROM pm.build_output WHERE program_id = ${program.id}::uuid AND deleted_at IS NULL AND work_date > ${addDays(input.today, -30)}::date AND work_date <= ${input.today}::date`,
    );
    const targetPace = planHours ? Math.max(1, Math.floor(Number(windowUnits?.units ?? 0) / planHours)) : null;
    const planUnits = spec.plan && planHours && targetPace ? targetPace * planHours : (spec.plan?.units ?? 0);
    const startDate = ongoing ? program.start : addDays(input.today, -20);
    const created = await createJob(ctx, {
      number: spec.n,
      name: spec.name,
      clientId,
      jobTypeId,
      siteId: input.siteId,
      kind: ongoing ? 'ongoing' : 'one_time',
      status: 'active',
      pricingModel: spec.pricing,
      plannedUnits: ongoing ? '0' : '1.000',
      unitPrice: spec.pricing === 'per_unit' ? (spec.unitPrice ?? null) : null,
      fixedPriceCents: spec.pricing === 'fixed' ? (spec.fixedCents ?? null) : null,
      billRateCents: null,
      materialMethod: 'standard',
      materialCostPerUnit: '0.0000',
      partsOwner: null,
      defaultLaborClassId: input.laborClassId,
      usualCrew: spec.crew ? [{ laborClassId: input.laborClassId, headcount: spec.crew }] : [],
      standardUph: targetPace === null ? null : targetPace.toFixed(3),
      targetMarginBp: null,
      startDate,
      dueDate: ongoing ? null : addDays(input.today, 12),
      poNumber: null,
      ownerId: ctx.userId,
      description: null,
      pinnedNote: spec.pinned ?? null,
      quote: spec.plan
        ? {
            units: planUnits.toFixed(3),
            revenueCents: spec.plan.revenueCents,
            // Labor cost is set from the crew's loaded rate once the labor lines exist (below).
            laborHours: (planHours ?? 0).toFixed(2),
            laborCents: 0,
            materialCents: 0,
            otherCents: 0,
            origin: 'typed',
            note: `One month of the ${spec.program} program at its usual volume`,
          }
        : null,
      links: [],
      source: 'manual',
      sourceRef: null,
    });
    jobIds.push(created.id);
    await db.execute(sql`UPDATE pulse.jobs SET created_at = ${`${addDays(startDate, -3)} 14:20:00+00`}::timestamptz WHERE id = ${created.id}`);
    if (spec.relation === 'bills_to') {
      await linkProgramToJob(ctx, spec.n, program.id);
      // The job billed the program from its first day: every program day and fee posts to it.
      await db.execute(sql`UPDATE pm.build_output SET posting = 'program_job', pulse_job_id = ${created.id}::uuid WHERE program_id = ${program.id}::uuid AND deleted_at IS NULL AND posting <> 'build_job'`);
      await db.execute(sql`UPDATE pm.program_ledger SET posting = 'program_job', pulse_job_id = ${created.id}::uuid WHERE program_id = ${program.id}::uuid AND deleted_at IS NULL`);
      billed.push({ jobId: created.id, number: spec.n, programId: program.id, key: program.key, start: program.start });
      // Crew hours only (no units): the job's labor cost on each day the program built.
      if (crewDays.length > 0) {
        const labor: ProductionInput[] = crewDays.map((d) => ({ jobId: created.id, workDate: d.day, laborClassId: input.laborClassId, headcount: String(spec.crew), hours: d.hours.toFixed(2), hoursConfirmed: true }));
        if (labor.length > 0) await saveProductionBulk(ctx, labor).catch((error: unknown) => input.log(`${spec.n}: crew hours skipped (${error instanceof Error ? error.message : String(error)})`));
        // The plan's labor cost at the crew's real loaded rate, so plan and actual agree.
        if (spec.plan && planHours) {
          const [rate] = await rows<{ cents: string | null; version: number | null }>(
            db,
            sql`SELECT (SELECT (sum(labor_cost_cents) / nullif(sum(hours), 0))::text FROM pulse.production_entries WHERE org_id = ${ctx.orgId} AND job_id = ${created.id} AND deleted_at IS NULL) AS cents,
                       (SELECT version FROM pulse.job_plans WHERE org_id = ${ctx.orgId} AND job_id = ${created.id} AND plan = 'quote') AS version`,
          );
          const perHour = Number(rate?.cents ?? 0);
          if (perHour > 0) await savePlan(ctx, created.id, 'quote', { laborHours: planHours.toFixed(2), laborCents: Math.round(perHour * planHours), version: rate?.version ?? null });
        }
      }
    } else {
      await linkRecords(db as unknown as LinkExecutor, {
        orgId: ctx.orgId,
        from: { type: 'pm_program', id: program.id },
        to: { type: 'pulse_job', id: created.id },
        relation: 'related',
        cache: { title: `${spec.n} ${spec.name}`, status: 'active', url: `/jobs/${encodeURIComponent(spec.n)}` },
        createdBy: ctx.userId,
      });
      if (spec.revenue) {
        const date = addDays(startOfMonth(input.today), 9) > input.today ? input.today : addDays(startOfMonth(input.today), 9);
        await saveRevenue(ctx, { jobId: created.id, revenueDate: date, kind: 'invoice', description: spec.revenue.desc, amountCents: spec.revenue.cents, invoiceNumber: spec.revenue.invoice });
      }
    }
  }
  const tally = { created: 0, updated: 0, skipped: 0, skippedClosed: 0, counts: {} as Record<string, number> };
  await syncPrograms(ctx, tally, { today: input.today });
  input.log(`programs synced: ${tally.created} rows made, ${tally.updated} updated, ${tally.skipped} skipped, ${tally.skippedClosed} in closed months`);
  return { jobIds, parity: await programParity(ctx, billed, input.today) };
}

/** Pulse program money per job and month next to what Projects stored for that job. */
export async function programParity(ctx: DomainContext, billed: readonly { jobId: string; number: string; programId: string; key: string; start: string }[], today: string): Promise<ProgramParityRow[]> {
  const out: ProgramParityRow[] = [];
  for (const job of billed) {
    for (const month of monthsBetween(job.start, today)) {
      const from = `${month}-01`;
      const [pulse] = await rows<{ cents: string }>(
        db,
        sql`SELECT ((SELECT coalesce(sum(base_revenue_cents), 0) FROM pulse.production_entries WHERE org_id = ${ctx.orgId} AND job_id = ${job.jobId} AND source = 'projects' AND deleted_at IS NULL
                      AND work_date >= ${from}::date AND work_date < (${from}::date + interval '1 month'))
                  + (SELECT coalesce(sum(amount_cents), 0) FROM pulse.revenue_entries WHERE org_id = ${ctx.orgId} AND job_id = ${job.jobId} AND source = 'projects' AND deleted_at IS NULL
                      AND revenue_date >= ${from}::date AND revenue_date < (${from}::date + interval '1 month')))::text AS cents`,
      );
      const read = await readProgramMonth(db as unknown as ProgramsExecutor, ctx.orgId, job.programId, month as never);
      const projects =
        read.output.filter((row) => row.pulseJobId === job.jobId).reduce((sum, row) => sum + BigInt(row.revenueCents), BigInt(0)) +
        read.ledger.filter((row) => row.pulseJobId === job.jobId).reduce((sum, row) => sum + row.cents, BigInt(0));
      out.push({ job: job.number, program: job.key, month, pulseCents: BigInt(pulse?.cents ?? '0'), projectsCents: projects });
    }
  }
  return out;
}

/** Prints the parity table; throws when any month differs. */
export function assertParity(parity: readonly ProgramParityRow[]): void {
  if (parity.length === 0) return;
  process.stdout.write('\n  Program revenue in Pulse and Projects\n');
  for (const row of parity) {
    const same = row.pulseCents === row.projectsCents;
    process.stdout.write(`    ${row.job} ${row.program} ${row.month}: Pulse ${usd(row.pulseCents)} · Projects ${usd(row.projectsCents)} ${same ? 'match' : 'DIFFER'}\n`);
  }
  const off = parity.filter((row) => row.pulseCents !== row.projectsCents);
  if (off.length > 0) throw new Error(`Seed parity failed: ${off.length} program month(s) differ between Pulse and Projects`);
}
