'use client';
import { useMemo } from 'react';
import type { OrgPerson } from '@/lib/types';
import { usePeople } from './use-data';

/** Org people as a Map (id → person) for avatars/names in lists. */
export function usePeopleMap(): ReadonlyMap<string, OrgPerson> {
  const people = usePeople();
  return useMemo(() => new Map((people.data ?? []).map((person) => [person.id, person])), [people.data]);
}
