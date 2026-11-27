import { redirect } from 'next/navigation';

/**
 * `/` goes to the dashboard. The proxy already sends a signed-in person from here to the right
 * place (dashboard, warehouse setup or the lock screen) before anything renders. This page only
 * redirects, so there is nothing to validate for instant navigation.
 */
export const instant = false;

export default function Home() {
  redirect('/dashboard');
}
