/** The People stream reader (docs/crew/SPEC.md section 7): typed values, plain messages, rights on pay and private columns. */
import { describe, expect, it } from 'vitest';
import { mapHeaders } from './headers';
import { issueText, PEOPLE_COLUMNS, peopleColumnsFor, readPeopleRow } from './people';

const ALL_RIGHTS = { canManagePay: true, canSeePrivate: true };
const SUPERVISOR = { canManagePay: false, canSeePrivate: true };

describe('readPeopleRow', () => {
  it('reads every column into its type', () => {
    const { values, issues } = readPeopleRow(
      { employee_number: '1024', first_name: 'Maria', last_name: 'Lopez', kind: 'Temporary', status: 'Active', agency: 'Brightway Staffing', start_date: '11/30/2026', email: 'Maria@Example.com', language: 'Spanish', overtime_exempt: 'no', pay_type: 'Hourly', wage_per_hour: '$19.50' },
      ALL_RIGHTS,
    );
    expect(issues).toEqual([]);
    expect(values).toEqual({ employee_number: '1024', first_name: 'Maria', last_name: 'Lopez', kind: 'temp', status: 'active', agency: 'Brightway Staffing', start_date: '2026-11-30', email: 'maria@example.com', language: 'es', overtime_exempt: false, pay_type: 'hourly', wage_per_hour: 1950 });
  });

  it('a blank cell is left out (keep what Crew has), a needed one is an error', () => {
    const { values, issues } = readPeopleRow({ first_name: '  ', last_name: 'Lopez', phone: '' }, ALL_RIGHTS);
    expect(values).toEqual({ last_name: 'Lopez' });
    expect(issues).toEqual([{ column: 'first_name', level: 'error', message: 'First name is needed.' }]);
  });

  it('puts plain messages on the exact cell', () => {
    const { issues } = readPeopleRow({ first_name: 'A', last_name: 'B', kind: 'boss', start_date: '2026-02-30', wage_per_hour: '19,5x', status: 'ended' }, ALL_RIGHTS);
    expect(issues.map((issue) => issue.column)).toEqual(['kind', 'start_date', 'wage_per_hour', 'end_date']);
    expect(issueText(14, issues[0]!)).toBe('Row 14, kind: boss is not one of: employee, temp, seasonal.');
    expect(issues[3]!.message).toBe('An ended person needs an end date.');
  });

  it('refuses pay columns without pay:manage and emergency columns without private rights', () => {
    const supervisor = readPeopleRow({ first_name: 'A', last_name: 'B', wage_per_hour: '19.50', pay_type: 'hourly', emergency_name: 'C' }, SUPERVISOR);
    expect(supervisor.issues.map((issue) => issue.column)).toEqual(['pay_type', 'wage_per_hour']);
    expect(supervisor.issues[0]!.message).toMatch(/^Your role cannot bring in pay_type\./);
    expect(supervisor.values).toEqual({ first_name: 'A', last_name: 'B', emergency_name: 'C' });
    const noPrivate = readPeopleRow({ first_name: 'A', last_name: 'B', emergency_phone: '555' }, { canManagePay: false, canSeePrivate: false });
    expect(noPrivate.issues.map((issue) => issue.column)).toEqual(['emergency_phone']);
  });

  it('only temps come from an agency', () => {
    const { issues } = readPeopleRow({ first_name: 'A', last_name: 'B', kind: 'employee', agency: 'Brightway' }, ALL_RIGHTS);
    expect(issues.map((issue) => issue.column)).toEqual(['kind']);
  });
});

describe('the People columns', () => {
  it('map common headers from agency files', () => {
    const mapping = mapHeaders(['Emp No', 'First', 'Last', 'Agency Name', 'Agency ID', 'Hire Date', 'Cell', 'Hourly Rate'], PEOPLE_COLUMNS);
    expect(mapping.columns).toEqual(['employee_number', 'first_name', 'last_name', 'agency', 'agency_person_id', 'start_date', 'phone', 'wage_per_hour']);
    expect(mapping.missingRequired).toEqual([]);
  });

  it('a template has the pay columns for payroll only and the emergency columns for supervisors and up', () => {
    const keys = (rights: { canSeePay: boolean; canSeePrivate: boolean }) => peopleColumnsFor(rights).map((column) => column.key);
    expect(keys({ canSeePay: true, canSeePrivate: true })).toHaveLength(PEOPLE_COLUMNS.length);
    expect(keys({ canSeePay: false, canSeePrivate: true })).not.toContain('wage_per_hour');
    expect(keys({ canSeePay: false, canSeePrivate: true })).toContain('emergency_name');
    expect(keys({ canSeePay: false, canSeePrivate: false })).not.toContain('emergency_phone');
  });
});
