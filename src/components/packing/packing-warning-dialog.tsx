"use client";

/**
 * Packing Warning modal (Data Setup › Packing Warning Type). Shown at the type's trigger. When
 * confirmation is required the packer must tick "I have read this warning" and Acknowledge
 * (logged on the order); Escape / outside click do not dismiss it. With "Skip confirmation from
 * packer" it is informational and closes with OK. Mount it with a key per prompt so the tick resets.
 */
import * as React from "react";
import { AlertTriangle, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { mediaKind, type PackWarningInfo } from "./pack-warning-model";

export function PackingWarningDialog({ warning, orderCode, onAcknowledge, busy, error }: {
  readonly warning: PackWarningInfo | null;
  readonly orderCode: string;
  readonly onAcknowledge: () => void;
  readonly busy?: boolean;
  readonly error?: string | null;
}) {
  const [read, setRead] = React.useState(false);
  const open = Boolean(warning);
  const mustConfirm = warning ? !warning.skipConfirmation : false;
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && warning && !mustConfirm) onAcknowledge(); }}>
      <DialogContent size="md" hideClose={mustConfirm} data-testid="packing-warning-dialog"
        onEscapeKeyDown={(e) => { if (mustConfirm) e.preventDefault(); }}
        onPointerDownOutside={(e) => { if (mustConfirm) e.preventDefault(); }}
        onInteractOutside={(e) => { if (mustConfirm) e.preventDefault(); }}>
        <DialogHeader
          title={<span className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-warning" aria-hidden />Packing warning: {warning?.name}</span>}
          description={warning ? `${orderCode} · ${warning.triggerLabel}` : undefined} />
        <DialogBody>
          {warning ? (
            <div className="flex flex-col gap-3">
              <p role="alert" className="whitespace-pre-line rounded-md border border-warning/40 bg-warning-soft px-3 py-2.5 text-[14px] font-medium text-foreground">{warning.text}</p>
              {warning.mediaLinks.length ? (
                <div className="flex flex-col gap-2">
                  {warning.mediaLinks.map((url) => {
                    const kind = mediaKind(url);
                    if (kind === "image") {
                      // eslint-disable-next-line @next/next/no-img-element -- media links are arbitrary URLs set in Data Setup
                      return <img key={url} src={url} alt={`${warning.name} reference`} className="max-h-64 w-full rounded-md border border-border object-contain" />;
                    }
                    if (kind === "video") return <video key={url} src={url} controls className="max-h-64 w-full rounded-md border border-border" />;
                    return (
                      <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-primary hover:underline">
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden />{url}
                      </a>
                    );
                  })}
                </div>
              ) : null}
              {mustConfirm ? (
                <Checkbox checked={read} onCheckedChange={(v) => setRead(v === true)} label="I have read this warning" autoFocus data-testid="packing-warning-read" />
              ) : null}
              {error ? <p role="alert" className="text-[12px] font-medium text-danger">{error}</p> : null}
            </div>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="primary" disabled={(mustConfirm && !read) || busy} onClick={onAcknowledge} autoFocus={!mustConfirm} data-testid="packing-warning-ack">
            {busy ? "Saving…" : mustConfirm ? "Acknowledge and continue" : "OK"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
