'use client';
/**
 * Controls of the signed in wall: pick a site, show or hide money, go full screen, and make a
 * link for a TV that has no login. A TV link never shows money.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Copy, Maximize, Tv } from 'lucide-react';
import { Badge, Button, Checkbox, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, Field, Input, Select, Skeleton, Switch, toast } from '@/components/ui';
import { keepOpenForToasts } from '@/features/calculator/toast-safe';
import { apiGet, apiPath } from '@/lib/api-client';
import { formatRelative } from '@/lib/dates';
import { routes } from '@/lib/routes';
import type { DeviceLinkDTO } from '@/lib/types';
import { createDeviceLinkAction, renewDeviceLinkAction, revokeDeviceLinkAction } from '@/server/actions/floor';
import { WALL_PANELS, WALL_PANEL_LABELS, type WallPanel } from './wall-math';

export interface WallControlsProps {
  readonly sites: readonly { readonly id: string; readonly name: string }[];
  readonly siteId: string | null;
  readonly showMoney: boolean;
  readonly canSeeMoney: boolean;
  readonly canManageLinks: boolean;
}

const linkKey = ['device-links', 'wall'] as const;

export function WallControls({ sites, siteId, showMoney, canSeeMoney, canManageLinks }: WallControlsProps) {
  const router = useRouter();
  const [setup, setSetup] = useState(false);

  const go = (next: { site?: string | null; money?: boolean }) => {
    const query = new URLSearchParams(window.location.search);
    if (next.site !== undefined) {
      if (next.site) query.set('site', next.site);
      else query.delete('site');
    }
    if (next.money !== undefined) {
      if (next.money) query.set('money', '1');
      else query.delete('money');
    }
    const text = query.toString();
    router.replace(text ? `${routes.wall()}?${text}` : routes.wall(), { scroll: false });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden" data-testid="wall-controls">
      {sites.length > 1 ? <Select size="sm" aria-label="Site on the wall" value={siteId ?? 'all'} onValueChange={(value) => go({ site: value === 'all' ? null : value })} options={[{ value: 'all', label: 'All sites' }, ...sites.map((site) => ({ value: site.id, label: site.name }))]} className="w-40" /> : null}
      {canSeeMoney ? <Switch size="sm" checked={showMoney} onCheckedChange={(value) => go({ money: value })} label="Show money" data-testid="wall-money" /> : null}
      {
        <Button
          size="sm"
          variant="secondary"
          leadingIcon={<Maximize aria-hidden />}
          onClick={() => {
            if (document.fullscreenElement) void document.exitFullscreen();
            else if (!document.documentElement.requestFullscreen) toast.error("Couldn't go full screen", 'This browser cannot do it. Try the F11 key.');
            else void document.documentElement.requestFullscreen().catch(() => toast.error("Couldn't go full screen", 'Your browser blocked it. Try the F11 key.'));
          }}
        >
          Full screen
        </Button>
      }
      {canManageLinks ? (
        <Button size="sm" variant="secondary" leadingIcon={<Tv aria-hidden />} onClick={() => setSetup(true)} data-testid="wall-setup">
          TV link
        </Button>
      ) : null}
      <Link href={routes.home()} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-fg-link hover:underline focus-visible:outline-2 focus-visible:outline-focus">
        <ArrowLeft aria-hidden className="size-3.5" />
        Back to Pulse
      </Link>
      {setup ? <TvLinkDialog sites={sites} siteId={siteId} onClose={() => setSetup(false)} /> : null}
    </div>
  );
}

function TvLinkDialog({ sites, siteId, onClose }: { readonly sites: WallControlsProps['sites']; readonly siteId: string | null; readonly onClose: () => void }) {
  const queryClient = useQueryClient();
  const links = useQuery({ queryKey: linkKey, queryFn: () => apiGet<DeviceLinkDTO[]>(apiPath('device-links', { kind: 'wall' })), staleTime: 10_000 });
  const [name, setName] = useState('');
  const [site, setSite] = useState(siteId ?? sites[0]?.id ?? '');
  const [allSites, setAllSites] = useState(false);
  const [rotate, setRotate] = useState('15');
  const [panels, setPanels] = useState<readonly WallPanel[]>([...WALL_PANELS]);
  const [hideClients, setHideClients] = useState(false);
  const [error, setError] = useState<{ field: 'name' | 'panels' | 'form'; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [made, setMade] = useState<{ name: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: linkKey });

  const create = async () => {
    if (!name.trim()) return setError({ field: 'name', message: 'Give the link a name, like Line 2 TV.' });
    if (panels.length === 0) return setError({ field: 'panels', message: 'Pick at least one screen.' });
    setSaving(true);
    setError(null);
    try {
      const result = await createDeviceLinkAction({ kind: 'wall', name: name.trim(), siteId: site || null, config: { rotateSeconds: Number(rotate), panels: [...panels], hideClientNames: hideClients, allSites } });
      if (!result.ok) {
        setError({ field: result.error.fields?.name ? 'name' : 'form', message: result.error.message });
        return;
      }
      setMade({ name: result.data.link.name, url: `${window.location.origin}${result.data.path}` });
      setName('');
      await refresh();
    } catch {
      setError({ field: 'form', message: 'Check your connection and try again.' });
    } finally {
      setSaving(false);
    }
  };

  const turnOff = async (link: DeviceLinkDTO) => {
    const result = await revokeDeviceLinkAction({ linkId: link.id });
    if (!result.ok) {
      toast.error("Couldn't turn the link off", result.error.message);
      return;
    }
    await refresh();
    toast.undo(`${link.name} is turned off`, {
      description: 'The TV shows that the link is not active.',
      onUndo: async () => {
        const back = await renewDeviceLinkAction({ linkId: link.id });
        if (!back.ok) throw new Error(back.error.message);
        await refresh();
      },
    });
  };

  const copy = async () => {
    if (!made) return;
    try {
      await navigator.clipboard.writeText(made.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      toast.error("Couldn't copy the link", 'Select the link and copy it by hand.');
    }
  };

  const active = (links.data ?? []).filter((link) => link.status === 'active');

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent size="lg" data-testid="wall-link-dialog" onInteractOutside={keepOpenForToasts}>
        <DialogHeader title="Put the wall on a TV" description="A TV link opens the wall with no login. It never shows money, and you can turn it off at any time." />
        <DialogBody className="flex flex-col gap-5">
          {made ? (
            <div className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-success-subtle p-3" data-testid="wall-link-made">
              <p className="text-sm font-semibold text-success-text">The link for {made.name} is ready</p>
              <p className="text-sm text-fg-secondary">Open it in the browser of the TV. For safety it is shown only this once: copy it now.</p>
              <div className="flex items-center gap-2">
                <Input readOnly value={made.url} aria-label="The TV link" onFocus={(event) => event.currentTarget.select()} className="min-w-0 flex-1 font-mono text-xs" data-testid="wall-link-url" />
                <Button variant="secondary" leadingIcon={copied ? <Check aria-hidden /> : <Copy aria-hidden />} onClick={() => void copy()} data-testid="wall-link-copy">
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
            </div>
          ) : null}

          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <h3 className="text-sm font-semibold text-fg">Make a new link</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name of the screen" error={error?.field === 'name' ? error.message : null} required>
                {({ inputId, describedBy, invalid }) => <Input id={inputId} aria-describedby={describedBy} invalid={invalid} value={name} maxLength={80} placeholder="Line 2 TV" onChange={(event) => (setName(event.target.value), setError(null))} data-testid="wall-link-name" />}
              </Field>
              <Field label="Each screen stays up for">
                {({ inputId }) => <Select id={inputId} value={rotate} onValueChange={setRotate} options={['10', '15', '20', '30', '60'].map((value) => ({ value, label: `${value} seconds` }))} />}
              </Field>
              {sites.length > 1 ? (
                <Field label="Site">
                  {({ inputId }) => <Select id={inputId} value={site} onValueChange={setSite} disabled={allSites} options={sites.map((item) => ({ value: item.id, label: item.name }))} />}
                </Field>
              ) : null}
            </div>
            {sites.length > 1 ? <Checkbox size="sm" label="Show every site on this TV" checked={allSites} onCheckedChange={(value) => setAllSites(value === true)} /> : null}
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1.5 text-sm font-medium text-fg">Screens to rotate through</legend>
              <div className="grid gap-x-5 gap-y-2 sm:grid-cols-2">
                {WALL_PANELS.map((panel) => (
                  <Checkbox key={panel} size="sm" label={WALL_PANEL_LABELS[panel]} checked={panels.includes(panel)} onCheckedChange={(value) => (setPanels(value === true ? WALL_PANELS.filter((item) => item === panel || panels.includes(item)) : panels.filter((item) => item !== panel)), setError(null))} />
                ))}
              </div>
              {error?.field === 'panels' ? (
                <p role="alert" className="text-sm text-danger-text">
                  {error.message}
                </p>
              ) : null}
            </fieldset>
            <Switch size="sm" checked={hideClients} onCheckedChange={setHideClients} label="Hide client names" description="For floors where visitors can see the screen." />
            {error?.field === 'form' ? (
              <p role="alert" className="text-sm text-danger-text">
                {error.message}
              </p>
            ) : null}
            <div>
              <Button type="submit" loading={saving} leadingIcon={<Tv aria-hidden />} data-testid="wall-link-create">
                Make the link
              </Button>
            </div>
          </form>

          <section aria-labelledby="wall-links-title" className="flex flex-col gap-2">
            <h3 id="wall-links-title" className="text-sm font-semibold text-fg">
              Links that work now
            </h3>
            {links.isLoading ? (
              <div role="status" aria-busy="true">
                <span className="sr-only">Loading links</span>
                <Skeleton height={44} rounded="lg" />
              </div>
            ) : links.isError ? (
              <div role="alert" className="flex flex-col items-start gap-2 text-sm text-danger-text">
                We could not load the links.
                <Button size="sm" variant="secondary" onClick={() => void links.refetch()}>
                  Try again
                </Button>
              </div>
            ) : active.length === 0 ? (
              <p className="text-sm text-fg-secondary">No TV link is active. Make one above, open it on the TV, and the wall runs on its own.</p>
            ) : (
              <ul className="divide-y divide-border-subtle rounded-lg border border-border-subtle" data-testid="wall-links">
                {active.map((link) => (
                  <li key={link.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-fg">{link.name}</span>
                      <span className="block text-xs text-fg-muted">
                        {link.config.allSites === true ? 'All sites' : link.siteName} · {link.lastSeenAt ? `last opened ${formatRelative(link.lastSeenAt)}` : 'not opened yet'} · works until {new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(link.expiresAt))}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <Badge tone="success" size="sm">
                        Active
                      </Badge>
                      <Button size="sm" variant="secondary" onClick={() => void turnOff(link)} data-testid="wall-link-off">
                        Turn off
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
