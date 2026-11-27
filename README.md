# PuneSeva

**Your City, Your Services, One Platform.**

PuneSeva is a local-services marketplace designed to connect customers with trusted service professionals in Pune. Customers can explore services, submit booking requests, and manage their accounts, while service providers can manage their profiles, services, and customer requests.

🌐 **Live Website:** https://pune-seva-backend-production.up.railway.app

📦 **GitHub Repository:** https://github.com/pavanughade04/PuneSeva

---

## Features

### Customer
- Browse and search local services.
- Register and log in securely.
- View service details and provider information.
- Create and manage service bookings.
- Access customer dashboard and booking history.
- Manage customer profile.
- Submit reviews.

### Service Provider
- Provider registration and login.
- Provider dashboard.
- Manage provider profile and services.
- Upload service images.
- Receive and manage customer service requests.
- Manage booking status.

### Admin
- Dedicated admin login.
- Admin dashboard.
- Manage users and providers.
- Manage and moderate services.
- View and manage bookings.
- Review platform activity and audit logs.

### Platform
- Responsive user interface.
- Role-based authentication and authorization.
- PostgreSQL-backed session management.
- Password hashing with bcrypt.
- Login rate limiting.
- Cloudinary image storage.

---

## Tech Stack

| Component | Technology |
|---|---|
| Frontend | HTML, CSS, JavaScript |
| Backend | Node.js, Express.js |
| Database | Supabase PostgreSQL |
| Authentication | Express Session, bcryptjs |
| Database Driver | node-postgres (`pg`) |
| Image Storage | Cloudinary |
| Deployment | Railway |
| Version Control | Git & GitHub |

---

## Project Structure

```text
PuneSeva/
├── frontend/
├── backend/
├── database/
├── package.json
├── package-lock.json
└── README.md
```

---

## Local Development Setup

### Requirements
- Node.js
- npm
- PostgreSQL database for local development
- Cloudinary account for image uploads

### 1. Clone Repository

```bash
git clone https://github.com/pavanughade04/PuneSeva.git
cd PuneSeva
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables

Create a `.env` file inside the backend directory and configure the required variables.

```env
NODE_ENV=development
PORT=3000

DB_HOST=localhost
DB_PORT=5432
DB_NAME=PuneSeva
DB_USER=postgres
DB_PASSWORD=your_database_password
DB_SSL=false

SESSION_SECRET=your_secure_session_secret
ADMIN_LOGIN_PATH=your_private_admin_path

CLOUDINARY_CLOUD_NAME=your_cloudinary_cloud_name
CLOUDINARY_API_KEY=your_cloudinary_api_key
CLOUDINARY_API_SECRET=your_cloudinary_api_secret
```

Use the PostgreSQL schema and migration files provided in the repository that match the current database structure.

### 4. Start Application

```bash
npm run start --workspace=pune-seva-backend
```

Open:

http://localhost:3000

---

## Production Deployment

PuneSeva is deployed using the following architecture:

| Service | Platform |
|---|---|
| Frontend | Railway |
| Backend API | Railway |
| PostgreSQL Database | Supabase |
| Image Storage | Cloudinary |
| Source Code | GitHub |

The frontend and backend are served through a single Railway Node.js service.

### Live Application

https://pune-seva-backend-production.up.railway.app

---

## Security

- Keep `.env` files out of GitHub.
- Never expose database credentials or API secrets.
- Use strong session secrets.
- Keep the admin login path private.
- Use secure production environment variables.
- Keep database connections encrypted.

---

## Future Improvements

- Online payments and payment verification.
- Provider availability and scheduling.
- Email and SMS notifications.
- Enhanced booking and dispute management.
- Further performance and security improvements.

---

## Project Status

**Deployment:** Live

**Frontend:** Deployed

**Backend:** Deployed

**Database:** Supabase PostgreSQL

PuneSeva is live, with its main customer, provider, and admin interfaces deployed. Further production testing and improvements are ongoing.

---

## Developer

**Pavan Ughade**

- GitHub: https://github.com/pavanughade04
- LinkedIn: https://www.linkedin.com/in/pavanughade78/

**PuneSeva — Your City, Your Services, One Platform.**
