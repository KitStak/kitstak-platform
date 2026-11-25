/**
 * Stand in for the `server-only` package in vitest (see vitest.config.mts). The real package throws
 * when it is imported outside a React Server Component bundle, and unit tests import server modules
 * directly. Next never loads this file.
 */
export {};
