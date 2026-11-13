'use client';
import { Dialog, DialogBody, DialogContent, DialogHeader, Kbd, useModKey } from '@/components/ui';
import { useShellStore } from './store';

/** Every keyboard shortcut, registered by the shell and feature teams. Keep in sync with use-shell-hotkeys + views. */
export const SHORTCUT_GROUPS: readonly { title: string; items: readonly { keys: readonly string[]; label: string }[] }[] = [
  {
    title: 'Anywhere',
    items: [
      { keys: ['mod', 'K'], label: 'Search and commands' },
      { keys: ['/'], label: 'Search' },
      { keys: ['C'], label: 'New task' },
      { keys: ['?'], label: 'Show keyboard shortcuts' },
      { keys: ['['], label: 'Collapse or expand the sidebar' },
      { keys: ['G', 'H'], label: 'Go to Home' },
      { keys: ['G', 'M'], label: 'Go to My work' },
      { keys: ['G', 'I'], label: 'Go to Inbox' },
      { keys: ['G', 'S'], label: 'Go to Search' },
      { keys: ['G', 'P'], label: 'Go to Projects' },
      { keys: ['G', 'G'], label: 'Go to Goals' },
      { keys: ['G', 'D'], label: 'Go to Dashboards' },
    ],
  },
  {
    title: 'In a list or board',
    items: [
      { keys: ['J'], label: 'Next task' },
      { keys: ['K'], label: 'Previous task' },
      { keys: ['Enter'], label: 'Open task' },
      { keys: ['X'], label: 'Select task' },
      { keys: ['Esc'], label: 'Close panel or clear selection' },
    ],
  },
  {
    title: 'My work',
    items: [
      { keys: ['D'], label: 'Mark the task done' },
      { keys: ['T'], label: 'Make it due today' },
      { keys: ['M'], label: 'Make it due tomorrow' },
      { keys: ['F'], label: 'Start Focus mode' },
    ],
  },
  {
    title: 'Inbox',
    items: [
      { keys: ['E'], label: 'Archive' },
      { keys: ['U'], label: 'Mark read or unread' },
      { keys: ['X'], label: 'Select' },
      { keys: ['Shift', 'R'], label: 'Mark everything read' },
    ],
  },
  {
    title: 'New task box',
    items: [
      { keys: ['Enter'], label: 'Add the task' },
      { keys: ['mod', 'Shift', 'Enter'], label: 'Add it and open it' },
      { keys: ['tomorrow'], label: 'Due date (also “next fri”, “dec 5”)' },
      { keys: ['!high'], label: 'Priority (!urgent … !low)' },
      { keys: ['@name'], label: 'Assign someone' },
      { keys: ['#label'], label: 'Add a label' },
      { keys: ['+KEY'], label: 'Pick the project' },
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
        <DialogHeader title="Keyboard shortcuts" description="Work faster without the mouse." />
        <DialogBody>
          <div className="grid gap-6 sm:grid-cols-2">
            {SHORTCUT_GROUPS.map((group) => (
              <section key={group.title}>
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
