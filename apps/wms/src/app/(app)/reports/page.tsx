import type { Metadata } from "next";
import { Suspense } from "react";
import { ReportsHub } from "@/components/reports/reports-hub";
import { getAuthContext } from "@/server/auth/context";

export const metadata: Metadata = { title: "Report Hub" };

/**
 * The catalog is static nav config; only the permission filter needs the session. Resolving the
 * viewer's permissions on the server paints the full, permission-filtered catalog in the first
 * HTML (critic R5: it waited for `/api/me` on the client). The client view takes over after
 * hydration; if the session read fails it falls back to the client permission set.
 */
async function HubWithPermissions() {
  let permissions: readonly string[] | null = null;
  try {
    const auth = await getAuthContext();
    permissions = auth ? [...auth.permissions].sort() : null;
  } catch {
    permissions = null;
  }
  return <ReportsHub initialPermissions={permissions} />;
}

export default function ReportsPage() {
  return (
    <Suspense fallback={<ReportsHub />}>
      <HubWithPermissions />
    </Suspense>
  );
}
