/**
 * Record search for the command palette and `/search`: tracked programs, jobs, clients, job types
 * and extra services. A program key or name finds the program first, then the job that holds it
 * (PULSE_PROGRAMS_SPEC 5.4); that job opens as a job (`?view=job`), not its program.
 * No extension needed (SPEC 5.2): every typed word must appear (case blind) in the record's text,
 * scoped to the org, with a small LIMIT per kind. Hits never carry money. Client, job type and extra
 * service pages need money and the Profit pages: without them a client opens its job list instead,
 * and job types and extra services are left out.
 */
import 'server-only';
import { sql, type SQL } from 'drizzle-orm';
import { db } from '@/server/db';
import { scoped } from '@/server/db/scope';
import { programsReady } from '@/server/integrations/programs';
import { JOB_STATUS_LABELS, type JobStatusValue } from '@/lib/constants';
import { navFor } from '@/lib/nav';
import { routes } from '@/lib/routes';
import type { SearchHitDTO } from '@/lib/types';
import { rows, type DomainContext } from './_shared';
import { requirePulse } from './access';

const MAX_WORDS = 6;
const MAX_QUERY_LENGTH = 120;
const MAX_PER_KIND = 25;

/** Rank boosts: a typed job number or an exact name wins, then names that start with the words. */
const SCORE = { exact: 100, number: 95, prefix: 80, word: 60, contains: 40 } as const;
/** Ties go to the kind people look for most. */
const KIND_ORDER: Readonly<Record<SearchHitDTO['type'], number>> = {
  program: -1,
  job: 0,
  client: 1,
  jobType: 2,
  service: 3,
};

/** Lower case words of the query, at most a few, empty when nothing searchable was typed. */
export function searchWords(query: string): string[] {
  return query
    .slice(0, MAX_QUERY_LENGTH)
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 0 && /[\p{L}\p{N}]/u.test(word))
    .slice(0, MAX_WORDS);
}

/** LIKE pattern that treats `%`, `_` and `\` as plain text. */
const likeEscape = (word: string): string => word.replace(/[\\%_]/g, (char) => `\\${char}`);

/** Every word must appear somewhere in `haystack`. */
function allWords(haystack: SQL, words: readonly string[]): SQL {
  return sql.join(
    words.map((word) => sql`${haystack} LIKE ${`%${likeEscape(word)}%`}`),
    sql` AND `,
  );
}

/** How well `name` matches what was typed. */
function score(name: string, phrase: string): number {
  const lower = name.toLowerCase();
  if (lower === phrase) return SCORE.exact;
  if (lower.startsWith(phrase)) return SCORE.prefix;
  if (lower.includes(` ${phrase}`)) return SCORE.word;
  return SCORE.contains;
}

const openJobs = (count: number): string =>
  count === 0 ? 'No open jobs' : count === 1 ? '1 open job' : `${count} open jobs`;
const statusWord = (status: string): string => JOB_STATUS_LABELS[status as JobStatusValue] ?? status;

interface Ranked {
  readonly hit: SearchHitDTO;
  readonly score: number;
  readonly order: number;
}

/** Jobs, clients, job types and extra services that match `query`, best first. Up to `limit` hits a kind. */
export const searchAll = scoped(async function searchAll(ctx: DomainContext, query: string, limit = 8): Promise<SearchHitDTO[]> {
  const access = await requirePulse(ctx, 'pulse:read');
  const words = searchWords(query);
  if (words.length === 0) return [];
  const phrase = words.join(' ');
  const cap = Math.min(Math.max(Math.trunc(limit) || 1, 1), MAX_PER_KIND);
  // Client, job type and extra service pages sit under Profit and show money.
  const seesCatalog = access.seesMoney && navFor(access.role).some((entry) => entry.id === 'profit');
  const numberPrefix = `${likeEscape(phrase)}%`;

  // Programs show only where the tracker is on; otherwise a program job is a normal job (spec 7.5).
  const programs = await programsReady(ctx);
  // The program a job holds (its `pm_program` mirror), so its key and name find the job too.
  const heldProgram = sql`LEFT JOIN LATERAL (
          SELECT pl.target_id AS program_id, pl.meta ->> 'key' AS key, pl.meta ->> 'name' AS name FROM pulse.job_links pl
           WHERE pl.job_id = j.id AND pl.target_type = 'pm_program' ORDER BY pl.created_at LIMIT 1) pp ON ${programs ? sql`true` : sql`false`}`;
  const jobHaystack = sql`lower(concat_ws(' ', j.number, j.name, c.name, c.code, j.kit_name, j.kit_sku, j.po_number, jt.name, pp.key, pp.name))`;
  const jobsQuery = rows<{ id: string; number: string; name: string; client: string; status: string; program_id: string | null; program_key: string | null }>(
    db,
    sql`SELECT j.id, j.number, j.name, c.name AS client, j.status, pp.program_id, pp.key AS program_key
          FROM pulse.jobs j
          JOIN pulse.clients c ON c.id = j.client_id
          LEFT JOIN pulse.job_types jt ON jt.id = j.job_type_id
          ${heldProgram}
         WHERE j.org_id = ${ctx.orgId} AND j.deleted_at IS NULL AND (${allWords(jobHaystack, words)})
         ORDER BY (lower(j.number) LIKE ${numberPrefix}) DESC, (j.status IN ('active', 'on_hold')) DESC, j.created_at DESC
         LIMIT ${cap}`,
  );
  const openCount = sql`(SELECT count(*)::int FROM pulse.jobs oj WHERE oj.org_id = ${ctx.orgId} AND oj.deleted_at IS NULL AND oj.status IN ('active', 'on_hold')`;
  const clientsQuery = rows<{ id: string; name: string; code: string; status: string; open: number }>(
    db,
    sql`SELECT c.id, c.name, c.code, c.status, ${openCount} AND oj.client_id = c.id) AS open
              FROM pulse.clients c
             WHERE c.org_id = ${ctx.orgId} AND c.deleted_at IS NULL AND (${allWords(sql`lower(concat_ws(' ', c.name, c.code))`, words)})
             ORDER BY (c.status = 'active') DESC, lower(c.name) LIMIT ${cap}`,
  );
  const typesQuery = seesCatalog
    ? rows<{ id: string; name: string; archived: boolean; open: number }>(
        db,
        sql`SELECT t.id, t.name, (t.archived_at IS NOT NULL) AS archived, ${openCount} AND oj.job_type_id = t.id) AS open
              FROM pulse.job_types t
             WHERE t.org_id = ${ctx.orgId} AND t.deleted_at IS NULL AND (${allWords(sql`lower(concat_ws(' ', t.name, t.code))`, words)})
             ORDER BY (t.archived_at IS NULL) DESC, t.position, lower(t.name) LIMIT ${cap}`,
      )
    : Promise.resolve([]);
  const servicesQuery = seesCatalog
    ? rows<{ id: string; name: string; code: string; active: boolean }>(
        db,
        sql`SELECT s.id, s.name, s.code, s.active
              FROM pulse.vas_services s
             WHERE s.org_id = ${ctx.orgId} AND s.deleted_at IS NULL AND (${allWords(sql`lower(concat_ws(' ', s.name, s.code))`, words)})
             ORDER BY s.active DESC, lower(s.name) LIMIT ${cap}`,
      )
    : Promise.resolve([]);
  const programsQuery = programs
    ? rows<{ id: string; key: string; name: string | null; client: string }>(
        db,
        sql`SELECT l.target_id AS id, l.meta ->> 'key' AS key, l.meta ->> 'name' AS name, c.name AS client
              FROM pulse.job_links l
              JOIN pulse.jobs j ON j.id = l.job_id AND j.deleted_at IS NULL
              JOIN pulse.clients c ON c.id = j.client_id
             WHERE l.org_id = ${ctx.orgId} AND l.target_type = 'pm_program' AND l.meta ->> 'key' IS NOT NULL
               AND (${allWords(sql`lower(concat_ws(' ', l.meta ->> 'key', l.meta ->> 'name'))`, words)})
             ORDER BY lower(l.meta ->> 'key') LIMIT ${cap}`,
      )
    : Promise.resolve([]);
  const [jobs, clients, types, services, found] = await Promise.all([
    jobsQuery,
    clientsQuery,
    typesQuery,
    servicesQuery,
    programsQuery,
  ]);

  const jobRanks: Ranked[] = jobs.map((job, index): Ranked => ({
    hit: {
      type: 'job',
      id: job.id,
      title: `${job.number} ${job.name}`,
      // A program job opens as a job here: its program has a hit of its own.
      subtitle: job.program_key ? `${job.client}, ${statusWord(job.status)}, ${job.program_key} program job` : `${job.client}, ${statusWord(job.status)}`,
      href: job.program_key ? routes.programJob(job.number) : routes.job(job.number),
    },
    // A job named after its client should not beat the client when the client's name is what was typed.
    score: job.number.toLowerCase().startsWith(phrase)
      ? SCORE.number
      : job.client.toLowerCase().startsWith(phrase)
        ? SCORE.contains
        : job.program_key
          ? Math.max(score(job.name, phrase), score(job.program_key, phrase) - 1)
          : score(job.name, phrase),
    order: index,
  }));
  const programRanks: Ranked[] = found.map((program, index): Ranked => {
    const name = program.name ?? program.key;
    const own = Math.max(program.key.toLowerCase() === phrase ? SCORE.exact : score(program.key, phrase), score(name, phrase));
    // "GLOVE" finds the program first, then the job that holds it.
    const job = jobs.findIndex((row) => row.program_id === program.id);
    const jobScore = job >= 0 ? (jobRanks[job]?.score ?? 0) : 0;
    return {
      hit: { type: 'program', id: program.id, title: `${program.key} · ${name}`, subtitle: `Program, ${program.client}`, href: routes.program(program.key) },
      score: Math.max(own, jobScore),
      order: index,
    };
  });

  const ranked: Ranked[] = [
    ...programRanks,
    ...jobRanks,
    ...clients.map((client, index): Ranked => ({
      hit: {
        type: 'client',
        id: client.id,
        title: client.name,
        subtitle:
          client.status === 'active'
            ? `${client.code}, ${openJobs(client.open)}`
            : `${client.code}, not active`,
        href: seesCatalog ? routes.client(client.id) : routes.jobs({ tab: 'all', q: client.name }),
      },
      score: client.code.toLowerCase() === phrase ? SCORE.exact : score(client.name, phrase),
      order: index,
    })),
    ...types.map((type, index): Ranked => ({
      hit: {
        type: 'jobType',
        id: type.id,
        title: type.name,
        subtitle: type.archived ? 'Job type, archived' : `Job type, ${openJobs(type.open).toLowerCase()}`,
        href: routes.profit({ jobType: type.id }),
      },
      score: score(type.name, phrase),
      order: index,
    })),
    ...services.map((service, index): Ranked => ({
      hit: {
        type: 'service',
        id: service.id,
        title: service.name,
        subtitle: service.active ? `Extra service, ${service.code}` : 'Extra service, not in use',
        href: routes.service(service.id),
      },
      score: score(service.name, phrase),
      order: index,
    })),
  ];
  return ranked
    .sort((a, b) => b.score - a.score || KIND_ORDER[a.hit.type] - KIND_ORDER[b.hit.type] || a.order - b.order)
    .map((entry) => entry.hit);
});
