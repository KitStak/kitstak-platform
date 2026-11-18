import { describe, expect, it } from 'vitest';
import { clientNameKey, clientNamesLookAlike, matchClientName, nameList } from './client-names';

const clients = [
  { id: '1', name: 'Harbor Roast Collective', code: 'HRB' },
  { id: '2', name: 'Northwind Outfitters', code: 'NWO' },
  { id: '3', name: 'Acme Foods, Inc.', code: 'ACME' },
  { id: '4', name: 'Harborview Dental', code: 'HVD' },
];

describe('clientNameKey', () => {
  it('drops case, marks and company filler', () => {
    expect(clientNameKey('Acme Foods, Inc.')).toBe('acme foods');
    expect(clientNameKey('  THE  Acme   Foods Co ')).toBe('acme foods');
    expect(clientNameKey('Café Olé')).toBe('cafe ole');
  });

  it('keeps a name that is only filler', () => {
    expect(clientNameKey('The Company')).toBe('the company');
  });
});

describe('clientNamesLookAlike', () => {
  it('sees a part of a longer name', () => {
    expect(clientNamesLookAlike('Harbor', 'Harbor Roast Collective')).toBe(true);
    expect(clientNamesLookAlike('Harbor Roast', 'Harbor Roast Collective')).toBe(true);
    expect(clientNamesLookAlike('Harbor Roast Collective West', 'Harbor Roast Collective')).toBe(true);
    expect(clientNamesLookAlike('Harb', 'Harbor Roast Collective')).toBe(true);
  });

  it('sees the same name written another way', () => {
    expect(clientNamesLookAlike('acme foods', 'Acme Foods, Inc.')).toBe(true);
    expect(clientNamesLookAlike('AcmeFoods', 'Acme Foods, Inc.')).toBe(true);
    expect(clientNamesLookAlike('North Wind Outfitters', 'Northwind Outfitters')).toBe(true);
  });

  it('sees a slip of a letter or two', () => {
    expect(clientNamesLookAlike('Nortwind Outfitters', 'Northwind Outfitters')).toBe(true);
    expect(clientNamesLookAlike('Acme Fods', 'Acme Foods')).toBe(true);
    expect(clientNamesLookAlike('Harbr Roast', 'Harbor Roast Collective')).toBe(true);
  });

  it('leaves different names alone', () => {
    expect(clientNamesLookAlike('Summit Supply', 'Harbor Roast Collective')).toBe(false);
    expect(clientNamesLookAlike('Bolt', 'Belt')).toBe(false);
    expect(clientNamesLookAlike('Harbor Freight', 'Harbor Roast Collective')).toBe(false);
    expect(clientNamesLookAlike('Ha', 'Harbor Roast Collective')).toBe(false);
    expect(clientNamesLookAlike('', 'Harbor Roast Collective')).toBe(false);
  });
});

describe('matchClientName', () => {
  it('picks the exact client by name or code, case aside', () => {
    expect(matchClientName('  harbor roast collective ', clients).exact?.id).toBe('1');
    expect(matchClientName('hrb', clients).exact?.id).toBe('1');
    expect(matchClientName('hrb', clients).lookAlikes).toEqual([]);
  });

  it('lists the look-alikes for a partial name, closest first', () => {
    const match = matchClientName('Harbor', clients);
    expect(match.exact).toBeNull();
    expect(match.lookAlikes.map((client) => client.id)).toEqual(['4', '1']);
  });

  it('treats the same name with other marks as a look-alike, not as exact', () => {
    const match = matchClientName('Acme Foods', clients);
    expect(match.exact).toBeNull();
    expect(match.lookAlikes.map((client) => client.id)).toEqual(['3']);
  });

  it('finds nothing for a new name or empty text', () => {
    expect(matchClientName('Summit Supply', clients)).toEqual({ exact: null, lookAlikes: [] });
    expect(matchClientName('   ', clients)).toEqual({ exact: null, lookAlikes: [] });
  });
});

describe('nameList', () => {
  it('joins names in plain words', () => {
    expect(nameList(['A'])).toBe('A');
    expect(nameList(['A', 'B'])).toBe('A or B');
    expect(nameList(['A', 'B', 'C', 'D'])).toBe('A, B or C');
  });
});
