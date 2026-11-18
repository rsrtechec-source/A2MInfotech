# A2M Infotech learning and training-center platform

An Expo mobile app backed by an Express API and PostgreSQL. Role-aware student, trainer, and administrator workspaces support day-to-day training operations alongside learning and career development.

## What is included

- Student registration and login with signed bearer tokens; privileged roles are provisioned by administrators.
- Course catalog, course enrollment, lessons, progress tracking, course assessments, learner submissions, grading, and completion certificates.
- Branch and batch records, capacity-aware cohort enrollment, and batch-scoped attendance.
- Trainer account provisioning, trainer-owned courses and batches, and instructor assessment workflows.
- Admission lead tracking with status changes, announcements, placement listings, and internship opportunities.
- Admin-managed tuition invoices and payment entries, with student-only access to each learner's own billing records.
- Admin-managed center expenses, plus staff leave requests with admin approval.
- Role-specific dashboards, learner rosters, and a mobile operations hub for center administrators and trainers.
- FAQ-style support assistant with a replaceable service boundary for a future AI provider.
- PostgreSQL schema, health endpoint, and request validation.

## Requirements

- Node.js 20.18+ and npm.
- PostgreSQL.
- Expo Go or an Android/iOS development environment.

## Setup

1. Create a PostgreSQL database and load the schema. For a local database, for example:

   ```sh
   createdb a2m_infotech
   psql -v ON_ERROR_STOP=1 -d a2m_infotech -f backend/sql/schema.sql
   ```

   For a hosted database, run `psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f backend/sql/schema.sql` using its connection URL. The schema can be run again to create missing tables and seed records; it does not migrate existing MySQL data. Back up and separately migrate any existing data before switching databases.

2. Create `backend/.env` from `backend/.env.example`. Set `DATABASE_URL` to the PostgreSQL connection URL and `JWT_SECRET` to a long random secret of at least 32 characters. Set `DATABASE_SSL=true` when the database requires TLS with a trusted certificate. Keep credentials out of Git.
3. Install dependencies from the project root:

   ```sh
   npm install
   npm --prefix backend install
   npm --prefix mobile install
   ```

4. Start the API and Expo:

   ```sh
   npm run dev
   ```

   The API listens on port `4000`. For a physical phone, set `EXPO_PUBLIC_API_URL` in `mobile/.env` to `http://<your-computer-lan-ip>:4000/api` before starting Expo. The default `http://localhost:4000/api` works in a simulator when the API is reachable at localhost.

## First administrator

Registration is intentionally student-only; clients cannot choose privileged roles. After registering a user, grant the first administrator role in PostgreSQL:

```sql
UPDATE users SET role = 'admin' WHERE email = 'you@example.com';
```

Admins can create trainer accounts using `POST /api/users/trainers` (admin bearer token required).

## PostgreSQL integration test

Set `TEST_DATABASE_URL` to a disposable PostgreSQL database and run `npm --prefix backend run test:postgres`. The test creates and removes a uniquely named schema in that database.

## API overview

| Method | Path | Access |
| --- | --- | --- |
| `GET` | `/api/health` | Public |
| `POST` | `/api/auth/register`, `/api/auth/login` | Public |
| `GET` | `/api/auth/me` | Signed-in user |
| `GET`, `POST` | `/api/courses` | Public, then trainer/admin for course creation |
| `POST` | `/api/courses/:id/enroll` | Student |
| `GET` | `/api/learning` | Signed-in user |
| `POST` | `/api/learning/:lessonId/progress` | Student |
| `GET` | `/api/announcements`, `/api/placements`, `/api/internships` | Signed-in user |
| `POST` | `/api/announcements` | Admin |
| `POST` | `/api/placements`, `/api/internships` | Trainer/admin |
| `GET` | `/api/branches` | Trainer/admin |
| `POST` | `/api/branches` | Admin |
| `GET`, `POST` | `/api/batches` | Signed-in user, then trainer/admin to create |
| `POST` | `/api/batches/:id/enroll` | Student enrolled in that course |
| `GET`, `POST` | `/api/attendance` | Signed-in user, then trainer/admin to record |
| `GET` | `/api/invoices` | Admin or the signed-in student |
| `POST` | `/api/invoices`, `/api/invoices/:id/payments` | Admin |
| `GET`, `POST` | `/api/expenses` | Admin |
| `GET`, `POST` | `/api/staff/leave-requests` | Trainer/admin; trainers see their own requests |
| `PATCH` | `/api/staff/leave-requests/:id` | Admin |
| `GET`, `POST`, `PATCH` | `/api/leads` | Trainer/admin |
| `GET`, `POST` | `/api/assessments` | Signed-in user, then trainer/admin to create |
| `POST` | `/api/assessments/:id/submissions` | Student enrolled in the course/batch |
| `GET` | `/api/assessments/:id/submissions` | Admin or the course's trainer |
| `PATCH` | `/api/assessment-submissions/:id/grade` | Admin or the course's trainer |
| `GET` | `/api/certificates` | Student or admin |
| `POST` | `/api/certificates/:courseId` | Student after completing all course lessons |
| `GET` | `/api/dashboard` | Signed-in user |
| `POST` | `/api/chat` | Signed-in user |
| `GET` | `/api/users` | Admin |
| `GET` | `/api/users/students` | Trainer/admin |
| `POST` | `/api/users/trainers` | Admin |

## Operational boundaries

Invoice payment entries are administrative records; no payment gateway, GST calculation, or bank settlement is configured. The app does not yet include live classes, push notifications, automated marketing campaigns, payroll/leave workflows, or downloadable certificate PDFs. Those require provider, policy, and business-rule decisions before they can be safely enabled.
