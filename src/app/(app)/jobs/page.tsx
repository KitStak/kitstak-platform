import type { Metadata } from "next";
import { JobsPage } from "@/components/jobs/jobs-page";

export const metadata: Metadata = { title: "Job Management" };

export default function Jobs() {
  return <JobsPage />;
}
