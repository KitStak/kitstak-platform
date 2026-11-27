---
title: Customers and retailers
description: Keep the end customers and retail partners your clients ship to, with their addresses, case label rules, logos and routing documents.
section: Clients
order: 50
---

Customers and retailers sit next to clients on the organization tabs. A customer is a person or company a client ships to, kept with its addresses so you can reuse it on orders. A retailer is a store chain a client ships wholesale orders to, with its logo, case label rules and routing documents.

## Before you start

- You need the **Customers** or **Retailers** page in your role, with **Create**, **Edit** and **Delete** as needed.
- For a customer, the client it belongs to must exist and be active.

## Add a customer

1. Go to **Settings > Master Data > Customers**, or select the **Customer** tab on the **Clients** page.
2. Select **Create customer**.
3. Fill in the **Customer** section and add at least one address.
4. Select **Create customer**.

| Field | What it does | Required |
| --- | --- | --- |
| **First name** | Up to 60 characters. | Yes |
| **Last name** | Up to 60 characters. | Yes |
| **E-mail** | Must be a valid email. | Yes |
| **Phone** | At least 7 digits; digits, spaces, plus, brackets, dots and dashes only. | Yes |
| **Client** | The client this customer belongs to. | Yes |
| **Active** | Turn off to make the customer inactive. | No |
| Addresses | Shipping, Billing or Return addresses, up to 50. | At least one active Shipping address |

A customer's **Client** locks once orders use the customer. The field shows **Locked: 12 orders reference this customer**, with the real count.

The customer list shows **Customer name**, **E-mail**, **Phone**, **Client**, **City**, **Country**, **State**, **Is active**, **Orders** and **Created date**. Search matches name, email or phone.

### Customer rules

- **Delete** is blocked for customers with orders: **Customers with orders can't be deleted; deactivate instead**.
- **Activate** and **Deactivate** work on one row or on a selection.
- Each row menu has **Show details**, **Edit**, **Change log**, **Activate** or **Deactivate**, and **Delete**.

## Add a retailer

1. Go to **Settings > Master Data > Retailers**, or select the **Retailers** tab on the **Clients** page.
2. Select **Create retailer**. The drawer has three steps: **General**, **Advanced** and **Other info**.
3. On **General**, enter the **Retailer details**, upload a **Retailer logo** and add the **Address**.
4. On **Advanced**, set the label rules and upload documents.
5. On **Other info**, fill in any custom fields, then save.

### General step

| Field | What it does | Required |
| --- | --- | --- |
| **Name** | The retailer name. Up to 100 characters. | Yes |
| **Business name** | The legal business name. Up to 150 characters. | No |
| **Description** | Up to 250 characters. | No |
| **Status** | Inactive retailers can't be chosen on new orders. | Yes |
| **Retailer logo** | Printed on case and LP labels for this retailer. PNG or JPG. | No |
| **Address line 1**, **Address line 2**, **Postal code**, **City** | The retailer address. | No |
| **Country** | The retailer's country. | Yes |
| **State** or **Province** | Picked from the country's list. | No |
| **Email**, **Phone number** | Contact details. | No |

### Advanced step

| Field | What it does | Required |
| --- | --- | --- |
| **Create case labels for single item LPs / parent LPs** | Prints a retailer case label for every LP that holds a single item, at packing and shipment plan loading. | No |
| **Case label print quantity** | How many copies of each case label print. 1 to 99. | Yes |
| **LP label print quantity** | How many copies of each LP label print. 1 to 99. | Yes |
| **Documents** | PDF or image files up to 10 MB each, such as routing guides and label specs. Up to 20 files. | No |

### Retailer rules

- Retailers used on shipment orders can't be deleted.
- The list shows **Name**, **Logo**, **Business name**, **Country**, **Address**, **Status**, **Case labels**, **Orders** and **Created date**.

## Vendors

The **Vendors** tab lists the suppliers that send purchase orders. Vendors are part of receiving.

## Export

The **Customers** and **Retailers** lists have **Export As Excel**. The file covers every row that matches your filters and appears in **Excel Export History**.

## Related

- [Client details page](/docs/wms/client-details)
- [Create a client](/docs/wms/client-create-a-client)
- [Export and schedule reports](/docs/wms/analytics-export-and-schedule)
