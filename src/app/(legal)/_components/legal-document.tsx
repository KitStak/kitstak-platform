export interface LegalSection {
  readonly heading: string;
  readonly paragraphs: readonly string[];
}

interface LegalDocumentProps {
  readonly title: string;
  readonly updated: string;
  readonly intro: string;
  readonly sections: readonly LegalSection[];
}

function anchorFor(heading: string): string {
  return heading.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

/** Long-form legal text with a linked table of contents. */
export function LegalDocument({ title, updated, intro, sections }: LegalDocumentProps) {
  return (
    <article className="rounded-xl border border-border-subtle bg-panel p-6 shadow-sm sm:p-12">
      <p className="text-xs font-semibold text-fg-muted ">Last updated {updated}</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-[-0.02em] text-fg">{title}</h1>
      <p className="mt-4 text-md leading-relaxed text-fg-secondary">{intro}</p>
      <nav aria-label="Contents" className="mt-8 rounded-lg bg-sunken p-5">
        <ol className="grid gap-1.5 text-sm sm:grid-cols-2">
          {sections.map((section, index) => (
            <li key={section.heading}>
              <a className="text-fg-link hover:underline" href={`#${anchorFor(section.heading)}`}>
                {index + 1}. {section.heading}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      {sections.map((section, index) => (
        <section key={section.heading} id={anchorFor(section.heading)} className="mt-10 scroll-mt-20">
          <h2 className="text-xl font-semibold text-fg">
            {index + 1}. {section.heading}
          </h2>
          {section.paragraphs.map((paragraph) => (
            <p key={paragraph} className="mt-3 leading-relaxed text-fg-secondary">
              {paragraph}
            </p>
          ))}
        </section>
      ))}
    </article>
  );
}
