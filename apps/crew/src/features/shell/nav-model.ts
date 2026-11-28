'use client';
/**
 * What the navigation surfaces share: the entries a person may see (from src/lib/nav.ts, the one
 * list behind the top nav, the mobile menu and the command palette) and how badge counts read.
 * Today is the primary button in the top bar, so it is left out of the link lists on wide screens.
 */
import { useMemo } from 'react';
import { navFor, type NavEntry } from '@/lib/nav';
import { useShell, type ShellBadges } from './shell-context';

const BADGE_WORDS: Readonly<Record<keyof ShellBadges, (count: number) => string>> = {
  needsFix: (count) => (count === 1 ? '1 time card needs a fix' : `${count} time cards need a fix`),
};

export function badgeFor(entry: NavEntry, badges: ShellBadges | undefined): number {
  return entry.badge ? (badges?.[entry.badge] ?? 0) : 0;
}

/** Accessible name for an entry with a live count ("Time, 3 time cards need a fix"). */
export function badgeLabel(entry: NavEntry, badge: number): string | undefined {
  return badge > 0 && entry.badge ? `${entry.label}, ${BADGE_WORDS[entry.badge](badge)}` : undefined;
}

export const drawerBadgeFor = badgeFor;
export const drawerBadgeLabel = badgeLabel;

/** The signed in person's entries, split the way every surface shows them. The phone sheet keeps Today first. */
export function useNavGroups(options: { readonly withPrimary?: boolean } = {}): { readonly main: readonly NavEntry[]; readonly more: readonly NavEntry[]; readonly badges: ShellBadges | undefined } {
  const { crewRole, badges } = useShell();
  const withPrimary = options.withPrimary === true;
  return useMemo(() => {
    const entries = navFor(crewRole);
    return {
      main: entries.filter((entry) => entry.group === 'main' || (withPrimary && entry.group === 'primary')),
      more: entries.filter((entry) => entry.group === 'more'),
      badges,
    };
  }, [crewRole, badges, withPrimary]);
}
