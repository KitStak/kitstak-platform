import { Suspense } from 'react';
import { SignupHero, SignupHeroFallback } from '../../../_components/auth-hero';

/** The panel beside the signup form: the cart from the link, or the list prices, and three promises. */
export default function Hero() {
  return (
    // The cart is read from the link in the browser, so the panel sits behind a boundary.
    <Suspense fallback={<SignupHeroFallback />}>
      <SignupHero />
    </Suspense>
  );
}
