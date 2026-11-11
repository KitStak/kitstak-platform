'use client';
import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, History, MapPin, Search } from 'lucide-react';
import { Button, Input, Skeleton, cn } from '@/components/ui';
import type { CellRenderContext, CellRenderer } from '../cell-context';
import { readLocation } from '../lib/values';
import { EmptyGhost, TruncText } from '../parts/common';
import { useDebounced } from '../parts/use-debounced';
import { useTabFlush } from '../parts/use-tab-flush';
import type { GeoPlace } from '../types';

type LocationValue = { address: string; lat?: number; lng?: number };

function LocationDisplay({ ctx }: { readonly ctx: CellRenderContext }) {
  const value = readLocation(ctx.value);
  if (!value) return ctx.readOnly ? null : <EmptyGhost icon={<MapPin aria-hidden />} label="Add location" />;
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1.5 px-2.5">
      <MapPin aria-hidden className="size-4 shrink-0 text-[var(--label-red-text)]" />
      <TruncText>{value.address}</TruncText>
    </span>
  );
}

function formatCoord(lat: number, lng: number): string {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lng >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(4)}° ${ns}, ${Math.abs(lng).toFixed(4)}° ${ew}`;
}

function mapHref(value: LocationValue): string {
  return value.lat !== undefined && value.lng !== undefined
    ? `https://www.openstreetmap.org/?mlat=${value.lat}&mlon=${value.lng}#map=15/${value.lat}/${value.lng}`
    : `https://www.openstreetmap.org/search?query=${encodeURIComponent(value.address)}`;
}

/** Stylized pin preview (no third-party tiles): grid "map" with the pin and its coordinates. */
function PinPreview({ value }: { readonly value: LocationValue }) {
  const hasCoords = value.lat !== undefined && value.lng !== undefined;
  return (
    <div
      data-testid="location-preview"
      className="relative flex h-[84px] items-end overflow-hidden rounded-md border border-border-subtle bg-[var(--label-sky-subtle)]"
    >
      <svg aria-hidden className="absolute inset-0 size-full text-[var(--label-sky-text)] opacity-25" preserveAspectRatio="none" viewBox="0 0 280 84">
        <path d="M0 22 H280 M0 54 H280 M60 0 V84 M150 0 V84 M220 0 V84" stroke="currentColor" strokeWidth="1" />
        <path d="M0 70 C70 40 120 80 180 46 S260 20 280 30" stroke="currentColor" strokeWidth="5" fill="none" />
      </svg>
      <MapPin aria-hidden className="absolute top-3 left-1/2 size-7 -translate-x-1/2 fill-[var(--label-red)] text-[var(--surface-panel)] drop-shadow" />
      <div className="relative m-1.5 flex min-w-0 flex-1 items-center gap-2 rounded-sm bg-[var(--surface-panel)] px-2 py-1 shadow-xs">
        <span className="min-w-0 flex-1 truncate text-xs text-fg-secondary tabular-nums">
          {hasCoords ? formatCoord(value.lat as number, value.lng as number) : 'No coordinates (typed address)'}
        </span>
        <a
          href={mapHref(value)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1 rounded-xs text-xs font-medium text-fg-link hover:underline focus-visible:outline-2 focus-visible:outline-focus"
        >
          <ExternalLink aria-hidden className="size-3" /> Open map
        </a>
      </div>
    </div>
  );
}

interface Suggestion {
  readonly key: string;
  readonly kind: 'place' | 'recent';
  readonly title: string;
  readonly subtitle: string | null;
  readonly value: LocationValue;
}

function LocationEditor({ ctx }: { readonly ctx: CellRenderContext }) {
  const current = readLocation(ctx.value);
  // A typed seed replaces the address (Excel-style); otherwise the current address opens selected.
  const [address, setAddress] = useState(ctx.seed ?? current?.address ?? '');
  const [active, setActive] = useState(-1);
  const debounced = useDebounced(address.trim(), 250);
  const listId = useId();
  const geocode = ctx.services.geocode;
  const typed = debounced.length >= 3 && debounced !== current?.address;

  const places = useQuery({
    queryKey: ['cells', 'geocode', ctx.services.scopeKey ?? 'local', debounced],
    queryFn: ({ signal }) => (geocode ? geocode(debounced, signal) : Promise.resolve([] as GeoPlace[])),
    enabled: Boolean(geocode) && typed,
    staleTime: 5 * 60_000,
  });

  const recent = useMemo(() => {
    const seen = new Map<string, LocationValue>();
    for (const entry of ctx.services.boardItems ?? []) {
      const location = readLocation(entry.values[ctx.column.key]);
      if (location && location.address !== current?.address && !seen.has(location.address)) seen.set(location.address, location);
      if (seen.size >= 8) break;
    }
    const needle = address.trim().toLowerCase();
    return [...seen.values()].filter((entry) => !needle || entry.address.toLowerCase().includes(needle)).slice(0, 4);
  }, [address, ctx.column.key, ctx.services.boardItems, current?.address]);

  const suggestions: Suggestion[] = [
    ...(typed && places.data
      ? places.data.map((place): Suggestion => ({
          key: `p:${place.id}`,
          kind: 'place',
          title: place.name,
          subtitle: place.address === place.name ? null : place.address,
          value: { address: place.address, lat: place.lat, lng: place.lng },
        }))
      : []),
    ...recent.map((entry): Suggestion => ({ key: `r:${entry.address}`, kind: 'recent', title: entry.address, subtitle: null, value: entry })),
  ];

  /** Typed text without a picked suggestion keeps its coordinates only if the address is unchanged. */
  const fromTyped = (): LocationValue | null => {
    const trimmed = address.trim().slice(0, 500);
    if (!trimmed) return null;
    return trimmed === current?.address ? current : { address: trimmed };
  };

  const apply = (next: LocationValue | null) => {
    if (!next) {
      if (current) ctx.commit(null);
      return;
    }
    if (next.address === current?.address && next.lat === current?.lat && next.lng === current?.lng) return;
    ctx.commit(next);
  };

  const save = (next: LocationValue | null) => {
    apply(next);
    ctx.endEdit();
  };

  useTabFlush(ctx, () => {
    apply(active >= 0 && suggestions[active] ? suggestions[active].value : fromTyped());
    return true;
  });

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (suggestions.length === 0) return;
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      // -1 = the typed text; wraps through the suggestions.
      setActive((index) => {
        const next = index + step;
        if (next < -1) return suggestions.length - 1;
        return next >= suggestions.length ? -1 : next;
      });
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const picked = active >= 0 ? suggestions[active] : undefined;
      save(picked ? picked.value : fromTyped());
    }
  };

  const preview = current && address.trim() === current.address ? current : null;
  const showSkeleton = typed && Boolean(geocode) && places.isLoading;
  const noMatches = typed && Boolean(geocode) && places.isSuccess && suggestions.length === 0;

  return (
    <div className="flex w-[300px] flex-col gap-2" data-testid="location-editor">
      <Input
        autoFocus
        onFocus={(event) => {
          if (!ctx.seed) event.currentTarget.select();
        }}
        leadingIcon={<Search aria-hidden />}
        value={address}
        maxLength={500}
        placeholder="Search an address or place"
        aria-label="Address"
        role="combobox"
        aria-expanded={suggestions.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 && suggestions[active] ? `${listId}-${active}` : undefined}
        onChange={(event) => {
          setAddress(event.target.value);
          setActive(-1);
        }}
        onKeyDown={onKeyDown}
      />
      <ul id={listId} role="listbox" aria-label="Address suggestions" aria-busy={showSkeleton || undefined} className="-mx-1 flex max-h-56 flex-col overflow-y-auto">
        {showSkeleton
          ? [72, 56, 64].map((width) => (
              <li key={width} aria-hidden className="flex h-10 items-center gap-2 px-2.5">
                <Skeleton width={16} height={16} rounded="full" />
                <span className="flex flex-1 flex-col gap-1">
                  <Skeleton height={9} width={`${width}%`} rounded="full" />
                  <Skeleton height={7} width={`${width - 20}%`} rounded="full" />
                </span>
              </li>
            ))
          : null}
        {places.isError && typed ? (
          <li className="px-2.5 py-2 text-sm text-danger-text">
            Couldn&apos;t search places.{' '}
            <button type="button" className="font-semibold underline" onClick={() => void places.refetch()}>
              Retry
            </button>
          </li>
        ) : null}
        {noMatches ? (
          <li className="px-2.5 py-2 text-sm text-fg-muted">
            No places match “{debounced}”. Press <span className="font-semibold">Enter</span> to save it as typed.
          </li>
        ) : null}
        {suggestions.map((suggestion, index) => {
          const first = index === 0 || suggestions[index - 1]?.kind !== suggestion.kind;
          return (
            <li key={suggestion.key} role="presentation">
              {first ? (
                <div className="px-2.5 pt-1.5 pb-1 text-xs font-semibold text-fg-muted ">
                  {suggestion.kind === 'place' ? 'Places' : 'Used on this board'}
                </div>
              ) : null}
              <div
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                data-active={index === active}
                onPointerMove={() => setActive(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => save(suggestion.value)}
                className="ks-menu-item mx-1 not-data-[active=true]:bg-transparent data-[active=true]:bg-hover"
              >
                {suggestion.kind === 'place' ? <MapPin aria-hidden /> : <History aria-hidden />}
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{suggestion.title}</span>
                  {suggestion.subtitle ? <span className="truncate text-xs text-fg-muted">{suggestion.subtitle}</span> : null}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      {preview ? <PinPreview value={preview} /> : null}
      <div className={cn('-mx-3 -mb-3 flex items-center gap-2 border-t border-border-subtle px-3 py-2.5')}>
        {current ? (
          <Button variant="danger-ghost" size="sm" onClick={() => save(null)}>
            Remove
          </Button>
        ) : null}
        <span className="flex-1" />
        <Button variant="ghost" size="sm" onClick={() => ctx.endEdit()}>
          Cancel
        </Button>
        <Button size="sm" onClick={() => save(fromTyped())}>
          Save
        </Button>
      </div>
    </div>
  );
}

export const locationRenderer: CellRenderer = {
  behavior: { mode: 'popover', clearable: true, typeToEdit: true, width: 300 },
  Display: LocationDisplay,
  Editor: LocationEditor,
};
