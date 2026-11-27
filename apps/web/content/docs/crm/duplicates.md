---
title: Find and merge duplicate records
description: Find contacts and accounts that are the same customer by email, website domain or name, merge them with field choices, or mark them as not duplicates.
section: Accounts and pipelines
order: 50
---

Imports, forms and busy teams create duplicates: the same person twice on Contacts, or the same company twice on Accounts. The Duplicates page finds them and merges them into one record, moving every deal, contact and activity to the record you keep.

## Before you start

- You need a Contacts or Accounts board from the CRM templates.
- You need edit access to the board to merge or dismiss duplicates. Others can see the matches.

## Open the Duplicates page

Open **CRM > Duplicates** in the top bar. Pick the **Contacts** or **Accounts** tab. The page scans the board and shows each group of likely duplicates as a card. If there are none, it says **No duplicates found**.

## How matches are found

| Board | Reason | Confidence |
| --- | --- | --- |
| Contacts | **Same email address** | **High confidence** |
| Contacts | **Same name** at the same account or email domain | **High confidence** |
| Contacts | **Same name** only | **Possible** |
| Accounts | **Same website domain** | **High confidence** |
| Accounts | **Same name** | **High confidence** |

Name matches are not suggested when other details clearly disagree. For a **Possible** match, only the name matches. Nothing is selected for merging until you tick a duplicate.

## Merge duplicates

1. On a card, compare the records side by side. Fields that differ are marked **Differs**, and the card shows how many fields differ.
2. Pick the record to keep with **Keep this one**. It shows **Keep**. The CRM suggests one for you.
3. Tick **Merge** on each record that should be merged into it.
4. For each field that differs, pick the value to keep.
5. Select **Merge** on the card (for example **Merge 2**), then confirm **Merge**.

Empty fields on the kept record are filled from the duplicates. Every relation (deals, contacts, activities) moves to the one you keep, and the duplicates go to the trash. A toast confirms the merge and offers **Undo**.

## Undo a merge

Select **Undo** on the toast right after the merge. The duplicates, their fields and their relations come back as they were. If undo is no longer possible, restore the duplicates from the trash. See [Archive, delete and restore](/docs/crm/trash-and-restore).

## Mark as not duplicates

If the records are different customers, select **Not duplicates** on the card. A toast confirms **Marked as not duplicates** with **Undo**. The group is not suggested again.

## Rules

- One merge can combine up to 20 duplicates into the kept record.
- Merged records go to the trash, like deleted items.

## Related pages

- [Account and contact 360 pages](/docs/crm/account-and-contact-pages)
- [Import data from a spreadsheet](/docs/crm/import-data)
- [Convert a lead](/docs/crm/convert-a-lead)
