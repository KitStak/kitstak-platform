/**
 * Stable ids for seeded program rows (docs/programs/SPEC.md 7). The domain layer lets Postgres
 * pick random ids; after a program is seeded, its rows get uuidv5 ids instead:
 *
 * - program: (orgId, programKey)
 * - variant: (programId, variantKey)
 * - build: (programId, variantKey, buildDate, n)
 * - output row: (buildId, workDate, n)
 * - one time charge: (programId, label, chargeOn)
 *
 * so Pulse `pmb`/`pmf` refs and `core.record_links` edges stay the same across reseeds. The swap
 * runs in one transaction with `session_replication_role = replica` (foreign keys and the
 * append-only activity guard are triggers, so they stand aside while every reference moves at
 * once). Every uuid, text and jsonb column of the org's `pm` rows and the org's record links is
 * rewritten from one map, so nothing keeps an old id.
 */
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from '@/server/db';

/** Fixed namespace for KitStak seed ids (never change it: ids would move on the next seed). */
const NAMESPACE = '5b6f3c1e-2d4a-5e8b-9c7d-1f2e3a4b5c6d';

function uuidBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ''), 'hex');
}

/** RFC 4122 version 5 uuid of `name` in the seed namespace. */
export function seedUuid(...parts: readonly string[]): string {
  const hash = createHash('sha1').update(uuidBytes(NAMESPACE)).update(parts.join('\u001f'), 'utf8').digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

interface IdRow {
  readonly old: string;
  readonly new: string;
}

/** The old to new map for every seeded row of the given programs. */
async function mapFor(orgId: string, programIds: readonly string[]): Promise<IdRow[]> {
  const ids = `{${programIds.join(',')}}`;
  const programs = await db.execute<{ id: string; key: string }>(sql`select id::text, key from pm.projects where org_id = ${orgId}::uuid and id = any(${ids}::uuid[])`);
  const out: IdRow[] = [];
  const programNew = new Map<string, string>();
  for (const row of programs.rows) {
    const next = seedUuid('program', orgId, row.key);
    programNew.set(row.id, next);
    out.push({ old: row.id, new: next });
  }
  const variants = await db.execute<{ id: string; program_id: string; key: string }>(
    sql`select id::text, program_id::text, key from pm.program_variants where program_id = any(${ids}::uuid[])`,
  );
  const variantKey = new Map<string, string>();
  for (const row of variants.rows) {
    variantKey.set(row.id, row.key);
    out.push({ old: row.id, new: seedUuid('variant', programNew.get(row.program_id)!, row.key) });
  }
  const builds = await db.execute<{ id: string; program_id: string; variant_id: string | null; build_date: string; title: string }>(
    sql`select b.task_id::text as id, b.program_id::text, b.variant_id::text, b.build_date::text, t.title
          from pm.builds b join pm.tasks t on t.id = b.task_id
         where b.program_id = any(${ids}::uuid[]) order by b.program_id, b.build_date, b.variant_id nulls last, t.number`,
  );
  const seen = new Map<string, number>();
  const buildNew = new Map<string, string>();
  for (const row of builds.rows) {
    const variant = row.variant_id ? (variantKey.get(row.variant_id) ?? row.variant_id) : `none:${row.title}`;
    const base = `${row.program_id}|${variant}|${row.build_date}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const next = seedUuid('build', programNew.get(row.program_id)!, variant, row.build_date, String(n));
    buildNew.set(row.id, next);
    out.push({ old: row.id, new: next });
  }
  // Builds in plain projects (no program): (orgId, projectKey, title, buildDate, n).
  const projectBuilds = await db.execute<{ id: string; key: string; title: string; build_date: string }>(
    sql`select b.task_id::text as id, p.key, t.title, b.build_date::text from pm.builds b join pm.tasks t on t.id = b.task_id join pm.projects p on p.id = b.container_id
         where b.org_id = ${orgId}::uuid and b.program_id is null and p.kind = 'project' order by p.key, b.build_date, t.number`,
  );
  for (const row of projectBuilds.rows) {
    const base = `${row.key}|${row.title}|${row.build_date}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const next = seedUuid('project-build', orgId, row.key, row.title, row.build_date, String(n));
    buildNew.set(row.id, next);
    out.push({ old: row.id, new: next });
  }
  // Plain tasks in programs (prep work): (programId, title, n). Pulse `pmt` refs name them.
  const tasks = await db.execute<{ id: string; project_id: string; title: string }>(
    sql`select id::text, project_id::text, title from pm.tasks where project_id = any(${ids}::uuid[]) and kind <> 'build' order by project_id, number`,
  );
  for (const row of tasks.rows) {
    const base = `task|${row.project_id}|${row.title}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    out.push({ old: row.id, new: seedUuid('task', programNew.get(row.project_id)!, row.title, String(n)) });
  }
  const output = await db.execute<{ id: string; build_id: string; work_date: string }>(
    sql`select o.id::text, o.build_id::text, o.work_date::text from pm.build_output o join pm.builds b on b.task_id = o.build_id
         where o.org_id = ${orgId}::uuid and (o.program_id = any(${ids}::uuid[]) or b.program_id is null) order by o.build_id, o.work_date, o.created_at, o.id`,
  );
  const outSeen = new Map<string, number>();
  for (const row of output.rows) {
    const base = `${row.build_id}|${row.work_date}`;
    const n = (outSeen.get(base) ?? 0) + 1;
    outSeen.set(base, n);
    out.push({ old: row.id, new: seedUuid('output', buildNew.get(row.build_id) ?? row.build_id, row.work_date, String(n)) });
  }
  const charges = await db.execute<{ id: string; program_id: string; label: string; charge_on: string }>(
    sql`select id::text, program_id::text, label, charge_on::text from pm.program_one_time_charges where program_id = any(${ids}::uuid[]) order by created_at, id`,
  );
  const chargeSeen = new Map<string, number>();
  for (const row of charges.rows) {
    const base = `${row.program_id}|${row.label}|${row.charge_on}`;
    const n = (chargeSeen.get(base) ?? 0) + 1;
    chargeSeen.set(base, n);
    out.push({ old: row.id, new: seedUuid('charge', programNew.get(row.program_id)!, row.label, row.charge_on, ...(n > 1 ? [String(n)] : [])) });
  }
  return out.filter((row) => row.old !== row.new);
}

const UUID_RE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/**
 * Gives the seeded programs their stable ids. Returns how many ids moved. Needs a role that may
 * set `session_replication_role` (the local superuser); elsewhere it reports the reason and
 * leaves the random ids in place.
 */
export async function stabilizeProgramIds(orgId: string, programIds: readonly string[]): Promise<{ moved: number; skipped?: string }> {
  if (programIds.length === 0) return { moved: 0 };
  const rows = await mapFor(orgId, programIds);
  if (rows.length === 0) return { moved: 0 };
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx.execute(sql`create temp table seed_id_map (old uuid primary key, new uuid not null) on commit drop`);
      for (let start = 0; start < rows.length; start += 2000) {
        const chunk = rows.slice(start, start + 2000);
        await tx.execute(sql`insert into seed_id_map (old, new) select * from unnest(${`{${chunk.map((r) => r.old).join(',')}}`}::uuid[], ${`{${chunk.map((r) => r.new).join(',')}}`}::uuid[])`);
      }
      await tx.execute(sql.raw(`
        create or replace function pg_temp.seed_remap(input text) returns text language plpgsql as $$
        declare hit record; output text := input; mapped uuid;
        begin
          if input is null then return null; end if;
          for hit in select distinct m[1] as u from regexp_matches(input, '(${UUID_RE})', 'g') as m loop
            select new into mapped from seed_id_map where old = hit.u::uuid;
            if found then output := replace(output, hit.u, mapped::text); end if;
          end loop;
          return output;
        end $$`));
      const columns = await tx.execute<{ table_name: string; column_name: string; data_type: string; has_org: boolean }>(sql`
        select c.table_name, c.column_name, c.data_type,
               exists (select 1 from information_schema.columns o where o.table_schema = c.table_schema and o.table_name = c.table_name and o.column_name = 'org_id') as has_org
          from information_schema.columns c join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
         where c.table_schema = 'pm' and c.data_type in ('uuid', 'text', 'jsonb', 'ARRAY')
         order by c.table_name, c.column_name`);
      for (const column of columns.rows) {
        const table = `pm."${column.table_name}"`;
        const col = `"${column.column_name}"`;
        const scope = column.has_org ? `t.org_id = '${orgId}'::uuid and ` : '';
        if (column.data_type === 'uuid') {
          await tx.execute(sql.raw(`update ${table} t set ${col} = m.new from seed_id_map m where ${scope}t.${col} = m.old`));
        } else if (column.data_type === 'text') {
          await tx.execute(sql.raw(`update ${table} t set ${col} = pg_temp.seed_remap(t.${col}) where ${scope}t.${col} ~ '${UUID_RE}'`));
        } else if (column.data_type === 'jsonb') {
          await tx.execute(sql.raw(`update ${table} t set ${col} = pg_temp.seed_remap(t.${col}::text)::jsonb where ${scope}t.${col}::text ~ '${UUID_RE}'`));
        }
      }
      // Record links live in core; ids are text there.
      await tx.execute(sql`update core.record_links set from_id = pg_temp.seed_remap(from_id::text)::text where org_id = ${orgId}::uuid and from_type like 'pm\_%'`);
      await tx.execute(sql`update core.record_links set to_id = pg_temp.seed_remap(to_id::text)::text where org_id = ${orgId}::uuid and to_type like 'pm\_%'`);
    });
  } catch (error) {
    return { moved: 0, skipped: error instanceof Error ? error.message : String(error) };
  }
  return { moved: rows.length };
}
