/** Static copy for the Help Center menu. */

export interface HelpGuide {
  readonly title: string;
  readonly body: string;
  readonly href?: string;
  readonly linkLabel?: string;
}

export const HELP_GUIDES: readonly HelpGuide[] = [
  {
    title: 'Find anything fast',
    body: 'Press / or Ctrl+K to search pages and records: order codes, store order numbers, customers, SKUs, barcodes and clients.',
  },
  {
    title: 'Work in context',
    body: 'Use the warehouse and client switcher in the header to narrow every list to one facility or client. Your choice is remembered on this device.',
  },
  {
    title: 'Background tasks',
    body: 'Exports, imports and bulk operations run in the background. Follow their progress in the Transactions tray and download finished files there.',
    href: '/reports/export-history',
    linkLabel: 'Open Excel export history',
  },
  {
    title: 'Direct printing',
    body: 'Assign your barcode and laser printer per warehouse from the Printers icon. Printouts then go straight to the right device.',
  },
  {
    title: 'Your preferences',
    body: 'Choose date, time and number formats used across every grid and summary.',
    href: '/account/preferences',
    linkLabel: 'Open preferences',
  },
];

export interface WhatsNewEntry {
  /** Release date shown above the title ("Nov 6, 2026"). */
  readonly date: string;
  readonly version: string;
  readonly tag: string;
  readonly title: string;
  readonly body: string;
}

export const WHATS_NEW: readonly WhatsNewEntry[] = [
  {
    date: 'Nov 12, 2026',
    version: 'v0.4',
    tag: 'New',
    title: 'Guided setup on the dashboard',
    body: 'New installs get a "Get set up" checklist in the right order: warehouse, locations, client, products, first order. Steps check themselves off from live data.',
  },
  {
    date: 'Nov 10, 2026',
    version: 'v0.4',
    tag: 'New',
    title: 'Help panel',
    body: 'Searchable help collections, articles for the page you are on, feedback and screen recording, all in one side panel.',
  },
  {
    date: 'Nov 10, 2026',
    version: 'v0.4',
    tag: 'New',
    title: 'Retailer packing lists',
    body: "Target, Macy's, QVC, Staples Dropship, Walmart and Amazon compliant packing list templates in Printouts.",
  },
  {
    date: 'Nov 10, 2026',
    version: 'v0.4',
    tag: 'Improved',
    title: 'Search users, roles and codes',
    body: 'Global search finds users and roles, and codes typed with fewer zeros such as PO22 or SO10916.',
  },
  {
    date: 'Nov 10, 2026',
    version: 'v0.4',
    tag: 'Improved',
    title: 'Notification center',
    body: 'Filter notifications by type, status and date, archive them, and see shortages flagged as warnings.',
  },
  {
    date: 'Nov 6, 2026',
    version: 'v0.3',
    tag: 'New',
    title: 'Record search',
    body: 'Global search now finds shipment orders, SKUs and clients, not just pages.',
  },
  {
    date: 'Nov 6, 2026',
    version: 'v0.3',
    tag: 'New',
    title: 'Warehouse & client context',
    body: 'Scope the whole app to one warehouse or client from the header.',
  },
  {
    date: 'Oct 22, 2026',
    version: 'v0.2',
    tag: 'Improved',
    title: 'Inline validation',
    body: 'Forms show the exact problem under each field and jump to the first error.',
  },
  {
    date: 'Oct 22, 2026',
    version: 'v0.2',
    tag: 'Improved',
    title: 'Notifications',
    body: 'Wave completions, failed imports and shortages arrive in the bell with deep links.',
  },
];

/** Two-key navigation sequences (see `goto-shortcuts.ts`). */
export interface GotoShortcut {
  readonly key: string;
  readonly href: string;
  readonly description: string;
}

export const GOTO_SHORTCUTS: readonly GotoShortcut[] = [
  { key: 'd', href: '/dashboard', description: 'Go to Dashboard' },
  { key: 'o', href: '/orders', description: 'Go to Shipment Orders' },
  { key: 'j', href: '/jobs', description: 'Go to Jobs' },
  { key: 'r', href: '/receiving', description: 'Go to Receiving' },
  { key: 'i', href: '/inventory', description: 'Go to Inventory' },
  { key: 'p', href: '/products', description: 'Go to Products' },
  { key: 'l', href: '/locations', description: 'Go to Locations' },
  { key: 'c', href: '/clients', description: 'Go to Clients' },
  { key: 't', href: '/reports', description: 'Go to Reports' },
  { key: 's', href: '/settings', description: 'Go to Settings' },
];

/** Grid keyboard behavior (handled by the grid controls themselves). */
const GRID_SHORTCUTS: readonly StaticShortcut[] = [
  { description: 'Run the grid search (in the search box)', keys: [['Enter']], group: 'Grids' },
  { description: 'Jump to the typed page (in the page box)', keys: [['Enter']], group: 'Grids' },
  { description: 'Select or clear the focused row checkbox', keys: [['Space']], group: 'Grids' },
  { description: 'Add a column to the sort (click a header)', keys: [['Shift+Click']], group: 'Grids' },
  { description: "Open the focused row's actions menu", keys: [['Enter'], ['Space']], group: 'Grids' },
  { description: 'Move between menu items', keys: [['↑'], ['↓']], group: 'Grids' },
];

/** Shortcuts handled outside the registry, listed in the shortcuts sheet. */
export interface StaticShortcut {
  readonly description: string;
  /** Alternatives; each is a list of keys pressed in sequence. */
  readonly keys: readonly (readonly string[])[];
  readonly group: string;
}

export const STATIC_SHORTCUTS: readonly StaticShortcut[] = [
  ...GOTO_SHORTCUTS.map((s) => ({
    description: s.description,
    keys: [['G', s.key.toUpperCase()]],
    group: 'Navigation',
  })),
  { description: 'Close a dialog, menu or drawer', keys: [['Esc']], group: 'General' },
  ...GRID_SHORTCUTS,
];

export interface ShortcutRow {
  readonly description: string;
  readonly combos: readonly string[];
  readonly group: string;
}

/** One row per action: registry entries with the same description merge ("/ or Ctrl K"). */
export function mergeShortcutRows(
  list: readonly { readonly description: string; readonly combo: string; readonly group: string }[],
): readonly ShortcutRow[] {
  const rows: ShortcutRow[] = [];
  for (const s of list) {
    const index = rows.findIndex((r) => r.description === s.description && r.group === s.group);
    const existing = rows[index];
    if (existing) rows[index] = { ...existing, combos: [...existing.combos, s.combo] };
    else rows.push({ description: s.description, combos: [s.combo], group: s.group });
  }
  return rows;
}

/* ---------------- Help panel: article collections ---------------- */

export interface HelpArticle {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  /** Short, ordered steps or facts shown in the article view. */
  readonly steps: readonly string[];
  /** In-app links at the end of the article. */
  readonly links?: readonly { readonly label: string; readonly href: string }[];
  /** Path prefixes this article is relevant to ("For this page"). */
  readonly contexts?: readonly string[];
}

export interface HelpCategory {
  readonly key: string;
  readonly title: string;
  readonly description: string;
  readonly articles: readonly HelpArticle[];
}

export const HELP_CATEGORIES: readonly HelpCategory[] = [
  {
    key: 'process-manuals',
    title: 'Process Manuals',
    description: 'Step-by-step guides for receiving, picking, packing, shipping, counts and returns.',
    articles: [
      {
        id: 'receive-po',
        title: 'Receive a purchase order',
        summary: 'Create a PO, receive it by LP or SKU and put it away.',
        contexts: ['/receiving'],
        steps: [
          'Open Receiving and choose New Purchase Order, or import POs from Excel.',
          'Add lines with the expected quantity per SKU, then save the PO as Open.',
          'Receive on the PO detail page or on a mobile device: scan the LP, then each SKU with its quantity, lot and expiry.',
          'Put away the received LPs; the putaway algorithm suggests a location.',
          'Close the PO when every line is received. Short or over receipts are recorded as discrepancies.',
        ],
        links: [
          { label: 'Open Receiving', href: '/receiving' },
          { label: 'Receiving history', href: '/receiving/history' },
        ],
      },
      {
        id: 'waves',
        title: 'Plan waves and pick jobs',
        summary: 'Turn open orders into pick jobs with wave rules.',
        contexts: ['/jobs', '/orders'],
        steps: [
          'Shipment orders become ready for picking after allocation.',
          'Run a wave rule from Jobs › Wave Rules, or select orders and choose Create Job.',
          'Each job lists pick tasks by location; operators pick on mobile or with a printed pick list.',
          'Shortages appear in Jobs › Shortage with the reason and the affected orders.',
        ],
        links: [
          { label: 'Open Jobs', href: '/jobs' },
          { label: 'Wave rules', href: '/jobs/wave-rules' },
          { label: 'Shortages', href: '/jobs/shortage' },
        ],
      },
      {
        id: 'pack-ship',
        title: 'Pack and ship an order',
        summary: 'Pack at the packing station, buy a label and close the shipment.',
        contexts: ['/packing-station', '/shipments'],
        steps: [
          'Open the Packing Station and choose your station and mode.',
          'Scan the order, tote or job, then scan each item into a package.',
          'Pick the package type; weight and dimensions fill in from the package setup.',
          'Create the label: rate shopping picks the carrier service unless one is set on the order.',
          'Ship the order. The tracking number is sent to the sales channel.',
        ],
        links: [
          { label: 'Packing Station', href: '/packing-station' },
          { label: 'Shipments', href: '/shipments' },
        ],
      },
      {
        id: 'counts',
        title: 'Run a cycle count',
        summary: 'Plan a count, count on mobile and approve the variance.',
        contexts: ['/counts', '/tasks/count'],
        steps: [
          'Create a count plan by location, SKU or zone.',
          'Release the plan: count tasks go to operators.',
          'Review the variance on the plan detail page and approve or recount.',
          'Approved variances post inventory adjustments with a reason.',
        ],
        links: [{ label: 'Open Counts', href: '/counts' }],
      },
      {
        id: 'returns',
        title: 'Process a return',
        summary: 'Create an RMA and receive it at the return station.',
        contexts: ['/orders/returns', '/return-station'],
        steps: [
          'Create a return order from the shipped order or from Returns › New.',
          'At the Return Station, scan the RMA or the original order.',
          'Scan each item and choose the condition and return reason.',
          'Return rules in Data Setup › Return Process decide what is accepted.',
        ],
        links: [
          { label: 'Returns', href: '/orders/returns' },
          { label: 'Return Station', href: '/return-station' },
          { label: 'Return process rules', href: '/settings/data-setup/return-process' },
        ],
      },
    ],
  },
  {
    key: 'reports',
    title: 'Reports',
    description: 'Operational reports, analytics dashboards and Excel exports.',
    articles: [
      {
        id: 'reports-overview',
        title: 'Find the right report',
        summary: 'Inventory, order, receiving and user performance reports.',
        contexts: ['/reports', '/analytics'],
        steps: [
          'Reports lists every report by area. Each one has filters, saved views and Excel export.',
          'Analytics shows dashboards for fulfillment, productivity and labor.',
          'Large exports run in the background; download them from the Transactions tray or Excel export history.',
        ],
        links: [
          { label: 'Open Reports', href: '/reports' },
          { label: 'Excel export history', href: '/reports/export-history' },
        ],
      },
      {
        id: 'transaction-history',
        title: 'Trace an inventory movement',
        summary: 'Use Transaction History to see who moved what, where and why.',
        contexts: ['/reports/transaction-history', '/inventory'],
        steps: [
          'Open Transaction History and filter by SKU, LP, location or date.',
          'Each row shows the transaction type, quantity, from and to location, user and reference.',
          'Serial-tracked SKUs have a separate serial history.',
        ],
        links: [{ label: 'Transaction history', href: '/reports/transaction-history' }],
      },
    ],
  },
  {
    key: 'integrations',
    title: 'Integrations',
    description: 'Sales channels, carriers, API users and integration monitoring.',
    articles: [
      {
        id: 'channels',
        title: 'Connect a sales channel',
        summary: 'Import orders and products and send tracking back.',
        contexts: ['/integrations'],
        steps: [
          'Open Integrations › Channels and choose the channel.',
          'Enter the store credentials and map the client and warehouse.',
          'Turn on order import, inventory sync and tracking updates.',
          'Watch Integration Monitoring for missing orders and listing exceptions.',
        ],
        links: [
          { label: 'Channels', href: '/integrations/channels' },
          { label: 'Monitoring', href: '/integrations/monitoring' },
        ],
      },
      {
        id: 'carriers',
        title: 'Set up a carrier account',
        summary: 'Add carrier credentials and services for labels and rates.',
        contexts: ['/integrations/carriers', '/automation/rate-shopping'],
        steps: [
          'Open Integrations › Carriers and add the account.',
          'Choose the services you ship with.',
          'Rate shopping rules pick the cheapest or fastest service per order.',
        ],
        links: [
          { label: 'Carriers', href: '/integrations/carriers' },
          { label: 'Rate shopping', href: '/automation/rate-shopping' },
        ],
      },
    ],
  },
  {
    key: 'workflow-rules',
    title: 'Workflow Rules',
    description: 'Automate order handling with workflows, allocation and putaway algorithms.',
    articles: [
      {
        id: 'workflows',
        title: 'Automate with workflow rules',
        summary: 'Run actions when orders match conditions.',
        contexts: ['/automation'],
        steps: [
          'Open Automation › Workflows and choose New workflow.',
          'Pick the trigger, for example order created.',
          'Add conditions (client, channel, SKU, ship-to) and the actions to run.',
          'Activate it. Blocked orders appear in Integration Monitoring › Workflow blocked.',
        ],
        links: [{ label: 'Workflows', href: '/automation/workflows' }],
      },
      {
        id: 'algorithms',
        title: 'Allocation and putaway algorithms',
        summary: 'Control where stock is picked from and put away to.',
        contexts: ['/automation/algorithms'],
        steps: [
          'Allocation algorithms rank locations, for example FEFO, FIFO or fewest picks.',
          'Putaway algorithms suggest a location by zone, product group and capacity.',
          'Assign algorithms per warehouse and client.',
        ],
        links: [{ label: 'Algorithms', href: '/automation/algorithms' }],
      },
    ],
  },
  {
    key: 'client-management',
    title: 'Client Management',
    description: 'Clients, billing, contracts and value-added services.',
    articles: [
      {
        id: 'clients',
        title: 'Add a client',
        summary: 'Create a 3PL client with its warehouses and settings.',
        contexts: ['/clients'],
        steps: [
          'Open Clients and choose New client.',
          'Set the code, name, address and the warehouses it uses.',
          'Give users access to the client from Settings › Users.',
        ],
        links: [
          { label: 'Clients', href: '/clients' },
          { label: 'Users', href: '/settings/users' },
        ],
      },
      {
        id: 'billing',
        title: 'Bill a client',
        summary: 'Contracts, billing reports and VAS charges.',
        contexts: ['/billing'],
        steps: [
          'Create a billing contract with storage, handling and VAS rates.',
          'Billing reports collect the activity for a period.',
          'Review, then approve and export the invoice lines.',
        ],
        links: [
          { label: 'Billing', href: '/billing' },
          { label: 'Billing reports', href: '/billing/reports' },
        ],
      },
    ],
  },
  {
    key: 'setup',
    title: 'Setup',
    description: 'Warehouses, locations, data setup, printouts and screen configuration.',
    articles: [
      {
        id: 'setup-guide',
        title: 'Use the setup guide',
        summary: 'The dashboard checklist that walks a new install through setup in the right order.',
        contexts: ['/dashboard'],
        steps: [
          'The "Get set up" panel on the Dashboard lists the five first-run steps in operational order: warehouse → locations → client → products → first order.',
          'Steps complete themselves from live data — create a warehouse anywhere and the step is checked off; a skipped step is still checked off once the data exists.',
          'Later steps stay locked until what they depend on is done or skipped (products need a client, orders need products) — skipping a step unlocks the ones after it.',
          'Admins can skip a step with its inline Skip button (undo any time) or dismiss the whole guide from the panel menu; the dashboard then looks exactly as before.',
        ],
        links: [
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Warehouses', href: '/settings/warehouses' },
        ],
      },
      {
        id: 'locations',
        title: 'Set up locations and zones',
        summary: 'Create locations in bulk and group them into zones.',
        contexts: ['/locations', '/settings/data-setup'],
        steps: [
          'Create zones in Settings › Data Setup › Location Zone, then match them with product groups for putaway.',
          'Create locations one by one or import them from Excel.',
          'Set the location type, pick sequence and capacity.',
        ],
        links: [
          { label: 'Locations', href: '/locations' },
          { label: 'Location zones', href: '/settings/data-setup/location-zone' },
        ],
      },
      {
        id: 'printouts',
        title: 'Design a printout',
        summary: 'Packing lists, pick lists and labels with the designer.',
        contexts: ['/settings/printouts'],
        steps: [
          'Open Settings › Printouts and choose the printout type.',
          'Choose Add new and pick a base template, including retailer-compliant packing lists.',
          'Arrange sections and blocks in the designer and check the live preview against a real order.',
          'Give clients access and set the template as the default.',
        ],
        links: [{ label: 'Printouts', href: '/settings/printouts' }],
      },
      {
        id: 'direct-print',
        title: 'Set up Direct Print',
        summary: 'Send labels and documents straight to a printer per warehouse.',
        contexts: ['/settings/printouts', '/packing-station'],
        steps: [
          'Open the Printers icon in the header and choose the warehouse you work in.',
          "Pick your barcode (thermal) printer and your laser printer. Type a name to add one that isn't listed yet.",
          'Until the Direct Print agent is installed on the workstation, printouts open in the browser print dialog with the right paper size.',
          "Zebra printers: use ZPL label templates in Printouts. The designer's ZPL tab shows the exact code sent to port 9100.",
          'Install the Direct Print agent: Printers › Download agent saves kitstak-print-agent.mjs. Run it with Node.js 18+ (node kitstak-print-agent.mjs); it listens on 127.0.0.1:9101 and only accepts this KitStak site.',
          'With the agent running, the Printers popover shows Connected and Test label prints a ZPL test label. Network Zebra printers can be entered as IP:9100; other printers use their operating-system name.',
        ],
        links: [{ label: 'Printouts', href: '/settings/printouts' }],
      },
      {
        id: 'data-setup',
        title: 'Configure data setup',
        summary: 'Lookups such as order types, reasons, merge rules and code generation.',
        contexts: ['/settings/data-setup'],
        steps: [
          'Data Setup holds the values that drop-downs across the app use.',
          'Inactive values are hidden from drop-downs but kept on existing records.',
          'Every change is in the change log of the value.',
        ],
        links: [{ label: 'Data Setup', href: '/settings/data-setup/code-generation' }],
      },
    ],
  },
  {
    key: 'release-notes',
    title: 'Release Notes',
    description: 'What changed in each KitStak release.',
    articles: [],
  },
  {
    key: 'account-management',
    title: 'Account Management',
    description: 'Users, roles, permissions, your profile, passwords and privacy.',
    articles: [
      {
        id: 'users-roles',
        title: 'Add users and roles',
        summary: 'Give people the right access to warehouses and clients.',
        contexts: ['/settings/users', '/settings/roles'],
        steps: [
          'Create roles in Settings › Roles. Any action on a page also grants its View permission.',
          'Add the user, assign roles, warehouses and clients.',
          'Deactivating a user signs them out on every device.',
        ],
        links: [
          { label: 'Users', href: '/settings/users' },
          { label: 'Roles', href: '/settings/roles' },
        ],
      },
      {
        id: 'profile',
        title: 'Your profile and preferences',
        summary: 'Name, email, password, date and number formats.',
        contexts: ['/account'],
        steps: [
          'My Profile changes your name and email. Changing the email needs your current password.',
          'Change Password signs out every other device.',
          'Preferences set the date, time and number formats used in every grid.',
        ],
        links: [
          { label: 'My profile', href: '/account/profile' },
          { label: 'Preferences', href: '/account/preferences' },
        ],
      },
      {
        id: 'privacy',
        title: 'Privacy policy',
        summary: 'What KitStak stores about you and why.',
        steps: [
          'KitStak stores your name, email, role assignments and sign-in history to run and secure your account.',
          'Security events such as sign-ins and permission denials are kept in the audit log for administrators.',
          'Feedback you send from the Help panel is stored with the page it was sent from. Screen recordings stay on your device unless you attach them to an email.',
          'Ask your administrator or support@kitstak.io to export or delete your personal data.',
        ],
      },
    ],
  },
];

/** Articles whose `contexts` match `pathname` (longest prefix first), at most `limit`. PURE. */
export function articlesForPath(
  pathname: string,
  limit = 3,
  categories: readonly HelpCategory[] = HELP_CATEGORIES,
): HelpArticle[] {
  const scored: { article: HelpArticle; score: number }[] = [];
  for (const c of categories)
    for (const a of c.articles) {
      const best = Math.max(
        -1,
        ...(a.contexts ?? [])
          .filter((p) => pathname === p || pathname.startsWith(`${p}/`))
          .map((p) => p.length),
      );
      if (best >= 0) scored.push({ article: a, score: best });
    }
  return scored
    .sort((x, y) => y.score - x.score)
    .slice(0, limit)
    .map((s) => s.article);
}

/** Case-insensitive search over category titles, article titles, summaries and steps. PURE. */
export function searchHelp(
  query: string,
  categories: readonly HelpCategory[] = HELP_CATEGORIES,
): HelpArticle[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return categories.flatMap((c) =>
    c.articles.filter((a) =>
      [c.title, a.title, a.summary, ...a.steps].some((t) => t.toLowerCase().includes(q)),
    ),
  );
}
