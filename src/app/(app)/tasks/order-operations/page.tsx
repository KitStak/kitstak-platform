import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { TasksListPage } from "@/components/tasks/tasks-list-page";

export const metadata: Metadata = { title: "Order operations" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <TasksListPage kind="order" />
    </Suspense>
  );
}
