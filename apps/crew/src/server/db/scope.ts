/**
 * The scope of the database guard (docs/pulse/CONTRACTS.md section 12, rule 13): which workspace the current call chain may
 * touch. No database driver in here, so anything on the server can import it.
 *
 *   scoped(fn)            every exported data function that is handed a DomainContext or an org
 *                         id is declared with it; the scope is that workspace for everything the
 *                         function awaits.
 *   withOrg(orgId, fn)    the same for code that has an org id and no function to wrap.
 *   asSystem(reason, fn)  THE escape hatch: runs as the table owner, across workspaces. Only for
 *                         work that is cross org by design (sign in, cron fan out, seeds, sibling
 *                         schemas, health checks). `src/server/db-guard.test.ts` lists every
 *                         allowed caller.
 *
 * `src/server/db.ts` reads the scope and opens every statement with the plain role and the
 * workspace setting. A statement with no scope is refused there (`DbGuardError`).
 */
import { AsyncLocalStorage } from 'node:async_hooks';

/** The plain role of migration 0009: no login, owns nothing, cannot skip row level security. */
export const DB_GUARD_ROLE = 'crew_app';

type DbScope = { readonly kind: 'org'; readonly orgId: string } | { readonly kind: 'system'; readonly reason: string };

interface ScopeGlobal {
  __kitstakCrewScope?: AsyncLocalStorage<DbScope>;
  __kitstakCrewGuardRefusals?: string[];
}

const globalSlot = globalThis as typeof globalThis & ScopeGlobal;
/** One store per process (a global slot, because Next loads this module once per bundle layer). */
const scopeStore = (globalSlot.__kitstakCrewScope ??= new AsyncLocalStorage<DbScope>());

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when `CREW_DB_GUARD` is 1, true or on. Read on every call, so a test can flip it. */
export function dbGuardOn(): boolean {
  const flag = process.env.CREW_DB_GUARD?.trim().toLowerCase();
  return flag === '1' || flag === 'true' || flag === 'on';
}

/** A statement reached the database with no org scope and no `asSystem`. */
export class DbGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DbGuardError';
  }
}

/** What the current async call chain runs as: an org id, 'system', or null when nothing set it. */
export function currentDbScope(): { org: string | null; system: boolean } | null {
  const scope = scopeStore.getStore();
  if (!scope) return null;
  return scope.kind === 'org' ? { org: scope.orgId, system: false } : { org: null, system: true };
}

interface ThenableLike {
  then: (resolve: (value: unknown) => void, reject: (reason: unknown) => void) => unknown;
}
const isLazyThenable = (value: unknown): value is ThenableLike =>
  typeof value === 'object' && value !== null && !(value instanceof Promise) && typeof (value as { then?: unknown }).then === 'function';

/**
 * A Drizzle query that is not awaited yet runs when someone awaits it, which may be after the
 * scope has ended. Starting it here keeps it inside the scope.
 */
function startInScope<T>(out: T): T {
  if (!isLazyThenable(out)) return out;
  return new Promise((resolve, reject) => out.then(resolve, reject)) as unknown as T;
}

/**
 * Runs `fn` with every `db` statement tied to one workspace. Inside another org scope the org
 * must be the same one: a call chain never changes workspace half way.
 */
export function withOrg<T>(orgId: string, fn: () => T): T {
  if (!UUID_RE.test(orgId)) throw new DbGuardError('The workspace id of a database scope must be a uuid.');
  const outer = scopeStore.getStore();
  const wanted = orgId.toLowerCase();
  if (outer?.kind === 'org') {
    if (outer.orgId === wanted) return startInScope(fn());
    throw new DbGuardError('A call for one workspace tried to act for another workspace.');
  }
  return scopeStore.run({ kind: 'org', orgId: wanted }, () => startInScope(fn()));
}

/**
 * THE escape hatch: runs `fn` as the table owner, across workspaces. Give the reason in plain
 * words. Allowed callers are listed in `src/server/db-guard.test.ts`; a new one fails that test.
 */
export function asSystem<T>(reason: string, fn: () => T): T {
  return scopeStore.run({ kind: 'system', reason }, () => startInScope(fn()));
}

/**
 * Declares a domain function: everything it runs on `db` is tied to one workspace.
 *
 *   export const listJobs = scoped(async function listJobs(ctx: DomainContext, ...) { ... });
 *   export const logActivity = scoped(async function logActivity(executor, ctx, ...) { ... }, 1);
 *   export const loadSettings = scoped(async function loadSettings(orgId: string, ...) { ... });
 *
 * `at` is the position of the argument that names the workspace: a DomainContext or an org id.
 * A query builder that is returned without `await` is started inside the scope, so it cannot run
 * later with no scope.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic over any domain function shape
export function scoped<F extends (...args: any[]) => unknown>(fn: F, at = 0): F {
  const wrapped = function (this: unknown, ...args: unknown[]): unknown {
    const arg = args[at] as { orgId?: unknown } | string | null | undefined;
    const orgId = typeof arg === 'string' ? arg : arg && typeof arg === 'object' ? arg.orgId : undefined;
    if (typeof orgId !== 'string') throw new DbGuardError(`${fn.name || 'A domain function'} was called without a workspace.`);
    return withOrg(orgId, () => (fn as (...inner: unknown[]) => unknown).apply(this, args));
  };
  Object.defineProperty(wrapped, 'name', { value: fn.name });
  Object.defineProperty(wrapped, 'length', { value: fn.length });
  return wrapped as unknown as F;
}

export function noteRefusal(text: string): void {
  (globalSlot.__kitstakCrewGuardRefusals ??= []).push(text);
  if (globalSlot.__kitstakCrewGuardRefusals.length > 50) globalSlot.__kitstakCrewGuardRefusals.shift();
  console.error('[crew] database guard refused a statement', text);
}

/**
 * "permission denied" under the plain role means a query reached for something outside the
 * guard's grants (a sibling schema, a core table). Loud on purpose: a fail soft reader may catch
 * the error, and it must still be seen.
 */
export function notePermissionDenied(error: unknown): void {
  const found = error as { code?: unknown; message?: unknown } | null;
  if (found && found.code === '42501') noteRefusal(`The plain role was refused: ${String(found.message)}\n${new Error().stack ?? ''}`);
}

/** Stacks of the statements the guard refused in this process (newest last). Tests read and clear it. */
export function dbGuardRefusals(clear = false): readonly string[] {
  const found = [...(globalSlot.__kitstakCrewGuardRefusals ?? [])];
  if (clear) globalSlot.__kitstakCrewGuardRefusals = [];
  return found;
}

/** The statement that opens every guarded transaction, or null when the owner may run (guard off or `asSystem`). */
export function guardSetup(): string | null {
  if (!dbGuardOn()) return null;
  const scope = scopeStore.getStore();
  if (!scope) {
    const refusal = new DbGuardError(
      'A database statement ran with no workspace scope. Call it from a domain function that takes a DomainContext, or wrap cross workspace work in asSystem.',
    );
    noteRefusal(refusal.stack ?? refusal.message);
    throw refusal;
  }
  if (scope.kind === 'system') return null;
  return `SET LOCAL ROLE "${DB_GUARD_ROLE}"; SELECT set_config('crew.org_id', '${scope.orgId}', true)`;
}
