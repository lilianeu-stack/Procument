# Stock Keeper Portal Redesign — Implementation and QA Report

**Date:** 27 November 2026  
**Status:** Implementation complete; automated and live verification passed. Updated after the Supervisor → Stock Keeper routing defect fix.  
**Scope:** Stock Keeper inventory workspace, Supervisor request decisions, department stock, receiving goods, physical stock-out, Bin Card, notifications, and inventory reports/export formats.

> **Critical routing defect:** the dedicated root-cause, code-change, and live E2E report is [`Supervisor_to_StockKeeper_Routing_Defect_Report.md`](./Supervisor_to_StockKeeper_Routing_Defect_Report.md). The latest verified counts are backend 131/131, frontend 98/98, and production build passed.

## 1. Executive summary

The Stock Keeper Portal is now backed by real MySQL workflows rather than local/prototype state. The nine required sidebar pages are routed and functional:

1. Dashboard
2. Requests from Supervisors
3. Stock Overview
4. Stock In
5. Stock Out
6. Bin Card
7. Inventory Reports
8. Notifications
9. Profile

Old Stock Keeper links (`Requests to Issue`, `List of Requesters`, `Notification`) resolve to the redesigned pages without adding duplicate sidebar entries. Visual styling uses black text, white/light surfaces, neutral grey borders, and green only for hover/focus/action emphasis.

Acceptance of a Supervisor request now records the decision, comments, reason, decider, timestamp, and affected lines, and notifies the Supervisor. Acceptance only authorizes preparation; inventory decreases only when a physical Stock Out transaction is successfully saved. Receipts update stock and Bin Card history only on save, and damaged/rejected units are tracked separately without increasing usable stock.

All required QA Scenarios A–E passed. Latest verified totals after the routing-defect fix: backend **131 tests / 131 passed**, frontend **98 tests / 98 passed**. Production build passed. Docker backend and frontend were rebuilt without touching the MySQL volume, and all three containers are healthy.

## 2. Implementation map

### Backend

| Area | Files | Result |
| --- | --- | --- |
| Runtime schema and fresh-install schema | `backend/src/config/db.js`, `backend/database/schema.sql` | Added item storage locations, Stock Keeper decision metadata, accepted quantities, receipt metadata/damaged quantities, PO/receipt movement links, FKs, indexes, and one-time backfill markers. |
| Core Stock Keeper APIs | `backend/src/routes/stockkeeper.js` | Added decision, batch issue, expected deliveries, receive-all/receive-items, stock overview, routed-request details, inventory report endpoint, authorized outstanding checks, receipt damage handling, and Bin Card integration. |
| Supervisor routing visibility | `backend/src/routes/portal.js` | Routing notifications point to the Stock Keeper decision page; Supervisor request detail exposes Stock Keeper decision data. |
| Expected delivery notifications | `backend/src/routes/workflows.js` | PO approval notifies active Stock Keepers with PO reference, supplier, expected date, items, quantities, units, officer, and a Stock In link. |
| Sidebar counts and role firewall | `backend/src/routes/api.js` | Real per-page counts for Stock Keeper links; module-read conditions; role firewall preserved. |
| Reports and exports | `backend/src/services/exports.js` | Eight inventory report definitions with shared filters, full filtered rows, summary totals, and PDF/Excel/CSV rendering. Worksheet names are sanitized for Excel. |
| Notification read-state helper | `backend/src/lib/notification-reads.js` | Shared, module-scoped notification read logic. |

### Frontend

| Area | Files | Result |
| --- | --- | --- |
| Routing and API wiring | `frontend/src/App.jsx` | All redesigned pages loaded lazily and wired to real Stock Keeper endpoints. Old links are aliased to canonical pages. |
| Navigation | `frontend/src/components/portals/StockKeeperSidebar.jsx`, `frontend/src/services/sidebarCounts.js`, `frontend/src/utils/access.js` | Exact nine-page sidebar, real badges, canonical aliases, and role-safe route access. |
| Dashboard | `frontend/src/components/portals/StockKeeperDashboard.jsx` | Cards and activity sections derive from real summary records. |
| Supervisor requests | `frontend/src/components/portals/StockKeeperSupervisorRequests.jsx` | Full request detail, Accept/Reject with comments/reason, shortage reporting, issue actions, and decision history. |
| Stock Overview | `frontend/src/components/portals/StockKeeperStockOverview.jsx` | Department/location grouping, opening balance, stock in/out, current balance, minimum level, status, last updated, and location editing. |
| Stock In | `frontend/src/components/portals/StockKeeperStockIn.jsx` | Expected deliveries, Receive All / Receive Individual Items, partial receipts, accepted vs damaged/rejected quantities, and outstanding quantities. |
| Stock Out | `frontend/src/components/portals/StockKeeperStockOut.jsx` | Accepted-request-based issuing, partial issue, outstanding authorization checks, available balance checks, receiver capture, and Bin Card updates. |
| Inventory Reports | `frontend/src/components/portals/StockKeeperInventoryReports.jsx` | Eight report types, filters, presets (including Last Year), and a shared Print/PDF/Excel/CSV toolbar. |
| Notifications | `frontend/src/components/portals/StockKeeperNotifications.jsx` | Role-aware rendering of routing, decisions, expected deliveries, receipts, issues, shortages, low/zero stock, and adjustments. |
| Shared report controls | `frontend/src/components/ui/ReportToolbar.jsx`, `frontend/src/utils/dates.js`, `frontend/src/utils/reportFields.js` | One filter query feeds the in-portal register, Print, PDF, Excel, and CSV. |

## 3. Required QA scenarios

### Scenario A — Supervisor request

**Verified:** A Supervisor-routed request is visible with reference, requester, department, submitted date, forwarding/routing date, items, requested quantities, available stock, Supervisor, comments, status, and actions. Stock Keeper Accept/Reject saves comments, rejection reason, decider name, decision timestamp, and affected item quantities; the Supervisor is notified; original request history remains intact.

**Important workflow detail:** Stock Keeper-only routes intentionally leave `forwarded_at` null. The page displays `forwardedAt || routedAt`; the API always exposes the `forwardedAt` field. This was explicitly asserted in QA A.

**Result:** Passed.

### Scenario B — Department Stock

**Verified:** Stock Overview groups by real department and storage location and exposes item code, name, category, department, location, unit, opening balance, stock in, stock out, current balance, minimum level, status, and last updated. Movement totals are derived from real Bin Card rows.

**Result:** Passed.

### Scenario C — Receiving goods

**Verified:** Approved POs appear as expected deliveries. Receive All and Receive Individual Items support partial delivery. Accepted units increase stock; damaged/rejected units are stored separately and reduce outstanding expected delivery quantity. Each receipt appends a Bin Card movement and notifies Procurement. Stock does not increase before save.

**Result:** Passed.

### Scenario D — Stock Out

**Verified:** Only Supervisor-routed, Stock Keeper-accepted requests can be issued. Partial issue is supported. The system prevents issuing above available stock or authorized outstanding quantity. A fully issued request returns a clear 409 with `authorized outstanding quantity (0)`; pending or rejected requests retain `Only an accepted request can be issued.` Successful issues update Bin Card, request status, and notify Supervisor/Requester.

**Result:** Passed.

### Scenario E — Inventory Reports

**Verified:** All eight reports are available: Stock In, Stock Out, Current Stock Balance, Department Stock, Stock Movement, Low Stock, Damaged/Rejected Goods, and Supplier Delivery/Receiving. Filters cover type, department, item, transaction type, year, and start/end date, with all required presets. Print, PDF, Excel, and CSV use the same filtered rows and summary totals.

**Result:** Passed.

## 4. Automated verification

### Backend

```text
node --test --test-concurrency=1
tests 131
pass 131
fail 0
```

The dedicated routing/QA file also passed separately:

```text
node --test --test-concurrency=1 test/supervisor-routing.test.js
tests 13
pass 13
fail 0
```

Covered test files include:

- `backend/test/supervisor-routing.test.js` — routing scenarios and QA A–E
- `backend/test/app.test.js` — Stock Keeper isolation, badges, stock transactions, concurrent issue safety
- `backend/test/committee-app.test.js` — committee and export compatibility
- `backend/test/export-security.test.js` — export authorization/rendering

### Frontend

```text
npm test
tests 98
pass 98
fail 0
```

New coverage includes:

- Last Year date preset
- All eight inventory report keys
- Print/PDF/Excel/CSV controls sharing one query
- Canonical Stock Keeper pages and aliases
- Real sidebar badge wiring
- Decision, receipt, and issue payload wiring

### Syntax and build

- `node --check` passed for all modified backend/test files.
- `npm run build` passed; only the pre-existing >500 kB bundle-size warning remains.

## 5. Live Docker verification

App services were rebuilt without recreating MySQL data:

```bash
docker compose up -d --no-deps --build backend
docker compose up -d --no-deps --build frontend
```

Container status after rebuild:

```text
procument-backend-1    Up (healthy)
procument-frontend-1   Up (healthy)
procument-mysql-1      Up (healthy)
```

Health check:

```text
GET http://localhost:4000/api/health
status=200
database=connected
```

Authenticated Stock Keeper checks returned HTTP 200:

- `/auth/me`
- `/sidebar-counts`
- `/notifications`
- `/portal/stockkeeper/summary`
- `/portal/stockkeeper/routed-requests`
- `/portal/stockkeeper/issue-requests`
- `/portal/stockkeeper/expected-deliveries`
- `/portal/stockkeeper/stock-overview`
- `/portal/stockkeeper/items`
- `/portal/stockkeeper/inventory-report?type=stockkeeperStockMovement`

Representative live records were present: 3 expected deliveries, 28 stock items, and 24 stock-movement report rows. Role firewall behavior was confirmed: a Stock Keeper request to `/api/dashboard` returned **403**.

All eight reports were downloaded in all three formats from the running container:

| Report | PDF | Excel | CSV |
| --- | --- | --- | --- |
| Stock In | 200 | 200 | 200 |
| Stock Out | 200 | 200 | 200 |
| Current Stock Balance | 200 | 200 | 200 |
| Department Stock | 200 | 200 | 200 |
| Stock Movement | 200 | 200 | 200 |
| Low Stock | 200 | 200 | 200 |
| Damaged/Rejected Goods | 200 | 200 | 200 |
| Supplier Delivery/Receiving | 200 | 200 | 200 |

File signatures were also checked: PDF starts with `%PDF`, Excel with `PK`, and CSV with a UTF-8 BOM.

## 6. Issues found and fixed during live verification

1. **Reserved SQL word in receipt insert**  
   `condition` caused `ER_PARSE_ERROR` in `goods_receipt_items` inserts. It is now escaped as `` `condition` ``.

2. **Reserved SQL word in damaged-goods export**  
   `gri.condition` was used as an unquoted alias `Condition`, causing an export parse error. The alias is now quoted as `'Condition'`.

3. **Damaged units did not reduce outstanding expected delivery quantity**  
   Outstanding quantity now subtracts both accepted and damaged/rejected units.

4. **Fully issued requests used the wrong error message**  
   The batch issue endpoint now detects `Accepted` + `Issued` and returns the expected authorized-outstanding-zero message.

5. **Routed-request detail missed request status/date aliases**  
   Added `requestStatus`, `issuedAt`, `submittedAt`, `forwardedAt`, and `authorizedQuantity` so the page and QA assertions see the same contract.

6. **CSV summary label mismatch**  
   Corrected the expected total label to `Total Damaged/rejected quantity`.

7. **QA teardown could hang on failure**  
   Server close is now fail-safe with idle/active connection closure, cleanup is wrapped in `try/finally`, and failed receipts/movements are cleaned by item ID.

8. **Excel export failed for two report titles**  
   Live downloads showed 500 errors for `Damaged / Rejected Goods` and `Supplier Delivery / Receiving` because ExcelJS disallows `/` in worksheet names. Added `safeSheetName()` in `backend/src/services/exports.js`, applied it to both report and record workbooks, and added a regression assertion that all eight reports produce valid `PK` workbooks.

## 7. Notes and caveats

- All changes remain **uncommitted**; no commit was made during verification.
- MySQL volume `procument_mysql_data` was preserved; only backend/frontend containers were rebuilt.
- `GOOGLE_TOKEN_ENCRYPTION_KEY` remains present in `backend/.env` and was not changed, so the stored Gmail refresh token remains decryptable.
- The prior external Cloudflare quick tunnel `https://speeches-beef-charleston-live.trycloudflare.com` is **not currently resolvable**. Local HTTP verification passed. If external HTTPS access is required again, the tunnel must be recreated and the Google redirect URI must match `https://speeches-beef-charleston-live.trycloudflare.com/api/email/google/callback`.
- `frontend/src/components/portals/StockKeeperIssueRequests.jsx` remains an untracked legacy component and is no longer imported by `frontend/src/App.jsx`; it was left in place rather than deleted because it may contain prior user work.
- Messages remain intentionally absent from the Stock Keeper sidebar because the backend role firewall does not authorize them.

## 8. Sign-off

The Stock Keeper redesign and end-to-end QA are complete. Automated suites, production build, live container health, role firewall, workflow endpoints, and all 24 report/download combinations passed. The only outstanding action is an explicit user decision to commit the uncommitted changes and, if needed, restore the external tunnel.
