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
});
