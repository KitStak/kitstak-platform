/**
 * Cross-process advisory lock based on exclusive file creation (`open(path, 'wx')`).
 *
 * Many agents call the harness concurrently; this lock serialises the critical sections
 * (starting the dev server, logging in). A lock is considered stale when the owning PID is
 * no longer alive or the lock is older than `staleMs`, so a crashed holder never wedges
 * everyone else.
 */
import { mkdir, open, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

interface LockInfo {
  readonly pid: number;
  readonly createdAt: number;
  readonly purpose: string;
}

export interface LockOptions {
  /** What the lock protects (shown to waiters). */
  readonly purpose: string;
  /** Give up waiting after this long. */
  readonly timeoutMs?: number;
  /** Treat a lock older than this as abandoned. */
  readonly staleMs?: number;
  /** Called once when we start waiting on another holder. */
  readonly onWait?: (holder: LockInfo) => void;
}

const POLL_MS = 250;

export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function readLock(file: string): Promise<LockInfo | null> {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as Partial<LockInfo>;
    if (typeof parsed.pid !== 'number' || typeof parsed.createdAt !== 'number') return null;
    return { pid: parsed.pid, createdAt: parsed.createdAt, purpose: String(parsed.purpose ?? 'unknown') };
  } catch {
    return null;
  }
}

async function tryAcquire(file: string, purpose: string): Promise<boolean> {
  try {
    const handle = await open(file, 'wx');
    const info: LockInfo = { pid: process.pid, createdAt: Date.now(), purpose };
    await handle.writeFile(JSON.stringify(info));
    await handle.close();
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Run `fn` while holding the lock at `file`. Always releases, even on throw. */
export async function withLock<T>(file: string, options: LockOptions, fn: () => Promise<T>): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 300_000;
  const staleMs = options.staleMs ?? 300_000;
  const deadline = Date.now() + timeoutMs;
  let announcedWait = false;

  await mkdir(path.dirname(file), { recursive: true });

  while (!(await tryAcquire(file, options.purpose))) {
    let holder = await readLock(file);
    if (holder === null) {
      // The holder may be between create and write; give it one poll before declaring it corrupt.
      await sleep(POLL_MS);
      holder = await readLock(file);
      if (holder === null) {
        await rm(file, { force: true });
        continue;
      }
    }
    if (!isPidAlive(holder.pid) || Date.now() - holder.createdAt > staleMs) {
      await rm(file, { force: true });
      continue;
    }
    if (!announcedWait) {
      options.onWait?.(holder);
      announcedWait = true;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Timed out after ${Math.round(timeoutMs / 1000)}s waiting for lock ${file} ` +
          `(held by pid ${holder.pid} for "${holder.purpose}"). Delete the file if that process is gone.`,
      );
    }
    await sleep(POLL_MS);
  }

  try {
    return await fn();
  } finally {
    const current = await readLock(file);
    if (current?.pid === process.pid) await rm(file, { force: true });
  }
}
