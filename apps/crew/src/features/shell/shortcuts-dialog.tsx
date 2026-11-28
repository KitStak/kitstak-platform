'use client';
import { Dialog, DialogBody, DialogContent, DialogHeader, Kbd, useModKey } from '@/components/ui';
import { navFor } from '@/lib/nav';
import { useShell } from './shell-context';
import { useShellStore } from './store';

/** The shortcuts registered by the shell (use-shell-hotkeys). The Go to group follows the person's navigation. */
export function ShortcutsDialog() {
  const open = useShellStore((state) => state.shortcutsOpen);
  const close = useShellStore((state) => state.closeShortcuts);
  const mod = useModKey();
  const { crewRole } = useShell();
  const groups = [
    {
      title: 'Anywhere',
      items: [
        { keys: ['mod', 'K'], label: 'Search and commands' },
        { keys: ['/'], label: 'Search' },
        { keys: ['?'], label: 'Show keyboard shortcuts' },
      ],
    },
    {
      title: 'Go to',
      items: navFor(crewRole)
        .filter((entry) => entry.chord)
        .map((entry) => ({ keys: ['G', entry.chord!.toUpperCase()], label: entry.label })),
    },
  ];
  return (
    <Dialog open={open} onOpenChange={(value) => (value ? undefined : close())}>
      <DialogContent size="lg" data-testid="shortcuts-dialog">
        <DialogHeader title="Keyboard shortcuts" />
        <DialogBody className="pb-6">
          <div className="columns-1 gap-8 sm:columns-2">
            {groups.map((group) => (
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
