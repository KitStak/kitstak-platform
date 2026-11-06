import { notFound } from 'next/navigation';

/**
 * Any unknown path inside an org renders the in-shell 404 (./not-found.tsx) instead of the global one.
 * This route deliberately sits OUTSIDE the `(pages)` group: that group owns loading.tsx, and a
 * Suspense boundary above notFound() would flush a 200 before the 404 is known (a soft 404).
 */
export default function MissingOrgPage(): never {
  notFound();
}
