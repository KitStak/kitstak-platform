/**
 * The docs at kitstak.com/docs. Pages are Markdown files in `content/docs/<app>/<slug>.md`, read once
 * at build time (the site is static). How to write one: content/docs/README.md.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import type { DocBlock } from './markdown';
import { parseMarkdown, plainText, splitFrontMatter } from './markdown';

/** The folders under content/docs, in the order the docs home and the app switcher show them. */
export const DOC_APP_IDS = ['getting-started', 'wms', 'crm', 'projects', 'pulse'] as const;
export type DocAppId = (typeof DOC_APP_IDS)[number];

/** The day the docs last changed. Bump it with real edits; it feeds dateModified and the sitemap. */
export const DOCS_UPDATED = '2026-11-25';

export interface DocPage {
  readonly app: DocAppId;
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly section: string;
  readonly order: number;
  readonly updated: string;
  readonly blocks: readonly DocBlock[];
  /** The h2 headings, for "On this page". */
  readonly headings: readonly { readonly id: string; readonly text: string }[];
  readonly path: string;
  readonly wordCount: number;
  readonly file: string;
}

export interface DocSection {
  readonly title: string;
  readonly pages: readonly DocPage[];
}

export interface DocApp {
  readonly id: DocAppId;
  readonly title: string;
  readonly description: string;
  readonly sections: readonly DocSection[];
  readonly pages: readonly DocPage[];
  readonly path: string;
}

export interface DocsProblem {
  readonly file: string;
  readonly problem: string;
}

export const DOCS_ROOT = path.join(process.cwd(), 'content', 'docs');

interface Meta {
  readonly title: string;
  readonly description: string;
  readonly sections: readonly string[];
}

function readMeta(app: DocAppId, problems: DocsProblem[]): Meta | null {
  const file = path.join(DOCS_ROOT, app, '_meta.json');
  if (!existsSync(file)) {
    problems.push({ file: `${app}/_meta.json`, problem: 'missing' });
    return null;
  }
  try {
    const meta = JSON.parse(readFileSync(file, 'utf8')) as Partial<Meta>;
    if (
      typeof meta.title !== 'string' ||
      typeof meta.description !== 'string' ||
      !Array.isArray(meta.sections)
    ) {
      problems.push({ file: `${app}/_meta.json`, problem: 'needs title, description and sections' });
      return null;
    }
    return { title: meta.title, description: meta.description, sections: meta.sections.map(String) };
  } catch {
    problems.push({ file: `${app}/_meta.json`, problem: 'is not valid JSON' });
    return null;
  }
}

function countWords(blocks: readonly DocBlock[]): number {
  const text = blocks
    .map((b) => {
      switch (b.type) {
        case 'ul':
        case 'ol':
          return b.items.join(' ');
        case 'table':
          return [...b.head, ...b.rows.flat()].join(' ');
        case 'code':
          return '';
        default:
          return b.text;
      }
    })
    .join(' ');
  return plainText(text).split(/\s+/).filter(Boolean).length;
}

function loadApp(app: DocAppId, problems: DocsProblem[]): DocApp | null {
  const dir = path.join(DOCS_ROOT, app);
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .sort();
  // A folder with no pages yet is not published and needs no _meta.json.
  if (files.length === 0) return null;
  const meta = readMeta(app, problems);
  if (!meta) return null;
  const pages: DocPage[] = [];
  for (const name of files) {
    const file = `${app}/${name}`;
    const slug = name.replace(/\.md$/, '');
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
      problems.push({ file, problem: 'file name must be lowercase words joined by hyphens' });
      continue;
    }
    const { data, body } = splitFrontMatter(readFileSync(path.join(dir, name), 'utf8'));
    const missing = ['title', 'description', 'section', 'order'].filter((key) => !data[key]);
    if (missing.length > 0) {
      problems.push({ file, problem: `front matter is missing ${missing.join(', ')}` });
      continue;
    }
    const section = data.section ?? '';
    if (!meta.sections.includes(section)) {
      problems.push({ file, problem: `section "${section}" is not in _meta.json` });
      continue;
    }
    const order = Number(data.order);
    const blocks = parseMarkdown(body);
    pages.push({
      app,
      slug,
      title: data.title ?? slug,
      description: data.description ?? '',
      section,
      order: Number.isFinite(order) ? order : 999,
      updated: /^\d{4}-\d{2}-\d{2}$/.test(data.updated ?? '') ? (data.updated as string) : DOCS_UPDATED,
      blocks,
      headings: blocks.flatMap((b) => (b.type === 'h2' ? [{ id: b.id, text: plainText(b.text) }] : [])),
      path: `/docs/${app}/${slug}`,
      wordCount: countWords(blocks),
      file,
    });
  }
  const sections = meta.sections
    .map((title) => ({
      title,
      pages: pages
        .filter((p) => p.section === title)
        .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title)),
    }))
    .filter((s) => s.pages.length > 0);
  return {
    id: app,
    title: meta.title,
    description: meta.description,
    sections,
    pages: sections.flatMap((s) => s.pages),
    path: `/docs/${app}`,
  };
}

interface Library {
  readonly apps: readonly DocApp[];
  readonly problems: readonly DocsProblem[];
}

let cache: Library | null = null;

/** Every app with at least one page, and anything wrong with the files. Read once per process. */
export function loadDocs(): Library {
  if (cache) return cache;
  const problems: DocsProblem[] = [];
  const apps = DOC_APP_IDS.flatMap((id) => {
    if (!existsSync(path.join(DOCS_ROOT, id))) return [];
    const app = loadApp(id, problems);
    return app && app.pages.length > 0 ? [app] : [];
  });
  cache = { apps, problems };
  return cache;
}

export function docApps(): readonly DocApp[] {
  return loadDocs().apps;
}

export function docApp(id: string): DocApp | undefined {
  return docApps().find((app) => app.id === id);
}

export function docPage(appId: string, slug: string): DocPage | undefined {
  return docApp(appId)?.pages.find((page) => page.slug === slug);
}

export function allDocPages(): readonly DocPage[] {
  return docApps().flatMap((app) => app.pages);
}

/** The page before and after, in sidebar order, within the same app. */
export function neighbors(page: DocPage): { readonly prev?: DocPage; readonly next?: DocPage } {
  const pages = docApp(page.app)?.pages ?? [];
  const index = pages.findIndex((p) => p.slug === page.slug);
  return { prev: index > 0 ? pages[index - 1] : undefined, next: index >= 0 ? pages[index + 1] : undefined };
}

export interface SearchEntry {
  readonly t: string;
  readonly d: string;
  readonly a: string;
  readonly s: string;
  readonly h: readonly string[];
  readonly u: string;
}

/** A compact index for the docs search box, served as /docs/search-index.json. */
export function searchIndex(): readonly SearchEntry[] {
  return docApps().flatMap((app) =>
    app.pages.map((page) => ({
      t: page.title,
      d: page.description,
      a: app.title,
      s: page.section,
      h: page.headings.map((h) => h.text),
      u: page.path,
    })),
  );
}
