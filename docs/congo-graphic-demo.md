# Congo Graphic operations demo

The public operations mode is `/workspace/#/congo-graphic`. The former public-finance route opens this mode for existing links. The enterprise financial review remains separate.

## Scope

Fictional billboard faces, clients, contracts, installations, maintenance, invoices, partial receipts and linked document attachments form a connected demonstration. A face is the booking unit; confirmed overlapping date ranges are rejected. Confirming a booking creates installation work. Completed work requires a completion note. Sites with ongoing bookings or work cannot be archived. Invoicing is capped at contract value and receipts at the unpaid balance.

English and French interface controls, labels, statuses and validation messages are supported. The language preference persists on the device. Record names and user-entered notes are preserved. Dates and amounts use locale formatting; sample amounts are USD.

CSV and XLSX site registers support worksheet/header selection, English/French column suggestions, explicit field mapping and review before importing accepted rows. Duplicates are excluded rather than silently overwriting records. Source filename, sheet and row remain attached. A real client workbook is still needed to validate its particular layout.

## Persistence and limits

This is a browser-local demo, clearly labelled in the interface. It is not a shared production database or an authenticated company system of record. JSON backup/restore includes documents; document attachments are limited to PDF/JPEG/PNG and 500 KB each. Browser storage quota may limit total workspace size. Activity history is local and not a tamper-proof audit log. The planning date controls availability and overdue indicators; receivables include all recorded payments.

Production rollout requires tenant-aware server persistence, permissions, durable document storage, backups and migration of the actual site register. No actual Congo Graphic locations or contracts are represented by the seed records.

## Validation

`node web/scripts/test-congo-graphic.mjs` covers booking conflicts, installation creation, cancellation, archiving safeguards, completion requirements, invoice/receipt limits, backup validation, CSV/XLSX import and interface translation coverage. Existing workspace route and portal assembly checks protect the entrypoints.
