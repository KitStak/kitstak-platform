"use client";

import * as React from "react";
import { Layers, Package, Search } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldError } from "@/components/ui/form";
import { ChipInput } from "@/components/ui/chip-input";
import { ColorSwatchPicker } from "@/components/ui/color-swatch-picker";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { DatePicker } from "@/components/ui/date-picker";
import { DateRangePicker, type DateRangeValue } from "@/components/ui/date-range-picker";
import { DateTimePicker } from "@/components/ui/datetime-picker";
import { FileDropzone, type DropzoneItem } from "@/components/ui/file-dropzone";
import { NumberInput } from "@/components/ui/number-input";
import { RadioCards } from "@/components/ui/radio-cards";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { TextField } from "@/components/ui/text-field";
import { Textarea } from "@/components/ui/textarea";
import { TimePicker } from "@/components/ui/time-picker";
import { YesNoToggle } from "@/components/ui/yes-no-toggle";
import { ShowcaseSection, Specimen } from "./showcase-section";

const CARRIERS: readonly ComboboxOption[] = [
  { value: "ups", label: "UPS", description: "Ground, 2nd Day Air, Next Day Air" },
  { value: "fedex", label: "FedEx", description: "Home Delivery, Express Saver" },
  { value: "usps", label: "USPS", description: "Ground Advantage, Priority Mail" },
  { value: "dhl", label: "DHL Express" },
  { value: "ontrac", label: "OnTrac" },
];

const SKUS = ["APX-TEE-BLK-M", "APX-TEE-BLK-L", "APX-HOOD-GRY-M", "NVF-MUG-12OZ", "NVF-BOTTLE-750", "NVF-CAP-NAVY"];

/** Async demo source: filters a static list after a short delay (mirrors a picker endpoint). */
const loadSkus = (query: string, signal: AbortSignal): Promise<readonly ComboboxOption[]> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(SKUS.filter((s) => s.toLowerCase().includes(query.toLowerCase())).map((s) => ({ value: s, label: s }))), 250);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });

const BARCODE_RE = /^[A-Za-z0-9-]{4,40}$/;

export function InputsShowcase() {
  const [text, setText] = React.useState("SO010421");
  const [note, setNote] = React.useState("");
  const [qty, setQty] = React.useState<number | null>(12);
  const [carrier, setCarrier] = React.useState<string | null>("ups");
  const [skus, setSkus] = React.useState<readonly string[]>([]);
  const [service, setService] = React.useState<string | null>(null);
  const [date, setDate] = React.useState<Date | null>(null);
  const [dateTime, setDateTime] = React.useState<Date | null>(null);
  const [time, setTime] = React.useState<string | null>("14:30");
  const [range, setRange] = React.useState<DateRangeValue>({ from: null, to: null });
  const [barcodes, setBarcodes] = React.useState<readonly string[]>(["0012345678905"]);
  const [color, setColor] = React.useState<string | null>(null);
  const [files, setFiles] = React.useState<readonly DropzoneItem[]>([]);
  const [checked, setChecked] = React.useState<boolean | "indeterminate">("indeterminate");
  const [enabled, setEnabled] = React.useState(true);
  const [yesNo, setYesNo] = React.useState<boolean | null>(true);
  const [density, setDensity] = React.useState<"Large" | "Small">("Small");
  const [mode, setMode] = React.useState<"single" | "multi" | null>("single");

  return (
    <ShowcaseSection id="inputs" title="Inputs" description="Every control has designed hover, focus, active, invalid and disabled states.">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Specimen label="Text field"><TextField aria-label="Order code" value={text} onChange={(e) => setText(e.target.value)} onClear={() => setText("")} leading={<Search className="h-3.5 w-3.5" aria-hidden />} maxLength={30} showCount className="w-full" wrapperClassName="w-full" /></Specimen>
        <Specimen label="Text field (invalid / disabled)">
          <div className="w-full">
            <TextField aria-label="Invalid example" invalid aria-describedby="showcase-invalid-email-error" defaultValue="bad@" wrapperClassName="w-full" />
            <FieldError id="showcase-invalid-email-error" message="Enter a valid email" />
          </div>
          <TextField aria-label="Disabled example" disabled defaultValue="Locked" wrapperClassName="w-full" />
        </Specimen>
        <Specimen label="Textarea (0 / 500)"><Textarea aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} showCount className="w-full" /></Specimen>
        <Specimen label="Number input"><NumberInput aria-label="Quantity" value={qty} onChange={setQty} min={0} max={999} suffix="EA" /></Specimen>
        <Specimen label="Select"><Select aria-label="Shipping service" placeholder="Select service" clearable value={service} onChange={setService} options={[{ value: "ground", label: "Ground", group: "UPS" }, { value: "2day", label: "2nd Day Air", group: "UPS" }, { value: "priority", label: "Priority Mail", group: "USPS" }]} className="w-full" /></Specimen>
        <Specimen label="Combobox (static, single)"><Combobox aria-label="Carrier" options={CARRIERS} value={carrier} onChange={(v) => setCarrier(v)} clearable className="w-full" /></Specimen>
        <Specimen label="Combobox (async, multi, min 3 chars)"><Combobox aria-label="SKUs" multiple loadOptions={loadSkus} minChars={3} value={skus} onChange={(v) => setSkus(v)} placeholder="Search SKU" className="w-full" /></Specimen>
        <Specimen label="Date picker"><DatePicker aria-label="Expected date" value={date} onChange={setDate} clearable /></Specimen>
        <Specimen label="Date-time picker (YYYY/MM/DD HH:mm)"><DateTimePicker aria-label="Ship by" value={dateTime} onChange={setDateTime} clearable /></Specimen>
        <Specimen label="Time picker"><TimePicker aria-label="Cutoff" value={time} onChange={setTime} clearable /></Specimen>
        <Specimen label="Date range picker"><DateRangePicker aria-label="Order date range" value={range} onChange={(v) => setRange(v)} /></Specimen>
        <Specimen label="Chip input (barcodes)"><ChipInput aria-label="Barcodes" value={barcodes} onChange={setBarcodes} validate={(t) => (BARCODE_RE.test(t) ? null : "4–40 letters, digits or dashes")} placeholder="Scan or type, press Enter" className="w-full" /></Specimen>
        <Specimen label="Color swatches"><ColorSwatchPicker ariaLabel="Tag color" value={color} onChange={setColor} allowCustom /></Specimen>
        <Specimen label="Checkbox (tri-state)"><Checkbox checked={checked} onCheckedChange={setChecked} label="Select all lines" description="Tri-state: indeterminate until clicked" /></Specimen>
        <Specimen label="Switch"><Switch checked={enabled} onCheckedChange={setEnabled} label="Is active" /></Specimen>
        <Specimen label="Yes / No toggle">
          <YesNoToggle ariaLabel="Allow mixed lots" value={yesNo} onChange={setYesNo} />
          <YesNoToggle ariaLabel="Disabled toggle" value={false} onChange={() => undefined} disabled />
        </Specimen>
        <Specimen label="Segmented control"><SegmentedControl ariaLabel="Density" value={density} onChange={setDensity} options={[{ value: "Large", label: "Large" }, { value: "Small", label: "Small" }]} /></Specimen>
      </div>
      <Specimen label="Radio cards">
        <RadioCards
          ariaLabel="Product type"
          columns={2}
          chevron
          value={mode}
          onChange={setMode}
          className="w-full"
          options={[
            { value: "single", title: "Single product", description: "One SKU with pack types", icon: Package },
            { value: "multi", title: "Kit / bundle", description: "Built from components", icon: Layers, badge: "NEW" },
          ]}
        />
      </Specimen>
      <Specimen label="File dropzone (type + size validation, progress)">
        <FileDropzone
          className="w-full"
          accept={[".xlsx", ".csv"]}
          maxSizeBytes={10 * 1024 * 1024}
          multiple
          maxFiles={3}
          hint=".xlsx or .csv, up to 10 MB"
          items={files}
          onRemove={(id) => setFiles((list) => list.filter((f) => f.id !== id))}
          onFiles={(added) => setFiles((list) => [...list, ...added.map((f, i) => ({ id: `${f.name}-${Date.now()}-${i}`, name: f.name, size: f.size, progress: 100 }))])}
        />
      </Specimen>
    </ShowcaseSection>
  );
}
