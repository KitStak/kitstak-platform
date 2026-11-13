import { describe, expect, it } from 'vitest';
import { statusTone, targetApp } from './status-tone';

describe('statusTone', () => {
  it('reads finished states as success', () => {
    expect(statusTone('Shipped')).toBe('success');
    expect(statusTone('Closed won')).toBe('success');
    expect(statusTone('Delivered')).toBe('success');
  });
  it('reads dead ends as danger and stalls as warning', () => {
    expect(statusTone('Lost')).toBe('danger');
    expect(statusTone('Cancelled')).toBe('danger');
    expect(statusTone('On Hold')).toBe('warning');
    expect(statusTone('Shortage')).toBe('warning');
  });
  it('reads moving work as progress and unknowns as neutral', () => {
    expect(statusTone('Ready to Pick')).toBe('progress');
    expect(statusTone('Negotiation')).toBe('progress');
    expect(statusTone('Prospect tier B')).toBe('neutral');
    expect(statusTone(null)).toBe('neutral');
  });
  it('maps target types to their app', () => {
    expect(targetApp('wms_order')).toBe('wms');
    expect(targetApp('crm_item')).toBe('crm');
    expect(targetApp('core_customer')).toBe('crm');
  });
});
