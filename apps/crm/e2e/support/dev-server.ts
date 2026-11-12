/**
 * Ensure embedded Postgres (5544) and the Next dev server (3100) are up, starting them
 * detached in the background when needed. Safe to call concurrently from many processes:
 * the start sequence is serialised by `.qa/dev.lock`, and a healthy server short-circuits
 * without taking the lock at all.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, openSync, closeSync, readFileSync, statSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { isPidAlive, withLock } from './lockfile';
import {
  DEV_LOCK_FILE,
  DEV_LOG_FILE,
  DEV_PID_FILE,
  DEV_PORT,
  HEALTH_PATH,
  QA_DIR,
  REPO_ROOT,
  baseUrl,
} from './paths';

export const DB_PORT = 5544;

export type HealthState = 'ok' | 'degraded' | 'down';

export interface HealthReport {
  readonly state: HealthState;
  readonly httpStatus?: number;
  readonly detail: string;
  readonly version?: string;
  readonly dbLatencyMs?: number;
}

export interface EnsureDevResult {
  readonly health: HealthReport;
  readonly startedServer: boolean;
  readonly startedDatabase: boolean;
  readonly pid?: number;
  readonly url: string;
  readonly logFile: string;
}

export interface EnsureDevOptions {
  /** Max total wait for a healthy server. */
  readonly timeoutMs?: number;
  /** Progress messages (stderr by default in the CLI). */
  readonly log?: (message: string) => void;
}

interface HealthBody {
  readonly ok?: boolean;
  readonly data?: { status?: string; version?: string; database?: { ok?: boolean; latencyMs?: number } };
  readonly error?: { message?: string };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function checkHealth(timeoutMs = 10_000): Promise<HealthReport> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl()}${HEALTH_PATH}`, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    const body = (await response.json().catch(() => null)) as HealthBody | null;
    const db = body?.data?.database;
    if (response.ok && body?.ok === true) {
      return {
        state: 'ok',
        httpStatus: response.status,
        detail: 'healthy',
        version: body.data?.version,
        dbLatencyMs: db?.latencyMs,
      };
    }
    return {
      state: 'degraded',
      httpStatus: response.status,
      detail: body?.error?.message ?? (db?.ok === false ? 'database unreachable' : `HTTP ${response.status}`),
    };
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    return { state: 'down', detail: aborted ? `no response within ${timeoutMs}ms` : 'connection refused' };
  } finally {
    clearTimeout(timer);
  }
}

export function isPortOpen(port: number, host = '127.0.0.1', timeoutMs = 1_500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    const done = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

async function anyHostPortOpen(port: number): Promise<boolean> {
  const results = await Promise.all([isPortOpen(port, '127.0.0.1'), isPortOpen(port, '::1')]);
  return results.some(Boolean);
}

function tsxCli(): string {
  const cli = path.join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  if (!existsSync(cli)) throw new Error(`tsx not installed (${cli} missing). Run \`npm install\`.`);
  return cli;
}

function nextBin(): string {
  const bin = path.join(REPO_ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
  if (!existsSync(bin)) throw new Error(`next not installed (${bin} missing). Run \`npm install\`.`);
  return bin;
}

function runToCompletion(args: readonly string[], label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...args], { cwd: REPO_ROOT, windowsHide: true, stdio: 'pipe' });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${label} exited with code ${code}: ${output.trim().slice(-800)}`)),
    );
  });
}

async function ensureDatabase(log: (message: string) => void): Promise<boolean> {
  if (process.env.ENSURE_DEV_SKIP_DB === '1') return false;
  if (await isPortOpen(DB_PORT)) return false;
  log(`Embedded Postgres not listening on ${DB_PORT}; starting it (npm run db:start)…`);
  await runToCompletion([tsxCli(), path.join(REPO_ROOT, 'scripts', 'db-start.ts')], 'db:start');
  return true;
}

function tailLog(lines = 40): string {
  if (!existsSync(DEV_LOG_FILE)) return '(no log)';
  return readFileSync(DEV_LOG_FILE, 'utf8').split(/\r?\n/).slice(-lines).join('\n');
}

async function readPid(): Promise<number | undefined> {
  try {
    const pid = Number((await readFile(DEV_PID_FILE, 'utf8')).trim());
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

const DEV_STAMP_FILE = path.join(QA_DIR, 'dev-stamp.json');
const NEXT_DEV_CACHE = path.join(REPO_ROOT, '.next', 'dev');

function fileDigest(file: string): string {
  try {
    return createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 16);
  } catch {
    return 'missing';
  }
}

function fileMtime(file: string): number {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Fingerprint of everything that invalidates Turbopack's dev cache. A stale `.next/dev`
 * (after a Next upgrade, a config/lockfile change, or a `next build` in the same `.next`)
 * makes the HMR socket loop on "HMR hash mismatch" reloads, so it is wiped on mismatch.
 */
export function devCacheStamp(): Record<string, string | number> {
  return {
    next: fileDigest(path.join(REPO_ROOT, 'node_modules', 'next', 'package.json')),
    config: fileDigest(path.join(REPO_ROOT, 'next.config.ts')),
    lock: fileDigest(path.join(REPO_ROOT, 'package-lock.json')),
    buildId: fileMtime(path.join(REPO_ROOT, '.next', 'BUILD_ID')),
  };
}

async function resetStaleDevCache(log: (message: string) => void): Promise<void> {
  const current = JSON.stringify(devCacheStamp());
  let previous = '';
  try {
    previous = await readFile(DEV_STAMP_FILE, 'utf8');
  } catch {
    previous = '';
  }
  if (previous.trim() !== current && existsSync(NEXT_DEV_CACHE)) {
    log('Dev cache fingerprint changed; clearing .next/dev to avoid HMR reload loops.');
    await rm(NEXT_DEV_CACHE, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
  await mkdir(QA_DIR, { recursive: true });
  await writeFile(DEV_STAMP_FILE, current);
}

async function spawnDevServer(log: (message: string) => void): Promise<number> {
  await mkdir(QA_DIR, { recursive: true });
  await resetStaleDevCache(log);
  const fd = openSync(DEV_LOG_FILE, 'a');
  try {
    const child = spawn(process.execPath, [nextBin(), 'dev', '-p', String(DEV_PORT)], {
      cwd: REPO_ROOT,
      detached: true,
      windowsHide: true,
      stdio: ['ignore', fd, fd],
      env: { ...process.env, PORT: String(DEV_PORT), NEXT_TELEMETRY_DISABLED: '1' },
    });
    if (child.pid === undefined) throw new Error('Failed to spawn next dev (no pid).');
    child.unref();
    await writeFile(DEV_PID_FILE, String(child.pid));
    log(`Started next dev on ${DEV_PORT} (pid ${child.pid}, log ${DEV_LOG_FILE}).`);
    return child.pid;
  } finally {
    closeSync(fd);
  }
}

async function waitForHealthy(deadline: number, pid: number | undefined): Promise<HealthReport> {
  let last: HealthReport = { state: 'down', detail: 'not checked' };
  while (Date.now() < deadline) {
    last = await checkHealth(Math.min(30_000, Math.max(1_000, deadline - Date.now())));
    if (last.state === 'ok') return last;
    if (pid !== undefined && !isPidAlive(pid)) {
      throw new Error(`next dev (pid ${pid}) exited before becoming healthy. Log tail:\n${tailLog()}`);
    }
    await sleep(1_000);
  }
  throw new Error(
    `Dev server not healthy at ${baseUrl()}${HEALTH_PATH} (${last.detail}). Log tail (${DEV_LOG_FILE}):\n${tailLog()}`,
  );
}

/** Ensure DB + dev server are running and healthy. Starts them in the background if needed. */
export async function ensureDevServer(options: EnsureDevOptions = {}): Promise<EnsureDevResult> {
  const log = options.log ?? (() => undefined);
  const deadline = Date.now() + (options.timeoutMs ?? 240_000);
  const url = baseUrl();

  const quick = await checkHealth(5_000);
  if (quick.state === 'ok') {
    return {
      health: quick,
      startedServer: false,
      startedDatabase: false,
      pid: await readPid(),
      url,
      logFile: DEV_LOG_FILE,
    };
  }

  return withLock(
    DEV_LOCK_FILE,
    {
      purpose: 'start dev server',
      timeoutMs: Math.max(1_000, deadline - Date.now()),
      staleMs: 300_000,
      onWait: (holder) => log(`Another process (pid ${holder.pid}) is starting the dev server; waiting…`),
    },
    async () => {
      const startedDatabase = await ensureDatabase(log);
      const again = await checkHealth(5_000);
      if (again.state === 'ok') {
        return {
          health: again,
          startedServer: false,
          startedDatabase,
          pid: await readPid(),
          url,
          logFile: DEV_LOG_FILE,
        };
      }

      const external =
        !url.startsWith(`http://localhost:${DEV_PORT}`) && !url.startsWith(`http://127.0.0.1:${DEV_PORT}`);
      if (external) {
        throw new Error(
          `E2E_BASE_URL=${url} is not healthy (${again.detail}); refusing to start a local server for it.`,
        );
      }

      let pid = await readPid();
      let startedServer = false;
      if (await anyHostPortOpen(DEV_PORT)) {
        // Something is listening (probably a dev server still compiling, or DB just came up).
        log(`Port ${DEV_PORT} is in use but not healthy yet (${again.detail}); waiting for it…`);
      } else {
        pid = await spawnDevServer(log);
        startedServer = true;
      }
      const health = await waitForHealthy(deadline, startedServer ? pid : undefined);
      return { health, startedServer, startedDatabase, pid, url, logFile: DEV_LOG_FILE };
    },
  );
}

/** Stop the dev server that this harness started (tracked in `.qa/dev-server.pid`). */
export async function stopDevServer(log: (message: string) => void = () => undefined): Promise<boolean> {
  const pid = await readPid();
  if (pid === undefined || !isPidAlive(pid)) {
    await rm(DEV_PID_FILE, { force: true });
    log('No harness-started dev server is running.');
    return false;
  }
  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      killer.once('exit', () => resolve());
      killer.once('error', () => resolve());
    });
  } else {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      process.kill(pid, 'SIGTERM');
    }
  }
  for (let i = 0; i < 40 && isPidAlive(pid); i += 1) await sleep(250);
  await rm(DEV_PID_FILE, { force: true });
  log(`Stopped dev server (pid ${pid}).`);
  return true;
}
