/**
 * Shared filesystem locations and constants for the QA harness (Playwright, screenshot CLI,
 * ensure-dev). Everything here is plain Node so it can be imported from Playwright config,
 * global setup and `tsx` scripts alike.
 */
import path from 'node:path';

/** Repository root (this file lives in `<root>/e2e/support`). */
export const REPO_ROOT = path.resolve(__dirname, '..', '..');

export const DEV_PORT = 3100;
export const DEFAULT_BASE_URL = `http://localhost:${DEV_PORT}`;

/** Base URL used by every harness tool. Override with `E2E_BASE_URL`. */
export function baseUrl(): string {
  const raw = process.env.E2E_BASE_URL?.trim();
  return (raw && raw.length > 0 ? raw : DEFAULT_BASE_URL).replace(/\/+$/, '');
}

export const QA_DIR = path.join(REPO_ROOT, '.qa');
export const SCREENS_DIR = path.join(QA_DIR, 'screens');
export const DEV_LOCK_FILE = path.join(QA_DIR, 'dev.lock');
export const AUTH_LOCK_FILE = path.join(QA_DIR, 'auth.lock');
export const DEV_PID_FILE = path.join(QA_DIR, 'dev-server.pid');
export const DEV_LOG_FILE = path.join(QA_DIR, 'dev-server.log');

export const AUTH_DIR = path.join(REPO_ROOT, 'e2e', '.auth');
/** Playwright storage state for the seeded demo admin. */
export const ADMIN_STORAGE_STATE = path.join(AUTH_DIR, 'admin.json');
/** Written by global setup: whether the admin login succeeded, and why not. */
export const ADMIN_AUTH_STATUS = path.join(AUTH_DIR, 'status.json');

export const SEED_README = path.join(REPO_ROOT, 'src', 'server', 'db', 'seed', 'README.md');
export const HEALTH_PATH = '/api/v1/health';
