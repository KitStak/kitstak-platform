import Link from 'next/link';
import { Download, Upload } from 'lucide-react';
import { ButtonLink } from '@/components/ledger/button-link';
import { DownloadLink } from '@/components/ledger/download-link';
import { routes } from '@/lib/routes';

/** Active and Archived as two links (`?show=archived`). */
export function ShowTabs({ path, archived, labels = ['Active', 'Archived'] }: { readonly path: string; readonly archived: boolean; readonly labels?: readonly [string, string] }) {
  const tabs = [
    { label: labels[0], href: path, current: !archived },
    { label: labels[1], href: `${path}${path.includes('?') ? '&' : '?'}show=archived`, current: archived },
  ];
  return (
    <nav aria-label="Views" className="flex gap-1 overflow-x-auto px-6">
      {tabs.map((tab) => (
        <Link
          key={tab.label}
          href={tab.href}
          aria-current={tab.current ? 'page' : undefined}
          className="border-b-2 border-transparent px-2 py-2 text-sm font-medium whitespace-nowrap text-fg-secondary hover:text-fg aria-[current=page]:border-primary aria-[current=page]:text-fg"
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

/** Import and export links for one setup stream (SPEC 7.1). */
export function CsvLinks({ stream, file, canImport, canExport }: { readonly stream: string; readonly file: string; readonly canImport: boolean; readonly canExport: boolean }) {
  return (
    <>
      {canImport ? (
        <ButtonLink href={routes.newImport(stream)} variant="secondary" icon={<Upload aria-hidden className="size-4" />} testId={`import-${stream}`}>
          Import
        </ButtonLink>
      ) : null}
      {canExport ? (
        <DownloadLink href={routes.exportFile(file)} icon={<Download aria-hidden className="size-4" />} testId={`export-${stream}`}>
          Export
        </DownloadLink>
      ) : null}
    </>
  );
}

/** A label and its value on a detail page. Blank values read "Not set". */
export function Fact({ label, value }: { readonly label: string; readonly value: string | null | undefined }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-medium text-fg-muted">{label}</dt>
      <dd className={value ? 'text-sm text-fg' : 'text-sm text-fg-muted'}>{value || 'Not set'}</dd>
    </div>
  );
}

export function addressText(address: { readonly line1?: string; readonly city?: string; readonly region?: string; readonly postalCode?: string; readonly country?: string } | null): string | null {
  if (!address) return null;
  const place = [address.city, [address.region, address.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const text = [address.line1, place, address.country].filter(Boolean).join(', ');
  return text || null;
}
