import { describe, expect, it } from 'vitest';
import { undash } from './undash';

describe('undash', () => {
  it('reads ranges as "to"', () => {
    expect(undash('Third shift (10pm–6am)')).toBe('Third shift (10pm to 6am)');
    expect(undash('Levels D–E and a scan test')).toBe('Levels D to E and a scan test');
    expect(undash('Nov 20 – Jan 5')).toBe('Nov 20 to Jan 5');
  });
  it('turns other dashes into a middle dot', () => {
    expect(undash('Beacon Pharma — Fleet orchestration software')).toBe('Beacon Pharma · Fleet orchestration software');
    expect(undash('Weekly cycle count – zone D aisle 1')).toBe('Weekly cycle count · zone D aisle 1');
    expect(undash('Plain title')).toBe('Plain title');
  });
});
