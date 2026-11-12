import { describe, expect, it } from 'vitest';
import { neutralizeFormula, parseCsv, stripFormulaGuard, toCsv } from './csv';
import {
  boardNameFromFile,
  destinationError,
  guessBoardKind,
  kindFromFileName,
  resolveDestination,
  withFileDefaults,
  emptyNewDestination,
} from './destination';
import { currencyFromCompanion, detectExportHelpers } from './export-headers';
import { profileColumns } from './infer';
import { autoMap } from './mapping';
import { buildColumnPlan, buildRows } from './plan';
import type { TargetColumn } from './types';
import { emptyDraft, switchDestination } from '../store';
import { importLabel } from '../components/import-wizard';
import { rovingIndex } from '../components/step-source';
import { RunInterrupted, friendlyFailure, sendWithRetry } from '../runner';
import { misfitCount } from '../components/step-map';
import { ApiClientError } from '@/lib/api';

const members = [{ userId: '5f0c6c2e-8b1a-4d3e-9f2a-1c2b3d4e5f60', name: 'Ada Lovelace', email: 'ada@example.com' }];
const matchMember = (value: string) => (value.trim().toLowerCase() === 'ada@example.com' ? '5f0c6c2e-8b1a-4d3e-9f2a-1c2b3d4e5f60' : null);

describe('CSV injection guard', () => {
  it('leaves phone numbers and plain numbers alone', () => {
    expect(neutralizeFormula('+1 415 555 0100')).toBe('+1 415 555 0100');
    expect(neutralizeFormula('+44 (20) 7946-0958')).toBe('+44 (20) 7946-0958');
    expect(neutralizeFormula('-12.5')).toBe('-12.5');
    expect(neutralizeFormula('-')).toBe("'-");
  });

  it('still neutralizes formulas', () => {
    expect(neutralizeFormula('=HYPERLINK("x")')).toBe(`'=HYPERLINK("x")`);
    expect(neutralizeFormula('+SUM(A1)')).toBe(`'+SUM(A1)`);
    expect(neutralizeFormula('@cmd')).toBe(`'@cmd`);
  });

  it('strips the guard on import so exports round-trip', () => {
    expect(stripFormulaGuard(`'=SUM(A1)`)).toBe('=SUM(A1)');
    expect(stripFormulaGuard("'+1 415")).toBe('+1 415');
    expect(stripFormulaGuard("O'Brien")).toBe("O'Brien");
    expect(stripFormulaGuard("'quoted'")).toBe("'quoted'");
  });

  it('round-trips an exported phone column without problems', () => {
    const csv = toCsv([
      ['Name', 'Phone'],
      ['Ada', '+1 415 555 0100'],
    ]);
    const rows = parseCsv(csv).rows;
    expect(rows[1]).toEqual(['Ada', '+1 415 555 0100']);
  });
});

describe('KitStak export helper columns', () => {
  const headers = ['Full name', 'Group', 'Owner', 'Owner (emails)', 'Deal value', 'Deal value (currency)', 'Email'];
  const data = [
    ['Ada', 'Hot', 'Ada Lovelace', 'ada@example.com', '1200', 'EUR', 'a@x.io'],
    ['Bob', 'Cold', 'Ada Lovelace', 'ada@example.com', '300', 'EUR', 'b@x.io'],
  ];

  it('detects Group, (emails) and (currency) companions', () => {
    const helpers = detectExportHelpers(headers);
    expect(helpers.group).toBe(1);
    expect(helpers.peopleEmails.get(2)).toBe(3);
    expect(helpers.currencyCodes.get(4)).toBe(5);
  });

  it('does not treat a plain "Group" column as a helper in arbitrary files', () => {
    expect(detectExportHelpers(['Name', 'Email', 'Group']).group).toBeNull();
  });

  it('maps helpers to group routing, people by email and currency instead of new columns', () => {
    const profiles = profileColumns(headers, data, { members });
    const mapping = autoMap(profiles, []);
    const target = (index: number) => mapping.find((entry) => entry.sourceIndex === index)?.target;
    expect(target(0)).toEqual({ kind: 'name' });
    expect(target(1)).toEqual({ kind: 'group' });
    expect(target(2)).toEqual({ kind: 'skip' });
    expect(target(3)).toEqual({ kind: 'new', type: 'people', title: 'Owner' });
    expect(target(4)).toMatchObject({ kind: 'new', type: 'currency' });
    expect(target(5)).toEqual({ kind: 'skip' });
  });

  it('maps the (emails) column onto an existing people column', () => {
    const board: TargetColumn[] = [{ key: 'owner', title: 'Owner', type: 'people', settings: {} }];
    const profiles = profileColumns(headers, data, { members });
    const mapping = autoMap(profiles, board);
    expect(mapping.find((entry) => entry.sourceIndex === 3)?.target).toEqual({ kind: 'existing', columnKey: 'owner' });
  });

  it('routes rows into groups and reads per-row currency codes', () => {
    const profiles = profileColumns(headers, data, { members });
    const mapping = autoMap(profiles, []);
    const plan = buildColumnPlan(mapping, profiles, [], data);
    expect(plan.groupIndex).toBe(1);
    const built = buildRows({
      dataRows: data,
      firstRowNumber: 2,
      plan,
      headers,
      ctx: { dateOrder: 'mdy', currency: 'USD', matchMember },
      columnContext: (index, source) => ({
        dateOrder: 'mdy',
        currency: 'USD',
        rowCurrency: index === 4 ? currencyFromCompanion(source[5]) : null,
        matchMember,
      }),
    });
    expect(built.issues).toEqual([]);
    expect(built.rows[0]?.groupTitle).toBe('Hot');
    expect(built.rows[0]?.values.new_4).toEqual({ amount: 1200, currency: 'EUR' });
    expect(built.rows[0]?.values.new_3).toEqual({ ids: ['5f0c6c2e-8b1a-4d3e-9f2a-1c2b3d4e5f60'] });
  });

  it('accepts only ISO currency codes from the companion', () => {
    expect(currencyFromCompanion(' eur ')).toBe('EUR');
    expect(currencyFromCompanion('Euro')).toBeNull();
    expect(currencyFromCompanion(undefined)).toBeNull();
  });
});

describe('destination defaults', () => {
  it('sentence-cases the file stem', () => {
    expect(boardNameFromFile('import contacts')).toBe('Import contacts');
    expect(boardNameFromFile('  ')).toBe('Imported data');
    expect(boardNameFromFile('Q3 CRM export')).toBe('Q3 CRM export');
  });

  it('guesses the record type from headers and file names', () => {
    expect(guessBoardKind(['Full name', 'E-mail', 'Phone', 'Owner'])).toBe('contacts');
    expect(guessBoardKind(['Deal', 'Amount', 'Stage', 'Close date'])).toBe('deals');
    expect(guessBoardKind(['Task', 'Due'])).toBe('custom');
    expect(kindFromFileName('Q3 leads')).toBe('leads');
    expect(kindFromFileName('notes')).toBeNull();
  });

  it('only prefills untouched drafts', () => {
    const fresh = withFileDefaults(emptyNewDestination(), 'import contacts', ['Email', 'Phone']);
    expect(fresh).toMatchObject({ name: 'Import contacts', kind: 'contacts' });
    const typed = { ...fresh, name: 'My board', kind: 'deals' as const, touched: true };
    expect(withFileDefaults(typed, 'other file', ['Email'])).toBe(typed);
  });

  it('lets the board name be cleared so validation can show', () => {
    const cleared = { ...emptyNewDestination(), name: '', touched: true, workspaceId: 'w1' };
    expect(destinationError(cleared)).toBe('Give the new board a name.');
  });

  it('derives the workspace at render time (no effect race)', () => {
    const draft = { ...emptyNewDestination(), name: 'Board' };
    expect(destinationError(draft)).toBe('Choose a workspace for the new board.');
    expect(destinationError(resolveDestination(draft, 'w1'))).toBeNull();
    expect(resolveDestination({ ...draft, workspaceId: 'w2' }, 'w1')).toMatchObject({ workspaceId: 'w2' });
  });

  it('restores the previous draft when toggling destination type', () => {
    const base = emptyDraft();
    const typed = { ...base, destination: { ...base.savedNew, name: 'Visual QA', kind: 'contacts' as const, touched: true } };
    const toExisting = { ...typed, ...switchDestination(typed, 'existing') };
    expect(toExisting.destination.type).toBe('existing');
    const back = { ...toExisting, ...switchDestination(toExisting, 'new') };
    expect(back.destination).toMatchObject({ type: 'new', name: 'Visual QA', kind: 'contacts' });
  });
});

describe('wizard helpers', () => {
  it('labels the import button with creates and updates', () => {
    expect(importLabel(5, 0, 'Contact')).toBe('Import 5 contacts');
    expect(importLabel(0, 5, 'Contact')).toBe('Update 5 contacts');
    expect(importLabel(3, 2, 'Contact')).toBe('Import 3, update 2 contacts');
    expect(importLabel(1, 0, 'Activity')).toBe('Import 1 activity');
  });

  it('moves through the source tiles with arrow keys', () => {
    expect(rovingIndex('ArrowRight', 3, 4, 4)).toBe(0);
    expect(rovingIndex('ArrowLeft', 0, 4, 4)).toBe(3);
    expect(rovingIndex('ArrowDown', 0, 4, 2)).toBe(2);
    expect(rovingIndex('Enter', 0, 4, 2)).toBeNull();
  });
});

describe('runner retries', () => {
  it('retries transient failures and then succeeds', async () => {
    let calls = 0;
    const result = await sendWithRetry(async () => {
      calls += 1;
      if (calls < 3) throw new ApiClientError('INTERNAL', 'Service unavailable', 503);
      return 'ok';
    }, [0, 0, 0]);
    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });

  it('does not retry validation errors', async () => {
    let calls = 0;
    await expect(
      sendWithRetry(async () => {
        calls += 1;
        throw new ApiClientError('VALIDATION_FAILED', 'Bad', 422);
      }, [0, 0]),
    ).rejects.toThrow('Bad');
    expect(calls).toBe(1);
  });

  it('explains a lost connection in plain words', () => {
    const message = friendlyFailure(new ApiClientError('INTERNAL', 'The import stopped down', 503), 400, true);
    expect(message).toBe('We lost the connection to the server after 400 rows. Resume to continue where it stopped.');
  });
});

describe('runner reconnect feedback', () => {
  it('reports each retry before waiting', async () => {
    const seen: number[] = [];
    let calls = 0;
    const result = await sendWithRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw new ApiClientError('NETWORK_ERROR', 'offline', 0);
        return 'ok';
      },
      { delays: [0, 0, 0], onRetry: (info) => seen.push(info.attempt) },
    );
    expect(result).toBe('ok');
    expect(seen).toEqual([2, 3]);
  });

  it('gives up once the total wait cap is reached', async () => {
    let calls = 0;
    await expect(
      sendWithRetry(
        async () => {
          calls += 1;
          throw new ApiClientError('INTERNAL', 'down', 503);
        },
        { delays: [5, 5, 5, 5], maxWaitMs: 1 },
      ),
    ).rejects.toThrow('down');
    expect(calls).toBeLessThanOrEqual(2);
  });

  it('stops at once when the run is paused', async () => {
    const controller = new AbortController();
    const pending = sendWithRetry(
      async () => {
        throw new ApiClientError('INTERNAL', 'down', 503);
      },
      { delays: [10_000], signal: controller.signal },
    );
    controller.abort(new RunInterrupted('paused'));
    await expect(pending).rejects.toBeInstanceOf(RunInterrupted);
  });

  it('explains an offline pause', () => {
    expect(friendlyFailure(new RunInterrupted('offline'), 200, true)).toContain("You're offline");
  });
});

describe('mapping chips', () => {
  it('counts values that will not fit instead of showing a percentage', () => {
    expect(misfitCount(10, 0.8)).toBe(2);
    expect(misfitCount(3, 1)).toBe(0);
    expect(misfitCount(0, 0)).toBe(0);
  });
});
