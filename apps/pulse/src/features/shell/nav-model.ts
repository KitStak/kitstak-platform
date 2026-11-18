'use client';
/**
 * What the navigation surfaces share: the entries a person may see (from src/lib/nav.ts, the one
 * list behind the top nav, the mobile menu and the command palette) and how badge counts read.
 */
import { useMemo } from 'react';
import { navFor, type NavEntry } from '@/lib/nav';
import { useShell, type ShellBadges } from './shell-context';

type BadgeKey = keyof ShellBadges;

const BADGE_WORDS: Readonly<Record<BadgeKey, (count: number) => string>> = {
  jobsAtRisk: (count) => (count === 1 ? '1 job needs you' : `${count} jobs need you`),
  openAlerts: (count) => (count === 1 ? '1 open alert' : `${count} open alerts`),
};

/**
 * On wide screens the bell in the top bar carries the open alerts count, so the Alerts link has
 * none. The phone menu has room for it and shows it on the Alerts row as well.
 */
function drawerBadgeKey(entry: NavEntry): BadgeKey | undefined {
  return entry.badge ?? (entry.id === 'alerts' ? 'openAlerts' : undefined);
}

export function badgeFor(entry: NavEntry, badges: ShellBadges | undefined): number {
  return entry.badge ? (badges?.[entry.badge] ?? 0) : 0;
}

/** Accessible name for an entry with a live count ("Jobs, 3 jobs need you"); undefined when the label says it all. */
export function badgeLabel(entry: NavEntry, badge: number): string | undefined {
  return badge > 0 && entry.badge ? `${entry.label}, ${BADGE_WORDS[entry.badge](badge)}` : undefined;
}

/** Count for an entry in the phone menu (the top nav counts plus open alerts on Alerts). */
export function drawerBadgeFor(entry: NavEntry, badges: ShellBadges | undefined): number {
  const key = drawerBadgeKey(entry);
  return key ? (badges?.[key] ?? 0) : 0;
}

/** Accessible name for a phone menu row with a live count ("Alerts, 23 open alerts"). */
export function drawerBadgeLabel(entry: NavEntry, badge: number): string | undefined {
  const key = drawerBadgeKey(entry);
  return badge > 0 && key ? `${entry.label}, ${BADGE_WORDS[key](badge)}` : undefined;
}

/** The signed-in person's entries, split the way every surface shows them: main links and the More group. */
export function useNavGroups(): { readonly main: readonly NavEntry[]; readonly more: readonly NavEntry[]; readonly badges: ShellBadges | undefined } {
  const { pulseRole, seesMoney, badges } = useShell();
  return useMemo(() => {
    const entries = navFor(pulseRole, seesMoney);
    return {
      main: entries.filter((entry) => entry.group === 'main'),
      more: entries.filter((entry) => entry.group === 'more'),
      badges,
    };
  }, [pulseRole, seesMoney, badges]);
}
