# Pune Seva

**Your City, Your Services, One Platform.**

Pune Seva is a local-services marketplace connecting customers with trusted service professionals in Pune. It provides a responsive service-discovery platform, secure customer and provider authentication, role-based dashboards, service management, booking workflows, and an administrative moderation system.

The application uses a Node.js and Express backend, MySQL database, and a Netlify serverless deployment architecture.

## Features

### Customer
- Customer registration and secure login.
- Personal dashboard and profile management.
- Browse and search approved services.
- Filter services by category and location.
- Sort services by price.
- View service details and provider information.
- Submit service booking requests.
- View booking history and booking status.
- Cancel eligible bookings.
- Submit and manage reviews.

### Service Provider
- Provider registration with pending approval.
- Secure provider dashboard.
- Business profile management.
- Create, edit, and delete service listings.
- Upload service images using Cloudinary.
- Service availability controls.
- Service approval status and listing statistics.
- View and manage customer booking requests.
- Accept, reject, start, and complete bookings.
- Rejected bookings retain provider rejection reasons.

### Admin
- Private administrator sign-in.
- Live marketplace statistics.
- Customer account management.
- Provider approval and account management.
- Service approval and moderation.
- Booking management and eligible cancellations.
- Review moderation.
- Contact-message management.
- Search, filters, and pagination.
- Moderation audit logs with recorded reasons.

### Security
- Password hashing using bcryptjs.
- Session-based authentication.
- MySQL-backed session storage.
- Role-based route protection.
- Login rate limiting.
- Input validation and sanitization.
- HTTP-only session cookies.
- Secure production cookie configuration.
- Protected admin sign-in URL.
- No public administrator registration.
- Service image type and file-size validation.
- Generated filenames for uploaded images.

### Additional Features
- Responsive homepage.
- Searchable service categories.
- Public service catalog.
- Required service locations.
- Provider and service approval workflows.
- Demo service seeding with dry-run preview.
- MySQL database health endpoint.
- Automated backend tests.

## Technology Stack

| Area | Technology |
|---|---|
| Frontend | HTML5, CSS3, JavaScript |
| Backend | Node.js, Express 4 |
| Database | MySQL 8 |
| Database Driver | mysql2 |
| Authentication | express-session, bcryptjs |
| Validation | express-validator |
| Rate Limiting | express-rate-limit |
| Session Storage | MySQL |
| Image Storage | Cloudinary |
| Deployment | Netlify Functions |
| Local Development | Netlify CLI |

## Project Structure

```text
PuneSeva/
│
├── frontend/
│   ├── index.html
│   ├── services.html
│   ├── login.html
│   ├── register.html
│   ├── provider-register.html
│   ├── customer-dashboard.html
│   ├── provider-dashboard.html
│   ├── admin-dashboard.html
│   ├── css/
│   └── js/
│
├── backend/
│   ├── config/
│   │   ├── db.js
│   │   └── cloudinary.js
│   ├── middleware/
│   │   ├── auth.js
│   │   └── service-image-upload.js
│   ├── routes/
│   │   ├── auth.js
│   │   ├── customer.js
│   │   ├── provider.js
│   │   ├── services.js
│   │   └── admin.js
│   ├── services/
│   ├── server.js
│   ├── serverless-app.js
│   ├── seed-admin.js
│   ├── .env.example
│   └── package.json
│
├── database/
│   ├── pune_seva.sql
│   ├── phase4_dashboard.sql
│   ├── phase5_services.sql
│   ├── phase5_service_images.sql
│   ├── phase6_bookings.sql
│   └── phase7_admin_audit.sql
│
├── netlify/
│   └── functions/
│       └── api.js
│
├── netlify.toml
├── package.json
├── package-lock.json
└── README.md
```

## Prerequisites

Install the following before running the project:

- Node.js 20 or newer.
- npm.
- MySQL 8.
- A MySQL database and user.
- Cloudinary account for service image uploads.
- Netlify account for deployment.

## Installation and Local Development

### 1. Clone the Repository

```bash
git clone https://github.com/pavanughade04/PuneSeva.git
```

```bash
cd PuneSeva
```

### 2. Install Backend Dependencies

```bash
npm --prefix backend install
```

### 3. Configure Environment Variables

Create your local environment file:

```powershell
Copy-Item backend\.env.example backend\.env
```

Configure the required database settings in `backend/.env`:

```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=your_mysql_user
DB_PASSWORD=your_mysql_password
DB_NAME=pune_seva
```

Also configure:

- `SESSION_SECRET`
- `ADMIN_LOGIN_PATH`
- Cloudinary credentials required by the image upload configuration.

Use strong random values for secrets. Never commit `backend/.env` to GitHub.

Refer to `backend/.env.example` for the complete environment-variable list.

### 4. Database Setup

For a new, empty MySQL installation, create the database and import the canonical schema:

```powershell
mysql -u your_mysql_user -p < database/pune_seva.sql
```

The database schema includes the application tables for users, customers, providers, services, bookings, reviews, and administrative audit records.

For existing databases, inspect the current table definitions and back up the database before applying any migration.

Available migrations:

| File | Purpose |
|---|---|
| phase4_dashboard.sql | Dashboard-related tables |
| phase5_services.sql | Service location support |
| phase5_service_images.sql | Service image support |
| phase6_bookings.sql | Booking workflow updates |
| phase7_admin_audit.sql | Admin moderation audit log |

Do not execute migrations blindly. New installations already receive the corresponding schema through `pune_seva.sql`.

### 5. Start the Local Backend

```bash
npm --prefix backend start
```

Open:

```text
http://localhost:3000
```

For automatic backend restarts during development:

```bash
npm --prefix backend run dev
```

**Important:** Authenticated dashboard pages and API requests must use the same Express origin. Do not open dashboard pages through VS Code Live Server or `file://`.

## Netlify Deployment

Pune Seva includes a Netlify serverless architecture.

### Deployment Architecture

- `frontend/` contains the public frontend.
- `netlify/functions/api.js` acts as the serverless API entry point.
- `backend/serverless-app.js` provides the Express application for serverless execution.
- `netlify.toml` configures the frontend publishing directory, function directory, bundling, and API redirects.
- MySQL stores application data and session information.
- Cloudinary stores uploaded service images.

### Netlify Configuration

The existing `netlify.toml` configures:

- Publish directory: `frontend`
- Functions directory: `netlify/functions`
- Function bundler: esbuild
- API routing: `/api/*` redirects to the Netlify API function.
- Frontend fallback routing to `index.html`.

### Deploy Through GitHub

1. Push the latest project changes to GitHub.
2. Log in to Netlify.
3. Select **Add new project**.
4. Import an existing GitHub repository.
5. Select `pavanughade04/PuneSeva`.
6. Allow Netlify to use the repository's `netlify.toml` configuration.
7. Configure the required production environment variables.
8. Deploy the project.

### Production Environment Variables

Configure the required variables in Netlify's environment-variable settings.

These include:

- `NODE_ENV=production`
- `DB_HOST`
- `DB_PORT`
- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`
- `SESSION_SECRET`
- `ADMIN_LOGIN_PATH`
- Cloudinary credentials required by `backend/config/cloudinary.js`.

Use a managed MySQL 8 database accessible from Netlify Functions.

Use a persistent random session secret of at least 32 characters and a private admin login path of at least 24 characters.

Keep all credentials in environment-variable settings, not in frontend code or GitHub.

**Important deployment notes:**

- The serverless application uses MySQL-backed session storage.
- Production database connections must support the required TLS configuration.
- Cloudinary is used for service image storage instead of relying on temporary serverless filesystem uploads.
- The health endpoint is `/api/health`.
- Database migrations must be applied to the production database only after a verified backup.
- Do not deploy development-only admin seeding scripts to production.

## Local Netlify Development

To test the Netlify serverless architecture locally, use:

```bash
npx netlify-cli dev
```

Netlify CLI reads the project's `netlify.toml` and runs the frontend and API function together.

Configure the required local environment variables before testing the serverless API.

## Admin Account

There is no public admin registration.

Administrator access uses a private login path configured through `ADMIN_LOGIN_PATH`.

A development-only seed script is available to create the first administrator account.

It must only be used in development mode and requires strong credentials.

Never expose the private administrator login path or administrator credentials publicly.

## API Overview

### Authentication

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/auth/register` | Customer registration |
| POST | `/api/auth/provider-register` | Provider registration |
| POST | `/api/auth/login` | User login |
| POST | `/api/auth/logout` | User logout |
| GET | `/api/auth/me` | Current authenticated user |

### Customer

- `/api/customer/dashboard`
- `/api/customer/profile`
- `/api/customer/bookings`
- `/api/customer/reviews`
- `/api/customer/bookings/:bookingId`

### Provider

- `/api/provider/dashboard`
- `/api/provider/profile`
- `/api/provider/services`
- `/api/provider/bookings`
- `/api/provider/services/:serviceId/availability`

### Public Services

- `/api/services`
- `/api/services/categories`
- `/api/services/locations`
- `/api/services/:serviceId`

### Admin

- `/api/admin/dashboard/stats`
- `/api/admin/dashboard/recent-activity`
- `/api/admin/customers`
- `/api/admin/providers`
- `/api/admin/services`
- `/api/admin/bookings`
- `/api/admin/reviews`
- `/api/admin/messages`

Administrative APIs support appropriate management actions, filtering, pagination, and role-based access protection.

### Other

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/contact` | Save contact messages |
| GET | `/api/health` | Check database connectivity |

All protected endpoints require the appropriate authenticated session and role.

## Testing

Run automated backend tests:

```bash
npm --prefix backend test
```

These tests use mocked database responses and do not insert real marketplace records.

Check the database health endpoint:

```text
/api/health
```

A successful health check confirms database connectivity.

Test the following workflows:

- Customer registration and login.
- Provider registration and approval.
- Service creation and approval.
- Service image uploads.
- Public service searching and filtering.
- Customer booking requests.
- Provider booking management.
- Customer booking history.
- Admin moderation and management.
- Session authentication and authorization.
- Login rate limiting.

## Database Backups

Before applying database migrations or modifying production data, create a database backup.

Use `mysqldump` with the appropriate database credentials and keep backups outside the project directory.

Always verify backups by testing restoration against a separate database.

## Current Project Limitations

The following features are currently outside the project scope:

- Online payment integration.
- Provider working-hour calendars.
- Appointment duration management.
- Email and SMS notifications.
- Automatic booking notifications.

Booking conflict protection currently checks existing pending, accepted, and in-progress bookings for the same provider and exact start date and time. It does not yet detect overlapping appointments with different start times.

## Future Improvements

- Online payment integration.
- Advanced provider availability management.
- Email and SMS notifications.
- Improved booking and appointment scheduling.
- Enhanced customer and provider experiences.
- Additional marketplace features.

## Project Information

**Project:** Pune Seva  
**Category:** Local Services Marketplace  
**Frontend:** HTML, CSS, JavaScript  
**Backend:** Node.js, Express  
**Database:** MySQL  
**Image Storage:** Cloudinary  
**Deployment:** Netlify  
**Repository:** https://github.com/pavanughade04/PuneSeva

---

**Pune Seva — Your City, Your Services, One Platform.**
