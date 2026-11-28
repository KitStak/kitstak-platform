'use client';
/**
 * What the navigation surfaces share: the entries a person may see (from src/lib/nav.ts, the one
 * list behind the top nav, the phone menu and the command palette) and how badge counts read.
 */
import { useMemo } from 'react';
import { navFor, type BadgeKey, type NavEntry } from '@/lib/nav';
import { useShell, type ShellBadges } from './shell-context';

const BADGE_WORDS: Readonly<Record<BadgeKey, (count: number) => string>> = {
  overdue: (count) => (count === 1 ? '1 invoice overdue' : `${count} invoices overdue`),
  billsWaiting: (count) => (count === 1 ? '1 bill waiting for you' : `${count} bills waiting for you`),
  unmatched: (count) => (count === 1 ? '1 bank line to match' : `${count} bank lines to match`),
};

export function badgeFor(entry: NavEntry, badges: ShellBadges | undefined): number {
  return entry.badge ? (badges?.[entry.badge] ?? 0) : 0;
}

/** Accessible name for an entry with a live count ("Bills, 3 bills waiting for you"). */
export function badgeLabel(entry: NavEntry, badge: number): string | undefined {
  return badge > 0 && entry.badge ? `${entry.label}, ${BADGE_WORDS[entry.badge](badge)}` : undefined;
}

/** The signed in person's entries, split the way every surface shows them: main links and the More group. */
export function useNavGroups(): { readonly main: readonly NavEntry[]; readonly more: readonly NavEntry[]; readonly badges: ShellBadges | undefined } {
  const { rights, badges } = useShell();
  return useMemo(() => {
    const entries = navFor(rights);
    return { main: entries.filter((entry) => entry.group === 'main'), more: entries.filter((entry) => entry.group === 'more'), badges };
  }, [rights, badges]);
}
