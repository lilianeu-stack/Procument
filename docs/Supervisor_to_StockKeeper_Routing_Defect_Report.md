# Supervisor → Stock Keeper Routing Defect — Technical Report

**Date:** 27 November 2026  
**Status:** Fixed and verified. The request appears in the authorized Stock Keeper's **Requests from Supervisors** page after **Send to Stock Keeper**.  
**Verification target:** live lowercase MySQL database `procument` on `127.0.0.1:3307`, rebuilt Docker backend/frontend, real HTTP APIs, and direct SQL reads.

## 1. Executive summary

The failure was not caused by a wrong requisition ID or a wrong destination string from the browser. The frontend was already calling `POST /portal/supervisor/requisitions/:id/route` with the correct requisition ID and one of the exact values `Procurement`, `Stock Keeper`, or `Split`.

The real defect was in the backend routing transaction and the Stock Keeper retrieval contract:

- When a requested line had no catalog match, stock verification returned `availableQuantity = 0` and `matched = false`.
- Under `Split`, the old allocation logic put the entire quantity into the **Procurement** branch and created no Stock Keeper allocation. If there was no Stock Keeper allocation, no `store_requests` row was created and no Stock Keeper notification was written.
- The Stock Keeper register was authoritative only on Procurement-style state and joined items with an inner join; it had no department/assignment scope. Free-text lines, routed rows with null catalog items, and unauthorized cross-department rows could therefore be missing or unsafe.
- The UI also discouraged or blocked the direct **Stock Keeper** choice for unmatched/insufficient stock, even though that is precisely the case where a Stock Keeper must review the line and return a shortage.

The fix makes `store_requests` the authoritative Stock Keeper register, writes it in the same transaction as the routing decision, assigns eligible Stock Keepers explicitly, preserves unmatched free-text lines without inventing catalog items, scopes every list/detail/action endpoint, and derives the required eight display states without overwriting the Supervisor's requisition status.

**Live result:** requisition **3207 / PR-2026-ECA28F**, routed with destination **Stock Keeper**, created store request **478 / SR-2026-003207**, appeared in Stock Keeper 810's register with status **New Request**, and remained visible after a fresh login.

## 2. Exact root cause

Live MySQL evidence before the fix:

| Requisition | Reference | Stored destination | Routing lines | `store_requests` | Item names |
| --- | --- | --- | --- | --- | --- |
| 2663 | `PR-2026-C004C3` | `Split` | Procurement only | none | `VBCXFG` (no catalog match) |
| 2998 | `PR-2026-5AE2B4` | `Split` | Procurement only | none | `HHHHHH` (no catalog match) |

`stockVerification()` returned `availableQuantity = 0` for those lines because no catalog item matched. The old `Split` branch used available stock as the Stock Keeper quantity, so zero stock meant:

1. `stockQuantity = 0`;
2. `purchaseQuantity = requestedQuantity`;
3. only a Procurement routing line was inserted;
4. `storeRequest` stayed `null`;
5. no `store_requests` row existed for the `Requests from Supervisors` query to return;
6. no Stock Keeper notification was created.

This also explains why the request appeared to be “routed” in Supervisor history but never appeared for the Stock Keeper: the routing decision was recorded on the requisition, but the destination-specific register row was never created.

Secondary defects found during the trace:

- `Split` routes that did create a `store_requests` row still skipped Stock Keeper notification.
- Retrieval had no department/assignment scope, so a guessed store request ID could expose another department's request.
- Retrieval inner-joined `items`, hiding any routed line whose free-text name had no catalog match.
- Orphaned QA `stock_routing` notifications pointed at deleted store request IDs 367–376 and inflated unread badges.
- The Supervisor sidebar omitted `SUPERVISOR_PAGES[5]` (`Approvals`).
- Notification navigation checked the raw alias before canonicalization, so some valid links were rejected by `canAccessPage()`.

## 3. Affected frontend and backend

### Frontend

| File | Defect / change |
| --- | --- |
| `frontend/src/components/portals/RequestDetail.jsx` | The exact payload was correct, but unmatched/insufficient stock wrongly discouraged direct Stock Keeper routing. Stock availability now reports `matched`; **Send to Stock Keeper** routes every requested line for review; `Split` remains the controlled partial-issue option. |
| `frontend/src/components/portals/StockKeeperSupervisorRequests.jsx` | Rebuilt the register around real routed rows: required columns, derived eight states, state-specific actions, null-item fallbacks, and real loading/empty/error rendering. |
| `frontend/src/components/portals/SupervisorSidebar.jsx` | Added the missing `Approvals` link. |
| `frontend/src/App.jsx` | Canonicalizes notification links before calling `canAccessPage()`. |
| `frontend/src/utils/status.js` | Added labels and tones for the eight Stock Keeper states. |
| `frontend/test/stockkeeper-workspace.test.js` | Static regressions for register columns/states/actions, unmatched routing, sidebar link, and canonical navigation. |

### Backend

| File | Defect / change |
| --- | --- |
| `backend/src/routes/portal.js` | Fixed the routing transaction: eligible scoped Stock Keepers, transactional assignments, Stock Keeper rows for unmatched/insufficient lines, notifications for `Stock Keeper` and `Split`, reference/department in notification bodies, duplicate-route guard, and orphan-notification guard in unread counts. |
| `backend/src/routes/stockkeeper.js` | Scoped register/detail/decision/shortage/issue endpoints through `requireActionScope()`; `LEFT JOIN items` with original requested name/unit fallbacks; derived eight states; `stockkeeper_viewed_at` distinguishes new from reviewed; zero authorized physical quantity allowed for unmatched shortage lines. |
| `backend/src/services/stockkeeper-scope.js` | New shared department/inventory scope: exact department, parent/child, siblings under the same parent, global Stock Keepers, or explicit per-request assignment. No fallback to all active Stock Keepers. |
| `backend/src/config/db.js`, `backend/database/schema.sql` | Idempotent runtime/fresh-install schema: nullable `store_request_items.item_id`, `requisition_item_id`, `requested_item_name`, `requested_unit`, `stockkeeper_viewed_at`, `store_request_assignments`, unique one-register-per-requisition index, and supporting FKs/indexes. |
| `backend/src/lib/notification-reads.js`, `api.js`, `workflows.js` | Shared `VALID_NOTIFICATION_SQL` excludes orphaned `stock_routing` rows from unread counts, lists, read marking, summaries, and module badges. |
| `backend/test/supervisor-routing.test.js` | Added regressions for unmatched free-text routing, Split notification, Procurement separation, failed-route notification absence, department scope, persistence, and badge/read behavior. |

## 4. Database relationship and query corrected

The authoritative chain is now:

```text
requisitions.id
  ├─ requisition_routing_lines.requisition_id
  ├─ requisition_activity.requisition_id
  └─ store_requests.requisition_id  (UNIQUE: uq_store_request_requisition)
       ├─ store_request_items.store_request_id
       │    ├─ requisition_items.id  (nullable: free-text lines survive)
       │    └─ items.id              (nullable: no invented catalog match)
       ├─ store_request_assignments.store_request_id → users.id
       └─ inventory_movements.store_request_id (physical issue only)
```

Key corrections:

- `requisitions.routing_destination` records the Supervisor's decision (`Procurement`, `Stock Keeper`, or `Split`) but is not the register itself.
- `store_requests` is the single authoritative Stock Keeper register row for a Supervisor-routed request; the unique index prevents duplicate/lost routes.
- `store_request_assignments` is written inside the same transaction as the route and is an authoritative per-request recipient grant.
- Supervisor department IDs are never used as Stock Keeper user IDs.
- `COALESCE(accepted_quantity, quantity)` remains the authorized issue quantity.
- The register query now requires:

```sql
sr.requisition_id IS NOT NULL
AND r.routing_destination IN ('Stock Keeper','Split')
AND r.status <> 'Cancelled'
AND <department-or-assignment scope clause>
```

- Items are read with `LEFT JOIN items i ON i.id = sri.item_id` and displayed as `COALESCE(i.name, sri.requested_item_name)` / `COALESCE(i.unit, sri.requested_unit, 'unit')`.
- The eight statuses are derived from `stockkeeper_decision`, `stockkeeper_viewed_at`, issued quantity, remaining quantity, and the requisition status. They are not written over the Supervisor's status.
- Stock Keeper-only routes intentionally leave `forwarded_at` null; the page displays `forwardedAt || routedAt`.

## 5. Automated verification

```text
Backend:  node --test --test-concurrency=1
          tests 131 / pass 131 / fail 0

Frontend: npm test
          tests 98 / pass 98 / fail 0

Build:    npm run build
          passed (only the pre-existing >500 kB chunk warning)
```

`applySchemaMigrations()` was executed successfully against `procument`. During this run a migration bug was found and fixed: `DELETE_RULE` is not a column of `information_schema.KEY_COLUMN_USAGE`; it is read from `REFERENTIAL_CONSTRAINTS` via a join.

Docker images were rebuilt with `--no-deps --build` and all three containers are healthy:

```text
procument-backend-1    Up (healthy)
procument-frontend-1   Up (healthy)
procument-mysql-1      Up (healthy)
GET /api/health        database=connected
```

## 6. Live E2E A–E

All tests used real API calls against `http://localhost:4000/api`; no row was inserted directly to make a request appear.

| Test | Live action | Result |
| --- | --- | --- |
| **A — successful routing** | Requester 805 submitted a free-text item `VBCXFG-LIVE-...` (no catalog match), Supervisor 804 approved and sent `destination: "Stock Keeper"` for requisition 3207. | HTTP 200; `storeRequestId=478`; register showed `PR-2026-ECA28F`, `New Request`, `Pending`, authorized Stock Keeper 810. **Request appeared: YES.** |
| **B — notification / badge / read** | Inspected notification 29908, checked `/sidebar-counts`, called `/notifications/read-module`, checked `/notifications` and `notification_read_receipts`. | Correct reference/department/link; unread badge `3 → 0`; notice `isRead=1`; receipt persisted. |
| **C — Procurement separation** | Procurement 809 requested `/procurement/received-requests/3207`; counted Procurement routing lines. | HTTP 404; zero Procurement routing lines; `forwarded_by_supervisor=NULL`. |
| **D — persistence after refresh/logout/login** | Fresh Stock Keeper login, repeated register and detail reads. | Same store request 478 found; reference `PR-2026-ECA28F`; decision still `Pending`. |
| **E — authorization scope** | Stock Keeper 4787 (department 1402) listed, opened, and attempted to accept store request 478. | List excluded it; detail 404; decision 404; decision remained `Pending`. |

Additional live checks:

- Duplicate `Send to Stock Keeper` returned HTTP 409; `store_requests` count for requisition 3207 stayed at 1.
- Final SQL row: `store_requests` 478, `requisition_id=3207`, `department_id=208`, `routed_by_supervisor=804`, `status=Approved`, `stockkeeper_decision=Pending`.
- Assignments: users 810 and 813, both eligible Stock Keepers in department 208.
- Routing line: destination `Stock Keeper`, quantity 4, `item_id=NULL`, original `requisition_item_id` preserved.
- Store line: `requested_item_name=VBCXFG-LIVE-...`, `requested_unit=unit`, quantity 4; no invented catalog item.
- Activity history: `created → submitted → approved_by_supervisor → routed_to_stock_keeper`.
- `inventory_movements` for store request 478: 0. Acceptance/routing does not decrement stock; only a physical issue does.

## 7. Remaining configuration and errors

No functional errors remain in the routing path. Items to be aware of:

- The Vite build emits the pre-existing >500 kB bundle-size warning; it is not a routing error.
- Backend test logs contain intentional `ESOCKET` failures for fake SMTP addresses used to prove email failure retry paths; those tests pass.
- The old external Cloudflare tunnel is still unresolved. Local HTTP verification passed; external HTTPS access would require recreating the tunnel and matching the Google redirect URI.
- `GOOGLE_TOKEN_ENCRYPTION_KEY` was not changed, so stored Gmail credentials remain valid.
- Messages remain intentionally absent from Stock Keeper navigation because the role firewall does not authorize them.
- `frontend/src/components/portals/StockKeeperIssueRequests.jsx` remains untracked legacy code and is not imported; it was not deleted.
- All changes remain **uncommitted** pending the user's decision.

## 8. Sign-off

The critical routing defect is fixed at the source: explicit Supervisor routing now creates a committed, scoped, notified Stock Keeper register row and the real request appears automatically in **Requests from Supervisors**. Backend 131/131, frontend 98/98, production build, Docker health, and live E2E A–E all passed.
