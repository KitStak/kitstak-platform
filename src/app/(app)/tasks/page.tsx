import { redirect } from "next/navigation";

/** `/tasks` → the first Task Details tab. */
export default function Page() {
  redirect("/tasks/order-operations");
}
