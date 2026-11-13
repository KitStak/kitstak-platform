import { describe, expect, it } from 'vitest';
import { linkPathOf, siblingAppOf } from './link-path';

describe('linkPathOf', () => {
  it('drops the host so a link never pins a port or domain', () => {
    expect(linkPathOf('http://localhost:3000/receiving/abc')).toBe('/receiving/abc');
    expect(linkPathOf('https://crm.kitstak.app/nw/boards/b1?item=i1#x')).toBe('/nw/boards/b1?item=i1#x');
  });

  it('keeps stored paths and rejects anything else', () => {
    expect(linkPathOf('/counts/1')).toBe('/counts/1');
    expect(linkPathOf('javascript:alert(1)')).toBeNull();
    expect(linkPathOf('')).toBeNull();
    expect(linkPathOf(null)).toBeNull();
  });
});

describe('siblingAppOf', () => {
  it('maps link types to their app', () => {
    expect(siblingAppOf('crm_item')).toBe('crm');
    expect(siblingAppOf('wms_receipt')).toBe('wms');
    expect(siblingAppOf('core_customer')).toBeNull();
  });
});
