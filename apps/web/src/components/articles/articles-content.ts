/**
 * The articles on kitstak.com/articles. Plain data, rendered by `article-body.tsx` into static HTML.
 *
 * Rules for the words:
 * - Any claim about a KitStak app must already be true on that app's product page. No roadmap.
 * - No price, percent or trial length is written here. Link to /pricing instead.
 * - Plain words and short sentences. No em dash and no double dash.
 * - Inline links use `[text](/path)`. Bold uses `**text**`.
 */

export type ArticleBlock =
  | { readonly type: 'p'; readonly text: string }
  | { readonly type: 'h2'; readonly text: string }
  | { readonly type: 'h3'; readonly text: string }
  | { readonly type: 'ul'; readonly items: readonly string[] }
  | { readonly type: 'ol'; readonly items: readonly string[] }
  | { readonly type: 'callout'; readonly title: string; readonly text: string }
  | {
      readonly type: 'table';
      readonly head: readonly string[];
      readonly rows: readonly (readonly string[])[];
    };

export type ArticleCategory = 'Warehouse' | '3PL' | 'Profit' | 'Operations' | 'Switching';

export interface Article {
  readonly slug: string;
  readonly title: string;
  /** The search snippet and the card text. About 150 characters. */
  readonly description: string;
  /** A short line for the social card. 40 characters or fewer reads best. */
  readonly ogLine: string;
  readonly category: ArticleCategory;
  /** ISO dates. */
  readonly published: string;
  readonly updated: string;
  readonly blocks: readonly ArticleBlock[];
  /** Where the closing call to action points. */
  readonly cta: {
    readonly title: string;
    readonly body: string;
    readonly href: string;
    readonly label: string;
  };
}

export const ARTICLES: readonly Article[] = [
  {
    slug: 'warehouse-location-codes',
    title: 'Warehouse location codes: a naming system your pickers can read',
    description:
      'How to name aisles, bays and shelves so a new picker finds O905 on day one. A simple code, real examples and the mistakes that cost you later.',
    ogLine: 'Location codes that read themselves.',
    category: 'Warehouse',
    published: '2026-11-25',
    updated: '2026-11-25',
    blocks: [
      {
        type: 'p',
        text: 'Every warehouse has a map. In the good ones, the map is written on the shelves. A picker reads a code like **O905** and walks straight to it without asking anyone. In the rest, stock lives in "the back corner" and "the shelf by the dock", and only two people know where anything is.',
      },
      {
        type: 'p',
        text: 'A location code is the cheapest fix in the building. It costs a label printer and an afternoon. Done well, it cuts training time, stops mis-picks and makes cycle counts possible. This guide shows a code that works, using the layout from a real fulfillment floor.',
      },
      { type: 'h2', text: 'The code: aisle, column, level' },
      {
        type: 'p',
        text: 'The simplest code that scales has three parts, read in the order a person walks: the aisle, then the column along it, then the level from the floor up.',
      },
      {
        type: 'table',
        head: ['Code', 'Aisle', 'Column', 'Level', 'Read it as'],
        rows: [
          ['O905', 'O', '9', '5', 'Aisle O, ninth column, fifth shelf up'],
          ['T1001', 'T', '10', '01', 'Aisle T, tenth column, bottom shelf'],
          ['A0102', 'A', '01', '02', 'Aisle A, first column, second shelf'],
        ],
      },
      {
        type: 'p',
        text: 'The letter tells you where to turn. The numbers tell you how far to walk and how high to reach. Nobody needs to memorize anything.',
      },
      { type: 'h2', text: 'Rules that keep the code honest' },
      {
        type: 'ol',
        items: [
          '**Fix the width.** If any aisle will ever reach ten columns, use two digits for every column: A01, not A1. Sorting then matches walking order, in your system and on a printed pick list.',
          '**Count from the same end.** Column 01 is always at the same end of every aisle, the end nearest the main walkway. Pickers stop guessing which way to face.',
          '**Count levels from the floor.** Level 01 is the bottom shelf. A new rack on top becomes the next number, and nothing below it changes.',
          '**Leave gaps on purpose.** Skip a letter between zones you might grow. Adding an aisle later should never mean relabeling the whole building.',
          '**One code, one place.** A code never moves. If a shelf is removed, retire its code. Reusing it hides old stock in the history.',
        ],
      },
      { type: 'h2', text: 'Name the places that are not shelves' },
      {
        type: 'p',
        text: 'Stock spends time in places that are not storage. Give those places codes too, so the system always knows where a unit is, even when it is between jobs. The floor this guide is drawn from uses short, obvious names:',
      },
      {
        type: 'ul',
        items: [
          '**R01 to R03** for the receiving doors, where new stock lands before putaway.',
          '**PS1 to PS4** for the packing stations.',
          '**RTS** for returns waiting to be inspected and restocked.',
          '**QC HOLD** for stock that cannot ship until someone checks it.',
          '**Shipping A to G** for staged outbound orders, sorted by carrier or by wave.',
        ],
      },
      {
        type: 'callout',
        title: 'Why a hold location matters',
        text: 'When damaged or doubtful stock has a named home, it stays visible and out of the pickable count. When it does not, it sits on a pick face and ships to a customer.',
      },
      { type: 'h2', text: 'Carts and totes get codes too' },
      {
        type: 'p',
        text: 'If your pickers use carts, number the carts and the bins on them. A cart of 24 bins laid out as 4 levels by 6 columns lets a picker fill many orders in one walk. Each bin is a location for a few minutes, and the system should treat it like one.',
      },
      { type: 'h2', text: 'Print, label, then count' },
      {
        type: 'p',
        text: 'Once the codes are on paper, print labels with a barcode and the code in large type. Put them at eye level for the level they mark, not on the upright. Then run a count, one aisle at a time, so the system and the shelves agree before you start picking by location.',
      },
      {
        type: 'p',
        text: 'In [KitStak WMS](/wms#inventory) you can generate a rack layout from a pattern like this, print the labels and lock a bin when you need to. Receiving suggests a putaway location, and picks are ordered by walking distance, so the code you chose turns straight into shorter walks.',
      },
    ],
    cta: {
      title: 'Map your floor in KitStak WMS.',
      body: 'Locations, labels, counts and walk-ordered picks on one stack.',
      href: '/wms',
      label: 'See KitStak WMS',
    },
  },
  {
    slug: '3pl-billing-guide',
    title: '3PL billing: how to charge for storage, picks and extra services',
    description:
      'A plain guide to 3PL pricing: storage by daily, peak or average quantity, pick and pack fees, minimums, tiers and the extra work you forget to bill.',
    ogLine: 'Bill for the work you actually do.',
    category: '3PL',
    published: '2026-11-25',
    updated: '2026-11-25',
    blocks: [
      {
        type: 'p',
        text: 'Most third party logistics warehouses do not lose money on the big jobs. They lose it on the small ones nobody wrote down: the relabel, the kit built by hand, the pallet that sat an extra week. Good 3PL billing is simple to read for the client and complete for you.',
      },
      { type: 'h2', text: 'The five things every 3PL bills for' },
      {
        type: 'table',
        head: ['Charge', 'Usually billed by', 'Watch for'],
        rows: [
          [
            'Receiving',
            'Per carton, pallet, unit or hour',
            'Unsorted or unlabeled freight that takes three times as long',
          ],
          ['Storage', 'Per pallet, bin, cubic foot or unit', 'How you measure a month that starts mid-way'],
          ['Pick and pack', 'Per order plus per extra unit', 'Inserts, gift notes and special packaging'],
          [
            'Shipping',
            'Carrier cost plus a margin or a fee',
            'Address corrections and residential surcharges',
          ],
          ['Returns', 'Per return, plus disposition', 'Inspection time and restock labor'],
        ],
      },
      {
        type: 'p',
        text: 'Then there is everything else: kitting, relabeling, photos, special projects. These are value-added services, and they are where your margin lives or dies.',
      },
      { type: 'h2', text: 'Storage: pick a measure and say it out loud' },
      {
        type: 'p',
        text: 'Storage causes more billing disputes than anything else, because "how much did they store" has more than one answer. There are three common ways to count it:',
      },
      {
        type: 'ul',
        items: [
          '**Daily quantity.** Charge for what was on hand each day. It is the fairest and the most work to calculate without software.',
          '**Peak quantity.** Charge for the most that was on hand during the period. Simple, and it rewards clients who keep stock lean.',
          '**Average quantity.** Charge for the average across the period. A middle path that smooths out a single big delivery.',
        ],
      },
      {
        type: 'p',
        text: 'Whichever you choose, write it in the contract and say how a split month works. A client who moves in on the 20th should know before the first bill whether they pay for ten days or thirty.',
      },
      { type: 'h2', text: 'Tiers and minimums' },
      {
        type: 'p',
        text: 'Graduated tiers let a fee fall as volume grows, so a client sees a reason to send you more. A monthly minimum protects you from the client who takes a rack and ships twelve orders. Use both, and make the tiers easy to explain on one line of an invoice.',
      },
      {
        type: 'callout',
        title: 'A rule of thumb',
        text: 'If you cannot explain a charge in one sentence on the invoice, the client will call you about it. Every call costs more than the line was worth.',
      },
      { type: 'h2', text: 'Bill from the work, not from memory' },
      {
        type: 'p',
        text: 'The best 3PL bill is built from the same records your floor already makes. When a receipt, a pick, a return or a work order is scanned, the charge should be counted then, not rebuilt at month end from a spreadsheet. That is how small jobs stop slipping through.',
      },
      {
        type: 'ol',
        items: [
          'Set a rate card per client, with the measure for each charge.',
          'Let the floor record work as it happens: receipts, picks, packs, returns and work orders.',
          'Run the billing period on a schedule, so every client is billed the same way each month.',
          'Hold each bill for approval. A person checks it before it goes out.',
          'Look at profit by client and by service, so you know which rates to raise.',
        ],
      },
      {
        type: 'p',
        text: '[KitStak WMS](/wms#clients) bills for receiving, storage, pick and pack, shipments, returns, work orders and value-added services. Storage can be billed by daily, peak or average quantity with split months, with graduated tiers, charge-if conditions and a minimum or maximum per bill. Bills wait for sign-off before they go out. To see which clients and services make money after labor, add [KitStak Pulse](/pulse).',
      },
    ],
    cta: {
      title: 'Bill every client from the floor.',
      body: 'Client billing is part of KitStak WMS. Nothing extra to buy.',
      href: '/wms#clients',
      label: 'See client billing',
    },
  },
  {
    slug: 'profit-by-job',
    title: 'Profit by job: why your monthly P&L hides your losing work',
    description:
      'A profitable month can hide jobs that lose money. How to measure profit per job and per client, what costs to count, and the signs a job is at risk.',
    ogLine: 'Find the jobs that lose money.',
    category: 'Profit',
    published: '2026-11-25',
    updated: '2026-11-25',
    blocks: [
      {
        type: 'p',
        text: 'Your accountant tells you whether the month made money. That is useful, and it is not enough. A good month can be three great jobs paying for two bad ones. If you never see the bad ones, you quote them again next month at the same price.',
      },
      { type: 'h2', text: 'What a job really costs' },
      {
        type: 'p',
        text: 'Revenue is the easy half. It is on the invoice. Cost is spread across your floor, your time sheets and your supplier bills. To see profit by job, every cost needs a home:',
      },
      {
        type: 'ul',
        items: [
          '**Labor.** Hours worked on the job, at the rate for the person who did them. A packer and a line lead cost different amounts.',
          '**Materials.** Boxes, labels, inserts, components and anything else that leaves with the order.',
          '**Shipping and outside services.** Carrier costs and anything you paid someone else to do.',
          '**Time not on a job.** Training, cleaning and waiting for a truck. It is real cost, and it has to be shared out fairly or it hides.',
        ],
      },
      {
        type: 'callout',
        title: 'The hidden cost is usually labor',
        text: 'Materials show up on a bill. Labor shows up as a feeling that the team was busy. Logging hours against jobs, even roughly, is the single biggest step toward knowing your margins.',
      },
      { type: 'h2', text: 'Quote vs actual' },
      {
        type: 'p',
        text: 'Every job starts as a guess. The quote says how many units, how many hours and what it will cost. Comparing the quote to what really happened, line by line, tells you two things: which jobs went wrong, and which of your quoting habits are wrong every time.',
      },
      {
        type: 'p',
        text: 'If kitting jobs always take a third longer than quoted, the problem is not the team. It is the quote. Fix the rate, and every future job of that type gets better.',
      },
      { type: 'h2', text: 'Signs a job is at risk' },
      {
        type: 'ol',
        items: [
          'Hours are running ahead of units done.',
          'Extra services keep appearing that were not in the quote.',
          'The client changed the spec after the work started.',
          'Materials cost more than they did when you priced the job.',
          'Nobody has logged time on it for days, so you cannot tell.',
        ],
      },
      {
        type: 'p',
        text: 'The last one matters most. A job with no data is not a safe job. It is a job you cannot see.',
      },
      { type: 'h2', text: 'Look by client and by service too' },
      {
        type: 'p',
        text: 'Once each job has a profit, roll it up. Profit by client tells you who to keep, who to reprice and who to let go. Profit by extra service tells you which add-ons are worth selling and which ones only feel busy.',
      },
      {
        type: 'p',
        text: '[KitStak Pulse](/pulse) shows profit by job, client and extra service. You log work, compare quote vs actual and see which jobs are at risk. Pulse works on its own. Add the [WMS](/wms) or the [CRM](/crm) and Pulse pulls in what they know, with one sign-in.',
      },
    ],
    cta: {
      title: 'See the profit on every job.',
      body: 'Pulse shows which jobs, clients and services make money.',
      href: '/pulse',
      label: 'See KitStak Pulse',
    },
  },
  {
    slug: 'cycle-counting',
    title: 'Cycle counts vs. a full physical inventory: which one, and how often',
    description:
      'Why most warehouses should count a little every day instead of shutting down once a year. Cycle, blind and SKU counts explained, with a simple schedule.',
    ogLine: 'Count a little. Every day.',
    category: 'Warehouse',
    published: '2026-11-25',
    updated: '2026-11-25',
    blocks: [
      {
        type: 'p',
        text: 'A full physical inventory means closing the doors, counting everything and hoping the numbers match. It takes a day or a weekend, it stops shipping and it tells you what was wrong months ago. Cycle counting replaces it with a small count every day, so mistakes are found while they are still easy to fix.',
      },
      { type: 'h2', text: 'The kinds of count' },
      {
        type: 'table',
        head: ['Count', 'What it is', 'Use it for'],
        rows: [
          [
            'Cycle count',
            'A planned count of a few locations each day',
            'Keeping the whole building accurate over time',
          ],
          [
            'Blind count',
            'The counter does not see the expected quantity',
            'Honest counts, with no temptation to match the screen',
          ],
          [
            'Instant count',
            'A count started on the spot, at one location',
            'A picker who finds a shelf that looks wrong',
          ],
          [
            'SKU count',
            'Every location holding one product',
            'A product with a known problem, or before a big order',
          ],
        ],
      },
      { type: 'h2', text: 'What to count first' },
      {
        type: 'p',
        text: 'Not every location deserves the same attention. Count the fast movers and the high value products more often. They change the most, and an error there costs the most. Slow, cheap stock can wait.',
      },
      {
        type: 'ul',
        items: [
          '**Fast movers:** count every few weeks.',
          '**High value or high risk:** count every few weeks, always blind.',
          '**Everything else:** at least once a quarter.',
          '**Any location a picker flags:** right away, with an instant count.',
        ],
      },
      { type: 'h2', text: 'Recounts and variance' },
      {
        type: 'p',
        text: 'A count that does not match is a question, not an answer. Before you adjust stock, recount. Have a different person do it if you can. If the second count agrees with the first, adjust and write down why. If it does not, count again.',
      },
      {
        type: 'callout',
        title: 'Find the cause, not just the number',
        text: 'If the same location is wrong twice, look at how stock gets there. Most errors start at receiving or putaway, not at the shelf.',
      },
      { type: 'h2', text: 'When a full inventory still makes sense' },
      {
        type: 'p',
        text: 'Some auditors and lenders want a full count once a year. Some businesses are small enough that a full count takes an hour. If either is you, do it. For everyone else, a steady cycle count program gives better numbers with no shutdown.',
      },
      {
        type: 'p',
        text: '[KitStak WMS](/wms#inventory) runs cycle, blind, instant and SKU counts, with recounts and variance. Every count is tied to a location, so the [code on the shelf](/articles/warehouse-location-codes) is the code on the count sheet.',
      },
    ],
    cta: {
      title: 'Count without closing the doors.',
      body: 'Four kinds of count, recounts and variance in KitStak WMS.',
      href: '/wms#inventory',
      label: 'See inventory in the WMS',
    },
  },
  {
    slug: 'one-stack-vs-many-tools',
    title: 'One stack or five tools: what disconnected ops software really costs',
    description:
      'A CRM here, a WMS there, projects in a third app. The real cost of disconnected tools is the copying, the missed handoffs and the questions nobody can answer.',
    ogLine: 'One stack beats five logins.',
    category: 'Operations',
    published: '2026-11-25',
    updated: '2026-11-25',
    blocks: [
      {
        type: 'p',
        text: 'Most operations teams build their software one problem at a time. A CRM when sales gets busy. A WMS when the warehouse outgrows spreadsheets. A project tool when the client work piles up. Each one is fine on its own. Together they leave gaps that people fill by hand.',
      },
      { type: 'h2', text: 'Where the cost shows up' },
      {
        type: 'ul',
        items: [
          '**Copying.** A deal is won in the CRM, then someone types the client into the WMS and again into the project tool.',
          '**Handoffs.** Sales promised a ship date. The warehouse never saw it.',
          '**Questions nobody can answer.** "Is this client profitable?" needs the deal, the work orders and the hours, and they live in three places.',
          '**Logins and seats.** Every tool has its own users, its own permissions and its own bill.',
          '**Integrations that break.** A sync between two vendors is a third product, and nobody owns it.',
        ],
      },
      { type: 'h2', text: 'A real example' },
      {
        type: 'p',
        text: 'Team 1 ran its client work in monday.com and its warehouse in Logiwa. Two good tools, with nothing between them. A project board did not know an order had shipped, and the warehouse did not know which client tasks were waiting on it. [Read how Team 1 moved to one stack](/customers/team-1).',
      },
      { type: 'h2', text: 'What "one stack" should mean' },
      {
        type: 'p',
        text: 'Plenty of vendors sell a suite. Check that it is really one system and not four products with a shared logo:',
      },
      {
        type: 'ol',
        items: [
          '**One sign-in** for every app, with one set of users and roles.',
          '**One database,** so a client is the same record in sales, the warehouse and projects.',
          '**Links between records,** so a task can point at the deal or the order it is for.',
          '**Buy only what you use.** You should not pay for the warehouse app if you do not have a warehouse.',
        ],
      },
      {
        type: 'callout',
        title: 'Start with one app if you like',
        text: 'One stack does not mean switching everything on day one. Start with the app that hurts most, then add the next one when you are ready.',
      },
      {
        type: 'p',
        text: 'KitStak runs the [CRM](/crm), the [WMS](/wms), [Projects](/projects) and [Pulse](/pulse) on one database and one sign-in. Use one, two or all four. Two or more take the bundle discount, shown on [pricing](/pricing).',
      },
    ],
    cta: {
      title: 'Run your operation on one stack.',
      body: 'Pick the apps you need. Add the rest when you are ready.',
      href: '/products',
      label: 'Compare the apps',
    },
  },
  {
    slug: 'moving-off-monday-com',
    title: 'Moving your CRM off monday.com: a checklist from a real migration',
    description:
      'What to map, what to keep and what to leave behind when you move boards off monday.com. Lessons from moving 28 boards and 210 items in one day.',
    ogLine: '28 boards moved in one day.',
    category: 'Switching',
    published: '2026-11-25',
    updated: '2026-11-25',
    blocks: [
      {
        type: 'p',
        text: 'On November 12, 2026, Team 1 moved its work off monday.com and into KitStak CRM. It was 28 boards and 210 items, for a team of seven. This checklist is what we learned doing it. It applies to most CRM moves, whatever tool you land on.',
      },
      { type: 'h2', text: '1. List what you have' },
      {
        type: 'p',
        text: 'Before you move anything, count it. Team 1 had two workspaces: one of 22 client boards, and one of 6 project boards. Knowing the shape up front makes it easy to check nothing was lost.',
      },
      {
        type: 'ul',
        items: [
          'Workspaces and folders',
          'Boards in each, with their groups',
          'Items and subitems on each board',
          'Columns, and the labels on every status column',
          'The people who use each board, and what they can do',
        ],
      },
      { type: 'h2', text: '2. Decide what not to move' },
      {
        type: 'p',
        text: 'A move is the best chance you will get to clean house. Team 1 left behind a sandbox workspace that held copies, not real work. Be just as strict with your own.',
      },
      {
        type: 'p',
        text: 'Some things do not carry well between tools, and it is better to decide that on purpose than to discover it later. Team 1 chose not to move file attachments, comment threads, automations or custom views. Automations and views are worth rebuilding in the new tool anyway, because they encode how you work, and that usually changed since you set them up.',
      },
      { type: 'h2', text: '3. Map your people first' },
      {
        type: 'p',
        text: 'Every person column, owner and assignee points at a user. Create the users in the new system before you load a single item, and map each old account to the new one. Then decide roles. Team 1 had one owner, one admin, one member and four viewers.',
      },
      {
        type: 'callout',
        title: 'Leave the bots out',
        text: 'If your old tool has AI agent or automation accounts, do not turn them into people. They inflate seat counts and confuse every "assigned to me" view.',
      },
      { type: 'h2', text: '4. Keep your status labels exactly' },
      {
        type: 'p',
        text: 'Status labels are the language your team uses every day. "Waiting on client" should still say "Waiting on client" the next morning, in the same color. Team 1 kept every status label, and kept the old label IDs alongside, so each item landed in the status it left.',
      },
      { type: 'h2', text: '5. Move in a way you can run twice' },
      {
        type: 'p',
        text: 'Your first run will not be your last. Make the import safe to repeat: if a board already exists, skip it. Then you can move a few boards, check them with the team, fix the mapping and run again without making duplicates.',
      },
      { type: 'h2', text: '6. Check with the people who use it' },
      {
        type: 'ol',
        items: [
          'Count boards and items on both sides. The numbers must match.',
          'Open five items people know well and check every field.',
          'Have each person open their own work and confirm it is all there.',
          'Rebuild the two or three automations the team cannot live without.',
          'Keep the old tool read only for a few weeks, in case someone needs to look something up.',
        ],
      },
      {
        type: 'p',
        text: 'Thinking about a move to [KitStak CRM](/crm)? [Talk to the founder](/contact?topic=founder) about your boards before you start. It is the same founder who ran this one.',
      },
    ],
    cta: {
      title: 'Bring your boards to KitStak CRM.',
      body: 'Boards, automations and dashboards your team shapes.',
      href: '/crm',
      label: 'See KitStak CRM',
    },
  },
];

export function articleBySlug(slug: string): Article | undefined {
  return ARTICLES.find((article) => article.slug === slug);
}

/** Every word a reader sees in the body, for the word count and reading time. */
export function articleText(article: Article): string {
  return article.blocks
    .map((block) => {
      switch (block.type) {
        case 'ul':
        case 'ol':
          return block.items.join(' ');
        case 'callout':
          return `${block.title} ${block.text}`;
        case 'table':
          return [...block.head, ...block.rows.flat()].join(' ');
        default:
          return block.text;
      }
    })
    .join(' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*/g, '');
}

export function wordCount(article: Article): number {
  return articleText(article).split(/\s+/).filter(Boolean).length;
}

/** Minutes to read at about 220 words a minute. Never less than one. */
export function readingMinutes(article: Article): number {
  return Math.max(1, Math.round(wordCount(article) / 220));
}

/** "November 25, 2026" */
export function formatArticleDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}
