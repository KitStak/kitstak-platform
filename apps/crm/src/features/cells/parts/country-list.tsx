'use client';
import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { Check } from 'lucide-react';
import { SearchInput } from '@/components/ui';
import { searchCountries, type Country } from '../lib/countries';
import { EmptyListMessage } from './common';
import { Flag } from './flag';

export interface CountryListProps {
  readonly value: string | null;
  readonly onSelect: (country: Country) => void;
  readonly showDial?: boolean;
  readonly autoFocus?: boolean;
}

/** Searchable country listbox (name, ISO code or dial code). ↑/↓/Enter, type to filter. */
export function CountryList({ value, onSelect, showDial = false, autoFocus = true }: CountryListProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();
  const results = useMemo(() => searchCountries(query), [query]);
  const activeIndex = Math.min(active, Math.max(0, results.length - 1));

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      const next = (activeIndex + delta + results.length) % Math.max(1, results.length);
      setActive(next);
      document.getElementById(`${listId}-${next}`)?.scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const country = results[activeIndex];
      if (country) onSelect(country);
    }
  };

  return (
    <div className="flex flex-col gap-2" onKeyDown={onKeyDown}>
      <SearchInput
        autoFocus={autoFocus}
        size="sm"
        value={query}
        onValueChange={(next) => {
          setQuery(next);
          setActive(0);
        }}
        placeholder={showDial ? 'Search country or code' : 'Search countries'}
        aria-controls={listId}
        aria-activedescendant={results.length ? `${listId}-${activeIndex}` : undefined}
      />
      <ul id={listId} role="listbox" aria-label="Countries" className="-mx-1 flex max-h-60 flex-col overflow-y-auto">
        {results.length === 0 ? <EmptyListMessage>No country matches “{query}”</EmptyListMessage> : null}
        {results.map((country, index) => (
          <li
            key={country.code}
            id={`${listId}-${index}`}
            role="option"
            aria-selected={country.code === value}
            data-active={index === activeIndex}
            onPointerMove={() => setActive(index)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onSelect(country)}
            className="ks-menu-item mx-1 not-data-[active=true]:bg-transparent data-[active=true]:bg-hover"
          >
            <Flag code={country.code} />
            <span className="min-w-0 flex-1 truncate">{country.name}</span>
            {showDial ? <span className="text-sm text-fg-muted tabular-nums">+{country.dial}</span> : null}
            {country.code === value ? <Check aria-hidden className="!size-4 !text-primary-text" /> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
