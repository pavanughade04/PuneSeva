# Pune Seva

**Your City, Your Services, One Platform.**

Pune Seva is a local-services marketplace for customers and service professionals in Pune. The project includes a responsive public homepage, database-backed customer/provider registration and session login, and role-protected customer and provider dashboards for profile, service, and booking management.

## Current features

- Responsive homepage with searchable service categories.
- Customer and provider registration using the existing MySQL tables.
- Password hashing with bcryptjs.
- Session-based login, logout, and current-user endpoint.
- Private, configurable admin sign-in URL for existing administrator accounts; there is no public admin signup or public admin login link.
- Role-protected customer, provider, and admin landing pages.
- Provider applications start with `pending` approval.
- Customer dashboard with booking history, profile editing, reviews, and public service browsing.
- Provider dashboard with profile editing, service management, booking status actions, and approval status.
- Provider service approval counts, creation dates, and availability controls.
- Provider service listings include a required service location; edited listings return to pending approval.
- Providers can upload optional JPEG, PNG, or WebP service images (up to 5 MB); images are signature-checked and stored with generated filenames.
- Public service listings include only available services approved by an active, approved provider.
- Public services catalog with search, category/location filters, price sorting, and safe service details.
- Admin service review queue with admin-only approve/reject actions.
- Pending providers can save inactive service drafts but cannot activate services.
- Customer booking requests, provider status management, and booking history, using the existing bookings table.
- Admin overview with live database totals and recent marketplace activity.
- Admin customer, provider, service, booking, review, and contact-message management with search, filters, and pagination.
- Admin moderation actions retain reasons in an audit log; booking cancellation follows the existing booking state rules.
- Development-only first-admin seed script; no public admin signup.
- Dry-run-first demo service seeding with both a fill-to-20 mode and an additive 12-category mode; existing records are preserved.
- MySQL-backed session storage and login rate limiting.

## Technology

- HTML, CSS, vanilla JavaScript
- Node.js 20+, Express 4
- MySQL 8 and mysql2
- bcryptjs, express-session, express-validator, express-rate-limit, dotenv

## Project structure

```text
frontend/
  index.html
  login.html
  register.html
  provider-register.html
  customer-dashboard.html
  provider-dashboard.html
  admin-dashboard.html
  css/
  js/
backend/
  config/db.js
  middleware/auth.js
  middleware/service-image-upload.js
  routes/auth.js
  routes/customer.js
  routes/provider.js
  routes/services.js
  services/
  server.js
  seed-admin.js
  .env.example
database/
  pune_seva.sql
  phase4_dashboard.sql
  phase5_services.sql
  phase5_service_images.sql
  phase6_bookings.sql
  phase7_admin_audit.sql
```

## Prerequisites

- Node.js 20 or newer and npm
- MySQL 8 running locally
- A MySQL account with access to the `pune_seva` database and permission to create the `sessions` table

## Database and environment setup

The application reuses the existing `users`, `customer_profiles`, `provider_profiles`, and `services` tables. `database/pune_seva.sql` is the canonical schema for a new installation and matches the columns used by the dashboard APIs. It also creates `bookings` and `reviews`; `database/phase4_dashboard.sql` is only for an existing database built with that same schema when one or both of those tables are missing. Both scripts use `CREATE TABLE IF NOT EXISTS`, but that does not update an existing table with different columns or key types. For an existing database, inspect its table definitions first and do not run either script as a schema-upgrade shortcut. The server creates separate `sessions` and `contact_messages` tables if they do not already exist. Contact messages are rate-limited and saved for the Pune Seva team; no outbound email is sent.

For a **new, empty installation only**, run this from the project root (MySQL will prompt for the password):

```powershell
mysql -u your_mysql_user -p < database/pune_seva.sql
```

Do not run the bootstrap script against a database with existing data to try to change its schema; `IF NOT EXISTS` leaves existing table definitions untouched. The checked-in `phase4_dashboard.sql` is not a conversion script for older `bookings` or `reviews` layouts.

For an existing database using the current `services` table, back it up and run `database/phase5_services.sql` once to add the service-specific location field and its index, then run `database/phase5_service_images.sql` once to add the optional image path. Existing listings receive the default location `Pune`; image values remain empty until providers upload one. Do not run either migration for a new database created from `pune_seva.sql`, or rerun one if its column already exists. If your services table differs from the canonical schema, inspect it before applying the migrations.

For an existing database with the legacy `bookings` table, inspect `SHOW CREATE TABLE bookings` and back it up, then apply `database/phase6_bookings.sql` once:

```powershell
mysql -u your_mysql_user -p < database/phase6_bookings.sql
```

The migration adds the in-progress status, customer contact and provider rejection reason fields, and the slot lookup index; it also backfills contact numbers on historical bookings where the customer account has one. Do not run it if these changes already exist, or against a schema with different booking columns. New installations already receive the Phase 6 booking fields from `database/pune_seva.sql`.

For an existing database, back it up and apply `database/phase7_admin_audit.sql` once before using the admin moderation actions. It creates the additive `admin_audit_log` table used to record reasons for provider/service rejection, admin booking cancellation, and review removal. New installations already receive this table from `database/pune_seva.sql`. Do not rerun this migration as a schema-upgrade mechanism for other tables.

Keep the existing `backend/.env` file and its database credentials. If setting up a new local copy:

```powershell
Copy-Item backend\.env.example backend\.env
```

Set `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, and `DB_NAME` in `backend/.env`. Set a persistent, random session secret (at least 32 characters). Generate one with:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Copy the output into `SESSION_SECRET` in `backend/.env`. Development can start without this value, but its generated session key is temporary and existing logins will not survive a server restart. Production refuses to start without a persistent secret.

Set `ADMIN_LOGIN_PATH` to an unguessable absolute path in `backend/.env`. Generate a random value with:

```powershell
node -e "console.log('/admin-' + require('crypto').randomBytes(24).toString('hex'))"
```

Keep the generated path private and do not commit `.env`. Production requires this setting to be at least 24 characters. Open the admin sign-in by appending its value to the same-origin server URL; it is not linked from public pages or returned by APIs. The old `/admin-login.html` page and `/api/auth/admin-login` endpoint are disabled on the server.

## Install and run

From the project root:

```powershell
npm --prefix backend install
npm --prefix backend start
```

Open [http://localhost:3000](http://localhost:3000). Dashboard pages and `/api/...` calls must use this Express origin; pages opened on separate VS Code Live Server ports (such as `4319` or `4322`) send API requests to the wrong server and may show `500`, `404`, or connection-refused errors. Do not use `file://` or a separate static server for authenticated pages. Authentication pages check the Express health endpoint before allowing sign-in or registration and point to the correct origin if opened from another server. Keep a persistent `SESSION_SECRET` in `backend/.env`; this project also stores sessions in MySQL. Sessions expire after 8 hours, so signing in again after that is expected. For automatic backend restarts while developing, run `npm --prefix backend run dev`.

## Backups and production deployment

Before applying a schema migration or changing production data, create a database dump outside the project directory. MySQL's `-p` option prompts for the password; do not put it in the command line:

```powershell
$backupDirectory = Join-Path $env:USERPROFILE 'PuneSevaBackups'
New-Item -ItemType Directory -Force -Path $backupDirectory | Out-Null
$backupFile = Join-Path $backupDirectory ("pune_seva-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + ".sql")
mysqldump --host=localhost --port=3306 --user=your_mysql_user --password --single-transaction --routines --triggers pune_seva > $backupFile
if ($LASTEXITCODE -ne 0) { throw 'Database backup failed; do not apply the migration.' }
Write-Output "Backup saved to $backupFile"
```

Use the correct host, port, user, and database for the installation. Keep dumps in encrypted, access-controlled storage and verify a restore against a separate, empty test database before relying on a backup. Do not restore over a live database as a routine test.

The current app is a traditional, long-running Express server that also serves the frontend. The included [`render.yaml`](./render.yaml) prepares a single Render Node web service; configure its unsynced database and session variables in the hosting dashboard. Use a managed MySQL 8 database reachable from the service. This same-origin arrangement needs no separate frontend API base URL or permissive CORS configuration. Deploying the static frontend separately to Vercel is not compatible as-is because its relative `/api/...` requests would go to the frontend host; that would require a separately configured API base URL and narrowly scoped CORS/session-cookie changes.

Production configuration:

- Node.js 20 or newer; start with `npm --prefix backend start`.
- Set `NODE_ENV=production`. The host supplies `PORT`.
- Set `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, and `DB_NAME` for the managed MySQL database.
- Remote MySQL connections use TLS automatically in production with certificate verification enabled. Set `DB_SSL=true` to require TLS in development as well; do not disable certificate verification for a production database.
- Set `SESSION_SECRET` to a persistent random value of at least 32 characters. Generate one locally with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` and store it only in the host's secret environment-variable manager.
- Set `ADMIN_LOGIN_PATH` to a private, unguessable path of at least 24 characters and store it in the host's environment-variable manager. The corresponding sign-in URL is the site origin plus this path.
- The health check is `GET /api/health`; it returns success only when MySQL is reachable.
- Apply only the schema migrations appropriate to the target database after taking and verifying a backup. Do not use the new-install SQL bootstrap against an existing database.
- Configure the host's proxy/TLS and database network access according to the provider's instructions. Do not deploy the development admin seed script or commit `.env`.

## Create the first admin account

There is no public admin registration. In a separate PowerShell terminal, set credentials interactively and run the development-only seed script. The script refuses to run outside `NODE_ENV=development`, requires a strong password, and will not replace an existing admin:

```powershell
Set-Location backend
$env:NODE_ENV = 'development'
$env:ADMIN_NAME = Read-Host 'Admin name'
$env:ADMIN_EMAIL = Read-Host 'Admin email'
$securePassword = Read-Host 'Admin password (12+ characters)' -AsSecureString
$env:ADMIN_PASSWORD = [System.Net.NetworkCredential]::new('', $securePassword).Password
npm run seed:admin
Remove-Item Env:ADMIN_NAME, Env:ADMIN_EMAIL, Env:ADMIN_PASSWORD
```

## Seed demo services

The demo service seed script discovers categories from the existing `services.category` values, selects only active, approved provider accounts, and proposes enough clearly tagged demo listings to reach 20 per category. It does not create providers or modify/delete existing services. Demo records use a `[DEMO]` name prefix and `[DEMO DATA]` description marker. Run a read-only preview first:

```powershell
Set-Location backend
npm run seed:demo-services
```

Only after reviewing the complete preview, use the apply option. The script rechecks the database, asks for an exact confirmation phrase, inserts in a transaction, and verifies that every discovered category has exactly 20 records:

```powershell
node seed-demo-services.js --apply
```

Back up the database before applying. If any category already exceeds 20 services or no active, approved providers exist, the script stops without inserting records. Categories are derived from `services.category` because some existing installations do not have the canonical `service_categories` table.

To add the expanded set of 12 categories (10 new services in each), preview the additions with:

```powershell
Set-Location backend
npm run seed:demo-categories
```

This mode preserves existing records and adds up to 10 uniquely named demo services to each configured category. Once those demo templates exist, rerunning the seed adds nothing. It uses existing active, approved providers, the Pune location, and approved/active listing status where the schema supports them. In the current preview, Electrician had 20 existing services and reached 30; the other 11 categories had no services and reached 10 each. Review the complete preview and back up the database before applying:

```powershell
node seed-demo-services.js --add-categories --apply
```

The script rechecks the database, requests the exact confirmation phrase for the number of records, inserts in a transaction, and verifies the final counts. Do not run the apply command until the preview and backup are reviewed.

## Registration and login

- Customer registration: [http://localhost:3000/register.html](http://localhost:3000/register.html)
- Provider registration: [http://localhost:3000/provider-register.html](http://localhost:3000/provider-register.html)
- Login: [http://localhost:3000/login.html](http://localhost:3000/login.html)
- Admin sign-in: private, configured through `ADMIN_LOGIN_PATH`; it is not linked publicly.

Provider accounts are created as pending. Until approval, providers can save inactive service drafts but cannot activate them. Even after provider approval, each new service must be approved before appearing in public listings. Customer, provider, and admin dashboards require a matching authenticated session and role. Admins can review and approve/reject service listings from the admin dashboard.

## Authentication API

- `POST /api/auth/register` — create a customer account
- `POST /api/auth/provider-register` — create a provider account and pending profile
- `POST /api/auth/login` — create a customer/provider session and return that role's dashboard URL; admin accounts use the private sign-in page
- `POST /api/auth/logout` — destroy the current session
- `GET /api/auth/me` — return the current safe user details, or `401`
- `GET /api/customer/dashboard`, `/api/customer/profile`, `/api/customer/bookings`, `/api/customer/reviews` — customer-only dashboard data
- `PUT /api/customer/profile` — update the signed-in customer's name and phone
- `GET /api/customer/bookings/:bookingId` and `PUT /api/customer/bookings/:bookingId/cancel` — customer-owned booking details and eligible cancellation
- `POST /api/customer/bookings` — create a booking for an approved, active service; accepts `serviceId`, `bookingDate` (`YYYY-MM-DD`), `bookingTime` (`HH:mm`, Pune local time), `address`, `phone`, and optional `notes`. The server uses the logged-in customer, selected service's provider, and database price.
- `GET /api/provider/dashboard`, `/api/provider/profile`, `/api/provider/services`, `/api/provider/bookings` — provider-only dashboard data
- `PUT /api/provider/profile` — update the signed-in provider's business profile
- `POST /api/provider/services`, `PUT /api/provider/services/:serviceId`, `DELETE /api/provider/services/:serviceId` — manage only the signed-in provider's services
- Provider service create/update requests may use `multipart/form-data` with an optional `image` file (JPEG, PNG, or WebP; maximum 5 MB).
- `PATCH /api/provider/services/:serviceId/availability` — toggle availability for an owned service
- `GET /api/provider/bookings/:bookingId` and `PUT /api/provider/bookings/:bookingId/status` — provider-owned booking details and status changes
- Provider status updates use `{"status":"accepted"}`, `{"status":"rejected","rejectionReason":"..."}`, `{"status":"in_progress"}`, or `{"status":"completed"}`. Only valid pending → accepted/rejected, accepted → in_progress, and in_progress → completed transitions are allowed.
- `GET /api/services`, `GET /api/services/categories`, `GET /api/services/locations`, `GET /api/services/:serviceId` — public search, categories, locations, and approved/available service details. Search accepts `search`, `category`, and `location`; sort accepts `newest`, `price_asc`, or `price_desc`.
- `POST /api/contact` — validate and save a contact message
- `GET /api/admin/dashboard/stats`, `GET /api/admin/dashboard/recent-activity` — admin-only marketplace totals and recent bookings, providers, and services
- `GET /api/admin/customers`, `GET /api/admin/customers/:id`, `PATCH /api/admin/customers/:id/status` — search/paginate customer accounts, inspect booking history, and update account status
- `GET /api/admin/providers`, `GET /api/admin/providers/:id`, `PATCH /api/admin/providers/:providerId/approve`, `PATCH /api/admin/providers/:providerId/reject`, `PATCH /api/admin/providers/:providerId/status` — manage provider profiles, services, bookings, approval, and account status
- `GET /api/admin/services`, `GET /api/admin/services/:id`, `PATCH /api/admin/services/:serviceId/approve`, `PATCH /api/admin/services/:serviceId/reject`, `PATCH /api/admin/services/:serviceId/status` — filter and manage existing service listings without deleting booking history
- `GET /api/admin/bookings`, `GET /api/admin/bookings/:id`, `PATCH /api/admin/bookings/:id/cancel` — search and inspect bookings; cancel only eligible bookings with a recorded reason
- `GET /api/admin/reviews`, `DELETE /api/admin/reviews/:id` — inspect reviews and remove one with a recorded reason
- `GET /api/admin/messages`, `GET /api/admin/messages/:id`, `PATCH /api/admin/messages/:id/status` — search, inspect, and update existing contact messages
- `GET /api/health` — verify MySQL connectivity

The session cookie is HTTP-only, SameSite=Lax, and Secure in production. Login attempts are rate limited. Responses never include password hashes. If a dashboard request appears to return 404, check the browser Network panel for the exact request URL, method, and responding origin. The profile update is `PUT /api/customer/profile`; an unauthenticated request to the matching route should return JSON `401`, not route-not-found `404`.

## Testing

Run the automated route tests from the project root:

```powershell
npm --prefix backend test
```

These tests use mocked database responses and do not insert test users, providers, or services. For manual checks, start the backend, then use an existing customer/provider/admin account. Verify a wrong password is rejected, a successful login opens the correct protected dashboard, and logging out returns you to the login page. Check the API health response at `/api/health`; a healthy database returns `"database":"connected"`.

After signing in:

- Customer dashboard: check booking counts/history, profile updates, reviews, and public-service search. Customers can cancel bookings in `pending` or `accepted` status and can see provider rejection reasons.
- Provider dashboard: check approval status, service create/edit/delete/availability and image upload, service approval counts and creation dates, profile updates, and received bookings. Providers can accept/reject `pending` bookings, start accepted bookings, and complete in-progress bookings.
- Public services page: search by name, filter by category/location, sort by price, open service details, and submit a booking with appointment date/time, address, phone, and notes. The provider receives the request in their dashboard.
- Upload a valid JPEG, PNG, or WebP service image under 5 MB and verify it appears on the provider card and public service listing; invalid types and oversized files should be rejected.
- Admin dashboard: check live summary counts and recent activity; search, filter, paginate, and inspect customer/provider/service/booking/review/message records. Verify provider/service approve/reject actions, status changes, eligible booking cancellation, and message resolution. Rejection, cancellation, and review-removal reasons require `database/phase7_admin_audit.sql` on an existing installation.
- Verify unauthenticated admin API requests receive `401`, customer/provider roles receive `403`, and the protected admin dashboard page is not served to non-admin users. Admin login uses an existing admin account; use the development-only seed instructions above only if one must be created.
- Verify that a pending provider can save an inactive draft, cannot activate a service, and does not appear in public results.
- Verify that dashboard APIs reject unauthenticated requests and that customer/provider roles cannot access each other's APIs.
- Do not add sample booking or review records solely to populate dashboard totals; empty states are expected when no real records exist.

Booking conflict protection currently prevents two pending, accepted, or in-progress bookings for one provider at the exact same start date and time. There is no provider availability or appointment-duration system, so overlapping appointments at different start times cannot yet be detected. No email or SMS notification provider is configured; booking updates are shown in the dashboards.

To call the APIs directly, send JSON requests from the same origin. Customer registration fields: `fullName`, `email`, `phone`, `password`, and `confirmPassword`. Provider registration also requires `businessName`, `experience`, `serviceArea`, and `description`.

## Out of scope

- Online payments, provider calendars/working hours, appointment durations, and email/SMS notifications.
