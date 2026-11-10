// @vitest-environment jsdom
import "./dom-shims";
import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { z } from "zod";

const routerPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/test/path",
  useSearchParams: () => new URLSearchParams(),
}));

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Drawer } from "@/components/ui/drawer";
import { Toaster } from "@/components/ui/toaster";
import { toast, dismissToast } from "@/components/ui/toast";
import { StatusPill } from "@/components/ui/status-pill";
import { Checkbox } from "@/components/ui/checkbox";
import { YesNoToggle } from "@/components/ui/yes-no-toggle";
import { NumberInput } from "@/components/ui/number-input";
import { ChipInput } from "@/components/ui/chip-input";
import { Combobox } from "@/components/ui/combobox";
import { TextField } from "@/components/ui/text-field";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/ui/empty-state";
import { Form, FormField, SubmitBar, useZodForm } from "@/components/ui/form";
import { Wizard, type WizardStep } from "@/components/ui/wizard";

beforeEach(() => {
  routerPush.mockReset();
  window.sessionStorage.clear();
  dismissToast();
});

describe("ConfirmDialog", () => {
  it("shows the question, records and runs an async confirm with a spinner", async () => {
    const user = userEvent.setup();
    let resolve: () => void = () => undefined;
    const onConfirm = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    const onOpenChange = vi.fn();
    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Are you sure you want to delete 2 orders?"
        description="This cannot be undone."
        records={{ columns: [{ key: "code", label: "Order" }], rows: [{ code: "SO000001" }, { code: "SO000002" }] }}
        onConfirm={onConfirm}
      />
    );
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("SO000002")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Yes" }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(screen.getByRole("status", { name: "Working" })).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalled();
    await act(async () => resolve());
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("keeps Yes disabled until the confirmation text is typed, and shows errors", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn(async () => {
      throw new Error("Server said no");
    });
    render(<ConfirmDialog open onOpenChange={() => undefined} title="Delete all?" typeToConfirm="DELETE" onConfirm={onConfirm} />);
    const yes = screen.getByRole("button", { name: "Yes" }) as HTMLButtonElement;
    expect(yes.disabled).toBe(true);
    await user.type(screen.getByLabelText(/to confirm/), "DELETE");
    expect(yes.disabled).toBe(false);
    await user.click(yes);
    expect(await screen.findByText("Server said no")).toBeTruthy();
  });
});

describe("Drawer", () => {
  it("asks before closing when dirty", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <Drawer open onOpenChange={onOpenChange} title="Edit vendor" dirty footer={<button type="button">Save</button>}>
        <p>Body</p>
      </Drawer>
    );
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(await screen.findByText("You have unsaved changes!")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Leave" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("closes directly when clean", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <Drawer open onOpenChange={onOpenChange} title="View">
        <p>Body</p>
      </Drawer>
    );
    await user.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("Toaster", () => {
  it("renders titled toasts with an action", async () => {
    const user = userEvent.setup();
    const onView = vi.fn();
    render(<Toaster />);
    act(() => {
      toast.success("Success", "3 of 4 orders shipped · 1 failed", { action: { label: "View", onClick: onView } });
    });
    expect(await screen.findByText("3 of 4 orders shipped · 1 failed")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "View" }));
    expect(onView).toHaveBeenCalled();
  });
});

describe("display & inputs", () => {
  it("StatusPill uses the domain palette and P mini-pill", () => {
    render(<StatusPill status="Partially Shipped" domain="shipmentOrder" />);
    const pill = screen.getByText("Partially Shipped").closest("[data-status]") as HTMLElement;
    // green fg is #0E6B3B (darkened for AA 4.5:1 on the pill background, stations-returns REQ-4)
    expect(pill.style.color).toBe("rgb(14, 107, 59)");
    expect(screen.getByLabelText("Partial")).toBeTruthy();
  });

  it("Checkbox supports the indeterminate state", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Checkbox checked="indeterminate" onCheckedChange={onChange} aria-label="Select all" />);
    const box = screen.getByRole("checkbox", { name: "Select all" });
    expect(box.getAttribute("aria-checked")).toBe("mixed");
    await user.click(box);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("YesNoToggle emits booleans", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<YesNoToggle value={false} onChange={onChange} ariaLabel="Active" />);
    await user.click(screen.getByRole("radio", { name: "Yes" }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("NumberInput clamps on blur and steps with arrows", async () => {
    const user = userEvent.setup();
    function Harness() {
      const [v, setV] = React.useState<number | null>(5);
      return <NumberInput aria-label="Qty" value={v} onChange={setV} min={0} max={10} />;
    }
    render(<Harness />);
    const input = screen.getByRole("spinbutton", { name: "Qty" }) as HTMLInputElement;
    await user.click(input);
    await user.keyboard("{ArrowUp}");
    expect(input.value).toBe("6");
    await user.clear(input);
    await user.type(input, "1234");
    await user.tab();
    expect(input.value).toBe("10");
  });

  it("ChipInput commits on Enter and removes chips", async () => {
    const user = userEvent.setup();
    function Harness() {
      const [v, setV] = React.useState<readonly string[]>([]);
      return <ChipInput aria-label="Tracking" value={v} onChange={setV} />;
    }
    render(<Harness />);
    const input = screen.getByRole("textbox", { name: "Tracking" });
    await user.type(input, "1Z999{Enter}1Z888{Enter}");
    expect(screen.getByText("1Z999")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Remove 1Z999" }));
    expect(screen.queryByText("1Z999")).toBeNull();
    expect(screen.getByText("1Z888")).toBeTruthy();
  });

  it("TextField and Textarea show character counters", async () => {
    const user = userEvent.setup();
    render(
      <>
        <TextField aria-label="Name" maxLength={60} showCount />
        <Textarea aria-label="Notes" maxLength={500} />
      </>
    );
    await user.type(screen.getByRole("textbox", { name: "Name" }), "abc");
    expect(screen.getByText("3 / 60")).toBeTruthy();
    expect(screen.getByText("0 / 500")).toBeTruthy();
  });

  it("Combobox shows the min-chars hint for async search, then results", async () => {
    const user = userEvent.setup();
    const loadOptions = vi.fn(async (q: string) => [{ value: "p1", label: `Product ${q}` }]);
    const onChange = vi.fn();
    render(<Combobox aria-label="Product" value={null} onChange={onChange} loadOptions={loadOptions} />);
    const input = screen.getByRole("combobox", { name: "Product" });
    await user.type(input, "ab");
    expect(await screen.findByText("You have to enter at least 3 characters to search.")).toBeTruthy();
    await user.type(input, "c");
    expect(await screen.findByText("Product abc", {}, { timeout: 2000 })).toBeTruthy();
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("p1", { value: "p1", label: "Product abc" });
  });

  it("Combobox multi selects chips from static options and supports create", async () => {
    const user = userEvent.setup();
    function Harness() {
      const [v, setV] = React.useState<readonly string[]>([]);
      return <Combobox aria-label="Tags" multiple creatable value={v} onChange={(next) => setV(next)} options={[{ value: "rush", label: "Rush" }, { value: "gift", label: "Gift" }]} />;
    }
    render(<Harness />);
    const input = screen.getByRole("combobox", { name: "Tags" });
    await user.type(input, "gi");
    await user.click(await screen.findByRole("option", { name: "Gift" }));
    expect(screen.getByRole("button", { name: "Remove Gift" })).toBeTruthy();
    await user.type(input, "fragile");
    await user.click(await screen.findByRole("option", { name: /Create/ }));
    expect(screen.getByRole("button", { name: "Remove fragile" })).toBeTruthy();
  });

  it("EmptyState renders CTA cards", async () => {
    const user = userEvent.setup();
    const onImport = vi.fn();
    render(<EmptyState title="No orders yet" description="Create or import orders." cards={[{ title: "Import file", onClick: onImport }]} />);
    await user.click(screen.getByRole("button", { name: /Import file/ }));
    expect(onImport).toHaveBeenCalled();
  });
});

describe("Form system", () => {
  const schema = z.object({
    code: z.string().min(1, "Code is required"),
    name: z.string().min(1, "Name is required"),
  });

  function VendorForm({ onSubmit }: { readonly onSubmit: (v: z.output<typeof schema>) => void }) {
    const form = useZodForm(schema, { code: "", name: "" });
    return (
      <Form form={form} onSubmit={onSubmit}>
        <FormField<z.input<typeof schema>> name="code" label="Code" required>
          {(c) => <TextField {...c} />}
        </FormField>
        <FormField<z.input<typeof schema>> name="name" label="Name" required description="Shown on POs">
          {(c) => <TextField {...c} />}
        </FormField>
        <SubmitBar />
      </Form>
    );
  }

  it("shows inline errors and focuses the first invalid field on submit", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<VendorForm onSubmit={onSubmit} />);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Code is required")).toBeTruthy();
    expect(screen.getByText("Name is required")).toBeTruthy();
    const code = screen.getByLabelText(/Code/);
    await waitFor(() => expect(document.activeElement).toBe(code));
    expect(code.getAttribute("aria-invalid")).toBe("true");
    expect(onSubmit).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("submits parsed values when valid", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<VendorForm onSubmit={onSubmit} />);
    await user.type(screen.getByLabelText(/Code/), "V01");
    await user.type(screen.getByLabelText(/Name/), "Acme");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ code: "V01", name: "Acme" }));
  });
});

describe("Wizard", () => {
  type Values = { name: string; qty: number | null };
  const steps: readonly WizardStep<Values>[] = [
    {
      key: "general",
      label: "General",
      schema: z.object({ name: z.string().min(1, "Name is required") }),
      render: ({ form }) => <TextField aria-label="Name" {...form.register("name")} aria-invalid={form.formState.errors.name ? true : undefined} />,
    },
    { key: "lines", label: "Lines", render: () => <p>Lines step</p> },
  ];

  it("linear mode validates on Next, blocks unreached steps, then completes", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(<Wizard steps={steps} defaultValues={{ name: "", qty: null }} onComplete={onComplete} success={<p>Created!</p>} draftScope={false} guardUnsaved={false} />);
    const linesStep = screen.getByRole("button", { name: /Step 2: Lines/ }) as HTMLButtonElement;
    expect(linesStep.disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.queryByText("Lines step")).toBeNull();
    expect(screen.getByRole("button", { name: /Step 1: General \(Needs attention\)/ })).toBeTruthy();
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Kit A");
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Lines step")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Step 1: General \(Completed\)/ })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Created!")).toBeTruthy();
    expect(onComplete).toHaveBeenCalledWith({ name: "Kit A", qty: null });
  });

  it("free mode lets every step be opened and persists drafts per route", async () => {
    const user = userEvent.setup();
    const view = render(<Wizard steps={steps} mode="free" defaultValues={{ name: "", qty: null }} onComplete={() => undefined} guardUnsaved={false} />);
    await user.click(screen.getByRole("button", { name: /Step 2: Lines/ }));
    expect(screen.getByText("Lines step")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Step 1: General/ }));
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Draft");
    await waitFor(() => expect(window.sessionStorage.getItem("ks:wizard-draft:/test/path")).toContain("Draft"), { timeout: 2000 });
    view.unmount();
    render(<Wizard steps={steps} mode="free" defaultValues={{ name: "", qty: null }} onComplete={() => undefined} guardUnsaved={false} />);
    expect(await screen.findByText("Draft restored")).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "Name" }) as HTMLInputElement).value).toBe("Draft");
  });
});
