/**
 * Board forms: publish / unpublish a Form view and the PUBLIC read + submit path.
 *
 * Public access is by an unguessable token stored at `view.config.form.token` (minted here,
 * 32 bytes of randomness). The public path runs with a system service context scoped to the
 * view's own org, and only ever writes the columns listed as visible questions on the form.
 */
import { randomBytes } from 'node:crypto';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { boards, groups, views } from '@/server/db/schema';
import { BadRequestError, ForbiddenError, NotFoundError, ValidationError } from '@/server/http/errors';
import { requireBoard } from './access';
import { inTransaction, type ServiceContext } from './context';
import type { ViewDto } from './contracts/dto';
import {
  answersToValues,
  formClosedReason,
  looksAutomated,
  parseFormSettings,
  pickUniqueForm,
  toPublicForm,
  type FormColumn,
  type PublicFormDto,
  type PublicSubmission,
} from './board-views-form-model';
import { issueRenderStamp, verifyRenderStamp } from './board-views-form-stamp';
import { loadBoardColumns } from './item-reads';
import { createItem } from './items';
import { toViewDto } from './mappers';
import { db as defaultDb, type Executor } from '@/server/db';
import { env } from '@/server/env';

const TOKEN_RE = /^[A-Za-z0-9_-]{32,80}$/;

function mintToken(): string {
  return randomBytes(32).toString('base64url');
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function toFormColumns(rows: Awaited<ReturnType<typeof loadBoardColumns>>): FormColumn[] {
  return rows
    .filter((row) => row.scope === 'item')
    .map((row) => ({ key: row.key, title: row.title, type: row.type, settings: row.settings, description: row.description }));
}

/** Publish (minting a token on first publish) or unpublish a shared Form view. */
export async function setFormPublished(ctx: ServiceContext, viewId: string, published: boolean): Promise<ViewDto> {
  return inTransaction(ctx, async (tx) => {
    const [view] = await tx.db
      .select()
      .from(views)
      .where(and(eq(views.id, viewId), eq(views.orgId, tx.orgId), isNull(views.deletedAt)))
      .limit(1);
    if (!view || (view.ownerId && view.ownerId !== tx.userId)) throw new NotFoundError('View');
    if (view.type !== 'form') throw new BadRequestError('Only form views can be published');
    if (view.ownerId) throw new ForbiddenError('Personal views cannot be published');
    await requireBoard(tx, view.boardId, 'write');
    const config = (view.config ?? {}) as Record<string, unknown>;
    const form = (typeof config.form === 'object' && config.form !== null ? config.form : {}) as Record<string, unknown>;
    let token = typeof form.token === 'string' && TOKEN_RE.test(form.token) ? form.token : mintToken();
    // Tokens are server-minted, but fail safe: never publish a token another view already holds.
    const holders = await tx.db
      .select({ id: views.id })
      .from(views)
      .where(and(sql`${views.config}->'form'->>'token' = ${token}`, ne(views.id, viewId)))
      .limit(1);
    if (holders.length > 0) token = mintToken();
    const [row] = await tx.db
      .update(views)
      .set({ config: { ...config, form: { ...form, token, published } }, updatedAt: new Date() })
      .where(eq(views.id, viewId))
      .returning();
    if (!row) throw new NotFoundError('View');
    return toViewDto(row);
  });
}

interface ResolvedForm {
  readonly viewId: string;
  readonly orgId: string;
  readonly boardId: string;
  readonly boardName: string;
  readonly config: Record<string, unknown>;
}

async function resolveToken(executor: Executor, token: string): Promise<ResolvedForm> {
  if (!TOKEN_RE.test(token)) throw new NotFoundError('Form');
  const rows = await executor
    .select({ view: views, boardName: boards.name, boardDeleted: boards.deletedAt, boardArchived: boards.archivedAt })
    .from(views)
    .innerJoin(boards, eq(boards.id, views.boardId))
    .where(
      and(
        eq(views.type, 'form'),
        isNull(views.deletedAt),
        isNull(views.ownerId),
        sql`${views.config}->'form'->>'token' = ${token}`,
        sql`(${views.config}->'form'->>'published')::boolean is true`,
      ),
    )
    .limit(2);
  // Ambiguous tokens fail closed: a public link must map to exactly one form.
  const row = pickUniqueForm(rows);
  if (!row || row.boardDeleted || row.boardArchived) throw new NotFoundError('Form');
  return {
    viewId: row.view.id,
    orgId: row.view.orgId,
    boardId: row.view.boardId,
    boardName: row.boardName,
    config: (row.view.config ?? {}) as Record<string, unknown>,
  };
}

function systemContext(orgId: string, executor: Executor = defaultDb): ServiceContext {
  return { db: executor, orgId, userId: null, roles: [] };
}

// Signed render stamp (time trap) ------------------------------------------------------------------

/** `<issuedAtMs>.<hmac>` bound to this form's token. */
export function issueRenderToken(token: string, now: number = Date.now()): string {
  return issueRenderStamp(env.BETTER_AUTH_SECRET, token, now);
}

export function verifyRenderToken(token: string, stamp: string | undefined, now: number = Date.now()): number | null {
  return verifyRenderStamp(env.BETTER_AUTH_SECRET, token, stamp, now);
}

/** True when a submission should get a silent fake success (honeypot / time trap). */
export function isAutomatedSubmission(token: string, input: PublicSubmission, now: number = Date.now()): boolean {
  return looksAutomated(input, verifyRenderToken(token, input.renderToken, now));
}

export async function getPublicForm(token: string, executor: Executor = defaultDb): Promise<PublicFormDto> {
  const form = await resolveToken(executor, token);
  const ctx = systemContext(form.orgId, executor);
  const columns = toFormColumns(await loadBoardColumns(ctx, form.boardId));
  const settings = parseFormSettings(form.config.form, columns, `${form.boardName} intake`);
  return { ...toPublicForm(settings, columns, todayUtc()), renderToken: issueRenderToken(token) };
}

export async function submitPublicForm(
  token: string,
  input: PublicSubmission,
  executor: Executor = defaultDb,
): Promise<{ readonly accepted: true }> {
  const form = await resolveToken(executor, token);
  const ctx = systemContext(form.orgId, executor);
  const columns = toFormColumns(await loadBoardColumns(ctx, form.boardId));
  const settings = parseFormSettings(form.config.form, columns, `${form.boardName} intake`);
  const closed = formClosedReason(settings, todayUtc());
  if (closed) throw new ForbiddenError('This form is no longer accepting responses', { reason: closed });
  const result = answersToValues(settings.questions, columns, input.answers);
  if (!result.ok) {
    throw new ValidationError(Object.entries(result.errors).map(([path, message]) => ({ path, message })));
  }
  let groupId: string | undefined;
  if (settings.groupId) {
    const [group] = await executor
      .select({ id: groups.id })
      .from(groups)
      .where(and(eq(groups.id, settings.groupId), eq(groups.boardId, form.boardId), isNull(groups.archivedAt)))
      .limit(1);
    groupId = group?.id;
  }
  await createItem(ctx, form.boardId, {
    name: result.name,
    values: result.values as never,
    ...(groupId && { groupId }),
    position: 'top',
  });
  // Response counter (drives "close after N responses"); best effort, atomic jsonb increment.
  await executor
    .update(views)
    .set({
      config: sql`jsonb_set(${views.config}, '{form,responseCount}', to_jsonb(coalesce((${views.config}->'form'->>'responseCount')::int, 0) + 1))`,
    })
    .where(eq(views.id, form.viewId));
  return { accepted: true };
}
