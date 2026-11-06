'use client';

/** Share dialog: copy a link (optionally with the current filters) and choose who can see it. */
import { useState } from 'react';
import { Check, Copy, Globe2, Lock } from 'lucide-react';
import {
  Avatar,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  Input,
  Switch,
  cn,
  toast,
} from '@/components/ui';
import type { UserSummaryDto } from '@/server/services/contracts/dto';

export interface ShareDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly baseUrl: string;
  readonly filteredUrl: string;
  readonly hasFilters: boolean;
  readonly privacy: 'main' | 'private';
  readonly canEdit: boolean;
  readonly ownerId: string | null | undefined;
  readonly people: readonly UserSummaryDto[];
  readonly workspaceName: string | null;
  readonly onPrivacyChange: (privacy: 'main' | 'private') => void;
}

export function ShareDialog({ open, onOpenChange, baseUrl, filteredUrl, hasFilters, privacy, canEdit, ownerId, people, workspaceName, onPrivacyChange }: ShareDialogProps) {
  const [withFilters, setWithFilters] = useState(true);
  const [copied, setCopied] = useState(false);
  const url = hasFilters && withFilters ? filteredUrl : baseUrl;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Couldn't copy the link", 'Select the link and copy it manually.');
    }
  };
  const visible = privacy === 'private' ? people.filter((person) => person.id === ownerId) : people;
  const options = [
    { value: 'main' as const, icon: Globe2, title: workspaceName ? `Everyone in ${workspaceName}` : 'Everyone in the workspace', body: 'Members can view; editors can change widgets.' },
    { value: 'private' as const, icon: Lock, title: 'Private', body: 'Only you and organization admins can open it.' },
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" data-testid="share-dialog">
        <DialogHeader title="Share dashboard" description="Anyone with access sees live data from the connected boards." />
        <DialogBody className="flex flex-col gap-5 pb-4">
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <Input readOnly value={url} aria-label="Dashboard link" onFocus={(event) => event.currentTarget.select()} containerClassName="flex-1" />
              <Button variant={copied ? 'secondary' : 'primary'} leadingIcon={copied ? <Check /> : <Copy />} onClick={() => void copy()}>
                {copied ? 'Copied' : 'Copy link'}
              </Button>
            </div>
            {hasFilters ? <Switch size="sm" label="Include the current filters in the link" checked={withFilters} onCheckedChange={(value) => setWithFilters(value === true)} /> : null}
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-semibold text-fg-secondary">Who can see it</legend>
            {options.map((option) => {
              const Icon = option.icon;
              const active = privacy === option.value;
              return (
                <label
                  key={option.value}
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors duration-[var(--duration-instant)] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus',
                    active ? 'border-primary bg-primary-subtle' : 'border-border-subtle hover:bg-hover',
                    !canEdit && 'cursor-default opacity-[0.6]',
                  )}
                >
                  <input type="radio" name="dashboard-privacy" className="sr-only" checked={active} disabled={!canEdit} onChange={() => onPrivacyChange(option.value)} />
                  <Icon aria-hidden className={cn('mt-0.5 size-5 shrink-0', active ? 'text-primary-text' : 'text-icon')} />
                  <span className="flex flex-col">
                    <span className="text-base font-medium text-fg">{option.title}</span>
                    <span className="text-sm text-fg-secondary">{option.body}</span>
                  </span>
                </label>
              );
            })}
          </fieldset>
          <div>
            <p className="mb-2 text-sm font-semibold text-fg-secondary">People with access</p>
            <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
              {visible.map((person) => (
                <li key={person.id} className="flex items-center gap-3 rounded-sm px-1 py-1">
                  <Avatar name={person.name} src={person.image} size="sm" colorKey={person.id} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base text-fg">{person.name}</span>
                    <span className="block truncate text-xs text-fg-muted">{person.email}</span>
                  </span>
                  <span className="text-xs font-medium text-fg-muted">{person.id === ownerId ? 'Owner' : 'Can view'}</span>
                </li>
              ))}
            </ul>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
