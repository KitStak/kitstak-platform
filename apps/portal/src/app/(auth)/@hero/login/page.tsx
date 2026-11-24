import { Suspense } from 'react';
import { LoginHero, SignInHero } from '../../_components/auth-hero';

/**
 * The panel beside "Welcome back". No prices. Only a link from the pricing page that carries a cart
 * keeps "Your free trial", and that is read from the link in the browser, behind a boundary.
 */
export default function Hero() {
  return (
    <Suspense fallback={<SignInHero />}>
      <LoginHero />
    </Suspense>
  );
}
