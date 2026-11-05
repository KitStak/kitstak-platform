"use client";

import * as React from "react";
import { Plus, Upload } from "lucide-react";
import { PageHeader, UnderlineTabs } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import type { ListEnvelope } from "./jobs-shared";
import { JobManagementTab } from "./job-management-tab";
import { WaveRulesTab, WAVE_RULE_COUNT } from "./wave-rules-tab";
import { AllocationExceptionsTab } from "./allocation-exceptions-tab";
import { ShortageReportTab } from "./shortage-report-tab";

type JobsTabKey = "wave-rules" | "management" | "exceptions" | "shortage";

async function fetchTotal(url: string, signal: AbortSignal): Promise<number | null> {
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    const body = (await res.json()) as ListEnvelope<unknown>;
    return body.success && body.meta ? body.meta.total : null;
  } catch {
    // Tab counts are cosmetic; the tab itself surfaces fetch errors.
    return null;
  }
}

export function JobsPage() {
  const [tab, setTab] = React.useState<JobsTabKey>("management");
  const [jobTotal, setJobTotal] = React.useState<number | undefined>(undefined);
  const [shortageTotal, setShortageTotal] = React.useState<number | undefined>(undefined);

  React.useEffect(() => {
    const controller = new AbortController();
    void fetchTotal("/api/jobs?page=1&pageSize=1", controller.signal).then((n) => {
      if (n !== null) setJobTotal(n);
    });
    void fetchTotal(
      "/api/orders?status=Shortage&page=1&pageSize=1",
      controller.signal
    ).then((n) => {
      if (n !== null) setShortageTotal(n);
    });
    return () => controller.abort();
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        breadcrumbs={[{ label: "Fulfillment" }, { label: "Job Management" }]}
        title="Jobs"
        helper="From this section, you can create new jobs or manage created jobs."
        actions={
          <>
            <Button variant="secondary" size="md">
              <Upload className="h-3.5 w-3.5" aria-hidden />
              Import
            </Button>
            <Button variant="primary" size="md">
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Create Job
            </Button>
          </>
        }
      />
      <UnderlineTabs
        className="mt-3"
        tabs={[
          { key: "wave-rules", label: "Wave Rules", count: WAVE_RULE_COUNT },
          { key: "management", label: "Job Management", count: jobTotal },
          { key: "exceptions", label: "Allocation Exceptions" },
          { key: "shortage", label: "Shortage Report", count: shortageTotal },
        ]}
        active={tab}
        onChange={(key) => setTab(key as JobsTabKey)}
      />
      {tab === "wave-rules" ? <WaveRulesTab /> : null}
      {tab === "management" ? <JobManagementTab /> : null}
      {tab === "exceptions" ? (
        <AllocationExceptionsTab onViewJobs={() => setTab("management")} />
      ) : null}
      {tab === "shortage" ? <ShortageReportTab /> : null}
    </div>
  );
}
