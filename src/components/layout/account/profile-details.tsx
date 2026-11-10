import * as React from "react";
import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import { DateCell } from "@/components/grid/cells";
import type { AccountProfile } from "@/server/account/account-data";
import { roleLabel } from "../role-label";

function Row({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[150px_minmax(0,1fr)] items-baseline gap-3 border-t border-border py-2.5 text-[13px] first:border-t-0">
      <dt className="text-secondary">{label}</dt>
      <dd className="min-w-0 text-foreground">{children}</dd>
    </div>
  );
}

/** Read-only profile; name, role and warehouse access are managed by an administrator (M14 Users). */
export function ProfileDetails({ profile }: { readonly profile: AccountProfile }) {
  return (
    <>
      <div className="flex items-center gap-3">
        <Avatar name={profile.name} tone="brand" />
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold text-foreground">{profile.name}</p>
          <p className="truncate text-[12px] text-faint">{profile.email}</p>
        </div>
      </div>
      <dl className="mt-4">
        <Row label="Role">{roleLabel(profile.role)}{profile.isApiUser ? " · API user" : ""}</Row>
        <Row label="User type">{profile.userType ?? "—"}</Row>
        <Row label="Warehouses">{profile.warehouses.length > 0 ? profile.warehouses.join(", ") : "None assigned"}</Row>
        <Row label="Clients">{profile.allClients ? "All clients" : "Assigned clients only"}</Row>
        <Row label="Last sign-in"><DateCell value={profile.lastLoginAt} /></Row>
        <Row label="Password changed">
          <span className="inline-flex items-center gap-2">
            <DateCell value={profile.passwordChangedAt} />
            <Link href="/account/password" className="text-[12px] font-medium text-primary underline-offset-2 hover:underline">Change</Link>
          </span>
        </Row>
        <Row label="Member since"><DateCell value={profile.createdAt} dateOnly /></Row>
      </dl>
      <p className="mt-4 text-[12px] text-faint">Your name, role and warehouse access are managed by an administrator.</p>
    </>
  );
}
