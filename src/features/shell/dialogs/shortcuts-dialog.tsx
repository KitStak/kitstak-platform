'use client';
import { Dialog, DialogBody, DialogContent, DialogHeader, Kbd, useModKey } from '@/components/ui';

interface Shortcut {
  readonly keys: readonly string[];
  readonly label: string;
}

function useSections(): readonly { readonly title: string; readonly items: readonly Shortcut[] }[] {
  const mod = useModKey();
  return [
    {
      title: 'Navigation',
      items: [
        { keys: [mod, 'K'], label: 'Search & commands' },
        { keys: [mod, '\\'], label: 'Toggle sidebar' },
        { keys: ['G', 'H'], label: 'Go to Home' },
        { keys: ['G', 'M'], label: 'Go to My work' },
        { keys: ['G', 'I'], label: 'Go to Inbox' },
        { keys: ['G', 'D'], label: 'Go to Dashboards' },
        { keys: ['G', 'P'], label: 'Go to Pipeline' },
      ],
    },
    {
      title: 'General',
      items: [
        { keys: ['?'], label: 'Show keyboard shortcuts' },
        { keys: ['Esc'], label: 'Close menu, panel or dialog' },
        { keys: ['↑', '↓'], label: 'Move through menus and lists' },
        { keys: ['Enter'], label: 'Open / confirm' },
      ],
    },
  ];
}

export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const sections = useSections();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader title="Keyboard shortcuts" description="Move faster across KitStak." />
        <DialogBody className="grid gap-6 pb-6 sm:grid-cols-2">
          {sections.map((section) => (
            <section key={section.title}>
              <h3 className="mb-2 font-sans text-xs font-semibold tracking-wide text-fg-muted uppercase">
                {section.title}
              </h3>
              <dl className="flex flex-col">
                {section.items.map((item) => (
                  <div
                    key={item.label}
                    className="flex items-center justify-between gap-4 border-b border-border-subtle py-2 last:border-b-0"
                  >
                    <dt className="text-base text-fg">{item.label}</dt>
                    <dd className="flex shrink-0 gap-1">
                      {item.keys.map((key) => (
                        <Kbd key={key}>{key}</Kbd>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
