'use client';
/** Settings → Keyboard shortcuts: every shortcut in one searchable list (same source as the ? sheet). */
import { useState } from 'react';
import { Keyboard } from 'lucide-react';
import { EmptyState, Kbd, SearchInput, useModKey } from '@/components/ui';
import { Panel } from '@/components/layout/page';
import { SHORTCUT_GROUPS } from '@/features/shell/shortcuts-dialog';

export function ShortcutsSection() {
  const mod = useModKey();
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const groups = SHORTCUT_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) => !q || `${item.label} ${item.keys.join(' ')} ${group.title}`.toLowerCase().includes(q),
    ),
  })).filter((group) => group.items.length > 0);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-fg-secondary">
          Press <Kbd>?</Kbd> anywhere to see these. Keys shown one after another (like <Kbd>G</Kbd>{' '}
          <Kbd>H</Kbd>) are pressed in order, not together.
        </p>
        <SearchInput
          value={query}
          onValueChange={setQuery}
          placeholder="Find a shortcut"
          aria-label="Find a shortcut"
          containerClassName="w-full sm:w-60"
        />
      </div>
      {groups.length === 0 ? (
        <EmptyState
          size="sm"
          visual={<Keyboard aria-hidden className="size-10 text-icon" />}
          title="No shortcut matches"
          description="Try a word like “task”, “inbox” or “search”."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2" data-testid="shortcut-list">
          {groups.map((group) => (
            <Panel key={group.title} title={group.title}>
              <ul className="flex flex-col divide-y divide-border-subtle">
                {group.items.map((item) => (
                  <li
                    key={`${group.title}-${item.label}`}
                    className="flex items-center justify-between gap-3 py-2 text-sm"
                  >
                    <span className="text-fg">{item.label}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {item.keys.map((key, index) => (
                        <Kbd key={`${index}-${key}`}>{key === 'mod' ? mod : key}</Kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}
