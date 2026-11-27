/**
 * Projects tools (the `pm` schema, shared by every org, so every query filters on the
 * configured org id). Private projects are left out unless KITSTAK_MCP_INCLUDE_PRIVATE=1.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { MAX_LIMIT } from './config.js';
import { readShared, type Org, type Sql, type Tx } from './db.js';
import { dateArg, fail, json, like, limitArg, plainText, READ_ONLY } from './util.js';

export interface ProjectsContext {
  readonly sql: Sql;
  readonly org: Org;
  readonly defaultLimit: number;
  readonly includePrivate: boolean;
  readonly canReadUsers: boolean;
}

/** Live projects this server may read. Needs alias p. */
function visibleProjects(tx: Tx, ctx: ProjectsContext) {
  return tx`
    p.org_id = ${ctx.org.id}::uuid AND p.deleted_at IS NULL AND p.is_template = false
    ${ctx.includePrivate ? tx`` : tx`AND p.visibility = 'org'`}`;
}

function userName(tx: Tx, ctx: ProjectsContext, column: string) {
  return ctx.canReadUsers
    ? tx`(SELECT u.name FROM core."user" u WHERE u.id = ${tx(column)})`
    : tx`NULL::text`;
}

const TASK_KEY_RE = /^([A-Za-z0-9]+)-(\d+)$/;

export function registerProjectsTools(server: McpServer, ctx: ProjectsContext): void {
  const lim = (n: number | undefined) => Math.min(n ?? ctx.defaultLimit, MAX_LIMIT);

  server.registerTool(
    'projects_list',
    {
      title: 'List projects',
      description:
        'Projects and Programs (kind "program": recurring work under one price card) with status, health and its note, owner, dates, and open, done and overdue task counts.',
      inputSchema: {
        status: z
          .enum(['planning', 'active', 'on_hold', 'completed', 'archived'])
          .optional()
          .describe('Leave empty for everything not completed or archived.'),
        health: z.enum(['on_track', 'at_risk', 'off_track']).optional(),
        kind: z.enum(['project', 'program']).optional().describe('Leave empty for both.'),
        query: z.string().optional().describe('Part of the project name or key.'),
        limit: limitArg,
      },
      annotations: READ_ONLY,
    },
    async (a) =>
      json(
        await readShared(
          ctx.sql,
          (tx) => tx`
            SELECT p.key, p.name, p.kind, p.status, p.health, p.health_note, ${userName(tx, ctx, 'p.owner_id')} AS owner,
              p.start_date::text, p.due_date::text,
              count(t.id) FILTER (WHERE s.category IN ('todo', 'in_progress')) AS open_tasks,
              count(t.id) FILTER (WHERE s.category = 'done') AS done_tasks,
              count(t.id) FILTER (WHERE s.category IN ('todo', 'in_progress') AND t.due_date < current_date) AS overdue_tasks
            FROM pm.projects p
            LEFT JOIN pm.tasks t ON t.project_id = p.id AND t.deleted_at IS NULL AND t.parent_task_id IS NULL
            LEFT JOIN pm.statuses s ON s.id = t.status_id
            WHERE ${visibleProjects(tx, ctx)}
              ${a.status ? tx`AND p.status = ${a.status}` : tx`AND p.status NOT IN ('completed', 'archived')`}
              ${a.health ? tx`AND p.health = ${a.health}` : tx``}
              ${a.kind ? tx`AND p.kind = ${a.kind}` : tx``}
              ${a.query ? tx`AND (p.name ILIKE ${like(a.query)} OR p.key ILIKE ${like(a.query)})` : tx``}
            GROUP BY p.id
            ORDER BY p.due_date NULLS LAST, p.name
            LIMIT ${lim(a.limit)}`,
        ),
      ),
  );

  server.registerTool(
    'projects_search_tasks',
    {
      title: 'Search project tasks',
      description:
        'Tasks across projects and Programs (kind "build" rows are Program builds). Filter by project key, status category, assignee name, due date, overdue, or text in the title and description.',
      inputSchema: {
        project_key: z.string().optional().describe('e.g. "OPS".'),
        status: z
          .enum(['open', 'todo', 'in_progress', 'done', 'cancelled'])
          .optional()
          .describe('"open" means todo or in progress (the default).'),
        assignee: z.string().optional().describe('Part of the assignee name.'),
        due_before: dateArg.describe('YYYY-MM-DD, inclusive.'),
        overdue_only: z.boolean().optional(),
        query: z.string().optional(),
        limit: limitArg,
      },
      annotations: READ_ONLY,
    },
    async (a) => {
      if (a.assignee && !ctx.canReadUsers) {
        return fail('Cannot filter by assignee: this database role cannot read user names.');
      }
      return json(
        await readShared(
          ctx.sql,
          (tx) => tx`
            SELECT p.key || '-' || t.number AS task, t.kind, t.title, p.name AS project, s.name AS status,
              s.category, t.priority, ${userName(tx, ctx, 't.assignee_id')} AS assignee,
              t.start_date::text, t.due_date::text, t.is_milestone, count(*) OVER () AS total_matching
            FROM pm.tasks t
            JOIN pm.projects p ON p.id = t.project_id
            JOIN pm.statuses s ON s.id = t.status_id
            WHERE ${visibleProjects(tx, ctx)} AND t.org_id = ${ctx.org.id}::uuid AND t.deleted_at IS NULL
              ${a.project_key ? tx`AND p.key = ${a.project_key.toUpperCase()}` : tx``}
              ${
                !a.status || a.status === 'open' || a.overdue_only
                  ? tx`AND s.category IN ('todo', 'in_progress')`
                  : tx`AND s.category = ${a.status}`
              }
              ${a.overdue_only ? tx`AND t.due_date < current_date` : tx``}
              ${a.due_before ? tx`AND t.due_date <= ${a.due_before}::date` : tx``}
              ${
                a.assignee
                  ? tx`AND t.assignee_id IN (SELECT u.id FROM core."user" u WHERE u.name ILIKE ${like(a.assignee)})`
                  : tx``
              }
              ${a.query ? tx`AND (t.title ILIKE ${like(a.query)} OR t.description ILIKE ${like(a.query)})` : tx``}
            ORDER BY t.due_date NULLS LAST, p.key, t.number
            LIMIT ${lim(a.limit)}`,
        ),
      );
    },
  );

  server.registerTool(
    'projects_get_task',
    {
      title: 'Get project task',
      description: 'One task by its key (e.g. "OPS-42") with description, subtasks and latest comments.',
      inputSchema: { task: z.string().regex(TASK_KEY_RE).describe('Task key like "OPS-42".') },
      annotations: READ_ONLY,
    },
    async ({ task }) => {
      const [, key, num] = TASK_KEY_RE.exec(task)!;
      const result = await readShared(ctx.sql, async (tx) => {
        const [row] = await tx<{ id: string; description: string | null }[]>`
          SELECT t.id::text, p.key || '-' || t.number AS task, t.kind, t.title, p.name AS project, p.kind AS project_kind,
            s.name AS status,
            s.category, t.priority, ${userName(tx, ctx, 't.assignee_id')} AS assignee,
            ${userName(tx, ctx, 't.reporter_id')} AS reporter, t.start_date::text, t.due_date::text, t.completed_at,
            m.name AS milestone, t.description, t.created_at, t.updated_at
          FROM pm.tasks t
          JOIN pm.projects p ON p.id = t.project_id
          JOIN pm.statuses s ON s.id = t.status_id
          LEFT JOIN pm.milestones m ON m.id = t.milestone_id
          WHERE ${visibleProjects(tx, ctx)} AND t.deleted_at IS NULL
            AND p.key = ${key!.toUpperCase()} AND t.number = ${Number(num)}`;
        if (!row) return null;
        const subtasks = await tx`
          SELECT p.key || '-' || t.number AS task, t.title, s.name AS status, s.category, t.due_date::text
          FROM pm.tasks t JOIN pm.projects p ON p.id = t.project_id JOIN pm.statuses s ON s.id = t.status_id
          WHERE t.parent_task_id = ${row.id}::uuid AND t.deleted_at IS NULL
          ORDER BY t.position`;
        const comments = await tx`
          SELECT ${userName(tx, ctx, 'c.author_id')} AS author, left(c.body, 1500) AS text, c.created_at
          FROM pm.comments c
          WHERE c.task_id = ${row.id}::uuid AND c.org_id = ${ctx.org.id}::uuid AND c.deleted_at IS NULL
          ORDER BY c.created_at DESC
          LIMIT 10`;
        const { id: _id, description, ...rest } = row;
        return { ...rest, description: plainText(description), subtasks, latest_comments: comments };
      });
      return result ? json(result) : fail(`No task ${task} in a project this server can read.`);
    },
  );
}
