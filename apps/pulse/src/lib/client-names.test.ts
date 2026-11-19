import { describe, expect, it } from 'vitest';
import { clientNameKey, clientNamesLookAlike, clientWordStem, matchClientName, nameList, CLIENT_NEEDED, clientBoxProblem, clientLookAlikeMessage } from './client-names';
import { CLIENT_LIST, TYPED_SLIPS } from './client-names.fixture';

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

describe('plurals and slips in more than one word (round four, ops buyer issue 4)', () => {
  it('treats a plural as the same word', () => {
    expect(clientWordStem('supplies')).toBe('supply');
    expect(clientWordStem('pets')).toBe('pet');
    expect(clientWordStem('boxes')).toBe('box');
    expect(clientWordStem('glass')).toBe('glass');
    expect(clientWordStem('bus')).toBe('bus');
    expect(clientNamesLookAlike('Orchard Pets', 'Orchard Pet Supply')).toBe(true);
    expect(clientNamesLookAlike('Orchard Pet Supplies LLC', 'Orchard Pet Supply')).toBe(true);
  });

  it('allows a slip in each word, more for a longer name', () => {
    expect(clientNamesLookAlike('Sumit Trial Gear', 'Summit Trail Gear')).toBe(true);
    expect(clientNamesLookAlike('Evergren Retail Grup', 'Evergreen Retail Group')).toBe(true);
    // One whole word that is different is a different client.
    expect(clientNamesLookAlike('Acme Foods', 'Acme Tools')).toBe(false);
    expect(clientNamesLookAlike('Silver Lake Apparel', 'Silverline Apparel')).toBe(false);
  });

  it('catches every slip in a list of ${TYPED_SLIPS.length} typed names, and names no other client', () => {
    const missed = TYPED_SLIPS.filter(([typed, means]) => !clientNamesLookAlike(typed, means));
    expect(missed).toEqual([]);
    const wrong = TYPED_SLIPS.flatMap(([typed, means]) => CLIENT_LIST.filter((name) => name !== means && clientNamesLookAlike(typed, name)).map((name) => `${typed} ~ ${name}`));
    expect(wrong).toEqual([]);
  });

  it('finds no false look alikes among 65 different clients', () => {
    // 2,080 pairs. The rule before this round flagged 2 of them (Acme Foods and Acme Tools, Cobalt
    // Foods and Cobalt Tools) and missed 3 of the typed slips above.
    expect(CLIENT_LIST.length).toBeGreaterThanOrEqual(50);
    const flagged: string[] = [];
    for (let i = 0; i < CLIENT_LIST.length; i += 1) {
      for (let j = i + 1; j < CLIENT_LIST.length; j += 1) if (clientNamesLookAlike(CLIENT_LIST[i]!, CLIENT_LIST[j]!)) flagged.push(`${CLIENT_LIST[i]} ~ ${CLIENT_LIST[j]}`);
    }
    expect(flagged).toEqual([]);
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

describe('clientBoxProblem', () => {
  const box = (text: string, clientId: string | null = null, createNew = false) => clientBoxProblem({ text, clientId, createNew }, clients);

  it('is the one message set of every client box', () => {
    expect(box('')).toBe(CLIENT_NEEDED);
    // A close name: pick it, or choose Create. The server sends the same words.
    expect(box('Harbor Roast Collectiv')).toBe(clientLookAlikeMessage('Harbor Roast Collectiv', ['Harbor Roast Collective']));
    expect(box('Harbor Roast Collectiv')).toContain('Pick it from the list, or choose Create "Harbor Roast Collectiv" to add a new client.');
    // Loose text close to nothing: a client is only made from the Create row.
    expect(box('Summit Supply')).toBe('Summit Supply is not a client yet. Choose Create "Summit Supply" in the list to add it.');
  });

  it('is quiet for a picked client, a confirmed new client and an exact name', () => {
    expect(box('Harbor Roast Collective', '1')).toBeNull();
    expect(box('Harbor', null, true)).toBeNull();
    expect(box('harbor roast collective')).toBeNull();
  });
});
