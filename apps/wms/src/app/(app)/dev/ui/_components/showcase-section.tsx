import * as React from 'react';

export const SHOWCASE_SECTIONS = [
  { key: 'display', label: 'Display' },
  { key: 'inputs', label: 'Inputs' },
  { key: 'overlays', label: 'Overlays & menus' },
  { key: 'navigation', label: 'Tabs & navigation' },
  { key: 'forms', label: 'Forms' },
  { key: 'wizard', label: 'Wizard' },
  { key: 'grid', label: 'Data grid' },
] as const;

export type ShowcaseKey = (typeof SHOWCASE_SECTIONS)[number]['key'];

/** One titled block of the /dev/ui showcase with an anchor id. */
export function ShowcaseSection({
  id,
  title,
  description,
  children,
}: {
  readonly id: ShowcaseKey;
  readonly title: string;
  readonly description?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="scroll-mt-[72px] rounded-xl border border-border bg-surface p-5 shadow-xs"
    >
      <h2 id={`${id}-title`} className="text-md font-semibold text-foreground">
        {title}
      </h2>
      {description ? <p className="mt-0.5 text-xs text-secondary">{description}</p> : null}
      <div className="mt-4 space-y-5">{children}</div>
    </section>
  );
}

export function Specimen({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-2 text-2xs font-bold text-faint">{label}</p>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}
