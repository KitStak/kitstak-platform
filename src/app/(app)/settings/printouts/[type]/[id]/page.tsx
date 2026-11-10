import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { PrintoutWizardPage } from "@/components/admin/printouts/printout-wizard";
import { getPrintType } from "@/server/print/catalog";
import { requirePagePermission } from "@/server/auth/permissions";

interface Props {
  readonly params: Promise<{ type: string; id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { type } = await params;
  return { title: `Edit ${getPrintType(type)?.name ?? "printout"}` };
}

async function Body({ params }: Props) {
  const { type, id } = await params;
  if (!getPrintType(type)) notFound();
  await requirePagePermission("settings.printouts_labels.edit", `/settings/printouts/${type}/${id}`);
  return <PrintoutWizardPage typeKey={type} editId={id} />;
}

/** `/settings/printouts/[type]/[id]` — edit wizard (free navigation, Save on every step). */
export default function Page(props: Props) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Body {...props} />
    </Suspense>
  );
}
