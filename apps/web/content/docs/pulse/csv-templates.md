---
title: CSV files and their columns
description: The 17 kinds of data Pulse reads and writes as CSV: each file name, the columns a row needs, the other columns, and how a row is matched.
section: Import and export
order: 20
---

Pulse reads and writes CSV for 17 kinds of data, each with its own template. Download a template from the import center: it has the header row and two example rows. A second file, **how to fill in**, lists each column, whether it is needed, and the allowed values. Exports use the same columns, so a file you export can be fixed and imported back.

## Before you start

- Go to **More > Import and export**. Each card has **Download the** template and **Download how to fill in the** file.
- Columns marked needed below must be in every row. Header names do not have to match exactly: Pulse ignores case, spaces, underscores and punctuation, and knows common other names.

## How values are read

| Kind of value | What Pulse accepts |
| --- | --- |
| Dates | `2026-11-03`, `11/3/2026` or `3/11/2026` (pick the order on the match step), `Nov 3 2026`, and Excel date numbers. |
| Money | `1234.5`, `$1,234.50`, and `(45.00)` or `-45` for a minus amount. |
| Percents | `28` and `28%` both mean 28 percent. |
| Yes and no | `yes`, `no`, `true`, `false`, `1`, `0`. |
| Lookups | Clients, jobs, job types, labor classes, sites, services and items are found by code first, then by exact name. |

## Set up once

| File | Needed | Other columns | A row updates when |
| --- | --- | --- | --- |
| **Clients** `clients.csv` | `client_code`, `name` | `status`, `contact_name`, `contact_email`, `phone`, `target_margin_pct`, `payment_terms_days`, `parts_owner`, `notes` | `client_code`, else the name, matches. |
| **Job types** `job_types.csv` | `job_type_code`, `name` | `unit_label`, `default_pricing_model`, `default_labor_class`, `default_units_per_labor_hour`, `target_margin_pct` | `job_type_code` matches. |
| **Jobs** `jobs.csv` | `job_number`, `name`, `client_code` | `job_type_code` (blank is General), `site_code`, `kind`, `status`, `pricing_model`, `unit_label`, `planned_units`, `unit_price`, `fixed_price`, `bill_rate_per_hour`, `material_method`, `material_cost_per_unit`, `parts_owner`, `labor_class`, `units_per_labor_hour_standard`, `target_margin_pct`, `start_date`, `due_date`, `completed_date`, `po_number`, `owner_email`, `kit_sku`, `notes`, `wms_work_order`, `crm_deal_id`, `project_key`, and the quote columns `quote_units`, `quote_revenue`, `quote_labor_hours`, `quote_labor_cost`, `quote_material_cost`, `quote_other_cost` | `job_number` matches. |
| **Quotes and budgets** `job_plans.csv` | `job_number`, `plan` (`quote` or `budget`) | Totals: `units`, `revenue`, `labor_hours`, `labor_cost`, `setup_hours`, `setup_cost`, `material_cost`, `other_cost`. Or lines: `category`, `description`, `quantity`, `unit`, `unit_amount`, `amount`, `labor_class`, `service_code`, `item_sku` | One row per job sets the totals. Lines replace all lines of that job and plan. |
| **Labor rates** `labor_rates.csv` | `labor_class_code`, `effective_from`, `wage_per_hour` | `labor_class_name`, `kind`, `site_code`, `payroll_tax_pct`, `benefits_pct`, `other_burden_pct`, `overhead_per_hour`, `overtime_multiplier`, `bill_rate_per_hour`, `note` | `labor_class_code`, `site_code` and `effective_from` match. |
| **Items** `items.csv` | `item_sku`, `name` | `uom`, `unit_cost`, `supplied_by`, `client_code` | `item_sku` matches. |
| **Services** `services.csv` | `service_code`, `name` | `unit_label`, `billing`, `default_price`, `default_cost_per_unit`, `units_per_labor_hour_standard`, `labor_class`, `active` | `service_code` matches. |
| **Target pace** `target_pace.csv` | `units_per_labor_hour`, `effective_from` | `job_type_code`, `service_code`, `client_code`, `labor_class`, `note` | The scope columns and `effective_from` match. |
| **Goals** `goals.csv` | `scope`, `metric`, `value` | `scope_code`, `month` | `scope`, `scope_code`, `metric` and `month` match. |

## Every day

| File | Needed | Other columns | A row updates when |
| --- | --- | --- | --- |
| **Production** `production.csv` | `work_date`, `job_number`, `units_good` | `entry_id`, `shift`, `labor_class`, `task`, `units_scrap`, `units_rework`, `people`, `hours_each`, `labor_hours`, `overtime_hours`, `setup_hours`, `task_units`, `note` | `entry_id`, else job, day, shift, labor class and task match. |
| **Other time** `indirect_time.csv` | `work_date`, `reason`, `labor_hours` | `entry_id`, `site_code`, `labor_class`, `people`, `overtime_hours`, `note` | `entry_id` matches. A row with the same day, site, class, reason and hours looks the same. |
| **Paid hours** `paid_hours.csv` | `work_date`, `paid_hours` | `site_code`, `labor_class`, `paid_amount` | Day, site and labor class match. |
| **Time punches** `time_punches.csv` | `employee_id`, `work_date`, `hours` | `entry_id`, `employee_name`, `site_code`, `job_number`, `reason`, `labor_class`, `overtime_hours`, `pay_amount` | `entry_id`, else person, day, job or reason, and class match. |
| **Materials** `materials.csv` | `usage_date`, `job_number`, `item_sku`, `quantity_used`, `unit_cost` | `entry_id`, `item_name`, `quantity_scrapped`, `quantity_planned`, `uom`, `lot`, `supplied_by`, `note` | `entry_id`, else job, day, item and lot when `lot` is set. Otherwise a row with the same job, day, item, quantity and cost looks the same. |
| **Service entries** `services_done.csv` | `work_date`, `client_code`, `service_code`, `quantity` | `entry_id`, `job_number`, `unit_price`, `amount`, `labor_class`, `people`, `labor_hours`, `overtime_hours`, `material_cost`, `note` | `entry_id` matches. A row with the same client, job, day, service and quantity looks the same. |

In **Production**, `labor_hours` left blank is `people` times `hours_each`. In **Time punches**, a row with no job and no reason is paid time not on any job.

## Money in and out

| File | Needed | Other columns | A row updates when |
| --- | --- | --- | --- |
| **Costs** `costs.csv` | `cost_date`, `category`, `amount` | `entry_id`, `job_number`, `client_code`, `site_code`, `vendor`, `reference`, `note` | `entry_id`, else job or client or company, day, category and reference when `reference` is set. Otherwise a row with the same amount looks the same. |
| **Revenue** `revenue.csv` | `revenue_date`, `kind`, `amount` | `entry_id`, `job_number`, `client_code`, `description`, `quantity`, `unit_price`, `invoice_number`, `service_code`, `note` | `entry_id`, else job or client, invoice number and description when `invoice_number` is set. Otherwise a row with the same day, kind and amount looks the same. |

A cost row with no job and no client is a company cost. A revenue `kind` is `invoice`, `fee`, `adjustment` or `credit`.

## Look the same rows

Some rows have no natural key: costs with no reference, revenue with no invoice number, other time, materials with no lot, and service entries. When such a row matches a row already in Pulse, it is counted under **Look the same** and left out, so money is never counted twice. Turn on **Add them anyway** on the check step when they really are separate rows.

## Who can import what

Supervisors can import **Production**, **Other time**, **Time punches** and **Materials**. **Labor rates** needs an admin or the owner. Everything else needs a manager.

## Related

- [Import a CSV file](/docs/pulse/import-csv)
- [Export your data](/docs/pulse/export-data)
- [Add a quote or a budget](/docs/pulse/quotes-and-budgets)
