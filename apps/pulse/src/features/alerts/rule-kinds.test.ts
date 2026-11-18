import { describe, expect, it } from 'vitest';
import { ALERT_KINDS } from '@/lib/constants';
import { RULE_KINDS, hideLinesInText, readThreshold, ruleHasLine, ruleNameWithoutMoney, ruleSentence, storedRuleName, tellSentence, thresholdText, tidyThreshold } from './rule-kinds';

describe('rule sentences', () => {
  it('has words for every kind, with no dashes', () => {
    for (const kind of ALERT_KINDS) {
      const sentence = ruleSentence(kind, RULE_KINDS[kind].threshold?.fallback || null);
      expect(sentence.startsWith('Tell me when ')).toBe(true);
      expect(sentence).not.toMatch(/[–—]|--/);
    }
  });
  it('puts the line in the sentence', () => {
    expect(ruleSentence('margin_below', '15.0000')).toBe("Tell me when a job's margin is heading under 15%.");
    expect(ruleSentence('missing_time_above', '2000.0000')).toBe('Tell me when more than $2,000 of paid time this month is not on any job.');
    expect(ruleSentence('unbilled_above', null)).toBe('Tell me when finished work worth more than your workspace limit is not billed.');
  });
});

describe('thresholds', () => {
  it('reads what a person types', () => {
    expect(readThreshold('percent', '15')).toBe('15');
    expect(readThreshold('percent', '12.5%')).toBe('12.5');
    expect(readThreshold('dollars', '$2,000')).toBe('2000');
  });
  it('refuses what cannot be a line', () => {
    expect(readThreshold('percent', '0')).toBeNull();
    expect(readThreshold('percent', '100')).toBeNull();
    expect(readThreshold('percent', 'abc')).toBeNull();
    expect(readThreshold('dollars', '-5')).toBeNull();
  });
  it('shows stored lines the short way', () => {
    expect(thresholdText('percent', '15.0000')).toBe('15%');
    expect(thresholdText('dollars', '2000.5000')).toBe('$2,000.5');
    expect(thresholdText('percent', null)).toBeNull();
    expect(tidyThreshold('15.0000')).toBe('15');
    expect(tidyThreshold(null)).toBe('');
  });
});

describe('tellSentence', () => {
  it('lists roles and people', () => {
    expect(tellSentence(['owner', 'admin'], ['Dana Ortiz'])).toBe('Tells owners, admins and Dana Ortiz.');
    expect(tellSentence(['manager'], [])).toBe('Tells managers.');
    expect(tellSentence([], [])).toContain('Nobody gets a message');
  });
});

describe('rule lines and readers without money', () => {
  it('leaves the line out of the sentence when money is hidden', () => {
    expect(ruleSentence('missing_time_above', '2000.0000', { moneyHidden: true })).toBe('Tell me when more than a set amount of paid time this month is not on any job.');
    expect(ruleSentence('overhead_rate_off', '1000.0000', { moneyHidden: true })).toBe('Tell me when my overhead rate is off by more than a set amount over 3 months.');
    expect(ruleSentence('margin_below', '15.0000', { moneyHidden: true })).toBe("Tell me when a job's margin is heading under a set line.");
    expect(ruleSentence('job_losing', null, { moneyHidden: true })).toBe('Tell me when a job is losing money.');
  });

  it('never stores a line in the name of a rule', () => {
    for (const kind of ALERT_KINDS) {
      const name = storedRuleName(kind);
      expect(name, kind).not.toMatch(/[$%]|\d{3,}/);
      expect(name.endsWith('.'), kind).toBe(false);
    }
  });

  it('takes dollars and percents out of free text', () => {
    expect(hideLinesInText('Tell me when more than $2,000 is lost')).toBe('Tell me when more than a set amount is lost');
    expect(hideLinesInText('under 12.5% or $1.5k')).toBe('under a set line or a set amount');
    expect(hideLinesInText('nothing logged for 3 work days')).toBe('nothing logged for 3 work days');
    expect(ruleNameWithoutMoney('unbilled_above', 'Tell me when finished work worth more than $5,000 is not billed')).toBe('Tell me when finished work worth more than a set amount is not billed');
    expect(ruleNameWithoutMoney('made_up_kind', 'Over $90')).toBe('Over a set amount');
    expect(ruleHasLine('margin_below')).toBe(true);
    expect(ruleHasLine('job_losing')).toBe(false);
  });
});
