'use client';
/**
 * What the navigation surfaces share: the entries a person may see (from src/lib/nav.ts, the one
 * list behind the top nav, the mobile menu and the command palette) and how badge counts read.
 */
import { useMemo } from 'react';
import { navFor, type NavEntry } from '@/lib/nav';
import { useShell, type ShellBadges } from './shell-context';

const BADGE_WORDS: Readonly<Record<NonNullable<NavEntry['badge']>, (count: number) => string>> = {
  jobsAtRisk: (count) => (count === 1 ? '1 job needs you' : `${count} jobs need you`),
  openAlerts: (count) => (count === 1 ? '1 open alert' : `${count} open alerts`),
};

export function badgeFor(entry: NavEntry, badges: ShellBadges | undefined): number {
  return entry.badge ? (badges?.[entry.badge] ?? 0) : 0;
}

/** Accessible name for an entry with a live count ("Jobs, 3 jobs need you"); undefined when the label says it all. */
export function badgeLabel(entry: NavEntry, badge: number): string | undefined {
  return badge > 0 && entry.badge ? `${entry.label}, ${BADGE_WORDS[entry.badge](badge)}` : undefined;
}

/** The signed-in person's entries, split the way every surface shows them: main links and the More group. */
export function useNavGroups(): { readonly main: readonly NavEntry[]; readonly more: readonly NavEntry[]; readonly badges: ShellBadges | undefined } {
  const { pulseRole, badges } = useShell();
  return useMemo(() => {
    const entries = navFor(pulseRole);
    return {
      main: entries.filter((entry) => entry.group === 'main'),
      more: entries.filter((entry) => entry.group === 'more'),
      badges,
    };
  }, [pulseRole, badges]);
}
