'use client';

import * as React from 'react';
import { z } from 'zod';
import { useApiQuery } from '@/lib/query-client';

const row = z.object({ id: z.string(), name: z.string(), isActive: z.boolean().optional() });

/** Active Data Setup values of a type as `{ id, name }` (reads the shared `/api/lookups/<type>`). */
export function useLookupNames(
  type: string | null,
): readonly { readonly id: string; readonly name: string }[] {
  const query = useApiQuery<unknown>(['lookups', type ?? '', 'all'], type ? `/api/lookups/${type}` : null, {
    staleTime: 60_000,
  });
  return React.useMemo(() => {
    const parsed = z.array(row).safeParse(query.data?.data);
    return parsed.success ? parsed.data.filter((r) => r.isActive !== false) : [];
  }, [query.data]);
}
