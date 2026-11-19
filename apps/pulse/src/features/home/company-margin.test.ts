import { describe, expect, it } from 'vitest';
import { companySentence } from './company-margin';

const base = { hasCompanyCosts: true, companyCostNote: null, companyCostPartial: false, companyCostSpread: 'calendar' as const, workProfitCents: 13200900, sharedGapCents: 0, missingCostCents: 700171, overheadGapCents: 0, companyProfitCents: 0 };

describe('companySentence (round four, designer issue 9)', () => {
  it('says why the company made more than its jobs', () => {
    // Nov 1 to 19: jobs $132,009, the hourly rates covered $10,841.14 more overhead than the costs for those days.
    const more = companySentence({ ...base, overheadGapCents: -1084114, companyProfitCents: 13200900 - 700171 + 1084114, companyCostPartial: true, companyCostNote: 'Company costs for 19 of 30 days.' });
    expect(more.lead).toBe('The company made more than its jobs:');
    expect(more.reason).toBe('Your hourly rates covered more overhead than the company costs for these days, so overhead added to profit. Company costs are shared by calendar day, so days off carry a share and a work week carries less than its part of the month.');
    expect(more.note).toBe('Company costs for 19 of 30 days.');
    // Shared by work day, the calendar day hint is not needed.
    const byWorkDay = companySentence({ ...base, overheadGapCents: -1084114, companyProfitCents: 13584843, companyCostPartial: true, companyCostSpread: 'work_days', companyCostNote: 'Company costs for 13 of 21 work days.' });
    expect(byWorkDay.reason).toBe('Your hourly rates covered more overhead than the company costs for these days, so overhead added to profit.');
  });

  it('names the biggest step down when the company made less', () => {
    const less = companySentence({ ...base, overheadGapCents: 1474486, companyProfitCents: 13200900 - 700171 - 1474486 });
    expect(less.lead).toBe('After time not on a job and overhead, the company made');
    expect(less.reason).toBe('The biggest step down is overhead your hourly rates did not cover.');
    const paid = companySentence({ ...base, hasCompanyCosts: false, overheadGapCents: null, companyProfitCents: 13200900 - 700171 });
    expect(paid.lead).toBe('After time not on a job, the company made');
    expect(paid.reason).toBe('The biggest step down is paid time not on any job.');
  });

  it('says nothing more when no step moved the number', () => {
    const flat = companySentence({ ...base, missingCostCents: 0, companyProfitCents: 13200900 });
    expect(flat.reason).toBeNull();
  });
});
