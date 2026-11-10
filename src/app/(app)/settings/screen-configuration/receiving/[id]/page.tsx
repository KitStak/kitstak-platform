import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { ScreenConfigEditorPage } from "@/components/admin/screen-configs/editor-page";
import { requirePagePermission } from "@/server/auth/permissions";

export const metadata: Metadata = { title: "Edit receiving configuration" };

interface Props {
  readonly params: Promise<{ id: string }>;
}

async function Guard({ params }: Props) {
  const { id } = await params;
  await requirePagePermission("settings.screen_configuration.edit", `/settings/screen-configuration/receiving/${id}`);
  return <ScreenConfigEditorPage editId={id} />;
}

/** `/settings/screen-configuration/receiving/[id]` — edit (free tab navigation, Save on every tab). */
export default function Page(props: Props) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Guard {...props} />
    </Suspense>
  );
}
