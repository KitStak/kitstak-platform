import { redirect } from "next/navigation";

/** `/settings` lands on Users (BUILD_PLAN M14 #1). */
export default function SettingsIndexPage(): never {
  redirect("/settings/users");
}
