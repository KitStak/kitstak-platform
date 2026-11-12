/**
 * Custom Branding (Apps › Custom Branding), read by: the app shell (accent color as the
 * primary token for every user), the sign-in page message, printout previews and PDFs
 * (heading accent, logo on/off) and company emails (footer). Null while the app is inactive.
 */
import { eq } from 'drizzle-orm';
import type { AppDb } from '@/server/api/db';
import * as s from '@/server/db/schema';

export interface Branding {
  readonly accentColor: string;
  readonly applyToApp: boolean;
  readonly printoutAccent: boolean;
  readonly logoOnPrintouts: boolean;
  readonly loginMessage: string | null;
  readonly emailFooter: string | null;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

export async function getBranding(db: AppDb): Promise<Branding | null> {
  const row = (
    await db
      .select({ isActive: s.apps.isActive, settings: s.apps.settings })
      .from(s.apps)
      .where(eq(s.apps.key, 'custom-branding'))
      .limit(1)
  )[0];
  if (!row?.isActive) return null;
  const st = (row.settings ?? {}) as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 300) : null);
  const accent =
    typeof st.accentColor === 'string' && HEX.test(st.accentColor) ? st.accentColor.toUpperCase() : '#4F46E5';
  return {
    accentColor: accent,
    applyToApp: st.applyToApp === true,
    printoutAccent: st.printoutAccent === true,
    // Defaults to on: activating branding without touching the toggle keeps the logo.
    logoOnPrintouts: st.logoOnPrintouts !== false,
    loginMessage: text(st.loginMessage),
    emailFooter: text(st.emailFooter),
  };
}

/** CSS that re-points the primary tokens at the brand accent (light and dark). Pure. */
export function brandAccentCss(hex: string): string {
  if (!HEX.test(hex)) return '';
  return [
    `:root{--primary:${hex};--primary-hover:color-mix(in srgb, ${hex} 82%, black);--primary-soft:color-mix(in srgb, ${hex} 10%, white)}`,
    `:root[data-theme="dark"]{--primary:color-mix(in srgb, ${hex} 85%, white);--primary-hover:color-mix(in srgb, ${hex} 70%, white);--primary-soft:color-mix(in srgb, ${hex} 18%, black)}`,
  ].join('\n');
}
