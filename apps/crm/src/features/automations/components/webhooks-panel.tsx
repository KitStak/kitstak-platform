'use client';
/**
 * Board webhooks: list (enable toggle, events, last delivery), create (URL + events → secret
 * shown once), send test, delivery log drawer, rotate secret and delete (confirmed: the secret
 * cannot be restored, so this is not an undo-able action).
 */
import { useId, useState } from 'react';
import {
  Check,
  CircleAlert,
  Copy,
  KeyRound,
  ListTree,
  MoreHorizontal,
  Plus,
  Send,
  ShieldCheck,
  Trash2,
  Webhook,
} from 'lucide-react';
import {
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  Drawer,
  DrawerContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  IconButton,
  Input,
  Skeleton,
  StatusPill,
  cn,
  toast,
} from '@/components/ui';
import { errorMessage } from '@/lib/hooks';
import {
  createWebhookSchema,
  WEBHOOK_EVENT_LABELS,
  WEBHOOK_EVENTS,
  WEBHOOK_SIGNATURE_HEADER,
  type WebhookDeliveryDto,
  type WebhookDto,
  type WebhookEvent,
} from '@/server/services/contracts/automations-center';
import { useWebhookDeliveries, useWebhookMutations, useWebhooks } from '../api';
import { formatDateTime, formatDuration, relativeTime } from './format';
import { Switch } from './switch';

export interface WebhooksPanelProps {
  readonly boardId: string;
  readonly canManage: boolean;
  readonly canEditBoard: boolean;
  /** Create dialog state (lifted so the integrations catalog can open it). */
  readonly creating: boolean;
  readonly onCreatingChange: (open: boolean) => void;
}

export function WebhooksPanel({
  boardId,
  canManage,
  canEditBoard,
  creating,
  onCreatingChange: setCreating,
}: WebhooksPanelProps) {
  const webhooks = useWebhooks(boardId, canManage);
  const mutations = useWebhookMutations(boardId);
  const [secret, setSecret] = useState<{ secret: string; url: string; rotated: boolean } | null>(null);
  const [logFor, setLogFor] = useState<WebhookDto | null>(null);
  const [deleting, setDeleting] = useState<WebhookDto | null>(null);
  const canWrite = canManage && canEditBoard;

  const sendTest = (webhook: WebhookDto) =>
    mutations.test.mutate(webhook.id, {
      onSuccess: (delivery) =>
        delivery.ok
          ? toast.success(
              'Test delivered',
              `The endpoint answered HTTP ${delivery.status} in ${formatDuration(delivery.durationMs)}.`,
            )
          : toast.error('Test delivery failed', delivery.error ?? `HTTP ${delivery.status ?? 'no response'}`),
      onError: (error) => toast.error('Couldn’t send the test', errorMessage(error)),
    });

  const rotate = (webhook: WebhookDto) =>
    mutations.rotate.mutate(webhook.id, {
      onSuccess: (result) => setSecret({ secret: result.secret, url: result.webhook.url, rotated: true }),
      onError: (error) => toast.error('Couldn’t rotate the secret', errorMessage(error)),
    });

  const toggle = (webhook: WebhookDto, enabled: boolean) =>
    mutations.update.mutate(
      { webhookId: webhook.id, input: { enabled } },
      {
        onSuccess: () => toast.success(enabled ? 'Webhook turned on' : 'Webhook paused'),
        onError: (error) => toast.error('Couldn’t update the webhook', errorMessage(error)),
      },
    );

  const header = (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2
          id="webhooks-heading"
          className="flex items-center gap-2 text-lg font-semibold text-fg"
        >
          <Webhook aria-hidden className="size-5 text-icon" />
          Webhooks
        </h2>
        <p className="text-sm text-fg-secondary">
          Every delivery is a signed <code className="rounded-xs bg-sunken px-1 font-mono text-xs">POST</code>{' '}
          with an{' '}
          <code className="rounded-xs bg-sunken px-1 font-mono text-xs">{WEBHOOK_SIGNATURE_HEADER}</code>{' '}
          header.
        </p>
      </div>
      {canManage ? (
        <Button
          leadingIcon={<Plus aria-hidden />}
          onClick={() => setCreating(true)}
          disabled={!canWrite}
          data-testid="webhook-add"
        >
          Add webhook
        </Button>
      ) : null}
    </div>
  );

  if (!canManage) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <div className="flex items-start gap-3 rounded-lg border border-border-subtle bg-sunken px-4 py-3 text-sm text-fg-secondary">
          <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-icon" />
          Only organization admins can view and manage webhooks, because they send board data outside KitStak.
        </div>
      </div>
    );
  }

  const list = webhooks.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      {header}
      {webhooks.isPending ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton height={68} rounded="lg" />
          <Skeleton height={68} rounded="lg" />
        </div>
      ) : webhooks.isError ? (
        <EmptyState
          illustration="error"
          size="sm"
          title="Webhooks couldn’t load"
          description={errorMessage(webhooks.error)}
          actions={
            <Button variant="secondary" onClick={() => void webhooks.refetch()}>
              Try again
            </Button>
          }
        />
      ) : list.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border-default bg-panel px-6 py-10 text-center">
          <span className="flex size-11 items-center justify-center rounded-full bg-primary-subtle text-primary-text">
            <Webhook aria-hidden className="size-5" />
          </span>
          <h3 className="text-base font-semibold text-fg">No webhooks on this board</h3>
          <Button
            className="mt-2"
            leadingIcon={<Plus aria-hidden />}
            onClick={() => setCreating(true)}
            disabled={!canWrite}
          >
            Add webhook
          </Button>
        </div>
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Webhooks" data-testid="webhook-list">
          {list.map((webhook) => {
            const failing = webhook.failureCount > 0;
            return (
              <li
                key={webhook.id}
                data-testid="webhook-row"
                className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-panel px-4 py-3 shadow-xs sm:flex-row sm:items-center"
              >
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <Switch
                    checked={webhook.enabled}
                    onCheckedChange={(enabled) => toggle(webhook, enabled)}
                    label={`${webhook.enabled ? 'Pause' : 'Turn on'} webhook ${webhook.url}`}
                    disabled={!canWrite}
                    className="mt-0.5"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-sm text-fg" title={webhook.url}>
                      {webhook.url}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {webhook.events.map((event) => (
                        <Badge key={event} tone="outline" size="sm">
                          {WEBHOOK_EVENT_LABELS[event].title}
                        </Badge>
                      ))}
                      <span className="text-xs text-fg-secondary">
                        {webhook.lastDeliveryAt
                          ? `Last delivery ${relativeTime(webhook.lastDeliveryAt)}${webhook.lastStatus ? ` · HTTP ${webhook.lastStatus}` : ' · no response'}`
                          : 'No deliveries yet'}
                      </span>
                      {failing ? (
                        <Badge tone="danger" size="sm" icon={<CircleAlert aria-hidden />}>
                          {webhook.failureCount} failed in a row
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 self-end sm:self-center">
                  <Button
                    variant="secondary"
                    size="sm"
                    leadingIcon={<Send aria-hidden />}
                    onClick={() => sendTest(webhook)}
                    loading={mutations.test.isPending && mutations.test.variables === webhook.id}
                    data-testid="webhook-test"
                  >
                    Send test
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    leadingIcon={<ListTree aria-hidden />}
                    onClick={() => setLogFor(webhook)}
                    data-testid="webhook-log"
                  >
                    Deliveries
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <IconButton
                        label="More webhook actions"
                        icon={<MoreHorizontal aria-hidden />}
                        size="sm"
                      />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                      <DropdownMenuItem
                        icon={<KeyRound />}
                        disabled={!canWrite}
                        onSelect={() => rotate(webhook)}
                      >
                        Rotate signing secret
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        icon={<Trash2 />}
                        variant="danger"
                        disabled={!canWrite}
                        onSelect={() => setDeleting(webhook)}
                      >
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <CreateWebhookDialog
        open={creating}
        onOpenChange={setCreating}
        onCreate={async (url, events) => {
          const result = await mutations.create.mutateAsync({ url, events });
          setCreating(false);
          setSecret({ secret: result.secret, url: result.webhook.url, rotated: false });
        }}
      />
      <SecretDialog value={secret} onClose={() => setSecret(null)} />
      <DeliveriesDrawer webhook={logFor} onClose={() => setLogFor(null)} />
      <Dialog open={deleting !== null} onOpenChange={(open) => (open ? undefined : setDeleting(null))}>
        {deleting ? (
          <DialogContent size="sm">
            <DialogHeader
              title="Delete this webhook?"
              description="Deliveries stop immediately. Its signing secret can’t be recovered, so a new webhook gets a new secret."
            />
            <DialogBody className="pb-4">
              <p className="truncate rounded-md bg-sunken px-3 py-2 font-mono text-sm text-fg">
                {deleting.url}
              </p>
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" autoFocus onClick={() => setDeleting(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  const target = deleting;
                  setDeleting(null);
                  mutations.remove.mutate(target.id, {
                    onSuccess: () => toast.success('Webhook deleted'),
                    onError: (error) => toast.error('Couldn’t delete the webhook', errorMessage(error)),
                  });
                }}
              >
                Delete webhook
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}

function CreateWebhookDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onCreate: (url: string, events: WebhookEvent[]) => Promise<void>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? <CreateWebhookBody onCancel={() => onOpenChange(false)} onCreate={onCreate} /> : null}
    </Dialog>
  );
}

function CreateWebhookBody({
  onCancel,
  onCreate,
}: {
  readonly onCancel: () => void;
  readonly onCreate: (url: string, events: WebhookEvent[]) => Promise<void>;
}) {
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<WebhookEvent[]>(['item.created', 'item.status_changed']);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const groupId = useId();
  const parsed = createWebhookSchema.safeParse({ url: url.trim(), events });
  const urlError = parsed.success
    ? null
    : (parsed.error.issues.find((issue) => issue.path[0] === 'url')?.message ?? null);
  const eventsError = parsed.success
    ? null
    : (parsed.error.issues.find((issue) => issue.path[0] === 'events')?.message ?? null);

  const submit = async () => {
    setTouched(true);
    if (!parsed.success) return;
    setSaving(true);
    setServerError(null);
    try {
      await onCreate(parsed.data.url, parsed.data.events);
    } catch (error) {
      setServerError(errorMessage(error, 'The webhook could not be created.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogContent size="md" data-testid="webhook-create-dialog">
      <DialogHeader
        title="Add a webhook"
        description="KitStak POSTs a signed JSON payload to this URL when a selected event happens."
      />
      <form
        noValidate
        className="contents"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <DialogBody className="flex flex-col gap-5 pb-5">
          <Field label="Endpoint URL" required error={touched ? (serverError ?? urlError) : serverError}>
            {({ inputId, describedBy, invalid }) => (
              <Input
                id={inputId}
                aria-describedby={describedBy}
                invalid={invalid}
                autoFocus
                type="url"
                inputMode="url"
                placeholder="https://example.com/hooks/kitstak"
                value={url}
                onChange={(event) => {
                  setUrl(event.target.value);
                  setServerError(null);
                }}
                onBlur={() => url && setTouched(true)}
                data-testid="webhook-url"
              />
            )}
          </Field>
          <fieldset aria-describedby={eventsError && touched ? `${groupId}-error` : undefined}>
            <legend className="mb-2 text-sm font-medium text-fg">Events</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {WEBHOOK_EVENTS.map((event) => {
                const checked = events.includes(event);
                const label = WEBHOOK_EVENT_LABELS[event];
                return (
                  <label
                    key={event}
                    className={cn(
                      'flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2.5 transition-colors duration-[var(--duration-fast)]',
                      'focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-focus hover:border-border-strong',
                      checked ? 'border-primary bg-primary-subtle' : 'border-border-subtle bg-panel',
                    )}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
                      checked={checked}
                      onChange={() =>
                        setEvents((current) =>
                          current.includes(event)
                            ? current.filter((entry) => entry !== event)
                            : [...current, event],
                        )
                      }
                    />
                    <span>
                      <span className="block text-sm font-medium text-fg">{label.title}</span>
                      <span className="block text-xs text-fg-secondary">{label.description}</span>
                      <code className="mt-0.5 block font-mono text-2xs text-fg-muted">{event}</code>
                    </span>
                  </label>
                );
              })}
            </div>
            {eventsError && touched ? (
              <p
                id={`${groupId}-error`}
                role="alert"
                className="mt-2 flex items-center gap-1 text-xs text-danger-text"
              >
                <CircleAlert aria-hidden className="size-3.5" />
                {eventsError}
              </p>
            ) : null}
          </fieldset>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" type="button" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" loading={saving} data-testid="webhook-create-submit">
            Create webhook
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function SecretDialog({
  value,
  onClose,
}: {
  readonly value: { secret: string; url: string; rotated: boolean } | null;
  readonly onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value.secret);
      setCopied(true);
      toast.success('Secret copied');
    } catch {
      toast.error('Couldn’t copy', 'Select the secret and copy it manually.');
    }
  };
  return (
    <Dialog
      open={value !== null}
      onOpenChange={(open) => {
        if (!open) {
          setCopied(false);
          onClose();
        }
      }}
    >
      {value ? (
        <DialogContent size="md" data-testid="webhook-secret-dialog">
          <DialogHeader
            title={value.rotated ? 'New signing secret' : 'Webhook created'}
            description="Copy the signing secret now. For your security it won’t be shown again."
            icon={
              <span className="flex size-9 items-center justify-center rounded-lg bg-success-subtle text-success-text">
                <KeyRound aria-hidden className="size-5" />
              </span>
            }
          />
          <DialogBody className="flex flex-col gap-4 pb-5">
            <div className="flex items-center gap-2 rounded-md border border-border-default bg-sunken p-2 pl-3">
              <code
                className="min-w-0 flex-1 font-mono text-sm break-all text-fg select-all"
                data-testid="webhook-secret"
              >
                {value.secret}
              </code>
              <Button
                size="sm"
                variant="secondary"
                leadingIcon={copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                onClick={() => void copy()}
              >
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <div className="text-sm text-fg-secondary">
              <p className="mb-1.5 font-medium text-fg">Verify each delivery</p>
              <p>
                The <code className="font-mono text-xs">{WEBHOOK_SIGNATURE_HEADER}</code> header looks like{' '}
                <code className="font-mono text-xs">t=1730000000,v1=…</code>. Compute an HMAC-SHA256 of{' '}
                <code className="font-mono text-xs">{'`${t}.${rawBody}`'}</code> with this secret and compare
                it to <code className="font-mono text-xs">v1</code>. Reject timestamps older than five
                minutes.
              </p>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button onClick={onClose}>I’ve saved it</Button>
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

function DeliveriesDrawer({
  webhook,
  onClose,
}: {
  readonly webhook: WebhookDto | null;
  readonly onClose: () => void;
}) {
  const deliveries = useWebhookDeliveries(webhook?.id ?? null);
  const [openId, setOpenId] = useState<string | null>(null);
  const rows = deliveries.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <Drawer open={webhook !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      {webhook ? (
        <DrawerContent
          width={560}
          title="Delivery log"
          description={webhook.url}
          data-testid="webhook-deliveries"
          onOpenAutoFocus={focusPanel}
        >
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {deliveries.isPending ? (
              <div className="flex flex-col gap-2" aria-busy="true">
                {Array.from({ length: 5 }, (_, index) => (
                  <Skeleton key={index} height={44} rounded="md" />
                ))}
              </div>
            ) : deliveries.isError ? (
              <EmptyState
                illustration="error"
                size="sm"
                title="The log couldn’t load"
                description={errorMessage(deliveries.error)}
                actions={
                  <Button variant="secondary" onClick={() => void deliveries.refetch()}>
                    Try again
                  </Button>
                }
              />
            ) : rows.length === 0 ? (
              <EmptyState
                illustration="inbox"
                size="sm"
                title="No deliveries yet"
                description="Send a test or change an item on this board to see deliveries here."
              />
            ) : (
              <ul className="flex flex-col gap-2">
                {rows.map((delivery) => (
                  <DeliveryRow
                    key={delivery.id}
                    delivery={delivery}
                    open={openId === delivery.id}
                    onToggle={() => setOpenId(openId === delivery.id ? null : delivery.id)}
                  />
                ))}
              </ul>
            )}
            {deliveries.hasNextPage ? (
              <Button
                variant="secondary"
                className="mt-3 w-full"
                onClick={() => void deliveries.fetchNextPage()}
                loading={deliveries.isFetchingNextPage}
              >
                Load older deliveries
              </Button>
            ) : null}
          </div>
        </DrawerContent>
      ) : null}
    </Drawer>
  );
}

function DeliveryRow({
  delivery,
  open,
  onToggle,
}: {
  readonly delivery: WebhookDeliveryDto;
  readonly open: boolean;
  readonly onToggle: () => void;
}) {
  return (
    <li className="rounded-md border border-border-subtle bg-panel">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus active:bg-pressed"
      >
        <StatusPill
          label={delivery.status ? String(delivery.status) : 'Error'}
          color={delivery.ok ? 'green' : 'red'}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-mono text-xs text-fg">{delivery.event}</span>
          <span className="block text-xs text-fg-secondary" title={formatDateTime(delivery.createdAt)}>
            {relativeTime(delivery.createdAt)} · {formatDuration(delivery.durationMs)}
            {delivery.kind === 'test' ? ' · test' : ''}
          </span>
        </span>
      </button>
      {open ? (
        <div className="flex flex-col gap-2 border-t border-border-subtle px-3 py-3">
          {delivery.error ? <p className="text-sm text-danger-text">{delivery.error}</p> : null}
          <div>
            <div className="mb-1 text-xs font-semibold text-fg-secondary">Request body</div>
            <pre className="max-h-48 overflow-auto rounded-md bg-sunken p-2 font-mono text-xs whitespace-pre-wrap text-fg">
              {prettyJson(delivery.requestBody)}
            </pre>
          </div>
          <div>
            <div className="mb-1 text-xs font-semibold text-fg-secondary">Response</div>
            <pre className="max-h-32 overflow-auto rounded-md bg-sunken p-2 font-mono text-xs whitespace-pre-wrap text-fg">
              {delivery.responseBody || 'No body'}
            </pre>
          </div>
        </div>
      ) : null}
    </li>
  );
}

function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/** Focus the panel itself on open (keeps the close button's tooltip from popping and eating Esc). */
function focusPanel(event: Event) {
  event.preventDefault();
  (event.currentTarget as HTMLElement | null)?.focus();
}
