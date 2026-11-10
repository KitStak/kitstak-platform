import { redirect } from "next/navigation";

/** `/settings/data-setup` opens Auto Code Generation Preferences (Logiwa parity). */
export default function DataSetupIndex(): never {
  redirect("/settings/data-setup/code-generation");
}
