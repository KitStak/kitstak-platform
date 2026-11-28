'use client';
import { Dialog, DialogBody, DialogContent, DialogHeader, Kbd, useModKey } from '@/components/ui';
import { useShellStore } from './store';

/** Every keyboard shortcut (SPEC 6). Keep in step with use-shell-hotkeys and src/lib/nav.ts chords. */
export const SHORTCUT_GROUPS: readonly { title: string; items: readonly { keys: readonly string[]; label: string }[] }[] = [
  {
    title: 'Anywhere',
    items: [
      { keys: ['mod', 'K'], label: 'Search and commands' },
      { keys: ['/'], label: 'Search' },
      { keys: ['N'], label: 'New invoice' },
      { keys: ['?'], label: 'Show keyboard shortcuts' },
    ],
  },
  {
    title: 'Go to',
    items: [
      { keys: ['G', 'H'], label: 'Home' },
      { keys: ['G', 'I'], label: 'Invoices' },
      { keys: ['G', 'C'], label: 'Collections' },
      { keys: ['G', 'B'], label: 'Bills' },
      { keys: ['G', 'X'], label: 'Expenses' },
      { keys: ['G', 'K'], label: 'Bank' },
      { keys: ['G', 'M'], label: 'Close' },
      { keys: ['G', 'U'], label: 'Customers' },
      { keys: ['G', 'V'], label: 'Vendors' },
      { keys: ['G', 'P'], label: 'Payments' },
      { keys: ['G', 'J'], label: 'Journal' },
      { keys: ['G', 'E'], label: 'Reports' },
      { keys: ['G', 'O'], label: 'Import and export' },
      { keys: ['G', 'S'], label: 'Settings' },
    ],
  },
];

export function ShortcutsDialog() {
  const open = useShellStore((state) => state.shortcutsOpen);
  const close = useShellStore((state) => state.closeShortcuts);
  const mod = useModKey();
  return (
    <Dialog open={open} onOpenChange={(value) => (value ? undefined : close())}>
      <DialogContent size="lg" data-testid="shortcuts-dialog">
        <DialogHeader title="Keyboard shortcuts" />
        <DialogBody className="relative pb-0">
          <div className="columns-1 gap-8 sm:columns-2">
            {SHORTCUT_GROUPS.map((group) => (
              <section key={group.title} className="mb-6 break-inside-avoid">
                <h3 className="mb-2 text-xs font-semibold tracking-[0.06em] text-fg-muted uppercase">{group.title}</h3>
                <ul className="flex flex-col gap-1.5">
                  {group.items.map((item) => (
                    <li key={item.label} className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-fg-secondary">{item.label}</span>
                      <span className="flex shrink-0 items-center gap-1">
                        {item.keys.map((key, index) => (
                          <Kbd key={`${index}-${key}`}>{key === 'mod' ? mod : key}</Kbd>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
