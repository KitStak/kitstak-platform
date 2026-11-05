import { redirect } from "next/navigation";
import { TopNav } from "@/components/layout/app-shell";
import { getSessionUser } from "@/server/auth/session";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await getSessionUser();
  if (!user) {
    redirect("/login");
  }
  return (
    <div className="flex min-h-screen flex-col">
      <TopNav userName={user.name} role={user.role} />
      <main className="flex min-h-0 flex-1 flex-col">{children}</main>
    </div>
  );
}
