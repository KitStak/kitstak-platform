# KitStak docs: how to write a page

Every file here becomes a page at `kitstak.com/docs/<app>/<slug>`. The site reads these files at build
time, so a new file is live on the next deploy and joins the sitemap on its own.

```
content/docs/
  getting-started/   Portal, sign-up, apps, billing, account basics
  crm/
  wms/
  projects/
  pulse/
  crew/              Planned app, not available yet (see "Planned apps" below)
  ledger/            Planned app, not available yet (see "Planned apps" below)
```

Each app folder has one `_meta.json` and any number of `<slug>.md` pages.

## `_meta.json`

```json
{
  "title": "KitStak WMS",
  "description": "One sentence on what the app does.",
  "sections": ["Get started", "Inbound", "Inventory", "Outbound"]
}
```

`sections` is the order of the groups in the sidebar. Every page's `section` must be one of them.

## Page file

The file name is the slug: lowercase words joined by hyphens (`receiving-purchase-orders.md`). It never
changes once published, because Google indexes the address.

```markdown
---
title: Receive a purchase order
description: Scan a PO, its items and a location to receive stock line by line or in bulk.
section: Inbound
order: 20
---

Opening paragraph: what this is and when you use it. Two to four sentences.

## Before you start

- What must exist first, with links.

## Receive line by line

1. Go to **Inbound > Purchase Orders**.
2. Open the PO and select **Receive**.
```

Front matter, all required:

| Key | Rule |
| --- | --- |
| `title` | Sentence case, 70 characters or fewer. Unique in the app. |
| `description` | One sentence, 80 to 160 characters. Becomes the Google snippet. |
| `section` | One of the `sections` in `_meta.json`. |
| `order` | A number. Pages sort by it inside their section. Use steps of 10. |

## Markdown you can use

Only this. Anything else renders as plain text.

- `## Heading` and `### Heading`. No `#` (the title is the page heading) and nothing deeper than `###`.
- Paragraphs separated by a blank line.
- Lists: `- item` or `1. item`. One level only. A list item is one line.
- Tables: a header row, a `| --- |` row, then rows. No pipes inside cells.
- Callouts: a line starting `> **Note:**`, `> **Tip:**` or `> **Important:**`, then the text on the same line.
- Code blocks fenced with three backticks, for CSV headers, codes and API paths only.
- Inline: `**bold**` for every on-screen label, button, menu and tab; `` `code` `` for codes, field keys
  and file names; `[text](/docs/wms/slug)` for links.

## What a page says

- **Only what the app does today.** Every screen, field, button, status and rule must be in the app's
  code. Use the exact words on screen, in bold: **Receive**, **Ready to Pick**. If you cannot find it in
  the code, leave it out. No roadmap, no "coming soon", no guesses. (Planned apps follow their own rule: see **Planned apps** below.)
- **No prices, percents of discount or trial lengths.** Link to `/pricing` instead.
- **Navigation as the user sees it:** **Inventory > Locations**, then the tab, then the button.
- **Plain words, short sentences.** Second person ("you"). No em dash, no en dash, no double dash.
- **No customer names or real data.** Examples use made-up values: SKU `MUG-11OZ-BLK`, location `A0102`.
- **Links:** to pages in the same app by full path (`/docs/wms/cycle-counts`), to another app only at
  its root (`/docs/crm`), and to site pages (`/pricing`, `/security`). Every link must resolve; the
  test suite checks.

## Planned apps

`crew/` and `ledger/` describe apps that are not built yet. The owner asked for their docs early, so
the "only what the app does today" rule above applies to live apps only. In a planned app's folder:

- Every page opens with this callout as the first line of the body:
  `> **Note:** Crew is planned and not available yet. This page describes how it is planned to work, and details may change before launch.`
- Describe the planned app from its `docs/<app>/REFERENCE.md` (repo root), in plain words: "Crew is
  planned to...". Nothing more than the reference says.
- No bold UI labels and no menu paths. There are no screens yet, so there are no on-screen words.
- Where the reference lists an open question, say it is still being decided. Never state it as fact.
- `_meta.json` descriptions start with "Planned:".
- When the app ships, rewrite every page against the real app's screens, drop the callout, and the
  live-app rules apply in full.

## Checks

`src/lib/docs.test.ts` fails the build if a page has a bad front matter key, an unknown section, a
duplicate title or slug, a broken internal link, a dash the house style forbids, or a dollar price.
