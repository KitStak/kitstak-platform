import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { PrintoutWizardPage } from "@/components/admin/printouts/printout-wizard";
import { getPrintType } from "@/server/print/catalog";
import { requirePagePermission } from "@/server/auth/permissions";

interface Props {
  readonly params: Promise<{ type: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { type } = await params;
  return { title: `Create ${getPrintType(type)?.name ?? "printout"}` };
}

async function Body({ params }: Props) {
  const { type } = await params;
  if (!getPrintType(type)) notFound();
  await requirePagePermission("settings.printouts_labels.create", `/settings/printouts/${type}/new`);
  return <PrintoutWizardPage typeKey={type} editId={null} />;
}

/** `/settings/printouts/[type]/new` — 5-step create wizard. */
export default function Page(props: Props) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Body {...props} />
    </Suspense>
  );
}
