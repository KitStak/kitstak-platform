/**
 * Minimal structured JSON logger (one line per event on stdout/stderr).
 * Errors are serialized with name/message/stack; known secret-bearing keys are redacted.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const REDACT_KEYS = /pass(word)?|secret|token|authorization|cookie|api[-_]?key/i;

function threshold(): number {
  const configured = process.env.LOG_LEVEL as Level | undefined;
  return LEVEL_RANK[configured && configured in LEVEL_RANK ? configured : 'info'];
}

function serialize(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[depth]';
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: process.env.NODE_ENV === 'production' ? undefined : value.stack,
      cause: value.cause === undefined ? undefined : serialize(value.cause, depth + 1),
    };
  }
  if (Array.isArray(value)) return value.map((entry) => serialize(entry, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = REDACT_KEYS.test(key) ? '[redacted]' : serialize(entry, depth + 1);
    }
    return out;
  }
  return value;
}

function write(level: Level, event: string, context?: Record<string, unknown>): void {
  if (LEVEL_RANK[level] < threshold()) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...(context ? (serialize(context) as Record<string, unknown>) : {}),
  });
  (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(`${line}\n`);
}

export const logger = {
  debug: (event: string, context?: Record<string, unknown>) => write('debug', event, context),
  info: (event: string, context?: Record<string, unknown>) => write('info', event, context),
  warn: (event: string, context?: Record<string, unknown>) => write('warn', event, context),
  error: (event: string, context?: Record<string, unknown>) => write('error', event, context),
} as const;
