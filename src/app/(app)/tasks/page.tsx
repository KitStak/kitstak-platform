import { redirect } from "next/navigation";

/**
 * `/tasks` → the first Task Details tab. The segment only redirects, so there is nothing to
 * validate for instant navigation (critic R3: "Could not validate `instant`" console error).
 */
export const instant = false;

export default function Page() {
  redirect("/tasks/order-operations");
}
