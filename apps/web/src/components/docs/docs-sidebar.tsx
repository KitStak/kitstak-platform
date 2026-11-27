import Link from 'next/link';
import type { DocApp } from '@/lib/docs/docs';
import { docApps } from '@/lib/docs/docs';
import { DocsSearch } from './docs-search';
import styles from './docs.module.css';

const FOLD_ON_PHONE =
  "(function(s){var d=s&&s.previousElementSibling;if(d&&window.matchMedia('(max-width: 960px)').matches)d.open=false})(document.currentScript)";

interface Props {
  readonly app: DocApp;
  /** The slug of the open page, or null on the app overview. */
  readonly current: string | null;
}

/**
 * The docs sidebar: search, the app switcher and every page of the open app by section. On a phone
 * it folds into one "Browse" disclosure above the page.
 */
export function DocsSidebar({ app, current }: Props) {
  const currentSection = app.pages.find((p) => p.slug === current)?.section;
  return (
    <aside className={styles.sidebar} aria-label={`${app.title} docs`}>
      <details className={styles.sidebarFold} open suppressHydrationWarning>
        <summary className={styles.sidebarSummary}>Browse {app.title} docs</summary>
        <div className={styles.sidebarInner}>
          <DocsSearch />
          <nav aria-label="Docs apps" className={styles.appSwitch}>
            {docApps().map((a) => (
              <Link key={a.id} href={a.path} aria-current={a.id === app.id ? 'true' : undefined}>
                {a.title}
              </Link>
            ))}
          </nav>
          <nav aria-label={`${app.title} pages`}>
            <Link
              href={app.path}
              className={styles.overviewLink}
              aria-current={current === null ? 'page' : undefined}
            >
              Overview
            </Link>
            {app.sections.map((section) => (
              <details
                key={section.title}
                className={styles.navSection}
                open={current === null || section.title === currentSection}
              >
                <summary>{section.title}</summary>
                <ul>
                  {section.pages.map((page) => (
                    <li key={page.slug}>
                      <Link href={page.path} aria-current={page.slug === current ? 'page' : undefined}>
                        {page.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </nav>
        </div>
      </details>
      {/* Static string: on a phone the page list starts folded, before first paint. */}
      <script dangerouslySetInnerHTML={{ __html: FOLD_ON_PHONE }} />
    </aside>
  );
}
