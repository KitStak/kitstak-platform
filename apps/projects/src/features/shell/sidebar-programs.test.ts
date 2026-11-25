import { describe, expect, it } from 'vitest';
import type { ProgramListItemDTO } from '@/lib/program-types';
import { sidebarPrograms } from './sidebar-programs';

function program(id: string, name: string, status: ProgramListItemDTO['status'], archivedAt: string | null = null): ProgramListItemDTO {
  return { id, key: id.toUpperCase(), name, status, archivedAt } as ProgramListItemDTO;
}

describe('sidebar programs', () => {
  it('keeps running and paused programs, recents first, then by name', () => {
    const list = [program('b', 'Beta', 'active'), program('a', 'Alpha', 'on_hold'), program('c', 'Charlie', 'active'), program('d', 'Delta', 'completed'), program('e', 'Echo', 'active', '2026-11-01'), program('f', 'Foxtrot', 'planning')];
    expect(sidebarPrograms(list, ['c']).map((p) => p.id)).toEqual(['c', 'a', 'b']);
    expect(sidebarPrograms(list, []).map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });
});
