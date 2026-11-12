/**
 * Structured JSON logger (one JSON object per line).
 *
 *   log.info("request", { route: "/api/orders", userId, ms: 12, status: 200 });
 *   log.error("handler failed", { route, err });
 *
 * - Levels: debug < info < warn < error. `LOG_LEVEL` sets the minimum (default `info`,
 *   `warn` under vitest so test output stays clean).
 * - Sensitive keys (password, token, secret, cookie, authorization, ...) are redacted
 *   recursively before writing.
 * - `err` values are serialised to `{ name, message, code?, stack? }`; the stack is only
 *   included outside production. Logs never reach the client.
 */

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export type LogFields = Readonly<Record<string, unknown>>;

export interface LogRecord {
  readonly ts: string;
  readonly level: LogLevel;
  readonly msg: string;
  readonly [key: string]: unknown;
}

export type LogSink = (level: LogLevel, line: string) => void;

const SENSITIVE_KEY_RE = /pass(word)?|secret|token|cookie|authorization|session|hash|csrf/i;
const REDACTED = '[redacted]';
const MAX_DEPTH = 6;

function levelRank(level: LogLevel): number {
  return LOG_LEVELS.indexOf(level);
}

function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && (LOG_LEVELS as readonly string[]).includes(value);
}

function defaultMinLevel(): LogLevel {
  const configured = process.env.LOG_LEVEL;
  if (isLogLevel(configured)) return configured;
  return process.env.VITEST ? 'warn' : 'info';
}

export interface SerializedError {
  readonly name: string;
  readonly message: string;
  readonly code?: string;
  readonly stack?: string;
  /** The driver error behind a drizzle "Failed query" wrapper (Postgres message + SQLSTATE). */
  readonly cause?: { readonly message: string; readonly code?: string };
}

export function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    const cause = (error as { cause?: unknown }).cause;
    const causeCode = cause instanceof Error ? (cause as { code?: unknown }).code : undefined;
    return {
      name: error.name,
      message: error.message,
      ...(typeof code === 'string' ? { code } : {}),
      ...(cause instanceof Error
        ? { cause: { message: cause.message, ...(typeof causeCode === 'string' ? { code: causeCode } : {}) } }
        : {}),
      ...(process.env.NODE_ENV !== 'production' && error.stack ? { stack: error.stack } : {}),
    };
  }
  return { name: 'NonError', message: String(error) };
}

/** Deep-copies `value`, redacting sensitive keys and serialising errors. */
export function sanitize(value: unknown, depth = 0): unknown {
  if (value instanceof Error) return serializeError(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[truncated]';
  if (Array.isArray(value)) return value.map((item) => sanitize(item, depth + 1));
  const entries = Object.entries(value as Record<string, unknown>).map(([key, inner]) => {
    if (key === 'err' || key === 'error') return [key, sanitize(inner, depth + 1)] as const;
    return [key, SENSITIVE_KEY_RE.test(key) ? REDACTED : sanitize(inner, depth + 1)] as const;
  });
  return Object.fromEntries(entries);
}

const defaultSink: LogSink = (level, line) => {
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  stream.write(`${line}\n`);
};

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  /** Returns a logger that adds `bound` to every record. */
  child(bound: LogFields): Logger;
}

export interface LoggerOptions {
  readonly sink?: LogSink;
  readonly minLevel?: LogLevel;
  readonly bound?: LogFields;
  readonly now?: () => Date;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const sink = options.sink ?? defaultSink;
  const bound = options.bound ?? {};
  const now = options.now ?? (() => new Date());

  const write = (level: LogLevel, msg: string, fields?: LogFields): void => {
    const minLevel = options.minLevel ?? defaultMinLevel();
    if (levelRank(level) < levelRank(minLevel)) return;
    const payload = sanitize({ ...bound, ...(fields ?? {}) }) as Record<string, unknown>;
    const record: LogRecord = { ts: now().toISOString(), level, msg, ...payload };
    try {
      sink(level, JSON.stringify(record));
    } catch {
      // A broken sink (closed stream, circular data) must never crash a request.
    }
  };

  return {
    debug: (msg, fields) => write('debug', msg, fields),
    info: (msg, fields) => write('info', msg, fields),
    warn: (msg, fields) => write('warn', msg, fields),
    error: (msg, fields) => write('error', msg, fields),
    child: (more) => createLogger({ ...options, bound: { ...bound, ...more } }),
  };
}

/** Process-wide logger. */
export const log: Logger = createLogger();
