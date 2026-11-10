"use client";

import * as React from "react";
import Link from "next/link";
import { BookOpen, CircleHelp, Keyboard, LifeBuoy, Sparkles } from "lucide-react";
import { useShortcut, useShortcutList } from "@/lib/keyboard";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogBody, DialogContent, DialogHeader } from "@/components/ui/dialog";
import { Kbd, KeyCombo } from "@/components/ui/kbd";
import { useGotoShortcuts } from "./goto-shortcuts";
import { HeaderIconButton } from "./header-icon-button";
import { SupportContact } from "./support-contact";
import { HELP_GUIDES, mergeShortcutRows, STATIC_SHORTCUTS, WHATS_NEW } from "./help-content";

type HelpDialog = "shortcuts" | "docs" | "whats-new" | "support" | null;


function Alternatives({ items }: { readonly items: readonly React.ReactNode[] }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {items.map((item, i) => (
        <React.Fragment key={i}>
          {i > 0 ? <span className="text-[11px] text-faint">or</span> : null}
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
          <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.06em] text-faint">{group}</h3>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {rows.filter((r) => r.group === group).map((r) => (
              <li key={r.description} className="flex items-center justify-between px-3 py-2 text-[13px] text-body">
                {r.description}
                <Alternatives items={r.combos.map((combo) => <KeyCombo key={combo} combo={combo} />)} />
              </li>
            ))}
            {STATIC_SHORTCUTS.filter((s) => s.group === group).map((s) => (
              <li key={s.description} className="flex items-center justify-between px-3 py-2 text-[13px] text-body">
                {s.description}
                <Alternatives items={s.keys.map((seq) => (
                  <span key={seq.join(" ")} className="inline-flex items-center gap-1">
                    {seq.map((k, i) => (
                      <React.Fragment key={`${k}-${i}`}>
                        {i > 0 ? <span className="text-[11px] text-faint">then</span> : null}
                        <Kbd>{k}</Kbd>
                      </React.Fragment>
                    ))}
                  </span>
                ))} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function GuidesList({ onNavigate }: { readonly onNavigate: () => void }) {
  return (
    <ul className="space-y-2">
      {HELP_GUIDES.map((guide) => (
        <li key={guide.title} className="rounded-lg border border-border p-3">
          <p className="text-[13px] font-semibold text-foreground">{guide.title}</p>
          <p className="mt-0.5 text-[12px] text-secondary">{guide.body}</p>
          {guide.href ? <Link href={guide.href} onClick={onNavigate} className="mt-1 inline-block text-[12px] font-semibold text-primary hover:underline">{guide.linkLabel}</Link> : null}
        </li>
      ))}
    </ul>
  );
}

function WhatsNewList() {
  return (
    <ol className="space-y-3">
      {WHATS_NEW.map((entry) => (
        <li key={entry.title} className="border-l-2 border-primary pl-3">
          <p className="flex items-center gap-1.5 text-[11px] text-faint">
            <time>{entry.date}</time>
            <span aria-hidden>·</span>
            <span>{entry.version}</span>
            <span className="rounded bg-primary-soft px-1.5 py-px font-semibold text-primary">{entry.tag}</span>
          </p>
          <p className="text-[13px] font-semibold text-foreground">{entry.title}</p>
          <p className="text-[12px] text-secondary">{entry.body}</p>
        </li>
      ))}
    </ol>
  );
}

const DIALOG_TITLES: Readonly<Record<Exclude<HelpDialog, null>, string>> = {
  shortcuts: "Keyboard shortcuts",
  docs: "Help & documentation",
  "whats-new": "What's new",
  support: "Contact support",
};

/** Help Center menu: shortcuts sheet (also on `?`), docs guides, What's new, support. */
export function HelpMenu() {
  const [dialog, setDialog] = React.useState<HelpDialog>(null);
  useShortcut("?", () => setDialog("shortcuts"), { description: "Show keyboard shortcuts", group: "Navigation" });
  useGotoShortcuts();
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <HeaderIconButton label="Help center">
            <CircleHelp className="h-4 w-4" aria-hidden />
          </HeaderIconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel>Help center</DropdownMenuLabel>
          <DropdownMenuItem icon={Keyboard} onSelect={() => setDialog("shortcuts")}>Keyboard shortcuts</DropdownMenuItem>
          <DropdownMenuItem icon={BookOpen} onSelect={() => setDialog("docs")}>Documentation</DropdownMenuItem>
          <DropdownMenuItem icon={Sparkles} onSelect={() => setDialog("whats-new")}>What&apos;s new</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem icon={LifeBuoy} onSelect={() => setDialog("support")}>Contact support</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={dialog !== null} onOpenChange={(open) => (open ? undefined : setDialog(null))}>
        <DialogContent size={dialog === "support" ? "sm" : "md"}>
          <DialogHeader title={dialog ? DIALOG_TITLES[dialog] : ""} />
          <DialogBody>
            {dialog === "shortcuts" ? <ShortcutsSheet /> : null}
            {dialog === "docs" ? <GuidesList onNavigate={() => setDialog(null)} /> : null}
            {dialog === "whats-new" ? <WhatsNewList /> : null}
            {dialog === "support" ? <SupportContact /> : null}
          </DialogBody>
        </DialogContent>
      </Dialog>
    </>
  );
}
