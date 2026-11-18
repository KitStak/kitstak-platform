/** How each kind of record hit is named and drawn, shared by the search page and the command palette. */
import { Building2, Layers, Package, Sparkles, type LucideIcon } from 'lucide-react';
import type { SearchHitDTO } from '@/lib/types';

export type RecordKind = SearchHitDTO['type'];

export interface RecordKindInfo {
  /** One record, as a tag on the row. */
  readonly label: string;
  /** The group heading. */
  readonly plural: string;
  readonly icon: LucideIcon;
}

export const RECORD_KINDS: Readonly<Record<RecordKind, RecordKindInfo>> = {
  job: { label: 'Job', plural: 'Jobs', icon: Package },
  client: { label: 'Client', plural: 'Clients', icon: Building2 },
  jobType: { label: 'Job type', plural: 'Job types', icon: Layers },
  service: { label: 'Extra service', plural: 'Extra services', icon: Sparkles },
};

export const RECORD_KIND_ORDER: readonly RecordKind[] = ['job', 'client', 'jobType', 'service'];

/** Every typed word appears in the hit's title or subtitle (keeps an older answer honest while a new one loads). */
export function hitMatches(hit: SearchHitDTO, typed: string): boolean {
  const haystack = `${hit.title} ${hit.subtitle ?? ''}`.toLowerCase();
  return typed
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}
