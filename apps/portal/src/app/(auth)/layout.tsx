import { legalUrls } from '@/server/env';
import { AuthShell } from './_components/auth-shell';

/**
 * Frame for every signed out screen and for the signup steps. Most screens use the split layout:
 * the form on the left, the brand panel on the right (from 1024 px up). The app picker step is
 * wide and has no brand panel, so the picker and its price summary get the whole page.
 *
 * The brand panel is the `@hero` slot (a parallel route), so each page gets the panel that fits
 * it, rendered on the server: reasons to start beside signup, "One sign in" beside sign in, the
 * running trial beside "Check your email", the team and the role beside an invite. Every page of
 * this group has a file of the same path under `@hero`; `@hero/default.tsx` is the fallback.
 */
/**
 * Rendered per request, never prebuilt. The legal links come from the server environment, and the
 * Vercel build runs without it (turbo strict env mode), so a prebuilt page here fails the build.
 */
export const dynamic = 'force-dynamic';

export default function AuthLayout({ children, hero }: { readonly children: React.ReactNode; readonly hero: React.ReactNode }) {
  return (
    <AuthShell legal={legalUrls()} year={new Date().getFullYear()} hero={hero}>
      {children}
    </AuthShell>
  );
}
