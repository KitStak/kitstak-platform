import { describe, expect, it } from 'vitest';
import { jobPageTitle } from './routes';

describe('jobPageTitle', () => {
  it('leads with the job number', () => {
    expect(jobPageTitle('J-1026', 'overview')).toBe('J-1026');
    expect(jobPageTitle('j-1026', 'work')).toBe('J-1026 · Work log');
    expect(jobPageTitle('WO000093', 'money-in')).toBe('WO000093 · Money in');
  });

  it('keeps the plain tab name for a link by id', () => {
    expect(jobPageTitle('ca5fc83c-6f16-4ee0-95d8-aad6e92e1d84', 'overview')).toBe('Job');
    expect(jobPageTitle('ca5fc83c-6f16-4ee0-95d8-aad6e92e1d84', 'plan')).toBe('Plan vs actual');
  });
});
