import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { UsersPage } from "@/components/admin/users/users-page";
import { requirePagePermission } from "@/server/auth/permissions";

export const metadata: Metadata = { title: "Users" };

async function Guard() {
  await requirePagePermission("settings.users.view", "/settings/users");
  return <UsersPage />;
}

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Guard />
    </Suspense>
  );
}
