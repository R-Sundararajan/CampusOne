# CampusOne

One campus application for attendance, club events, and campus complaints. React/Vite and Express run together in one Docker container; PostgreSQL stores structured data. Railway is the only planned cloud provider.

## Current milestone

Phase 1 foundation: seeded accounts, JWT login/logout, current-role authorization, role-specific landing screens, database schema, Docker setup, health endpoints, and CI. Attendance, event management, complaint workflows, and image upload/access are later slices; their UI cards are intentionally marked as upcoming. Database constraints prepare those slices but do not implement their API workflows.

The academic demo uses synthetic data. The revised SRS target is 50–100 normal active users and 300 peak; these targets and the 500 ms read / 2 s write targets have not been established by load tests.

## Local development

Prerequisites: Node.js 24, npm, and Docker Desktop running Linux containers. No Railway account is needed locally.

1. Copy `.env.example` to `.env`. Replace `JWT_SECRET` with a random secret of at least 32 characters; choose `DEMO_PASSWORD` (12–128 characters). The sample database credentials are for localhost only. Use URL-safe characters for the Compose database password, or correctly encode credentials if building a custom connection URL.
2. Install dependencies and start PostgreSQL:

   ```powershell
   npm ci
   docker compose up -d db
   npm run db:generate
   npm run db:migrate
   npm run db:seed
   npm run dev
   ```

3. Open `http://127.0.0.1:5173`. Vite proxies `/api` to port 3000; use this exact origin because write requests validate `Origin`.

Generate a secret without printing it (PowerShell with Node installed):

```powershell
$campusSecret = node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"
(Get-Content .env) -replace '^JWT_SECRET=.*$', "JWT_SECRET=$campusSecret" | Set-Content .env
```

Demo accounts all use the `DEMO_PASSWORD` supplied at first seed:

| Email | Roles |
|---|---|
| student@campusone.example | Student |
| staff@campusone.example | Staff |
| clubhead@campusone.example | Student + Club Head |
| admin@campusone.example | Staff + Admin |

Seed reruns preserve existing passwords and roles and do not erase module data. Changing `DEMO_PASSWORD` later does not reset existing accounts. Demo addresses are synthetic, not an institutional identity-verification mechanism.

## Run the complete container locally

After creating `.env`:

```powershell
docker compose build app
docker compose up -d db
docker compose run --rm app npm run db:migrate
docker compose run --rm app npm run db:seed:built -w backend
docker compose up -d app
```

Open `http://localhost:3000`. The container serves UI and API from one origin. Local HTTP cookies omit `Secure`; Railway's HTTPS origin enables `Secure`. To run host development again, stop the app container with `docker compose stop app` to free port 3000. Database contents persist across restarts in `postgres-data`; do not remove the volume to restart the app.

## Checks

```powershell
npm run db:generate
npm run typecheck
npm test
npm run build
```

Ordinary tests use a small in-memory authentication repository. PostgreSQL checks are opt-in using a disposable database:

```powershell
docker compose exec db createdb -U campusone campusone_test
$env:DATABASE_URL = 'postgresql://campusone:campusone@127.0.0.1:5432/campusone_test'
$env:TEST_DATABASE_URL = $env:DATABASE_URL
npm run db:migrate
npm test
Remove-Item Env:DATABASE_URL
Remove-Item Env:TEST_DATABASE_URL
```

CI uses its own PostgreSQL service, applies migrations, seeds twice, runs all tests/typechecks/builds, and builds the Docker image. Manual end-to-end verification belongs to each module slice. Large test frameworks and scanners are optional.

Dependency overrides select patched `deepmerge-ts` and `mysql2` versions used by the Prisma CLI. Client generation and database migrations have been exercised with these versions; keep those checks when updating dependencies.

## Authentication and API

- Passwords use Argon2id hashes; email/password login issues a signed HS256 JWT valid for 30 minutes.
- Cookie: HttpOnly, SameSite=Lax, `/api` path, Secure on HTTPS. Tokens never enter browser storage.
- Verify signature, algorithm, issuer, audience, and expiry. Read current active status and roles from PostgreSQL for every authenticated request.
- State-changing API calls require the configured `APP_ORIGIN`; this includes login and logout. No cross-origin frontend or permissive CORS is needed.
- Limit failed logins to 10 per IP per 15 minutes. The limiter is process-local for this single-instance demo and resets on restart.
- Logout clears the browser cookie. An already copied JWT remains valid until expiry; immediate token revocation is outside the MVP.
- `/api/auth/login`, `/api/auth/logout`, `/api/auth/me`; `/api/auth/admin-check` is a foundation permission check.
- `/api/health/live` checks the process; `/api/health/ready` checks database connectivity.

## Railway deployment — disabled until authorized

Use the college Railway account and Trial/Free only. Do not link this repository as a Railway deployment source. Account verification through GitHub is separate from connecting a repository for automatic deployment.

Provision an application service and PostgreSQL through Railway's dashboard, then configure:

| Runtime variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `APP_ORIGIN` | Exact Railway HTTPS origin, no trailing slash |
| `DATABASE_URL` | Reference PostgreSQL's private connection URL |
| `JWT_SECRET` | Random secret, at least 32 characters |
| `DEMO_PASSWORD` | Explicit synthetic-account password for the one-time seed |
| `STORAGE_MODE` | `database` for the approved fallback; bucket integration is a later slice |

Railway supplies `PORT`. `railway.toml` selects the Dockerfile, runs `npm run db:migrate` before release, and checks readiness. Migrations must be backward-compatible; failure blocks deployment. Seeding is an explicit one-time operation, never an automatic migration step.

Configure these GitHub repository values only after deployment authorization:

- Secret: environment-scoped `RAILWAY_TOKEN`.
- Variables: `RAILWAY_PROJECT_ID`, `RAILWAY_SERVICE_ID`, `RAILWAY_ENVIRONMENT_ID`, `RAILWAY_PUBLIC_URL` (HTTPS origin without trailing slash).
- Variable `ENABLE_RAILWAY_DEPLOY=true` enables automatic deployment of successful pushes to `main`. Absent/false means checks only. Pull requests never deploy and never receive the deployment token.

The single workflow serializes deployment jobs and waits for the CLI deployment result before checking readiness and the frontend. Railway rebuilds the checked source commit with the same Dockerfile/lockfile; this does not promote the identical CI image. Do not use `--detach` or build-only success as release verification.

## Images, credits, and recovery

Preferred image storage is a private Railway bucket, subject to actual account eligibility and networking. If unavailable, the approved fallback is raw PostgreSQL `bytea` in a separate image table, not object storage. It uses the existing database volume rather than a second upload volume. Later image slices enforce one JPEG/PNG per event/complaint, 2 MiB each, 50 MiB total, authorized reads, and no image bytes in list queries. Those upload/access/quota operations are not implemented in Phase 1.

Railway's trial and bucket-billing documents disagree about limited-trial bucket availability; inspect the actual account before relying on it. Both database and image usage consume storage/credits. No paid upgrade is permitted; continuous hosted availability is not guaranteed. Local Docker remains usable if Railway credits expire.

Before database changes, preserve a backup and practice restoration into a separate local database. Use Railway rollback or redeploy a known-good commit for application recovery; application rollback does not undo migrations. The final integration milestone will verify backup/rollback procedures rather than claim them complete now.

Local `decisions.md` and `workflow.md` are intentionally ignored. Track progress there without committing them.

## Repository layout

`frontend/` owns React, Vite and its build. `backend/` owns Express, Prisma, migrations and tests. npm workspaces share one root lockfile. Run `npm run dev:ui` or `npm run dev:api` independently; `npm run build -w frontend` and `npm run build -w backend` build each package. Root scripts orchestrate both.
