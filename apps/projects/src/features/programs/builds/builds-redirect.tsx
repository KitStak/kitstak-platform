'use client';
/**
 * `/programs/KEY/builds` goes to the last builds view this browser used (localStorage
 * `ks-programs:builds-view:{key}`, written by the frame), else the Runs view. The search string
 * (range, filters, the drawer) is kept.
 */
import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Skeleton } from '@/components/ui';
import { BUILD_VIEWS, routes } from '@/lib/routes';
import type { BuildView } from '@/lib/program-types';

export function BuildsRedirect({ programKey }: { readonly programKey: string }) {
  const router = useRouter();
  const params = useSearchParams();
  useEffect(() => {
    let view: BuildView = 'runs';
    try {
      const stored = window.localStorage.getItem(`ks-programs:builds-view:${programKey}`);
      if (stored && (BUILD_VIEWS as readonly string[]).includes(stored)) view = stored as BuildView;
    } catch {
      // Storage can be off; the default view opens.
    }
    const query = params?.toString();
    router.replace(`${routes.programBuilds(programKey, view)}${query ? `?${query}` : ''}`);
  }, [params, programKey, router]);
  return (
    <div className="flex flex-col gap-3 px-6 py-4" aria-busy="true" aria-label="Opening builds">
      {[0, 1, 2].map((index) => (
        <Skeleton key={index} height={56} rounded="lg" />
      ))}
    </div>
  );
}
