// @vitest-environment jsdom
import "../foundation-f4a/dom-shims";
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { z } from "zod";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/test/path",
  useSearchParams: () => new URLSearchParams(),
}));

import { TextField } from "@/components/ui/text-field";
import { UnsavedChangesDialog } from "@/components/ui/unsaved-changes";
import { Wizard, WizardSuccess, type WizardStep } from "@/components/ui/wizard";

type Values = { name: string; note: string };
const steps: readonly WizardStep<Values>[] = [
  {
    key: "general",
    label: "General",
    schema: z.object({ name: z.string().min(1, "Name is required") }),
    render: ({ form }) => <TextField aria-label="Name" {...form.register("name")} />,
  },
  { key: "more", label: "More", render: ({ form }) => <TextField aria-label="Note" {...form.register("note")} /> },
];

describe("Wizard keyboard and focus (fix2)", () => {
  it("Enter in a field runs Next and focus moves to the new step's first field", async () => {
    const user = userEvent.setup();
    render(<Wizard steps={steps} defaultValues={{ name: "", note: "" }} onComplete={() => undefined} draftScope={false} guardUnsaved={false} />);
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Kit A{Enter}");
    const note = await screen.findByRole("textbox", { name: "Note" });
    await waitFor(() => expect(document.activeElement).toBe(note));
  });

  it("Enter on the last step saves; the free-mode success screen says updated", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(
      <Wizard
        steps={steps}
        mode="free"
        defaultValues={{ name: "Kit", note: "" }}
        onComplete={onComplete}
        draftScope={false}
        guardUnsaved={false}
        success={<WizardSuccess entity="the kit product" options={[]} />}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Step 2: More/ }));
    await user.type(await screen.findByRole("textbox", { name: "Note" }), "x{Enter}");
    expect(await screen.findByText("You have successfully updated the kit product")).toBeTruthy();
    expect(onComplete).toHaveBeenCalledWith({ name: "Kit", note: "x" });
  });

  it("shows a single Save when the rail owns it", () => {
    render(<Wizard steps={steps} mode="free" defaultValues={{ name: "Kit", note: "" }} onComplete={() => undefined} draftScope={false} guardUnsaved={false} railSummary={() => <p>rail</p>} />);
    expect(screen.getAllByRole("button", { name: "Save" })).toHaveLength(1);
  });
});

describe("Unsaved-changes guard (fix2)", () => {
  it("uses the red danger header with Stay focused and Leave as the danger action", async () => {
    render(<UnsavedChangesDialog open onStay={() => undefined} onLeave={() => undefined} />);
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.getAttribute("data-variant")).toBe("danger");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Stay" })));
    expect(screen.getByRole("button", { name: "Leave" }).className).toContain("danger");
  });
});
