/** Deep links into Crew (SPEC 8.1). Links store a path, never a host: the base comes from NEXT_PUBLIC_CREW_URL. */
export interface CrewUrls {
  readonly home: () => string;
  readonly person: (personId: string) => string;
  readonly today: (siteId?: string) => string;
  readonly schedule: (siteId: string, week: string) => string;
  readonly timeWeek: (siteId: string, week: string) => string;
  readonly plan: (siteId: string) => string;
}

export function crewUrls(base: string): CrewUrls {
  const root = base.replace(/\/+$/, '');
  const at = (path: string, params: Record<string, string | undefined> = {}): string => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
    const qs = query.toString();
    return `${root}${path}${qs ? `?${qs}` : ''}`;
  };
  return {
    home: () => at('/'),
    person: (personId) => at(`/people/${encodeURIComponent(personId)}`),
    today: (siteId) => at('/today', { site: siteId }),
    schedule: (siteId, week) => at('/schedule', { site: siteId, week }),
    timeWeek: (siteId, week) => at('/time', { site: siteId, week }),
    plan: (siteId) => at('/plan', { site: siteId }),
  };
}
