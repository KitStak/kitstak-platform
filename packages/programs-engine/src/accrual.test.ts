import { describe, expect, it } from 'vitest';
import { LINK_JOB_MESSAGES, POSTING_LABELS, accrueDay, canLinkJob, hourlyRevenue, minutesToHours, perUnitRevenue, postingTarget } from './accrual';
import { seeded } from './glove.fixture';

describe('accrueDay (M1)', () => {
  it('E1 100 at $1.85 is $185.00', () => {
    expect(accrueDay('100', '1.85')).toBe(BigInt(18500));
  });
  it('E2 333 at $1.8525 rounds 616.8825 to 616.88', () => {
    expect(accrueDay('333', '1.8525')).toBe(BigInt(61688));
  });
  it('E3 half a cent rounds away from zero', () => {
    expect(accrueDay('1', '0.0050')).toBe(BigInt(1));
  });
  it('E4 37.5 cents rounds to 38', () => {
    expect(accrueDay('3', '0.1250')).toBe(BigInt(38));
  });
  it('E5 half a unit at $2.10', () => {
    expect(accrueDay('0.5', '2.1000')).toBe(BigInt(105));
  });
  it('E6 no price is 0', () => {
    expect(accrueDay('100', null)).toBe(BigInt(0));
  });
  it('rounds credits away from zero too', () => {
    expect(accrueDay('-3', '0.1250')).toBe(BigInt(-38));
  });
});

/**
 * Reference for Postgres `round(qty * price, 2)` on numerics, done digit by digit on strings:
 * schoolbook multiplication, then round half away from zero at the cent. No BigInt, no floats.
 */
function referenceCents(qty: string, price: string): string {
  const digits = (text: string, scale: number): number[] => {
    const [whole, frac = ''] = text.split('.');
    return `${whole}${frac.padEnd(scale, '0')}`.split('').map(Number);
  };
  const a = digits(qty, 3);
  const b = digits(price, 4);
  const product = new Array<number>(a.length + b.length).fill(0);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      const sum = (product[i + j + 1] as number) + (a[i] as number) * (b[j] as number);
      product[i + j + 1] = sum % 10;
      product[i + j] = (product[i + j] as number) + Math.floor(sum / 10);
    }
  }
  // The product has 7 decimals; cents keep 2, so drop the last 5 digits and round on the first dropped one.
  const kept = product.slice(0, product.length - 5);
  if ((product[product.length - 5] as number) >= 5) {
    let k = kept.length - 1;
    while (k >= 0) {
      kept[k] = (kept[k] as number) + 1;
      if ((kept[k] as number) < 10) break;
      kept[k] = 0;
      k -= 1;
    }
    if (k < 0) kept.unshift(1);
  }
  const text = kept.join('').replace(/^0+(?=\d)/, '');
  return text === '' ? '0' : text;
}

describe('E26 parity with Postgres round(numeric)', () => {
  it('matches the string reference for 2,000 random pairs', () => {
    const random = seeded(20261125);
    const pick = (max: number): number => Math.floor(random() * max);
    for (let n = 0; n < 2000; n += 1) {
      const qty = `${pick(100000)}.${String(pick(1000)).padStart(3, '0')}`;
      const price = `${pick(1000)}.${String(pick(10000)).padStart(4, '0')}`;
      expect(accrueDay(qty, price).toString(), `${qty} x ${price}`).toBe(referenceCents(qty, price));
    }
  });
  it('the reference itself rounds half away from zero', () => {
    expect(referenceCents('1.000', '0.0050')).toBe('1');
    expect(referenceCents('333.000', '1.8525')).toBe('61688');
    expect(referenceCents('99999.999', '999.9999')).toBe(accrueDay('99999.999', '999.9999').toString());
  });
});

describe('moved Pulse revenue helpers', () => {
  it('perUnitRevenue treats a blank price as no price', () => {
    expect(perUnitRevenue(3000, '2.75')).toBe(BigInt(825000));
    expect(perUnitRevenue(3000, '')).toBe(BigInt(0));
    expect(perUnitRevenue(3000, undefined)).toBe(BigInt(0));
  });
  it('hourlyRevenue multiplies hours by the bill rate', () => {
    expect(hourlyRevenue('1.58', 4200)).toBe(BigInt(6636));
    expect(hourlyRevenue('2', null)).toBe(BigInt(0));
  });
});

describe('minutesToHours', () => {
  it('rounds once to 2 decimals', () => {
    expect(minutesToHours(95)).toBe('1.58');
    expect(minutesToHours(62)).toBe('1.03');
    expect(minutesToHours(60)).toBe('1.00');
    expect(minutesToHours(0)).toBe('0.00');
  });
  it('refuses a fraction of a minute', () => {
    expect(() => minutesToHours(1.5)).toThrow(RangeError);
  });
});

describe('postingTarget (D4)', () => {
  it('E24 a live build job beats a live program job', () => {
    expect(postingTarget({ buildJob: { id: 'J2', live: true }, programId: 'P', programJob: { id: 'J1', live: true } })).toEqual({ posting: 'build_job', jobId: 'J2' });
  });
  it('a live program job beats the program', () => {
    expect(postingTarget({ buildJob: null, programId: 'P', programJob: { id: 'J1', live: true } })).toEqual({ posting: 'program_job', jobId: 'J1' });
  });
  it('a job that is not live counts as no job', () => {
    expect(postingTarget({ buildJob: { id: 'J2', live: false }, programId: 'P', programJob: { id: 'J1', live: false } })).toEqual({ posting: 'program', jobId: null });
    expect(postingTarget({ buildJob: { id: 'J2', live: false }, programId: null, programJob: null })).toEqual({ posting: 'unbilled', jobId: null });
  });
  it('a project build with its own live job bills to it', () => {
    expect(postingTarget({ buildJob: { id: 'J3', live: true }, programId: null, programJob: null })).toEqual({ posting: 'build_job', jobId: 'J3' });
  });
  it('has words for every posting', () => {
    expect(Object.keys(POSTING_LABELS).sort()).toEqual(['build_job', 'program', 'program_job', 'unbilled']);
    // SPEC 2.2.17, word for word, so Projects, Pulse and pm-bridge show the same words.
    expect(POSTING_LABELS).toEqual({ program: 'This program', program_job: "The program's Pulse job", build_job: "This build's Pulse job", unbilled: 'Not billed' });
  });
});

describe('canLinkJob', () => {
  const job = { pricingModel: 'per_unit' as const, kind: 'ongoing' as const, feedsFromWorkOrder: false, hasTypedUnits: false, programId: null };
  it('accepts an ongoing per unit job for a program', () => {
    expect(canLinkJob(job, { kind: 'program', programId: 'P' })).toEqual({ ok: true });
    expect(canLinkJob({ ...job, programId: 'P' }, { kind: 'program', programId: 'P' })).toEqual({ ok: true });
  });
  it('refuses each rule with its reason', () => {
    expect(canLinkJob({ ...job, pricingModel: 'fixed' }, { kind: 'program', programId: 'P' })).toEqual({ ok: false, reason: 'not_per_unit' });
    expect(canLinkJob({ ...job, kind: 'one_time' }, { kind: 'program', programId: 'P' })).toEqual({ ok: false, reason: 'not_ongoing' });
    expect(canLinkJob({ ...job, feedsFromWorkOrder: true }, { kind: 'program', programId: 'P' })).toEqual({ ok: false, reason: 'work_order_fed' });
    expect(canLinkJob({ ...job, hasTypedUnits: true }, { kind: 'build', programId: 'P' })).toEqual({ ok: false, reason: 'has_typed_units' });
    expect(canLinkJob({ ...job, programId: 'Q' }, { kind: 'program', programId: 'P' })).toEqual({ ok: false, reason: 'other_program' });
  });
  it('lets a build link to a one time per unit job', () => {
    expect(canLinkJob({ ...job, kind: 'one_time' }, { kind: 'build', programId: null })).toEqual({ ok: true });
    expect(canLinkJob({ ...job, programId: 'Q' }, { kind: 'build', programId: 'P' })).toEqual({ ok: false, reason: 'other_program' });
  });
  it('has words for every refusal', () => {
    expect(LINK_JOB_MESSAGES.not_per_unit).toBe('Only per unit jobs can take build output.');
    expect(LINK_JOB_MESSAGES.other_program).toBe('This job already takes revenue from another program.');
  });
});
