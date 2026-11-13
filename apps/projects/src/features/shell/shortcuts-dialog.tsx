'use client';
import { Dialog, DialogBody, DialogContent, DialogHeader, Kbd, useModKey } from '@/components/ui';
import { useShellStore } from './store';

/** Every keyboard shortcut, registered by the shell and feature teams. Keep in sync with use-shell-hotkeys + views. */
export const SHORTCUT_GROUPS: readonly { title: string; items: readonly { keys: readonly string[]; label: string }[] }[] = [
  {
    title: 'Anywhere',
    items: [
      { keys: ['mod', 'K'], label: 'Search and commands' },
      { keys: ['/'], label: 'Filter this view (or search everything)' },
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
      { keys: ['mod', 'Z'], label: 'Undo the last change' },
    ],
  },
  {
    title: 'Any task (List, Board, My work, task panel)',
    items: [
      { keys: ['J'], label: 'Next task' },
      { keys: ['K'], label: 'Previous task' },
      { keys: ['Enter'], label: 'Open task' },
      { keys: ['mod', 'Enter'], label: 'Mark done or reopen' },
      { keys: ['S'], label: 'Change status' },
      { keys: ['A'], label: 'Change assignee' },
      { keys: ['I'], label: 'Assign to me' },
      { keys: ['P'], label: 'Change priority' },
      { keys: ['D'], label: 'Change due date' },
      { keys: ['T'], label: 'Make it due today' },
      { keys: ['Shift', 'T'], label: 'Make it due tomorrow' },
      { keys: ['#'], label: 'Change labels' },
      { keys: ['mod', '.'], label: 'Copy task link' },
      { keys: ['X'], label: 'Select task' },
      { keys: ['mod', 'K'], label: 'Commands for the selected tasks' },
      { keys: ['Esc'], label: 'Close panel or clear selection' },
    ],
  },
  {
    title: 'Board and Focus mode',
    items: [
      { keys: ['H'], label: 'Board: column to the left (or ←)' },
      { keys: ['L'], label: 'Board: column to the right (or →)' },
      { keys: ['F'], label: 'My work: start Focus mode' },
      { keys: ['N'], label: 'Focus mode: skip to the next task' },
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
      <DialogContent size="xl" data-testid="shortcuts-dialog">
        <DialogHeader title="Keyboard shortcuts" description="Work faster without the mouse." />
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
