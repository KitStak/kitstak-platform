import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { breadcrumbsFor } from "@/config/route-registry";
import { getImportDefinition, summarizeImport } from "@/server/imports";
import { requirePagePermission } from "@/server/auth/permissions";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { ImportPage } from "@/components/shared/import-page";
import { Callout } from "@/components/ui/callout";

type Params = Promise<{ key: string }>;

export const metadata: Metadata = { title: "Import" };

async function ImportRoute({ params }: { readonly params: Params }) {
  const { key } = await params;
  const def = getImportDefinition(key);
  if (!def) notFound();
  await requirePagePermission(def.permission, `/imports/${encodeURIComponent(key)}`);
  const summary = summarizeImport(def);
  const parentCrumbs = breadcrumbsFor(summary.backHref).map((crumb, i, all) => (i === all.length - 1 ? { label: crumb.label, href: summary.backHref } : crumb));
  return (
    <>
      <Breadcrumbs items={[...parentCrumbs, { label: summary.title }]} className="px-6 pt-3" />
      {summary.configured ? null : (
        <div className="px-6 pt-3">
          <Callout variant="attention" title="Not configured yet">
            You can download the template now. Uploads are refused until the owning module ships this import&apos;s handler.
          </Callout>
        </div>
      )}
      <ImportPage importKey={summary.key} title={summary.title} description={summary.description} backHref={summary.backHref} backLabel={summary.backLabel} />
    </>
  );
}

/** `/imports/<key>` — shared import template page (F4 page + module handler). */
export default function ImportKeyPage({ params }: { readonly params: Params }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ImportRoute params={params} />
    </Suspense>
  );
}
