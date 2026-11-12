'use client';

import * as React from 'react';
import { CircleHelp, MessageSquarePlus } from 'lucide-react';
import { useShortcut, useShortcutList } from '@/lib/keyboard';
import { Dialog, DialogBody, DialogContent, DialogHeader } from '@/components/ui/dialog';
import { Kbd, KeyCombo } from '@/components/ui/kbd';
import { useGotoShortcuts } from './goto-shortcuts';
import { HeaderIconButton } from './header-icon-button';
import { mergeShortcutRows, STATIC_SHORTCUTS } from './help-content';
import { HelpPanel, type HelpView } from './help-panel';
import { HELP_EVENT, type HelpEventDetail } from './help-events';

function Alternatives({ items }: { readonly items: readonly React.ReactNode[] }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {items.map((item, i) => (
        <React.Fragment key={i}>
          {i > 0 ? <span className="text-2xs text-faint">or</span> : null}
          {item}
        </React.Fragment>
      ))}
    </span>
  );
}

function ShortcutsSheet() {
  const rows = mergeShortcutRows(useShortcutList());
  const groups = [...new Set([...rows.map((r) => r.group), ...STATIC_SHORTCUTS.map((s) => s.group)])];
  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <section key={group}>
          <h3 className="mb-1.5 text-2xs font-bold text-faint">{group}</h3>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {rows
              .filter((r) => r.group === group)
              .map((r) => (
                <li
                  key={r.description}
                  className="flex items-center justify-between px-3 py-2 text-sm text-body"
                >
                  {r.description}
                  <Alternatives
                    items={r.combos.map((combo) => (
                      <KeyCombo key={combo} combo={combo} />
                    ))}
                  />
                </li>
              ))}
            {STATIC_SHORTCUTS.filter((s) => s.group === group).map((s) => (
              <li
                key={s.description}
                className="flex items-center justify-between px-3 py-2 text-sm text-body"
              >
                {s.description}
                <Alternatives
                  items={s.keys.map((seq) => (
                    <span key={seq.join(' ')} className="inline-flex items-center gap-1">
                      {seq.map((k, i) => (
                        <React.Fragment key={`${k}-${i}`}>
                          {i > 0 ? <span className="text-2xs text-faint">then</span> : null}
                          <Kbd>{k}</Kbd>
                        </React.Fragment>
                      ))}
                    </span>
                  ))}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/**
 * Help center: the ? icon opens the Help panel (collections, page-aware articles, release notes,
 * feedback, screen recording, support). A slim "Feedback & Updates" side tab opens the panel on
 * feedback. `?` still opens the keyboard shortcuts sheet.
 */
export function HelpMenu() {
  const [view, setView] = React.useState<HelpView | null>(null);
  const [shortcuts, setShortcuts] = React.useState(false);
  useShortcut('?', () => setShortcuts(true), { description: 'Show keyboard shortcuts', group: 'Navigation' });
  useGotoShortcuts();
  // Other shell pieces (Printers popover…) open a specific article through a window event.
  React.useEffect(() => {
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent<HelpEventDetail>).detail;
      setView(d?.articleId ? { kind: 'article', id: d.articleId } : { kind: 'home' });
    };
    window.addEventListener(HELP_EVENT, onOpen);
    return () => window.removeEventListener(HELP_EVENT, onOpen);
  }, []);
  return (
    <>
      <HeaderIconButton
        label="Help center"
        onClick={() => setView({ kind: 'home' })}
        aria-haspopup="dialog"
        aria-expanded={view !== null}
      >
        <CircleHelp className="h-4 w-4" aria-hidden />
      </HeaderIconButton>
      {/* Logiwa-style feedback side tab; hidden on small screens and in print. Compact (w-6,
          short label) and anchored to the lower third so it stays clear of grid headers and
          action columns; the shell reserves a matching lg:pr-6 gutter so it never overlaps
          table edges at 1440. */}
      <button
        type="button"
        onClick={() => setView({ kind: 'feedback' })}
        aria-label="Feedback and updates"
        className="fixed right-0 top-2/3 z-30 hidden w-6 -translate-y-1/2 items-center justify-center gap-1 rounded-l-md bg-inverse px-0 py-2.5 text-2xs font-semibold leading-none text-fg-inverse shadow-md transition-colors [writing-mode:vertical-rl] hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60 print:hidden lg:flex"
      >
        <MessageSquarePlus className="h-3 w-3 rotate-90" aria-hidden />
        Feedback
      </button>
      <HelpPanel
        view={view}
        onViewChange={setView}
        onClose={() => setView(null)}
        onShortcuts={() => {
          setView(null);
          setShortcuts(true);
        }}
      />
      <Dialog open={shortcuts} onOpenChange={setShortcuts}>
        <DialogContent size="md">
          <DialogHeader title="Keyboard shortcuts" />
          <DialogBody>
            <ShortcutsSheet />
          </DialogBody>
        </DialogContent>
      </Dialog>
    </>
  );
}
