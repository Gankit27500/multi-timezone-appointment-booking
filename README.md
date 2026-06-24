# Multi-Timezone Appointment Booking

Full-stack implementation for the Lyftr AI appointment booking assignment. It includes a FastAPI + SQLAlchemy backend, SQLite persistence, timezone-aware slot generation, concurrency-safe booking, cancellation, and a React + TypeScript calendar UI.

## Features

- Business configuration panel for timezone, hours, active weekdays, slot duration, and holiday exclusions.
- Login dashboard with seeded admin credentials and protected booking APIs.
- Wall-clock calendar rendered in the configured business timezone.
- Live operations strip showing business-local time, next available slot, weekly open slots, and active bookings.
- Booking sidebar with availability-engine notes for a clear demo of the filtering logic.
- UTC preview in the booking modal to make timezone conversion visible.
- Available slots exclude non-working days, holidays, past local times, and overlapping active appointments.
- Booking modal with server-side validation.
- Cancellation flow that marks appointments as `CANCELLED`.
- SQLite transaction guard plus a partial unique index to protect exact-slot double bookings.

## Run Locally

Backend:

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Open `http://127.0.0.1:5173`.

Demo login:

- Email: `admin@lyftr.local`
- Password: `admin123`

## API

- `GET /api/booking/config`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `PUT /api/booking/config`
- `GET /api/booking/slots?smb_id=...&min_start_time=...&max_end_time=...`
- `POST /api/booking/appointments`
- `GET /api/booking/appointments?smb_id=...`
- `PATCH /api/booking/appointments/{id}/cancel`

## Deployment

Backend on Render:

- Root Directory: `backend`
- Build Command: `pip install -r requirements.txt`
- Start Command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- Environment Variables:
  - `ALLOWED_ORIGINS=https://your-frontend-url.vercel.app`
  - `DATABASE_URL=sqlite:///./booking.db`

Frontend on Vercel:

- Root Directory: `frontend`
- Build Command: `npm run build`
- Output Directory: `dist`
- Environment Variable:
  - `VITE_API_URL=https://your-backend-url.onrender.com`

For a production database, use PostgreSQL and set `DATABASE_URL` to the hosted database URL.

## Notes

Appointment timestamps are accepted with timezone offsets and normalized to UTC before storage. Slot validation maps each UTC slot to the business timezone before checking wall-clock hours, weekdays, holidays, and past-time restrictions.
