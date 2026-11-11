import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

const valid: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://u:p@localhost:5544/db',
  BETTER_AUTH_SECRET: 'x'.repeat(40),
  BETTER_AUTH_URL: 'http://localhost:3100',
  TRUSTED_ORIGINS: 'https://a.example.com, https://b.example.com',
};

describe('loadEnv', () => {
  it('parses a valid environment with defaults', () => {
    const env = loadEnv(valid);
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.DB_POOL_MAX).toBe(10);
    expect(env.TRUSTED_ORIGINS).toEqual(['https://a.example.com', 'https://b.example.com']);
  });

  it('lists every invalid variable in one error', () => {
    let message = '';
    try {
      loadEnv({ ...valid, DATABASE_URL: 'mysql://x', BETTER_AUTH_SECRET: 'short' });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('DATABASE_URL');
    expect(message).toContain('BETTER_AUTH_SECRET');
  });

  it('falls back to the Supabase integration variables', () => {
    const env = loadEnv({
      ...valid,
      DATABASE_URL: undefined,
      POSTGRES_URL: 'postgres://u:p@pooler.example.com:6543/postgres?sslmode=require',
      POSTGRES_URL_NON_POOLING: 'postgres://u:p@pooler.example.com:5432/postgres?sslmode=require',
    });
    expect(env.DATABASE_URL).toBe(
      'postgres://u:p@pooler.example.com:6543/postgres?sslmode=require&uselibpqcompat=true',
    );
    expect(env.DATABASE_URL_UNPOOLED).toBe(
      'postgres://u:p@pooler.example.com:5432/postgres?sslmode=require&uselibpqcompat=true',
    );
  });

  it('prefers an explicit DATABASE_URL and leaves it untouched', () => {
    const env = loadEnv({ ...valid, POSTGRES_URL: 'postgres://other:p@example.com/db' });
    expect(env.DATABASE_URL).toBe(valid.DATABASE_URL);
    expect(env.DATABASE_URL_UNPOOLED).toBeUndefined();
  });
});
