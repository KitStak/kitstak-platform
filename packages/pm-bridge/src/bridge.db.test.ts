/**
 * Round trip against the shared dev Postgres (DATABASE_URL, default the local kitstak DB):
 * create a task from a "CRM deal", read it back as linked work, emit a stage change and check
 * the queued automation event. Everything runs in one transaction that is rolled back.
 * Skipped when the database or the pm schema is not available.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import {
  countLinkedWork,
  createTaskFromExternal,
  emitRecordStatusChange,
  linkProjectToRecord,
  listLinkedWork,
  listWritableProjects,
  removeLink,
  rowsOf,
  type BridgeExecutor,
} from './index';

const url = process.env.DATABASE_URL ?? 'postgres://postgres@localhost:5432/kitstak';
const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 1500 });

async function ready(): Promise<boolean> {
  try {
    const { rows } = await pool.query<{ ok: boolean }>("select to_regclass('pm.integration_events') is not null as ok");
    return rows[0]?.ok === true;
  } catch {
    return false;
  }
}

const available = await ready();
vi.setConfig({ testTimeout: 30_000 });
afterAll(() => pool.end());

class Rollback extends Error {}

describe.skipIf(!available)('pm-bridge (database)', () => {
  it('creates, reads, links and emits inside one rolled-back transaction', async () => {
    const db = drizzle(pool);
    await db
      .transaction(async (tx) => {
        const exec = tx as unknown as BridgeExecutor;
        const [actorRow] = rowsOf<{ org_id: string; user_id: string }>(
          await tx.execute(sql`select m.organization_id as org_id, m.user_id from core.member m
                                where m.role like '%owner%' or m.role like '%admin%' limit 1`),
        );
        expect(actorRow).toBeDefined();
        const actor = { orgId: actorRow!.org_id, userId: actorRow!.user_id };
        const [project] = rowsOf<{ id: string }>(
          await tx.execute(sql`insert into pm.projects (org_id, key, name, position, owner_id)
                               values (${actor.orgId}::uuid, 'ZZBRG', 'Bridge test', 'a0', ${actor.userId}::uuid) returning id`),
        );
        await tx.execute(sql`insert into pm.statuses (org_id, project_id, name, category, position, is_default)
                             values (${actor.orgId}::uuid, ${project!.id}::uuid, 'To do', 'todo', 'a0', true),
                                    (${actor.orgId}::uuid, ${project!.id}::uuid, 'Done', 'done', 'a1', false)`);
        const urls = { projectsUrl: 'https://projects.example/' };
        const dealId = '00000000-0000-4000-8000-00000000beef';

        const writable = await listWritableProjects(exec, actor, { query: 'Bridge' });
        expect(writable.map((p) => p.key)).toContain('ZZBRG');
        expect(writable.find((p) => p.key === 'ZZBRG')?.statuses).toHaveLength(2);

        const created = await createTaskFromExternal(
          exec,
          actor,
          {
            projectId: project!.id,
            title: '  Send   onboarding kit ',
            description: 'Line one\nLine two',
            priority: 'high',
            dueDate: '2030-01-15',
            link: { type: 'crm_item', id: dealId, title: 'Acme renewal', status: 'Proposal' },
            source: 'crm',
          },
          urls,
        );
        expect(created.task.key).toBe('ZZBRG-1');
        expect(created.task.title).toBe('Send onboarding kit');
        expect(created.task.url).toBe('https://projects.example/p/ZZBRG/1');
        expect(created.task.status.name).toBe('To do');

        await linkProjectToRecord(exec, actor, project!.id, { type: 'crm_item', id: dealId, title: 'Acme renewal' });
        const work = await listLinkedWork(exec, actor, [{ type: 'crm_item', id: dealId }], urls);
        expect(work.tasks.map((t) => t.key)).toEqual(['ZZBRG-1']);
        expect(work.projects.map((p) => p.key)).toEqual(['ZZBRG']);
        expect(work.projects[0]!.progress).toMatchObject({ total: 1, done: 0, percent: 0 });
        expect(work.openTasks).toBe(1);

        const counts = await countLinkedWork(exec, actor, 'crm_item', [dealId]);
        expect(counts[dealId]).toEqual({ tasks: 1, openTasks: 1, projects: 1 });

        const emitted = await emitRecordStatusChange(exec, {
          orgId: actor.orgId,
          source: 'crm',
          target: { type: 'crm_item', id: dealId },
          status: 'Won',
          title: 'Acme renewal',
        });
        expect(emitted).toEqual({ linksUpdated: 2, queued: true });
        const events = rowsOf<{ kind: string; before_status: string | null; after_status: string | null }>(
          await tx.execute(sql`select kind, before_status, after_status from pm.integration_events
                                where org_id = ${actor.orgId}::uuid and target_id = ${dealId} order by created_at, kind`),
        );
        expect(events.map((e) => e.kind).sort()).toEqual(['record_status_changed', 'task_created']);
        expect(events.find((e) => e.kind === 'record_status_changed')).toMatchObject({ before_status: 'Proposal', after_status: 'Won' });

        // Same status again: links refresh, no duplicate event.
        expect((await emitRecordStatusChange(exec, { orgId: actor.orgId, source: 'crm', target: { type: 'crm_item', id: dealId }, status: 'Won' })).queued).toBe(false);

        await removeLink(exec, actor, created.linkId);
        expect((await listLinkedWork(exec, actor, [{ type: 'crm_item', id: dealId }], urls)).tasks).toHaveLength(0);

        await expect(
          createTaskFromExternal(exec, actor, { projectId: project!.id, title: ' ', link: { type: 'crm_item', id: dealId, title: 'x' }, source: 'crm' }, urls),
        ).rejects.toMatchObject({ code: 'VALIDATION' });
        throw new Rollback();
      })
      .catch((error: unknown) => {
        if (!(error instanceof Rollback)) throw error;
      });
  });
});
