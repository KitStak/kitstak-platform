/**
 * React Query keys. Nested keys share a prefix, so
 * `queryClient.invalidateQueries({ queryKey: qk.job(ref) })` refreshes the job and everything
 * under it. Keep a list key and a count key on different prefixes (they collide otherwise).
 */
export const qk = {
  me: () => ['me'] as const,
  people: () => ['people'] as const,
} as const;
