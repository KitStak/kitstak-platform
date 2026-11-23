import { Suspense } from 'react';
import { legalUrls } from '@/server/env';
import { AuthHero, AuthHeroFallback } from './_components/auth-hero';
import { AuthShell } from './_components/auth-shell';

/**
 * Frame for every signed out screen and for the signup steps. Most screens use the split layout:
 * the form on the left, the brand panel on the right (from 1024 px up). The app picker step is
 * wide and has no brand panel, so the picker and its price summary get the whole page.
 */
export default function AuthLayout({ children }: { readonly children: React.ReactNode }) {
  return (
    <AuthShell
      legal={legalUrls()}
      year={new Date().getFullYear()}
      hero={
        // The hero reads the cart from the link in the browser, so it sits behind a boundary.
        <Suspense fallback={<AuthHeroFallback />}>
          <AuthHero />
        </Suspense>
      }
    >
      {children}
    </AuthShell>
  );
}
