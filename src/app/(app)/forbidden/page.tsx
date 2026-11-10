import { Suspense } from "react";
import type { Metadata } from "next";
import { ShieldAlert } from "lucide-react";
import { routeLabelFromParam } from "@/config/route-registry";
import { GoBackButton } from "@/components/layout/go-back-button";
import { deniedPath, HomeLink, StatusScreen } from "@/components/layout/status-screen";

export const metadata: Metadata = { title: "Access denied" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

async function ForbiddenBody({ searchParams }: { readonly searchParams: SearchParams }) {
  const from = (await searchParams).from;
  const label = routeLabelFromParam(from);
  const path = deniedPath(from);
  return (
    <StatusScreen
      code="403"
      icon={ShieldAlert}
      tone="warning"
      title={path ? `You don't have access to ${path}` : "You don't have access to this page"}
      description={
        <>
          {label ? <>Your role does not include permission to view <span className="font-semibold text-body">{label}</span>.</> : "Your role does not include permission to view this page."}{" "}
          Ask an administrator to update your role in Settings › Roles.
        </>
      }
      actions={
        <>
          <GoBackButton />
          <HomeLink />
        </>
      }
    />
  );
}

export default function ForbiddenPage({ searchParams }: { readonly searchParams: SearchParams }) {
  return (
    <Suspense fallback={null}>
      <ForbiddenBody searchParams={searchParams} />
    </Suspense>
  );
}
