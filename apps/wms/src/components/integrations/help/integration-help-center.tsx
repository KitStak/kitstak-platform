/**
 * Integration Help Center (`/integrations/help`, M12). Static, server-rendered: one anchored
 * section per channel and carrier (status, how to connect, provider docs), plus logs,
 * monitoring, carrier errors and workflow triggers. Page headers deep-link to the anchors.
 */
import Link from 'next/link';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { channelCredentialProfile, CHANNEL_CREDENTIAL_PROFILES } from '@/lib/grid-defs/integrations/channels';
import { TRIGGER_COPY } from '@/lib/grid-defs/integrations/workflows';
import { WORKFLOW_TRIGGERS } from '@/lib/enums';

export interface HelpEntry {
  readonly key: string;
  readonly name: string;
  readonly kind: 'channel' | 'carrier';
  readonly availability: string;
  readonly description: string;
  readonly live: boolean;
}

/** Official developer documentation per provider ("Learn more" on the provider's API). */
const PROVIDER_DOCS: Readonly<Record<string, string>> = {
  shopify: 'https://help.shopify.com/en/manual/apps/app-types/custom-apps',
  shipstation: 'https://www.shipstation.com/docs/api/',
  amazon: 'https://developer-docs.amazon.com/sp-api/',
  woocommerce: 'https://woocommerce.github.io/woocommerce-rest-api-docs/',
  tiktok: 'https://partner.tiktokshop.com/docv2/page/tts-api-concepts-overview',
  magento: 'https://developer.adobe.com/commerce/webapi/rest/',
  walmart: 'https://developer.walmart.com/',
  ebay: 'https://developer.ebay.com/api-docs/sell/fulfillment/overview.html',
  bigcommerce: 'https://developer.bigcommerce.com/docs/start/authentication/api-accounts',
  etsy: 'https://developers.etsy.com/documentation/',
  ups: 'https://developer.ups.com/',
  fedex: 'https://developer.fedex.com/',
  easypost: 'https://docs.easypost.com/',
  shippo: 'https://docs.goshippo.com/',
  'stamps-com': 'https://developer.stamps.com/',
};

const CARRIER_HELP: Readonly<Record<string, string>> = {
  ups: 'Create an app on the UPS Developer Portal with the Rating, Shipping and Tracking products, then paste its client ID and secret and your UPS account number. KitStak uses OAuth client credentials and renews the token itself.',
  fedex:
    'Create a project on the FedEx Developer Portal with Rates, Ship and Track APIs, then paste the API key, secret key and your FedEx account number.',
  easypost:
    'Paste a production API key from EasyPost → Account Settings → API Keys. Carrier accounts linked in EasyPost are imported as services.',
  shippo:
    'Paste a live API token from Shippo → Settings → API. Carrier accounts in Shippo become KitStak services.',
  'stamps-com': 'Connect with your Stamps.com (USPS) credentials to rate and buy USPS labels.',
  shipstation:
    'Paste the ShipStation API key and secret (Settings → Account → API Settings) to rate and label with the carriers in ShipStation.',
  'custom-carrier': 'Add your own carrier with its services and manual tracking numbers; no API is called.',
};

const METHOD_COPY: readonly [string, string][] = [
  [
    'Download Orders',
    'Pulls new paid orders from the store into KitStak (every 15 minutes by default). Orders with unknown SKUs go to Channel Monitoring › Missing Shipment Orders with the reason.',
  ],
  [
    'Download Products',
    "Pulls the store's products and variants as listings so SKUs link to KitStak products (daily).",
  ],
  [
    'Sync Inventory',
    'Sends available quantity per linked SKU back to the store (hourly). Locations marked Prevent Inventory Sync are excluded.',
  ],
  [
    'Send Shipment Info',
    'Sends tracking numbers and shipped quantities for shipped orders, so the store closes the order and emails the buyer (every 30 minutes).',
  ],
];

function status(e: HelpEntry): { label: string; tone: 'success' | 'neutral' | 'warning' } {
  if (e.key === 'kitstaks-sandbox') return { label: 'Sandbox', tone: 'neutral' };
  if (e.availability === 'coming-soon') return { label: 'Coming soon · not available yet', tone: 'neutral' };
  if (e.key === 'custom-carrier') return { label: 'No API · manual tracking', tone: 'neutral' };
  // A live adapter is Beta until a connected account completes a successful call in this workspace (the Integration Management card then reads Live API).
  if (e.live) return { label: 'Live adapter · Beta', tone: 'warning' };
  return { label: 'Sandbox only · no live API yet', tone: 'warning' };
}

function Section({
  id,
  title,
  children,
  aside,
}: {
  readonly id: string;
  readonly title: string;
  readonly children: React.ReactNode;
  readonly aside?: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20 rounded-xl border border-border bg-surface p-5">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {aside}
      </div>
      <div className="flex flex-col gap-2 text-sm leading-relaxed text-body">{children}</div>
    </section>
  );
}

export function IntegrationHelpCenter({
  entries,
  shopifyPublicApp,
}: {
  readonly entries: readonly HelpEntry[];
  readonly shopifyPublicApp: boolean;
}) {
  const channels = entries.filter((e) => e.kind === 'channel');
  const carriers = entries.filter((e) => e.kind === 'carrier' && e.key !== 'kitstaks-sandbox');
  return (
    <div className="pb-10">
      <PageHeader
        title="Integration Help Center"
        breadcrumbs={[
          { label: 'Integrations' },
          { label: 'Integration Management', href: '/integrations/channels' },
          { label: 'Help Center' },
        ]}
      />
      <div className="mt-4 grid gap-6 px-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="Help topics" className="flex flex-col gap-1 self-start text-sm lg:sticky lg:top-4">
          {[
            ['overview', 'Overview'],
            ['channels', 'Sales channels'],
            ['carriers', 'Carriers'],
            ['methods', 'Channel methods'],
            ['logs', 'Channel logs'],
            ['monitoring', 'Channel monitoring'],
            ['carrier-errors', 'Carrier errors'],
            ['workflows', 'Workflow triggers'],
          ].map(([id, label]) => (
            <a
              key={id}
              href={`#${id}`}
              className="rounded px-2 py-1 text-secondary hover:bg-surface-sunken hover:text-foreground"
            >
              {label}
            </a>
          ))}
        </nav>
        <div className="flex min-w-0 flex-col gap-4">
          <Section id="overview" title="Overview">
            <p>
              Every integration is set up from{' '}
              <Link className="text-primary hover:underline" href="/integrations/channels">
                Integration Management
              </Link>
              . A store connection belongs to one client; link each store location to a warehouse, then turn
              on the methods you want. Credentials are encrypted at rest and only the last four characters are
              ever shown.
            </p>
            <p>
              <strong>Live adapter · Beta</strong> integrations call the provider&apos;s real API with your
              credentials, but are marked Beta until a connected account in this workspace completes a
              successful call; the Integration Management card then reads <strong>Live API</strong>.
              Connecting checks the credentials against the provider&apos;s API; a <strong>Run</strong> on
              Channel Methods (or a rate or label call for a carrier) then verifies it end to end.{' '}
              <strong>Sandbox only</strong> integrations don&apos;t have a live adapter yet: connecting
              creates a KitStak Sandbox store that simulates orders, inventory and shipment confirmation so
              you can configure and test. <strong>Coming soon</strong> integrations can&apos;t be connected
              yet.
            </p>
            <div className="overflow-x-auto">
              <table className="mt-1 w-full text-left text-xs">
                <thead className="text-secondary">
                  <tr>
                    <th className="py-1 pr-3 font-medium">Integration</th>
                    <th className="py-1 pr-3 font-medium">Type</th>
                    <th className="py-1 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {[...channels, ...carriers].map((e) => {
                    const st = status(e);
                    return (
                      <tr key={`${e.kind}-${e.key}`} className="border-t border-border">
                        <td className="py-1.5 pr-3">
                          <a
                            href={e.kind === 'carrier' ? `#carrier-${e.key}` : `#${e.key}`}
                            className="text-primary hover:underline"
                          >
                            {e.name}
                          </a>
                        </td>
                        <td className="py-1.5 pr-3 capitalize text-secondary">{e.kind}</td>
                        <td className="py-1.5">
                          <Badge size="sm" tone={st.tone}>
                            {st.label}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Section>
          <h2 id="channels" className="scroll-mt-20 pt-2 text-xs font-semibold text-secondary">
            Sales channels
          </h2>
          {channels.map((e) => {
            const st = status(e);
            const profile = CHANNEL_CREDENTIAL_PROFILES[e.key] ? channelCredentialProfile(e.key) : null;
            return (
              <Section
                key={e.key}
                id={e.key}
                title={e.name}
                aside={
                  <Badge size="sm" tone={st.tone}>
                    {st.label}
                  </Badge>
                }
              >
                <p>{e.description}</p>
                {e.key === 'kitstaks-sandbox' ? (
                  <p>
                    A realistic test store: each run generates orders from the client&apos;s active SKUs.
                    Scheduled runs never fail on purpose; Simulate error (Channel Methods › Download Orders)
                    adds one unknown-SKU order on demand so monitoring and retries can be practised.
                  </p>
                ) : null}
                {e.live && profile ? (
                  <p>
                    <strong>How to connect:</strong> {profile.help} Then open{' '}
                    <Link
                      className="text-primary hover:underline"
                      href={`/integrations/channels/${e.key}?connect=1`}
                    >
                      Connect Store
                    </Link>
                    , choose Custom App and paste the values.
                  </p>
                ) : null}
                {e.key === 'shopify' ? (
                  <p>
                    <strong>Public App:</strong>{' '}
                    {shopifyPublicApp
                      ? "One-click install is enabled: choose Public App, enter the myshopify store name, approve KitStak on Shopify, and you're brought back with the store connected."
                      : "One-click install needs the workspace's Shopify app credentials (SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET). Until an administrator adds them, use a Custom App."}
                  </p>
                ) : null}
                {!e.live && e.availability !== 'coming-soon' && e.key !== 'kitstaks-sandbox' ? (
                  <p>
                    KitStak can&apos;t connect to a real {e.name} account yet. You can connect a KitStak
                    Sandbox store for {e.name} to set up mappings, methods and workflows, and switch to the
                    live adapter when it ships.
                  </p>
                ) : null}
                {e.availability === 'coming-soon' ? (
                  <p>{e.name} is on the roadmap and can&apos;t be connected yet.</p>
                ) : null}
                <p className="flex flex-wrap gap-3">
                  {e.availability !== 'coming-soon' ? (
                    <Link className="text-primary hover:underline" href={`/integrations/channels/${e.key}`}>
                      Open {e.name} connections
                    </Link>
                  ) : null}
                  {PROVIDER_DOCS[e.key] ? (
                    <a
                      className="text-primary hover:underline"
                      href={PROVIDER_DOCS[e.key]}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {e.name} API documentation ↗
                    </a>
                  ) : null}
                </p>
              </Section>
            );
          })}
          <h2 id="carriers" className="scroll-mt-20 pt-2 text-xs font-semibold text-secondary">
            Carriers
          </h2>
          {carriers.map((e) => {
            const st = status(e);
            return (
              <Section
                key={e.key}
                id={`carrier-${e.key}`}
                title={e.name}
                aside={
                  <Badge size="sm" tone={st.tone}>
                    {st.label}
                  </Badge>
                }
              >
                <p>{e.description}</p>
                {e.live && CARRIER_HELP[e.key] ? (
                  <p>
                    <strong>How to connect:</strong> {CARRIER_HELP[e.key]} Services, packages and rate
                    shopping become available once the connection is saved.
                  </p>
                ) : null}
                {!e.live && e.availability !== 'coming-soon' ? (
                  <p>
                    KitStak can&apos;t buy real {e.name} labels yet. Its connection uses the KitStak Sandbox
                    carrier, which returns realistic rates, labels and tracking numbers for testing.
                  </p>
                ) : null}
                {e.availability === 'coming-soon' ? (
                  <p>{e.name} is on the roadmap and can&apos;t be connected yet.</p>
                ) : null}
                <p className="flex flex-wrap gap-3">
                  {e.availability !== 'coming-soon' ? (
                    <Link className="text-primary hover:underline" href={`/integrations/carriers/${e.key}`}>
                      Open {e.name} integration
                    </Link>
                  ) : null}
                  {PROVIDER_DOCS[e.key] ? (
                    <a
                      className="text-primary hover:underline"
                      href={PROVIDER_DOCS[e.key]}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {e.name} API documentation ↗
                    </a>
                  ) : null}
                </p>
              </Section>
            );
          })}
          <Section id="methods" title="Channel methods">
            <ul className="list-disc pl-5">
              {METHOD_COPY.map(([m, d]) => (
                <li key={m}>
                  <strong>{m}:</strong> {d}
                </li>
              ))}
            </ul>
            <p>
              Change each interval under the store&apos;s Configuration tab. A method runs only while it is
              Active and the store has at least one location linked to a warehouse.
            </p>
          </Section>
          <Section id="logs" title="Channel logs">
            <p>
              <Link className="text-primary hover:underline" href="/integrations/logs/methods">
                Channel Methods
              </Link>{' '}
              lists every method with its countdown and a Run button.{' '}
              <Link className="text-primary hover:underline" href="/integrations/logs/history">
                Channel History
              </Link>{' '}
              keeps each run with its counts and details.{' '}
              <Link className="text-primary hover:underline" href="/integrations/logs/orders">
                Orders and Shipments
              </Link>{' '}
              and{' '}
              <Link className="text-primary hover:underline" href="/integrations/logs/products">
                Products and Inventory
              </Link>{' '}
              show every call with Successful Yes/No and the error message.
            </p>
          </Section>
          <Section id="monitoring" title="Channel monitoring">
            <p>
              The{' '}
              <Link className="text-primary hover:underline" href="/integrations/monitoring">
                Channel Health Overview
              </Link>{' '}
              shows the last 24 hours per store. Missing Shipment Orders can be retried once the cause
              (usually an unknown SKU) is fixed; Workflow Blocked orders are released there; Product Listing
              Exceptions link store listings to KitStak products.
            </p>
          </Section>
          <Section id="carrier-errors" title="Carrier errors">
            <p>
              <Link
                className="text-primary hover:underline"
                href="/integrations/carrier-errors/label-generation"
              >
                Carrier Errors
              </Link>{' '}
              keeps every failed label, rate and void call with the exact request and response. Open a row to
              see the payloads, download them for the carrier&apos;s support team, or retry after fixing the
              order or setup.
            </p>
          </Section>
          <Section id="workflows" title="Workflow triggers">
            <ul className="list-disc pl-5">
              {WORKFLOW_TRIGGERS.map((t) => (
                <li key={t}>
                  <strong>{t}:</strong> {TRIGGER_COPY[t]}
                </li>
              ))}
            </ul>
            <p>
              Build them under{' '}
              <Link className="text-primary hover:underline" href="/automation/workflows">
                Automation › Workflows
              </Link>
              ; every run is recorded in the workflow&apos;s Run history.
            </p>
          </Section>
        </div>
      </div>
    </div>
  );
}
