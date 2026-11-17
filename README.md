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

For local development, the example credentials match between the two files. Change `MYSQL_ROOT_PASSWORD`, `DB_USER`, and `DB_PASSWORD` in the root `.env` and set the matching `DB_USER` and `DB_PASSWORD` in `backend\.env` if you customize them. The database container creates the `Procument` database, loads `backend/database/schema.sql` on first startup, and persists data in the `procument_mysql_data` Docker volume.

Start the database from the project root:

```powershell
docker compose up -d
docker compose ps
```

The backend connects to the published MySQL port on `127.0.0.1:3307` (the container listens on 3306). The schema and sample supplier and inventory records are initialized only when the Docker volume is empty.

### 2. Configure and create an administrator

In `backend\.env`, set a long random `JWT_SECRET` (at least 32 characters) and administrator values:

```text
ADMIN_NAME=Hope Haven Administrator
ADMIN_EMAIL=admin@hopehaven.org
ADMIN_PASSWORD=use-a-unique-password-of-at-least-12-characters
```

Install dependencies and create the administrator account:

```powershell
npm install
npm install --prefix backend
npm install --prefix frontend
npm run create-admin --prefix backend
```

Use the email and password you configured to sign in. Do not commit `.env` files.

### 3. Run the application

From the project root:

```powershell
npm run dev
```

The frontend is at `http://localhost:5173` and the API is at `http://localhost:4000`. To run either side separately, use `npm run dev:frontend` or `npm run dev:backend`.

Run the API and role-navigation tests with `npm test --prefix backend` and `npm test --prefix frontend`. Check the production assets with `npm run build --prefix frontend`.

## Included workflows

- JWT sign-in, bcrypt password hashes, role-based API access, and administrator-managed users
- Multi-item purchase requisitions, supervisor decisions, and in-app notifications
- Supplier directory and RFQ distribution to multiple suppliers
- Quotation capture and committee scoring across price, delivery, quality, and supplier rating
- Supplier award, purchase-order approval, PO-linked/direct goods receipts, and stock movement records
- Inventory catalogue, categories, reorder thresholds, receipt tracking, and low-stock dashboard
- Store requests with approval and transactional stock issue (issues fail rather than allowing negative stock)
- Invoice submission after a goods receipt, finance approval/rejection, and paid status
- Departments, audit log records, and notification inbox

Available roles: `admin`, `requestor`, `approver`, `procurement`, `storekeeper`, `finance`, and `committee`. Administrators can create users from the Users screen; the starter intentionally does not expose public account registration. Shared read pages are available to signed-in users; Approvals is shown to approvers, Stock movements to storekeepers/procurement, and Users/Audit logs to admins. Action buttons follow the same backend role rules.

| Role | Main actions |
| --- | --- |
| Requestor | Submit purchase and store requests; view request, stock, supplier, and procurement status |
| Approver | Review requisitions, purchase orders, and store requests |
| Procurement | Manage suppliers, RFQs, quotations, purchase orders, receipts, and invoices |
| Committee | Record and evaluate quotations; award a supplier |
| Storekeeper | Maintain inventory, record receipts, review stock movement, and issue approved store requests |
| Finance | Review, approve/reject, and mark invoices paid |
| Admin | Access all modules, manage users/departments, and view audit logs |

## API overview

All endpoints are prefixed with `/api`. Except for sign-in and `/health`, requests require `Authorization: Bearer <token>`.

| Method | Endpoint | Access |
| --- | --- | --- |
| `GET` | `/health` | Public |
| `POST` | `/auth/login` | Public |
| `GET` | `/auth/me` | Signed in |
| `GET` | `/dashboard` | Signed in |
| `GET`, `POST` | `/requisitions` | Signed in |
| `PATCH` | `/requisitions/:id/decision` | Admin, approver |
| `GET` | `/rfqs`, `/rfqs/:id/quotations` | Signed in |
| `POST` | `/rfqs` | Admin, procurement |
| `POST` | `/rfqs/:id/quotations` | Admin, procurement, committee |
| `POST` | `/rfqs/:id/award` | Admin, committee |
| `GET`, `POST` | `/purchase-orders` | Signed in / Admin, procurement |
| `PATCH` | `/purchase-orders/:id/decision` | Admin, approver |
| `GET`, `POST` | `/goods-receipts` | Signed in / Admin, storekeeper, procurement |
| `GET` | `/inventory`, `/inventory/categories` | Signed in |
| `POST` | `/inventory/items` | Admin, storekeeper |
| `PATCH` | `/inventory/items/:id` | Admin, storekeeper |
| `GET` | `/inventory/movements` | Admin, procurement, storekeeper |
| `GET`, `POST` | `/store-requests` | Signed in |
| `PATCH` | `/store-requests/:id/decision` | Admin, approver |
| `POST` | `/store-requests/:id/issue` | Admin, storekeeper |
| `GET`, `POST` | `/invoices` | Signed in / Admin, procurement |
| `PATCH` | `/invoices/:id/decision` | Admin, finance |
| `GET` | `/notifications` | Signed in |
| `PATCH` | `/notifications/:id/read` | Signed in |
| `GET` | `/suppliers` | Signed in |
| `POST` | `/suppliers` | Admin, procurement |
| `GET`, `POST` | `/admin/users`, `/admin/departments` | Admin |
| `GET` | `/admin/audit-logs` | Admin |

## Project structure

```text
backend/
  database/schema.sql              MySQL schema and demo catalogue
  src/config/db.js                 MySQL connection pool
  src/lib/events.js                Audit and notification helpers
  src/middleware/auth.js           JWT authentication and role checks
  src/routes/                      Auth, inventory, procurement, finance, and admin APIs
  src/scripts/create-admin.js      Secure initial administrator setup
  test/app.test.js                 API smoke and access-control tests
frontend/
  src/components/layout/           Shared app shell and navigation
  src/components/ui/               Reusable cards, dialogs, and status badges
  src/pages/                        Feature-specific screens
  src/services/api.js              Authenticated API client
  src/App.jsx                       App state and API orchestration
  src/index.css                     Tailwind and global styles
docker-compose.yml                  Persistent MySQL 8.4 service
```

## Notes

This project includes the core end-to-end workflows, but still needs deployment-specific production work: email delivery, realtime push notifications, password reset, document uploads/attachments, PDF/Excel exports, formal forecasting, and payment-provider integration. The bundled Docker credentials are for local development only; replace them before exposing the database beyond your machine. The bundled supplier and inventory records are sample data.

The browser UI defaults to `http://localhost:4000/api`; copy `frontend\.env.example` to `frontend\.env.local` and change `VITE_API_URL` if the API runs elsewhere. During development, local frontend ports are allowed; production permits only `CLIENT_ORIGIN`.
