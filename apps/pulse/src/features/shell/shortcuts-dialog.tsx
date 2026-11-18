'use client';
import { Dialog, DialogBody, DialogContent, DialogHeader, Kbd, useModKey } from '@/components/ui';
import { useShellStore } from './store';

/** Every keyboard shortcut, registered by the shell and by pages. Keep in step with use-shell-hotkeys and the log grid. */
export const SHORTCUT_GROUPS: readonly { title: string; items: readonly { keys: readonly string[]; label: string }[] }[] = [
  {
    title: 'Anywhere',
    items: [
      { keys: ['mod', 'K'], label: 'Search and commands' },
      { keys: ['/'], label: 'Search' },
      { keys: ['L'], label: 'Log work' },
      { keys: ['N'], label: 'New job' },
      { keys: ['?'], label: 'Show keyboard shortcuts' },
      { keys: ['mod', 'Z'], label: 'Undo the last change' },
    ],
  },
  {
    title: 'Go to',
    items: [
      { keys: ['G', 'H'], label: 'Home' },
      { keys: ['G', 'J'], label: 'Jobs' },
      { keys: ['G', 'L'], label: 'Log work' },
      { keys: ['G', 'P'], label: 'Profit' },
      { keys: ['G', 'A'], label: 'Alerts' },
      { keys: ['G', 'B'], label: 'Labor' },
      { keys: ['G', 'R'], label: 'Reports' },
      { keys: ['G', 'T'], label: 'Target pace' },
      { keys: ['G', 'C'], label: 'Calculator' },
      { keys: ['G', 'O'], label: 'Goals' },
      { keys: ['G', 'I'], label: 'Import and export' },
      { keys: ['G', 'S'], label: 'Settings' },
    ],
  },
  {
    title: 'Log work',
    items: [
      { keys: ['Tab'], label: 'Next box' },
      { keys: ['Enter'], label: 'Save and move down a row' },
      { keys: ['↑', '↓'], label: 'Move between rows' },
      { keys: ['['], label: 'Previous day' },
      { keys: [']'], label: 'Next day' },
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
          <div className="columns-1 gap-8 sm:columns-2 lg:columns-3">
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
          {/* Scroll cue: fades the last visible row while there is more below; at the end it only covers the padding. */}
          <div aria-hidden className="pointer-events-none sticky bottom-0 -mx-6 h-6 bg-gradient-to-t from-raised to-transparent" />
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
