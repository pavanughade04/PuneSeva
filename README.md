# Pune Seva

**Your City, Your Services, One Platform.**

Pune Seva is a local-services marketplace connecting customers with service professionals in Pune.

## Features

- Responsive homepage and service search.
- Customer and provider registration/login.
- Role-based customer, provider and admin dashboards.
- Service listing, approval and management.
- Booking creation and status management.
- Customer reviews and profiles.
- Admin dashboard with moderation and audit logs.
- Cloudinary image uploads.
- PostgreSQL-backed authentication sessions.
- Secure authentication and login rate limiting.

## Tech Stack

- Frontend: HTML, CSS, JavaScript
- Backend: Node.js, Express.js
- Database: PostgreSQL
- Authentication: Express Session, bcryptjs
- Image Storage: Cloudinary

## Project Structure

```text
PuneSeva/
├── frontend/
├── backend/
├── database/
│   └── postgres_schema.sql
├── package.json
└── package-lock.json
```

## Requirements

- Node.js 20+
- PostgreSQL 18+
- npm
- Cloudinary account (for image uploads)

## Setup

1. Clone the repository.
2. Install dependencies:

```powershell
npm --prefix backend install
```

3. Create a PostgreSQL database named `PuneSeva`.
4. Import the PostgreSQL schema:

```powershell
psql -U postgres -d PuneSeva -f database/postgres_schema.sql
```

5. Create `backend/.env` and configure:

```env
NODE_ENV=development
PORT=3000
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your_password
DB_NAME=PuneSeva
SESSION_SECRET=your_secret
ADMIN_LOGIN_PATH=/your-private-admin-path
```

Also configure the required Cloudinary credentials.

6. Start the application:

```powershell
npm --prefix backend start
```

Open `http://localhost:3000`.

## Testing

Run automated tests:

```powershell
npm --prefix backend test
```

## Deployment

The planned production architecture uses:

- Render Node.js web service.
- Separate managed PostgreSQL database.
- Cloudinary for image storage.

Keep database credentials, session secrets and Cloudinary credentials private. Never commit `.env` files.

## Important

The older SQL files in `database/` are legacy MySQL files. Use `postgres_schema.sql` for the current PostgreSQL setup.

## Future Improvements

- Online payments.
- Provider availability and scheduling.
- Email/SMS notifications.
- Production deployment and monitoring.