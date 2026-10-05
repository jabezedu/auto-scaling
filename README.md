# Auto Scaling

Simulates an elastic compute auto-scaling service (such as AWS EC2 Auto Scaling) with threshold-based policies, cooldown periods, and workload simulations.

## Overview

The Auto Scaling simulator models horizontal compute elasticity used by cloud infrastructure providers to dynamically match server capacity with real-time demand. It evaluates scale-out and scale-in CPU thresholds over consecutive observation ticks, accounts for instance boot latency, and enforces cooldown timers to prevent flapping. The application provides an interactive workload runner to test policies against synthetic traffic patterns.

## Features

- Configurable Auto Scaling Groups with defined minimum and maximum instance limits
- Dynamic scaling policies based on high/low CPU utilization thresholds (scale-out and scale-in percentages)
- Consecutive breach requirements ensuring scaling decisions only fire after sustained threshold violations
- Instance boot lifecycle modeling with a 2-tick provisioning delay before instances serve traffic
- Post-scaling cooldown period timers to let metrics stabilize before triggering subsequent scaling actions
- Synthetic traffic generation supporting four workload patterns: steady, linear ramp, spike burst, and wave
- Granular tick-by-tick simulation tracking capacity, active and booting instances, CPU percentage, and decision logs
- Overload detection tracking dropped request ticks when total system capacity is saturated

## Tech Stack

| Component | Technology |
| --- | --- |
| Frontend | Next.js 14 + TypeScript + Tailwind |
| Backend | Node.js + Express |
| Database | PostgreSQL 16 |
| Auth | JWT |
| Container | Docker Compose |

## Project Structure

```
auto-scaling/
├── backend/
├── database/
│   └── init.sql
├── docker-compose.yml
└── frontend/
```

## Getting Started

### Prerequisites

- Node.js 20+
- Docker and Docker Compose

### Option A: Docker Compose

1. From the `auto-scaling` directory, run:
   ```bash
   docker compose up --build
   ```
2. Access the applications:
   - Frontend: http://localhost:3004
   - Backend: http://localhost:4004

### Option B: Local Development

1. Start the PostgreSQL database:
   ```bash
   docker compose up -d db
   ```
2. Start the backend service:
   ```bash
   cd backend
   npm install
   npm run dev
   ```
   Backend runs on http://localhost:4004.
3. Start the frontend application:
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
   Frontend runs on http://localhost:3004.

> `database/init.sql` runs only on first container startup. To reset the database and re-run initialization, run `docker compose down -v`.

## Demo Login

- **Email**: admin@demo.com
- **Password**: demo123

## Environment Variables

### Backend (`backend/.env`)

| Variable | Description |
| --- | --- |
| `PORT` | Port for Express backend server (default: 4004) |
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Secret key used to sign and verify authentication JWT tokens |
| `CORS_ORIGIN` | Allowed origin for Cross-Origin Resource Sharing |

### Frontend (`frontend/.env.local`)

| Variable | Description |
| --- | --- |
| `NEXT_PUBLIC_API_URL` | Base URL for the backend API (default: http://localhost:4004) |

*Note: The frontend reads the API URL from `NEXT_PUBLIC_API_URL` at build time, so it must be configured before building for deployment.*

## API Endpoints

| Method | Path | Description |
| --- | --- | --- |
| GET | `/health` | Server health check endpoint |
| POST | `/api/auth/login` | Authenticate administrator and receive JWT token |
| GET | `/api/groups` | List all scaling groups with run counts |
| POST | `/api/groups` | Create a new scaling group configuration |
| GET | `/api/groups/:id/runs` | Retrieve previous simulation runs for a scaling group |
| POST | `/api/groups/:id/simulate` | Execute a workload simulation run (steady, ramp, spike, wave) |
| GET | `/api/runs/:runId` | Retrieve full tick-by-tick logs and metrics for a specific run |

## Notes

- Instances require 2 simulation ticks to boot, during which they count against maximum instance limits but do not yet contribute compute capacity.

## License

MIT
