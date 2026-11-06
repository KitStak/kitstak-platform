/**
 * Local-development embedded PostgreSQL lifecycle.
 *
 * Initialisation (initdb, auth config) uses the `embedded-postgres` package. Starting
 * and stopping use the bundled `pg_ctl` binary directly so the server runs as a
 * detached daemon that outlives the Node process that started it (embedded-postgres'
 * own `start()` ties the server to the parent process via exit hooks).
 *
 * Used only by CLI scripts (`npm run db:*`); never imported by the Next.js app.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';

export const EMBEDDED_PG_PORT = 5544;
export const EMBEDDED_PG_USER = 'postgres';
export const EMBEDDED_PG_PASSWORD = 'postgres';
export const EMBEDDED_PG_DATABASE = 'kitstak';

export interface EmbeddedPgPaths {
  readonly root: string;
  readonly dataDir: string;
  readonly logFile: string;
}

export function embeddedPgPaths(projectRoot: string = process.cwd()): EmbeddedPgPaths {
  const root = path.join(projectRoot, '.data');
  return {
    root,
    dataDir: path.join(root, 'pg'),
    logFile: path.join(root, 'pg.log'),
  };
}

interface PgBinaries {
  readonly pg_ctl: string;
  readonly initdb: string;
  readonly postgres: string;
}

/** Platform binary packages shipped as optionalDependencies of `embedded-postgres`. */
const BINARY_PACKAGES: Readonly<Record<string, string>> = {
  'win32-x64': '@embedded-postgres/windows-x64',
  'darwin-arm64': '@embedded-postgres/darwin-arm64',
  'darwin-x64': '@embedded-postgres/darwin-x64',
  'linux-x64': '@embedded-postgres/linux-x64',
  'linux-arm64': '@embedded-postgres/linux-arm64',
};

async function resolveBinaries(): Promise<PgBinaries> {
  const key = `${os.platform()}-${os.arch()}`;
  const specifier = BINARY_PACKAGES[key];
  if (!specifier) {
    throw new Error(
      `Embedded Postgres is not supported on ${key}. Set DATABASE_URL to an external Postgres.`,
    );
  }
  return (await import(specifier)) as PgBinaries;
}

interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Run a binary to completion.
 *
 * `daemonize` is used for `pg_ctl start`: the postgres server it launches would inherit
 * any stdio pipes and keep them open forever, so output is discarded (the server logs to
 * its own logfile) and we resolve on the pg_ctl process `exit`, not stream `close`.
 */
function run(command: string, args: readonly string[], daemonize = false): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      windowsHide: true,
      detached: daemonize,
      stdio: daemonize ? 'ignore' : ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', reject);
    if (daemonize) {
      child.on('exit', (code) => resolve({ code: code ?? 1, stdout, stderr }));
    } else {
      child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
    }
  });
}

export function isInitialised(paths: EmbeddedPgPaths = embeddedPgPaths()): boolean {
  return existsSync(path.join(paths.dataDir, 'PG_VERSION'));
}

export async function isRunning(paths: EmbeddedPgPaths = embeddedPgPaths()): Promise<boolean> {
  if (!isInitialised(paths)) return false;
  const { pg_ctl } = await resolveBinaries();
  const result = await run(pg_ctl, ['status', '-D', paths.dataDir]);
  // pg_ctl status: 0 = running, 3 = not running, 4 = no data dir.
  return result.code === 0;
}

async function initialise(paths: EmbeddedPgPaths): Promise<void> {
  await mkdir(paths.root, { recursive: true });
  const cluster = new EmbeddedPostgres({
    databaseDir: paths.dataDir,
    port: EMBEDDED_PG_PORT,
    user: EMBEDDED_PG_USER,
    password: EMBEDDED_PG_PASSWORD,
    authMethod: 'scram-sha-256',
    persistent: true,
    initdbFlags: ['--encoding=UTF8'],
    onLog: () => undefined,
    onError: (error: unknown) => process.stderr.write(`[embedded-pg] ${String(error)}\n`),
  });
  await cluster.initialise();
}

async function ensureDatabase(): Promise<boolean> {
  const client = new pg.Client({
    host: '127.0.0.1',
    port: EMBEDDED_PG_PORT,
    user: EMBEDDED_PG_USER,
    password: EMBEDDED_PG_PASSWORD,
    database: 'postgres',
  });
  await client.connect();
  try {
    const existing = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      EMBEDDED_PG_DATABASE,
    ]);
    if (existing.rowCount && existing.rowCount > 0) return false;
    await client.query(`CREATE DATABASE "${EMBEDDED_PG_DATABASE}" ENCODING 'UTF8'`);
    return true;
  } finally {
    await client.end();
  }
}

export interface StartResult {
  readonly initialised: boolean;
  readonly alreadyRunning: boolean;
  readonly databaseCreated: boolean;
}

/** Idempotently initialise (first run), start (detached) and create the app database. */
export async function startEmbeddedPostgres(
  paths: EmbeddedPgPaths = embeddedPgPaths(),
): Promise<StartResult> {
  let initialised = false;
  if (!isInitialised(paths)) {
    await initialise(paths);
    initialised = true;
  }

  const alreadyRunning = await isRunning(paths);
  if (!alreadyRunning) {
    const { pg_ctl } = await resolveBinaries();
    const result = await run(
      pg_ctl,
      [
        'start',
        '-w',
        '-t',
        '60',
        '-D',
        paths.dataDir,
        '-l',
        paths.logFile,
        '-o',
        `-p ${EMBEDDED_PG_PORT} -c listen_addresses=localhost`,
      ],
      true,
    );
    if (result.code !== 0) {
      throw new Error(
        `pg_ctl start failed (exit ${result.code}). See ${paths.logFile}\n${result.stderr || result.stdout}`,
      );
    }
  }

  const databaseCreated = await ensureDatabase();
  return { initialised, alreadyRunning, databaseCreated };
}

/** Stop the detached server if running. Returns true if it was running. */
export async function stopEmbeddedPostgres(paths: EmbeddedPgPaths = embeddedPgPaths()): Promise<boolean> {
  if (!(await isRunning(paths))) return false;
  const { pg_ctl } = await resolveBinaries();
  const result = await run(pg_ctl, ['stop', '-w', '-m', 'fast', '-D', paths.dataDir]);
  if (result.code !== 0) {
    throw new Error(`pg_ctl stop failed (exit ${result.code}): ${result.stderr || result.stdout}`);
  }
  return true;
}
