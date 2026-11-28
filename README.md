# Hope Haven Procurement & Inventory Management System

A full-stack procurement and stores application for Hope Haven. It connects purchase requests, approvals, supplier quotations, purchasing, goods receiving, inventory, store issues, invoicing, and user administration.

## Stack

- **Frontend:** React, Vite, Tailwind CSS
- **Backend:** Node.js, Express
- **Database:** MySQL 8+
- **Authentication:** JWT, bcrypt password hashes, role-based access checks

## Getting started

### 1. Start the MySQL database in Docker

Make sure Docker Desktop is running. Copy the Docker settings and backend settings:

```powershell
Copy-Item .env.docker.example .env
Copy-Item backend\.env.example backend\.env
```

The backend environment file contains placeholders. Set its `DB_USER` and `DB_PASSWORD` to match `DB_USER` and `DB_PASSWORD` in the root `.env`, and set a unique `JWT_SECRET` of at least 32 characters. The database container creates the `Procument` database, loads `backend/database/schema.sql` on first startup, and persists data in the `procument_mysql_data` Docker volume.

The backend requires `DB_HOST`, `DB_USER`, `DB_NAME`, and `JWT_SECRET`. `DB_PORT` defaults to `3307`; `PORT` defaults to `4000` in development and must be set in production. Production also requires `DB_PASSWORD`.

Start the database from the project root:

```powershell
docker compose up -d mysql
docker compose ps mysql
```

The backend container connects to MySQL at `mysql:3306`; local Node processes connect through the published port at `127.0.0.1:3307`. The schema and sample supplier and inventory records are initialized only when the Docker volume is empty.

If Docker is not available, an existing local MySQL/MariaDB server can be used instead: set `DB_PORT=3306` (or the local server's port), `DB_HOST`, `DB_USER`, `DB_PASSWORD` and `DB_NAME` in `backend\.env` to match that server, and make sure the `Procument` schema from `backend/database/schema.sql` is loaded. Generate `JWT_SECRET` locally with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. The backend refuses to accept placeholder values or start before the database connection succeeds.

### 2. Configure and access the administrator

In `backend\.env`, set a long random `JWT_SECRET` (at least 32 characters) and the intended owner identity:

```text
ADMIN_NAME=Hope Haven Administrator
ADMIN_EMAIL=admin@hopehaven.org
```

Install dependencies:

```powershell
npm install
npm install --prefix backend
npm install --prefix frontend
```

If an administrator account already exists, replace a forgotten password with the secure reset utility. From the `backend` directory it prompts with masked input, asks for confirmation, validates strength, hashes with bcrypt (cost 12), and verifies login and admin access:

```powershell
cd backend
npm run admin:reset-password
```

If the `users` table is empty (no administrator has ever been provisioned), opt in explicitly to create only the initial account described by `ADMIN_EMAIL` and `ADMIN_NAME`:

```powershell
cd backend
npm run admin:reset-password -- --bootstrap
# PowerShell may consume npm's "--" separator; this also works:
# $env:ADMIN_BOOTSTRAP='1'; npm run admin:reset-password
```

The utility refuses to create duplicate accounts, never prints the password or its hash, and does not touch other users. `ADMIN_PASSWORD` is only used by the older `npm run create-admin` helper; it is not needed for sign-in after a reset.

Use the configured email and the password you entered to sign in. Do not commit `.env` files.

### Supplier email delivery

The backend uses one generic SMTP integration (`nodemailer`). No provider is assumed: set `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_REQUIRE_TLS`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_FROM_NAME` and `APP_BASE_URL` in `backend\.env` using the values issued by your organization's email provider. Use implicit TLS with `SMTP_SECURE=true` on port 465, or STARTTLS with `SMTP_SECURE=false` and `SMTP_REQUIRE_TLS=true` on the provider's submission port. Start the backend to see a warning when any value is missing; RFQs still save correctly, but their invitation deliveries are recorded as `Failed` until the configuration is corrected.

The Create RFQ form takes a send-date range (start date and deadline) and a searchable multi-select of active Suppliers showing each Supplier's name and email; multiple Suppliers can be invited in one RFQ. When the RFQ is created, each selected Supplier receives one individual email built as a requisition form: request details, the send-date range, a requested-items table with quantities, unit prices and totals, plus their own signed `#/supplier/RFQ?token=…` response link. The token is HMAC-signed with `JWT_SECRET` and contains only that RFQ and Supplier's identifiers; it cannot be used to open another Supplier's quotation. The Supplier page is public but token-gated and shows the same requisition form, where the Supplier can submit or update their response and notes. No other Supplier's email address or link is included in the message.

Delivery status is intentionally truthful: SMTP acceptance is shown as **Accepted by Email Provider**, never **Delivered**. Set `EMAIL_WEBHOOK_SECRET` and point the provider's generic delivery webhook to `POST /api/email/webhooks/generic` with header `x-email-webhook-secret` to record provider-confirmed `Delivered`, `Bounced` and `Opened` statuses. Opening the signed link also records `Opened`. Administrators can verify SMTP authentication, send a test to their own account, retry only failed recipients, and explicitly resend an individual link from the RFQs page.

**Domain authentication is the domain owner's responsibility.** Ask the actual email provider for the exact SPF, DKIM and DMARC records required for the sending domain and enter those values at the DNS registrar; no records are invented by this application. Also verify the sender email/domain in the provider account, confirm the account is activated, and check its sending limits. SPF/DKIM/DMARC problems usually cause spam placement or rejection even when SMTP authentication succeeds.

### Google inbox and email composition

The **Email Inbox** page is available to Administrators and Procurement users. It can connect one Google mailbox, sync the 25 most recent inbox messages (up to 100 are retained in the app), display plain-text message bodies, and send one-recipient messages through Gmail API. Existing SMTP settings remain supported and are used for RFQ/supplier email delivery when configured; Gmail API is the fallback when SMTP is not configured. Inbox sync is manual, and messages opened in the app are not marked read in Gmail.

On a received request, **Send to another user** sends a formatted requisition form built from the saved request items, including item descriptions, unit prices, quantities and totals. The email contains a public `#/response?token=…` link where the recipient can view the same form, write a comment and submit it directly into Procurement without signing in. The token is a unique database-backed value created for that outbound form and recipient. Each form also carries a reply tag linked to the requisition, so a recipient who prefers email can reply instead: when the mailbox is synced, a matching `Re:` reply is stored as a comment on that requisition. Either submission method adds the comment to request history, shows it under **G. Email comments**, and notifies Administrators and Procurement users. The **Check email replies** button on the document page triggers mailbox sync and refreshes the comments.

To connect Google:

1. In Google Cloud Console, enable the Gmail API for the project and create a **Web application** OAuth client. For a Workspace organization, use the internal audience where available.
2. Add this exact local authorized redirect URI to the OAuth client: `http://localhost:4000/api/email/google/callback`. In production, use `https://<your-api-domain>/api/email/google/callback` and set that same value in `GOOGLE_OAUTH_REDIRECT_URI`.
3. Configure the OAuth consent screen to request `openid`, `email`, `https://www.googleapis.com/auth/gmail.readonly`, and `https://www.googleapis.com/auth/gmail.send`. The connected Google account must match `GOOGLE_MAILBOX`.
4. In `backend\.env`, set `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`, and `GOOGLE_MAILBOX`. Generate `GOOGLE_TOKEN_ENCRYPTION_KEY` as a random 32-byte (64-character hex) key using the command in `backend\.env.example`. Back up this key securely; losing it makes the stored refresh token unreadable.
5. Restart the backend, sign in as an Administrator or Procurement user, open **Email Inbox**, and choose **Connect Google mailbox**. Approve access for the configured mailbox, then use **Sync inbox** to fetch messages.

The backend stores the OAuth refresh token encrypted with AES-256-GCM and stores only a hash of each short-lived OAuth state value. Never commit `backend\.env` or share OAuth client secrets. If a client secret has been exposed, rotate it in Google Cloud before configuring the app. A non-local production callback must use HTTPS. Gmail API access may require Workspace policy approval or Google OAuth verification, depending on the consent-screen audience.

### 3. Run the application

To build and run the frontend, API, and MySQL in Docker from the project root:

```powershell
docker compose up --build -d
docker compose ps
```

Open `http://localhost:5173`. The API is at `http://localhost:4000`; follow container output with `docker compose logs -f frontend backend`. Stop the containers with `docker compose down`; the database volume is preserved.

To run the frontend and API as local Node processes instead:

```powershell
npm run dev
```

The backend can also be started on its own with:

```powershell
npm run dev --prefix backend
```

Or, from the `backend` directory, use `npm run dev` for development or `npm start` for a normal start. The backend waits for a successful MySQL connection before listening. The frontend is at `http://localhost:5173`, the API is at `http://localhost:4000`, and its health endpoint is `http://localhost:4000/api/health`. To run either side separately, use `npm run dev:frontend` or `npm run dev:backend`.

Run the API and role-navigation tests with `npm test --prefix backend` and `npm test --prefix frontend`. Check the production assets with `npm run build --prefix frontend`.

## Included workflows

- JWT sign-in, bcrypt password hashes, role-based API access, and administrator-managed users
- Multi-item purchase requisitions, supervisor decisions, and in-app notifications
- Supplier directory and RFQ distribution to multiple suppliers
- Quotation capture and committee scoring across price, delivery, quality, and supplier rating
- Supplier award, purchase-order approval, PO-linked/direct goods receipts, and stock movement records
- Inventory catalogue, categories, reorder thresholds, receipt tracking, and low-stock dashboard
- Store requests with approval and transactional stock issue (issues fail rather than allowing negative stock)
- Storekeeper pre-delivery review of purchase-order items after the signed official PO is sent to the supplier; accepted lines create one stock receipt, rejected lines never enter stock
- Invoice submission after a goods receipt, finance approval/rejection, and paid status
- Departments, audit log records, and notification inbox
- Three role-based portals with protected layouts, dashboards, sidebars, and role-specific pages
- Business-date tracking, UTC storage with local display, reusable date filters, and branded print/download reports

## Role-based portals

Sign-in routes each account to a portal derived from its current database role and Department. The portal is never chosen by the browser. Authentication reloads the role and Department on every API request, so admin changes take effect immediately.

| Portal | Database role | Landing page |
| --- | --- | --- |
| Administrator Portal | `admin` | Existing system-wide Overview |
| Department Supervisor Portal | `supervisor` | Supervisor Dashboard |
| Requester Portal | `requestor` | Requester Dashboard |

Every Department can have one active Supervisor and one or more Requesters. A Supervisor or Requester must be assigned to the Department they work in. Administrators manage these assignments from Users Management; attempting to create a second active Supervisor for a Department is rejected unless **Replace existing Supervisor** is selected, which deactivates the former Supervisor. `procurement` signs into the Administrator shell with page restrictions; `approver`, `storekeeper`, `finance`, and `committee` also use Administrator-side pages allowed for their role.

Supervisor approval only records the Supervisor decision. The separate **Forward to Procurement** action is the only route into Procurement; forwarded requests are identified by both the forwarding marker and `forwarded_at`, never by status alone. Direct URLs to another portal are blocked in the UI, and the API independently rejects unauthorized roles and Department IDs. Supervisor and Requester accounts can access `/auth/me`, notifications, their portal endpoints, and their own role-scoped exports, but not the legacy management/workflow APIs.

The Storekeeper portal has `Dashboard`, `List of Requesters`, `Notification`, `Display before delivery`, `Bin Card`, and `Profile`. Submitting the official purchase order send action queues every ordered line in `Display before delivery` and notifies Storekeepers; this internal handoff is not blocked by an offline or unconfigured email provider. Accepting a line creates or matches an inventory catalogue item, increases its quantity, and records a `Receipt`/`In` movement; rejecting a line records the reason and actor only, with no catalogue item or stock movement. Decisions are final and audited.

The Goods receipts workspace shows suppliers as soon as their purchase orders are sent. Selecting a supplier displays its registered contact, telephone, email, address, and sent purchase orders. Each order must first be **Allow**ed or **Denie**d: a denied order is removed from the workspace, while an allowed order unlocks **Create GRN**. That action opens a Good Received Note form matching the official layout (`Receiving Department`, `Tel. No.`, `Supplied by`, `Quantity`, `Unit`, `Description item received`, `Comment`, `Received by`, `Verified by`, and `Date`) prefilled from the sent purchase order. Upload a signature photo under both **Received by:** and **Verified by:**; the images are required, normalised to compact WebP, stored with the GRN, and embedded in the generated PDF. Rejected lines are never included; pending and accepted lines can be documented. The GRN records the document and its comments without adding stock — Storekeeper acceptance remains the only stock movement — then emails the generated GRN PDF to the supplier's registered address. A failed or unconfigured email provider is reported in the form without rolling back the GRN.

## Dates, printing and downloads

Each module uses its own lifecycle dates (submission, Supervisor decision, forwarding, RFQ issue/due/close, PO approval/delivery, goods receipt, invoice submission/approval/payment, store issue, inventory movement, user last login, and audit activity). Timestamps are stored in UTC and displayed as `DD/MM/YYYY` (with time where it matters) in `VITE_DISPLAY_TIMEZONE`, which defaults to `Africa/Kigali`. Set the same value in the frontend build environment when deployed elsewhere.

List pages provide Today, Yesterday, This week, This month, This quarter, This year, and custom range presets. Date filters work alongside search, status, and module filters and are passed to both the list query and the report export. Invalid ranges and reversed business dates are rejected, and audit timestamps cannot be edited through the application.

Printable views use the branded A4 layout with logo, title, reference, dates, approval details, hidden navigation/controls, clean page breaks, and page numbers. Downloads are generated server-side as PDF for official documents, Excel `.xlsx` for tabular/financial data, and CSV for simple datasets. Reports are scoped by role: Requesters export only their own requisitions, Supervisors only their Department, and Administrator-side datasets follow the existing role permissions. Every export is authenticated and written to the audit log.

## API overview

All endpoints are prefixed with `/api`. Except for sign-in and `/health`, requests require `Authorization: Bearer <token>`.

| Method | Endpoint | Access |
| --- | --- | --- |
| `GET` | `/health` | Public |
| `POST` | `/auth/login` | Public |
| `GET` | `/auth/me` | Signed in |
| `GET` | `/portal/session` | Signed in |
| `GET` | `/portal/supervisor/summary` | Supervisor |
| `GET` | `/portal/requester/summary` | Requester |
| `GET` | `/portal/supervisor/requesters` | Supervisor |
| `GET` | `/portal/department`, `/portal/department/:id` | Supervisor, Requester (own Department only) |
| `GET` | `/dashboard` | Signed in |
| `GET`, `POST` | `/requisitions` | Signed in |
| `PATCH` | `/requisitions/:id/decision` | Admin, approver |
| `GET` | `/rfqs`, `/rfqs/:id/quotations` | Signed in |
| `POST` | `/rfqs` | Admin, procurement |
| `GET` | `/email/google/callback` | Public OAuth callback (one-time state required) |
| `GET` | `/email/google/status`, `/email/google/connect` | Admin, procurement |
| `POST` | `/email/google/disconnect`, `/email/inbox/sync`, `/email/send`, `/email/requisitions/:id/send` | Admin, procurement |
| `GET` | `/email/inbox/messages`, `/email/inbox/messages/:id` | Admin, procurement |
| `POST` | `/rfqs/:id/quotations` | Admin, procurement, committee |
| `POST` | `/rfqs/:id/award` | Admin, committee |
| `GET`, `POST` | `/purchase-orders` | Signed in / Admin, procurement |
| `PATCH` | `/purchase-orders/:id/decision` | Admin, approver |
| `GET`, `POST` | `/goods-receipts` | Signed in / Admin, storekeeper, procurement |
| `GET` | `/goods-receipts/sent-suppliers` | Admin, storekeeper, procurement |
| `POST` | `/goods-receipts/supplier-decision` | Admin, storekeeper, procurement |
| `POST` | `/goods-receipts/from-supplier` | Admin, storekeeper, procurement |
| `GET` | `/inventory`, `/inventory/categories` | Signed in |
| `POST` | `/inventory/items` | Admin, storekeeper |
| `PATCH` | `/inventory/items/:id` | Admin, storekeeper |
| `GET` | `/inventory/movements` | Admin, procurement, storekeeper |
| `GET`, `POST` | `/store-requests` | Signed in |
| `PATCH` | `/store-requests/:id/decision` | Admin, approver |
| `POST` | `/store-requests/:id/issue` | Admin, storekeeper |
| `GET` | `/portal/stockkeeper/deliveries`, `/portal/stockkeeper/deliveries/:id` | Storekeeper |
| `POST` | `/portal/stockkeeper/deliveries/:id/accept` | Storekeeper |
| `POST` | `/portal/stockkeeper/deliveries/:id/reject` | Storekeeper |
| `GET`, `POST` | `/invoices` | Signed in / Admin, procurement |
| `PATCH` | `/invoices/:id/decision` | Admin, finance |
| `GET` | `/notifications` | Signed in |
| `PATCH` | `/notifications/:id/read` | Signed in |
| `GET` | `/suppliers` | Signed in |
| `POST` | `/suppliers` | Admin, procurement |
| `GET`, `POST` | `/admin/users`, `/admin/departments` | Admin |
| `GET` | `/admin/audit-logs` | Admin |
| `GET` | `/exports/available` | Signed in (role-scoped list) |
| `GET` | `/exports/:key/:format` | Signed in (role-scoped report: `pdf`, `xlsx`, `csv`) |
| `GET` | `/exports/record/:type/:id/:format` | Signed in (record visibility checked) |

The purchase order send endpoint returns `deliveryQueued: true` whenever the Storekeeper handoff is complete, including when email delivery itself fails.

## Project structure

```text
backend/
  database/schema.sql              MySQL schema and demo catalogue
  src/config/db.js                 MySQL connection pool
  src/lib/events.js                Audit and notification helpers
  src/middleware/auth.js           JWT authentication and role checks
  src/routes/                      Auth, portal, inventory, procurement, finance, and admin APIs
  src/middleware/auth.js           Database-backed JWT authentication and role checks
  src/utils/roles.js               Portal/role mapping shared by auth and routes
  src/scripts/create-admin.js      Secure initial administrator setup
  test/app.test.js                 API smoke, portal RBAC, and access-control tests
frontend/
  src/components/layout/           Administrator app shell and navigation
  src/components/portals/          Role-based layouts, sidebars, dashboards, and placeholders
  src/components/ui/               Reusable cards, dialogs, and status badges
  src/pages/                        Feature-specific screens
  src/services/api.js              Authenticated API client
  src/utils/access.js              Frontend role/portal permissions
  src/utils/routes.js              Protected hash routes
  src/App.jsx                      Portal selection, state, and API orchestration
  src/index.css                     Tailwind and global styles
docker-compose.yml                  Persistent MySQL 8.4 service
```

## Notes

This project includes the core end-to-end workflows and generic SMTP supplier email delivery, but still needs deployment-specific production work: realtime push notifications, password reset, document uploads/attachments, formal forecasting, and payment-provider integration. The bundled Docker credentials are for local development only; replace them before exposing the database beyond your machine. The bundled supplier and inventory records are sample data.

The browser UI calls `/api` on the same origin as the page; Vite proxies that path to `http://localhost:4000` in both `npm run dev` and `vite preview`. This keeps sign-in working even when you open the frontend at `http://<your-ip>:5173` instead of `localhost` (no CORS preflight involved). If the API runs on a different host or port, set `API_PROXY_TARGET` (for example `http://192.168.1.10:4000`) when starting Vite. In Docker Compose the frontend container sets `API_PROXY_TARGET=http://backend:4000`, because `localhost` inside that container is the frontend itself. Copy `frontend\.env.example` to `frontend\.env.local` to override `VITE_API_URL`. During development, localhost and private-network origins are allowed by the API; production permits only `CLIENT_ORIGIN`.

### Department hierarchy

Admin → Users is organised as **Department → Subdepartment → User**:

- The only departments and subdepartments are:
  - `Administration` → `Procurement`
  - `Education`
  - `Facility` → `IT`
  - `Stores` → `StoreKeeper`
- The startup seeder creates these rows and removes anything else from an existing database. Linked users and historical records from removed departments are reassigned to `Procurement`; nothing is deleted.
- Add users only inside a subdepartment. The API rejects assigning a user directly to a top-level department.
- Deleting a department with subdepartments is blocked until those subdepartments are moved or deleted.
