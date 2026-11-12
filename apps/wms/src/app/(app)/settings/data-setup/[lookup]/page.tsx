import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { LookupPage } from "@/components/admin/data-setup/lookup-page";
import { EMBEDDED_LOOKUPS, lookupBySlug } from "@/lib/grid-defs/admin/lookups";
import { requirePagePermission } from "@/server/auth/permissions";

interface Props {
  readonly params: Promise<{ lookup: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lookup } = await params;
  return { title: lookupBySlug(lookup)?.title ?? "Data Setup" };
}

async function Body({ params }: Props) {
  const { lookup } = await params;
  // Return Reason is managed inside Return Process: one place per data set.
  const host = EMBEDDED_LOOKUPS[lookup];
  if (host) redirect(`/settings/data-setup/${host}`);
  const def = lookupBySlug(lookup);
  if (!def) notFound();
  await requirePagePermission("settings.data_setup.view", `/settings/data-setup/${lookup}`);
  return <LookupPage def={def} />;
}

export default function Page(props: Props) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Body {...props} />
    </Suspense>
  );
}
