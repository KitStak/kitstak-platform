import type { Metadata } from "next";
import { Suspense, use } from "react";
import { JobsPageSkeleton } from "@/components/jobs/jobs-page-skeleton";
import { JobDetailPage } from "@/components/jobs/job-detail-page";

export const metadata: Metadata = { title: "Job" };

function Detail({ params }: { readonly params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <JobDetailPage id={decodeURIComponent(id)} />;
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<JobsPageSkeleton title="Job" variant="detail" />}>
      <Detail params={params} />
    </Suspense>
  );
}
