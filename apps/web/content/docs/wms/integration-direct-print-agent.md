---
title: Direct Print agent and printer setup
description: Assign barcode and laser printers per warehouse, install the KitStak Direct Print agent on a workstation and send ZPL and PDF labels straight to printers.
section: Integrations
order: 100
---

KitStak can send labels and documents straight to a printer, with no browser print dialog. Each user picks a barcode printer and a laser printer per warehouse, and a small program on the workstation, the Direct Print agent, passes each print job to the printer. Without the agent, printouts still work: they open in the browser print dialog with the right paper size.

## Before you start

- The workstation needs Node.js 18 or later to run the agent.
- Know your printers: a network Zebra printer by its IP address, or any printer by its name in the operating system.

## Assign your printers

1. Select the **Printers** icon in the header.
2. Choose the **Warehouse** you work in and select **Next**.
3. Pick the **Selected barcode printer**, the thermal printer for labels.
4. Pick the **Selected laser printer**, for documents such as packing lists.
5. Select **Test label** to print a ZPL test label on the barcode printer.
6. Select **Save**.

You can type a printer name that isn't listed yet. A network Zebra printer can be entered as `192.168.1.50:9100`. Your assignment saves even when the agent isn't running.

### Scan to assign

Instead of picking from the list, scan a printer's label into **Scan a printer label to assign it**. A label starting with `BC:` or `LBL:` goes to the barcode printer, and one starting with `LS:` or `LZ:` goes to the laser printer. Thermal printer names such as Zebra or Honeywell models go to the barcode printer.

## Install the Direct Print agent

1. Open the **Printers** popover. When the agent isn't running you see **Direct Print agent not connected**.
2. Select **Download agent**. The browser saves `kitstak-print-agent.mjs`.
3. On the workstation, open a terminal in the download folder and run `node kitstak-print-agent.mjs`.
4. Keep that window open, or install it as a service, while you print from KitStak.
5. In the popover, select **Check for agent**. It now reads **Direct Print agent connected** with its version.

**Setup guide** in the popover opens the in-app help on Direct Print.

## How the agent works

| Topic | Detail |
| --- | --- |
| Address | Listens on `127.0.0.1:9101` only, so nothing outside the workstation can reach it. |
| Who may print | Accepts requests only from the KitStak site it was downloaded from. Add more with `--origin`. |
| Port | Change it with `--port`. |
| ZPL to a network printer | Sent over a raw socket to the IP address, port 9100 by default. |
| ZPL or PDF to a named printer | Sent through the operating system spooler: `lp` on macOS and Linux, PowerShell on Windows. |
| Printer list | Read from the operating system, so installed printers show in the popover. |

> **Tip:** Zebra printers work best with ZPL label templates. Network Zebras can be entered as IP and port 9100; other printers use their operating system name.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| **Direct Print agent not connected** | The agent window is open and **Check for agent** was selected on the same workstation. |
| **Test label failed: the Direct Print agent stopped answering.** | The agent window was closed. Start it again. |
| The printer did not answer | The IP address and port, and that the printer is on the network. |
| Printouts open in the browser | The agent isn't running. Printing still works through the print dialog. |

## Related

- [Connect a carrier account](/docs/wms/carrier-connect-a-carrier)
- [Integrations overview](/docs/wms/integration-overview)
- [Manage warehouses](/docs/wms/settings-warehouses)
