/**
 * Original KitStak spot illustrations. Drawn with design tokens so they adapt to light/dark.
 * Each is decorative (aria-hidden); the surrounding EmptyState carries the message.
 */
import type { ReactElement } from 'react';

export type IllustrationName = 'board' | 'search' | 'inbox' | 'favorites' | 'error' | 'workspace' | 'notifications';

const P = 'var(--primary)';
const PS = 'var(--primary-selected)';
const PANEL = 'var(--surface-panel)';
const LINE = 'var(--border-default)';
const MUTED = 'var(--surface-muted)';

function Board() {
  return (
    <>
      <rect x="22" y="26" width="116" height="80" rx="10" fill={PANEL} stroke={LINE} strokeWidth="1.5" />
      <rect x="22" y="26" width="116" height="18" rx="10" fill={MUTED} />
      <rect x="34" y="54" width="4" height="40" rx="2" fill="var(--label-purple)" />
      <rect x="44" y="56" width="36" height="7" rx="3.5" fill={LINE} />
      <rect x="86" y="55" width="40" height="9" rx="2" fill="var(--label-green)" />
      <rect x="44" y="70" width="28" height="7" rx="3.5" fill={LINE} />
      <rect x="86" y="69" width="40" height="9" rx="2" fill="var(--label-orange)" />
      <rect x="44" y="84" width="32" height="7" rx="3.5" fill={LINE} />
      <rect x="86" y="83" width="40" height="9" rx="2" fill="var(--label-red)" />
      <circle cx="132" cy="30" r="14" fill={P} />
      <path d="M132 24v12M126 30h12" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
    </>
  );
}

function SearchArt() {
  return (
    <>
      <rect x="20" y="34" width="92" height="12" rx="6" fill={MUTED} />
      <rect x="20" y="54" width="70" height="12" rx="6" fill={MUTED} />
      <rect x="20" y="74" width="82" height="12" rx="6" fill={MUTED} />
      <circle cx="108" cy="66" r="24" fill={PS} stroke={P} strokeWidth="4" />
      <path d="M125 84l16 16" stroke={P} strokeWidth="7" strokeLinecap="round" />
      <path d="M98 60l8 8M106 60l-8 8" stroke={P} strokeWidth="3" strokeLinecap="round" />
    </>
  );
}

function InboxArt() {
  return (
    <>
      <path d="M30 70l16-36h68l16 36v28a8 8 0 0 1-8 8H38a8 8 0 0 1-8-8z" fill={PANEL} stroke={LINE} strokeWidth="1.5" />
      <path d="M30 70h30l6 10h28l6-10h30" fill="none" stroke={LINE} strokeWidth="1.5" />
      <path d="M62 52l12 10 24-24" stroke="var(--label-green)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <circle cx="122" cy="30" r="5" fill="var(--label-yellow-light)" />
      <circle cx="40" cy="26" r="3.5" fill="var(--label-pink-light)" />
    </>
  );
}

function FavoritesArt() {
  return (
    <>
      <rect x="26" y="40" width="108" height="20" rx="6" fill={MUTED} />
      <rect x="26" y="68" width="108" height="20" rx="6" fill={MUTED} />
      <path
        d="M80 20l7.6 15.4 17 2.5-12.3 12 2.9 16.9L80 58.8l-15.2 8 2.9-16.9-12.3-12 17-2.5z"
        fill="var(--label-yellow-light)"
        stroke="var(--label-yellow)"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <rect x="36" y="74" width="40" height="8" rx="4" fill={LINE} />
    </>
  );
}

function ErrorArt() {
  return (
    <>
      <rect x="30" y="30" width="100" height="72" rx="10" fill={PANEL} stroke={LINE} strokeWidth="1.5" />
      <path d="M30 46h100" stroke={LINE} strokeWidth="1.5" />
      <circle cx="40" cy="38" r="3" fill="var(--label-red-light)" />
      <circle cx="50" cy="38" r="3" fill="var(--label-yellow-light)" />
      <circle cx="60" cy="38" r="3" fill="var(--label-green-light)" />
      <path d="M80 58l18 32H62z" fill="var(--danger-subtle)" stroke="var(--danger)" strokeWidth="3" strokeLinejoin="round" />
      <path d="M80 68v10" stroke="var(--danger)" strokeWidth="3.5" strokeLinecap="round" />
      <circle cx="80" cy="84" r="2" fill="var(--danger)" />
    </>
  );
}

function WorkspaceArt() {
  return (
    <>
      <rect x="22" y="34" width="52" height="52" rx="12" fill="var(--label-purple)" />
      <rect x="86" y="34" width="52" height="24" rx="8" fill="var(--label-teal-light)" />
      <rect x="86" y="64" width="52" height="22" rx="8" fill="var(--label-orange-light)" />
      <path d="M38 64l10-14 10 14" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <rect x="22" y="94" width="116" height="8" rx="4" fill={MUTED} />
    </>
  );
}

function NotificationsArt() {
  return (
    <>
      <path d="M80 26a26 26 0 0 0-26 26v18l-8 14h68l-8-14V52a26 26 0 0 0-26-26z" fill={PS} stroke={P} strokeWidth="3" strokeLinejoin="round" />
      <path d="M70 90a10 10 0 0 0 20 0" stroke={P} strokeWidth="3" fill="none" strokeLinecap="round" />
      <path d="M36 44c-4 6-5 14-3 21M124 44c4 6 5 14 3 21" stroke={LINE} strokeWidth="3" strokeLinecap="round" fill="none" />
    </>
  );
}

const ART: Readonly<Record<IllustrationName, () => ReactElement>> = {
  board: Board,
  search: SearchArt,
  inbox: InboxArt,
  favorites: FavoritesArt,
  error: ErrorArt,
  workspace: WorkspaceArt,
  notifications: NotificationsArt,
};

export interface IllustrationProps {
  readonly name: IllustrationName;
  readonly size?: number;
  readonly className?: string;
}

export function Illustration({ name, size = 160, className }: IllustrationProps) {
  const Art = ART[name];
  return (
    <svg
      aria-hidden
      viewBox="0 0 160 128"
      width={size}
      height={(size * 128) / 160}
      fill="none"
      className={className}
    >
      <ellipse cx="80" cy="116" rx="58" ry="6" fill="var(--surface-sunken)" />
      <Art />
    </svg>
  );
}
