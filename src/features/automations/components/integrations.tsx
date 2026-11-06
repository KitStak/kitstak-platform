'use client';
/**
 * Integrations tab. Webhooks are fully functional (signed deliveries of board events, test
 * delivery, delivery log, secret rotation). Zapier/Make-style hubs connect through a webhook.
 * Email, Slack, Gmail and Outlook need provider credentials that are not configured in this
 * workspace; their cards say so plainly instead of pretending to connect.
 */
import { useState } from 'react';
import {
  Bell,
  CircleAlert,
  Inbox,
  Mail,
  MessageSquare,
  Plug,
  Webhook,
  Workflow,
  Check,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import {
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  cn,
} from '@/components/ui';
import { WebhooksPanel } from './webhooks-panel';

interface IntegrationCard {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly description: string;
  readonly icon: LucideIcon;
  /** Label color token for the icon tile. */
  readonly tint: string;
  readonly status: 'available' | 'via-webhook' | 'built-in' | 'needs-config';
  readonly requirement?: string;
}

const CARDS: readonly IntegrationCard[] = [
  {
    id: 'webhooks',
    name: 'Webhooks',
    category: 'Developer',
    description: 'Send signed JSON to any URL when items are created, change or move.',
    icon: Webhook,
    tint: 'dark-blue',
    status: 'available',
  },
  {
    id: 'zapier',
    name: 'Zapier-style hubs',
    category: 'Automation hubs',
    description:
      'Point a “catch hook” URL from Zapier, Make or n8n at a KitStak webhook to reach 5,000+ apps.',
    icon: Zap,
    tint: 'orange',
    status: 'via-webhook',
  },
  {
    id: 'make',
    name: 'Make / n8n',
    category: 'Automation hubs',
    description: 'Visual scenario builders. Connect them with an incoming-webhook module.',
    icon: Workflow,
    tint: 'purple',
    status: 'via-webhook',
  },
  {
    id: 'in-app',
    name: 'In-app notifications',
    category: 'Communication',
    description: 'The “notify” action delivers to the KitStak inbox and bell. Nothing to set up.',
    icon: Bell,
    tint: 'green',
    status: 'built-in',
  },
  {
    id: 'email',
    name: 'Email',
    category: 'Communication',
    description: 'Send automation messages by email.',
    icon: Mail,
    tint: 'sky',
    status: 'needs-config',
    requirement:
      'An outbound email provider (SMTP host or a transactional email API key) must be configured on the server by an administrator. No email will be sent until then.',
  },
  {
    id: 'slack',
    name: 'Slack',
    category: 'Communication',
    description: 'Post automation messages to a channel.',
    icon: MessageSquare,
    tint: 'berry',
    status: 'needs-config',
    requirement:
      'A Slack app (client ID, client secret and signing secret) must be registered for this KitStak installation before workspaces can be connected with OAuth.',
  },
  {
    id: 'gmail',
    name: 'Gmail',
    category: 'Email & calendar',
    description: 'Create items from emails and log replies on contacts.',
    icon: Inbox,
    tint: 'red',
    status: 'needs-config',
    requirement:
      'A Google Cloud OAuth client with the Gmail API enabled must be configured for this installation before mailboxes can be connected.',
  },
  {
    id: 'outlook',
    name: 'Outlook',
    category: 'Email & calendar',
    description: 'Create items from emails and log replies on contacts.',
    icon: Mail,
    tint: 'blue',
    status: 'needs-config',
    requirement:
      'A Microsoft Entra app registration (client ID and secret with Mail.Read) must be configured for this installation before mailboxes can be connected.',
  },
];

const STATUS_BADGE: Readonly<
  Record<IntegrationCard['status'], { label: string; tone: 'success' | 'primary' | 'neutral' | 'warning' }>
> = {
  available: { label: 'Available', tone: 'success' },
  'via-webhook': { label: 'Via webhook', tone: 'primary' },
  'built-in': { label: 'Built in', tone: 'neutral' },
  'needs-config': { label: 'Requires configuration', tone: 'warning' },
};

export interface IntegrationsProps {
  readonly boardId: string;
  readonly canManageWebhooks: boolean;
  readonly canEditBoard: boolean;
}

export function Integrations({ boardId, canManageWebhooks, canEditBoard }: IntegrationsProps) {
  const [requirement, setRequirement] = useState<IntegrationCard | null>(null);
  const [creating, setCreating] = useState(false);

  const act = (card: IntegrationCard) => {
    if (card.status === 'needs-config') return setRequirement(card);
    if (card.status === 'available' || card.status === 'via-webhook') {
      document.getElementById('webhooks')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (canManageWebhooks && canEditBoard) setCreating(true);
    }
  };

  return (
    <div className="flex flex-col gap-8" data-testid="integrations">
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Integrations">
        {CARDS.map((card) => {
          const badge = STATUS_BADGE[card.status];
          const Icon = card.icon;
          return (
            <li
              key={card.id}
              data-testid="integration-card"
              data-integration={card.id}
              className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-panel p-4 shadow-xs transition-[border-color,box-shadow] duration-[var(--duration-fast)] hover:border-border-strong hover:shadow-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <span
                  aria-hidden
                  className="flex size-10 items-center justify-center rounded-lg text-[var(--lc-fg)]"
                  style={{
                    background: `var(--label-${card.tint})`,
                    ['--lc-fg' as string]: `var(--label-${card.tint}-fg)`,
                  }}
                >
                  <Icon className="size-5" />
                </span>
                <Badge tone={badge.tone} size="sm">
                  {badge.label}
                </Badge>
              </div>
              <div>
                <h3 className="font-heading text-base font-semibold text-fg">{card.name}</h3>
                <p className="text-xs text-fg-muted">{card.category}</p>
              </div>
              <p className="flex-1 text-sm text-fg-secondary">{card.description}</p>
              {card.status === 'built-in' ? (
                <span
                  className="inline-flex h-8 items-center gap-1.5 self-start rounded-md border border-border-subtle bg-sunken px-3 text-sm font-medium text-fg-secondary"
                  aria-label="Enabled: ready to use in any notify action"
                  title="Ready to use in any “notify” action"
                >
                  <Check aria-hidden className="size-4 text-success-text" />
                  Enabled
                </span>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  className="self-start"
                  leadingIcon={
                    card.status === 'needs-config' ? <Plug aria-hidden /> : <Webhook aria-hidden />
                  }
                  onClick={() => act(card)}
                  disabled={card.status !== 'needs-config' && !canManageWebhooks}
                >
                  {card.status === 'needs-config'
                    ? 'Connect'
                    : card.status === 'available'
                      ? 'Set up'
                      : 'Use a webhook'}
                </Button>
              )}
            </li>
          );
        })}
      </ul>

      <section id="webhooks" className="scroll-mt-4" aria-labelledby="webhooks-heading">
        <WebhooksPanel
          boardId={boardId}
          canManage={canManageWebhooks}
          canEditBoard={canEditBoard}
          creating={creating}
          onCreatingChange={setCreating}
        />
      </section>

      <Dialog open={requirement !== null} onOpenChange={(open) => (open ? undefined : setRequirement(null))}>
        {requirement ? (
          <DialogContent size="sm">
            <DialogHeader
              title={`${requirement.name} isn’t configured yet`}
              description="This connection can’t be set up from here until an administrator configures it."
              icon={
                <span className="flex size-9 items-center justify-center rounded-lg bg-warning-subtle text-warning-text">
                  <CircleAlert aria-hidden className="size-5" />
                </span>
              }
            />
            <DialogBody className="flex flex-col gap-3 pb-4">
              <p className="text-sm text-fg">{requirement.requirement}</p>
              <p className={cn('rounded-md bg-sunken px-3 py-2 text-sm text-fg-secondary')}>
                Need it sooner? A webhook to a Zapier-style hub can forward KitStak events to{' '}
                {requirement.name} today.
              </p>
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setRequirement(null)}>
                Close
              </Button>
              <Button
                onClick={() => {
                  setRequirement(null);
                  act(CARDS[0] as IntegrationCard);
                }}
                disabled={!canManageWebhooks}
              >
                Use a webhook instead
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}
