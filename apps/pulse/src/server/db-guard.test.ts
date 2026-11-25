/**
 * No query path around the database guard (CONTRACTS section 12, rule 13). This test reads the source and fails
 * when someone adds a way to reach `pulse` data that skips the guard:
 *
 *   1. Every exported function of the data layer that is handed a DomainContext or an org id is
 *      declared with `scoped(...)`, so its statements are tied to that workspace.
 *   2. An exported function that touches the database with no context is on a short list here,
 *      with its reason. It must set a scope itself (`asSystem`, `withOrg`, `forDevice`).
 *   3. The escape hatches (`asSystem`, `systemDb`, `siblingDb`, the raw pool) are only used in
 *      the files listed here. A new caller has to be added to the list, in a reviewed change.
 *   4. `siblingDb` never reads a `pulse` table.
 *   5. Only the guard itself (`src/server/db.ts`, `src/server/db/scope.ts`) changes the database
 *      role or the workspace setting.
 *   6. API routes and server actions run their handler inside `withOrg`.
 *
 * The other half of the proof is at run time: with the guard on, a statement with no scope is
 * refused, and the whole test suite runs with the guard on (`src/test/setup-env.ts`).
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(__dirname, '..');
const rel = (file: string): string => path.relative(SRC, file).split(path.sep).join('/');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const isTest = (file: string): boolean => /\.test\.tsx?$/.test(file) || file.includes(`${path.sep}test${path.sep}`);
const ALL = walk(SRC).filter((file) => !isTest(file));
const read = (file: string): string => fs.readFileSync(file, 'utf8');

/** The data layer: files whose exported functions run queries for a workspace. */
const DATA_LAYER = ALL.filter((file) => {
  const name = rel(file);
  return /^server\/domain\/[^/]+\.ts$/.test(name) || /^server\/integrations\/[^/]+\.ts$/.test(name) || /^features\/[^/]+\/server\/[^/]+\.ts$/.test(name);
});

/**
 * Exported functions that reach the database with no DomainContext and no org id. Each one sets
 * its own scope. Adding a name here needs a reason a reviewer accepts. (The device link functions
 * in devices.ts and wall.ts take a secret: they look the link up with asSystem, then run their
 * private helpers inside forDevice or withOrg. A helper that forgot that is refused at run time.)
 */
const NO_CONTEXT_ALLOWED: Readonly<Record<string, string>> = {
  'server/domain/_shared.ts:inTx': 'the transaction helper itself: it runs under the scope of its caller',
  'server/domain/cron.ts:orgsUsingPulse': 'cron fan out: lists every workspace, asSystem',
  'server/domain/cron.ts:runCleanup': 'daily cleanup across workspaces, asSystem',
  'server/integrations/detect.ts:tableExists': 'asks the catalog whether a sibling table exists, siblingDb',
};

/** Files that may call `asSystem`, and why. */
const AS_SYSTEM_ALLOWED: Readonly<Record<string, string>> = {
  'server/db/scope.ts': 'defines it',
  'server/session.ts': 'sign in: finds the workspaces of a person before any workspace is known',
  'server/entitlements.ts': 'module entitlements live in core.entitlements, checked before the workspace is trusted',
  'server/plan.ts': 'plan state (trial, subscription, billing roles) lives in core billing tables, read for the active workspace',
  'app/api/health/route.ts': 'health check: no workspace data',
  'app/no-workspace/page.tsx': 'a person with no workspace: invitations in core',
  'server/domain/cron.ts': 'cron fan out and daily cleanup across workspaces',
  'server/domain/devices.ts': 'device link lookup by its secret',
  'server/integrations/detect.ts': 'sibling schemas have no Pulse policy (siblingDb, core.wms_tenants)',
  'server/db/seed/context.ts': 'demo seed builds a workspace across schemas',
};

/** Files that may use the sibling handle (crm, pm, WMS tenant schemas). Never for a pulse table. */
const SIBLING_ALLOWED = new Set([
  'server/integrations/detect.ts',
  'server/integrations/index.ts',
  'server/integrations/crm.ts',
  'server/integrations/projects.ts',
  'server/integrations/programs.ts',
  'server/integrations/wms.ts',
  'server/domain/access.ts',
  'server/domain/people.ts',
  'server/domain/ledger.ts',
  'features/jobs/server/job-sources.ts',
  'features/clients/server/sibling-links.ts',
]);

const SYSTEM_DB_ALLOWED = new Set(['server/db/system.ts', 'server/auth.ts']);
const RAW_POOL_ALLOWED = new Set(['server/db.ts', 'server/db/system.ts', 'server/db/seed/context.ts']);

interface ExportedFn {
  readonly file: string;
  readonly name: string;
  readonly scoped: boolean;
  /** Position of the first DomainContext or `orgId: string` among the first two parameters, or -1. */
  readonly workspaceArg: number;
  readonly touchesDb: boolean;
  readonly body: string;
}

function workspaceArgOf(params: ts.NodeArray<ts.ParameterDeclaration>): number {
  for (const [index, param] of [...params].slice(0, 2).entries()) {
    const type = param.type?.getText() ?? '';
    if (type === 'DomainContext') return index;
    if (param.name.getText() === 'orgId' && type === 'string') return index;
  }
  return -1;
}

const TOUCHES_DB = /\bdb\b|\binTx\(|\bsiblingDb\b|\bsystemDb\b/;

function exportedFunctions(file: string): ExportedFn[] {
  const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
  const out: ExportedFn[] = [];
  const isExported = (node: ts.Node): boolean => ts.canHaveModifiers(node) && Boolean(ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
  source.forEachChild((node) => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body && isExported(node)) {
      const body = node.body.getText();
      out.push({ file: rel(file), name: node.name.text, scoped: false, workspaceArg: workspaceArgOf(node.parameters), touchesDb: TOUCHES_DB.test(body), body });
    }
    if (ts.isVariableStatement(node) && isExported(node)) {
      for (const declaration of node.declarationList.declarations) {
        let init = declaration.initializer;
        if (!init || !ts.isIdentifier(declaration.name)) continue;
        let scoped = false;
        if (ts.isCallExpression(init) && init.expression.getText() === 'scoped' && init.arguments[0]) {
          scoped = true;
          init = init.arguments[0];
        }
        if (!ts.isArrowFunction(init) && !ts.isFunctionExpression(init)) continue;
        const body = init.body.getText();
        out.push({ file: rel(file), name: declaration.name.text, scoped, workspaceArg: workspaceArgOf(init.parameters), touchesDb: TOUCHES_DB.test(body), body });
      }
    }
  });
  return out;
}

const FUNCTIONS = DATA_LAYER.flatMap(exportedFunctions);

/** The first template literal after `from` (the SQL a handle is given), with nested `${...}` parts. */
function templateAfter(text: string, from: number): string {
  const start = text.indexOf('`', from);
  if (start < 0) return '';
  let depth = 0;
  for (let index = start + 1; index < text.length; index += 1) {
    const char = text[index];
    if (char === '\\') index += 1;
    else if (char === '$' && text[index + 1] === '{') depth += 1;
    else if (char === '}' && depth > 0) depth -= 1;
    else if (char === '`' && depth === 0) return text.slice(start, index + 1);
  }
  return text.slice(start);
}

describe('no query path around the database guard', () => {
  it('finds the data layer', () => {
    expect(DATA_LAYER.length).toBeGreaterThan(50);
    expect(FUNCTIONS.filter((fn) => fn.scoped).length).toBeGreaterThan(300);
  });

  it('declares every exported data function that is handed a workspace with scoped()', () => {
    const unscoped = FUNCTIONS.filter((fn) => fn.workspaceArg >= 0 && !fn.scoped).map((fn) => `${fn.file}:${fn.name}`);
    expect(unscoped, 'wrap these in scoped(...) so their statements are tied to the workspace').toEqual([]);
  });

  it('allows a database call with no workspace only for the listed functions, and each sets a scope', () => {
    const loose = FUNCTIONS.filter((fn) => !fn.scoped && fn.workspaceArg < 0 && fn.touchesDb);
    const unknown = loose.map((fn) => `${fn.file}:${fn.name}`).filter((key) => !(key in NO_CONTEXT_ALLOWED));
    expect(unknown, 'a new exported function reaches the database with no DomainContext').toEqual([]);
    const stale = Object.keys(NO_CONTEXT_ALLOWED).filter((key) => !loose.some((fn) => `${fn.file}:${fn.name}` === key));
    expect(stale, 'listed here but no longer in the code').toEqual([]);
    for (const fn of loose) {
      if (fn.name === 'inTx') continue;
      expect(/\b(asSystem|withOrg|forDevice|siblingDb|loadSettings)\b/.test(fn.body), `${fn.file}:${fn.name} sets no scope`).toBe(true);
    }
  });

  it('keeps asSystem to the listed files', () => {
    const users = ALL.filter((file) => /\basSystem\s*\(/.test(read(file))).map(rel).sort();
    expect(users.filter((file) => !(file in AS_SYSTEM_ALLOWED)), 'a new file calls asSystem: add it to AS_SYSTEM_ALLOWED with its reason').toEqual([]);
    expect(Object.keys(AS_SYSTEM_ALLOWED).filter((file) => !users.includes(file)), 'listed here but no longer calls asSystem').toEqual([]);
    // Every call gives its reason in words.
    for (const file of users) {
      if (file === 'server/db/scope.ts') continue;
      for (const call of read(path.join(SRC, file)).matchAll(/\basSystem\s*\(\s*([^,)]*)/g)) {
        expect(/^['`][^'`]{12,}/.test(call[1] ?? ''), `${file}: asSystem needs a reason in plain words`).toBe(true);
      }
    }
  });

  it('keeps systemDb, the raw pool and the sibling handle to the listed files', () => {
    const using = (pattern: RegExp): string[] => ALL.filter((file) => pattern.test(read(file))).map(rel);
    expect(using(/\bsystemDb\b/).filter((file) => !SYSTEM_DB_ALLOWED.has(file))).toEqual([]);
    expect(using(/\b(getPool|getOwnerPool|createGuardedDb)\s*\(|\bcreatePgPool\b|\bcreatePgClient\b|new\s+(pg\.)?(Pool|Client)\s*\(|from 'pg'/).filter((file) => !RAW_POOL_ALLOWED.has(file))).toEqual([]);
    expect(using(/\bsiblingDb\b/).filter((file) => !SIBLING_ALLOWED.has(file))).toEqual([]);
  });

  it('never reads a pulse table through the sibling handle', () => {
    for (const file of [...SIBLING_ALLOWED]) {
      const text = read(path.join(SRC, file));
      // Every use is `rows<T>(siblingDb, sql\`...\`)` or `siblingDb.execute<T>(sql\`...\`)`.
      for (const match of text.matchAll(/\bsiblingDb(\.execute(<[^`]*?>)?\(|,)\s*sql`/g)) {
        const statement = templateAfter(text, match.index ?? 0);
        expect(/\bpulse\s*\.\s*[a-z_"]/.test(statement), `${file}: a pulse table is read through siblingDb`).toBe(false);
      }
    }
  });

  it('changes the database role and the workspace setting only in the guard itself', () => {
    const offenders = ALL.filter((file) => !['server/db.ts', 'server/db/scope.ts'].includes(rel(file)))
      .filter((file) => /\bSET\s+(LOCAL\s+|SESSION\s+)?ROLE\b|\bRESET\s+ROLE\b|SET\s+SESSION\s+AUTHORIZATION|set_config\(\s*'pulse\.org_id'|SET\s+(LOCAL\s+)?pulse\.org_id/i.test(read(file)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it('imports the database handle only in server code', () => {
    const importers = ALL.filter((file) => /import\s+\{[^}]*\bdb\b[^}]*\}\s+from\s+'@\/server\/db'/.test(read(file))).map(rel);
    const outside = importers.filter((file) => !file.startsWith('server/') && !/^features\/[^/]+\/server\//.test(file) && !['app/api/health/route.ts', 'app/no-workspace/page.tsx', 'app/api/v1/export/[file]/route.ts', 'app/api/v1/reports/[slug]/route.ts'].includes(file));
    expect(outside, 'pages and components read through the domain layer, never through db').toEqual([]);
  });

  it('runs API handlers and server actions inside withOrg', () => {
    // The address check for deleted jobs and clients runs first, inside the same scope.
    expect(read(path.join(SRC, 'server/http/api.ts'))).toMatch(/withOrg\(context\.org\.id, async \(\) => \{\s*(\/\/[^\n]*\s*)?await assertAddressRefsReadable\(ctx, searchParams\);\s*return handler\(/);
    expect(read(path.join(SRC, 'server/actions/_action.ts'))).toMatch(/withOrg\(context\.org\.id, \(\) => handler\(/);
  });
});
