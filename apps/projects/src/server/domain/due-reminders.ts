/**
 * Due-date reminders for the inbox (nav team). There is no background scheduler, so reminders
 * are created lazily the first time a person's inbox count is read (throttled per person):
 *   - `due_soon`: an open task assigned to you is due today or tomorrow (once per due date),
 *   - `overdue`:  an open task assigned to you is past its due date (once per due date).
 * Moving the due date re-arms the reminder. Muting a kind in notification settings is honored.
 */
import 'server-only';
import { sql } from 'drizzle-orm';
import { db } from '@/server/db';
import type { DomainContext } from './_shared';

const THROTTLE_MS = 10 * 60_000;
const lastRun = new Map<string, number>();

export async function ensureDueReminders(ctx: DomainContext, options: { readonly force?: boolean } = {}): Promise<number> {
  if (ctx.actorKind !== 'user') return 0;
  const key = `${ctx.orgId}:${ctx.userId}`;
  const now = Date.now();
  if (!options.force && now - (lastRun.get(key) ?? 0) < THROTTLE_MS) return 0;
  lastRun.set(key, now);
  if (lastRun.size > 5000) lastRun.clear();
  try {
    const result = await db.execute(sql`
      with prefs as (
        select coalesce(p.prefs -> 'notifications', '{}'::jsonb) as toggles
        from (select 1) one
        left join pm.user_prefs p on p.org_id = ${ctx.orgId} and p.user_id = ${ctx.userId}
      ),
      candidates as (
        select t.id as task_id, t.project_id, t.title, t.number, t.due_date, p.key as project_key,
          case when t.due_date < current_date then 'overdue' else 'due_soon' end as kind
        from pm.tasks t
        join pm.projects p on p.id = t.project_id
        join pm.statuses s on s.id = t.status_id
        where t.org_id = ${ctx.orgId}
          and t.assignee_id = ${ctx.userId}
          and t.deleted_at is null and p.deleted_at is null and p.archived_at is null
          and s.category not in ('done', 'cancelled')
          and t.due_date is not null
          and t.due_date between current_date - 30 and current_date + 1
      )
      insert into pm.notifications (org_id, user_id, kind, project_id, task_id, title, body, url)
      select ${ctx.orgId}, ${ctx.userId}, c.kind, c.project_id, c.task_id,
        case
          when c.kind = 'overdue' then c.project_key || '-' || c.number || ' is overdue'
          when c.due_date = current_date then c.project_key || '-' || c.number || ' is due today'
          else c.project_key || '-' || c.number || ' is due tomorrow'
        end,
        left(c.title, 300),
        '/p/' || c.project_key || '/' || c.number
      from candidates c, prefs
      where coalesce((prefs.toggles ->> c.kind)::boolean, true)
        and not exists (
          select 1 from pm.notifications n
          where n.org_id = ${ctx.orgId} and n.user_id = ${ctx.userId} and n.task_id = c.task_id and n.kind = c.kind
            and n.created_at >= (c.due_date - case when c.kind = 'overdue' then 0 else 1 end)::timestamptz
        )
    `);
    return result.rowCount ?? 0;
  } catch {
    // Reminders are a convenience; never break the inbox over them.
    return 0;
  }
}
