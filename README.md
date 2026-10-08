# CampusOne

One campus application for attendance, club events, and campus complaints. React/Vite and Express run together in one Docker container; PostgreSQL stores structured data. Railway is the only planned cloud provider.

## Current milestone

Phase 1.5: npm workspaces, institutional registration with email verification, Admin approval for privileged roles, JWT login/logout, role-specific landing screens, database schema, Docker setup, health endpoints, and CI. Attendance, event management, complaint workflows, and image upload/access are later slices; their UI cards are intentionally marked as upcoming. Database constraints prepare those slices but do not implement their API workflows.

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

Open `http://localhost:3000`. The container serves UI and API from one origin. Compose explicitly uses development mode for local accounts and mail previews; the image itself defaults to production for Railway. Local HTTP cookies omit `Secure`; Railway's HTTPS origin enables `Secure`. To run host development again, stop the app container with `docker compose stop app` to free port 3000. Database contents persist across restarts in `postgres-data`; do not remove the volume to restart the app.

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
| `MAIL_MODE` | `smtp` (development previews are rejected in production) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | Approved SMTP credentials and sender |
| `STORAGE_MODE` | `database` for the approved fallback; bucket integration is a later slice |

Railway supplies `PORT`. `railway.toml` selects the Dockerfile, runs `npm run db:migrate` before release, and checks readiness. Migrations must be backward-compatible; failure blocks deployment. Demo seeding is forbidden in production. Use the trusted Admin bootstrap described below; migrations never create public demo accounts.

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

## Institutional registration and approval

- Public registration accepts only normalized, exact `@ssn.edu.in` addresses and Student, Staff or Club Head requests. Unknown fields (including roles, active state and verification flags) are rejected. Admin is never a public option.
- Verification proves inbox control. Tokens contain 32 random bytes; only SHA-256 hashes are stored, expire after 30 minutes, and can be consumed once. Links use a URL fragment and a confirmation POST, so ordinary GET link scanners do not activate accounts.
- Verified Students receive Student access. New Staff/Club Head accounts remain unable to sign in until approval. Club Head approval requires a real club; Staff approval may include existing class/subject offerings. A Staff account without assignments cannot manage any class. No extra Student role is silently granted to a new privileged applicant.
- Verified users can request additional Staff/Club Head roles from Profile. Approval preserves existing roles and writes assignments and an audit record atomically. Only Admins can review requests; self-approval is refused. Rejection requires a reason.
- Registrations and resends return the same generic response for existing/unknown eligible addresses. Duplicate signup never overwrites a password or request. Per-IP limits cover login, signup/resend, role requests and verification; resends also have a 60-second account cooldown. Limits are process-local.
- Login requires active status, verified email and at least one approved role. Production also rejects all synthetic demo accounts. Login errors deliberately do not reveal which eligibility condition failed.
- Existing local demo users keep their credentials. New databases need an explicit development seed; changing DEMO_PASSWORD does not reset existing users.

### Local email verification

With `NODE_ENV=development`, `MAIL_MODE=development` and a loopback APP_ORIGIN, verification emails are written to the ignored root `.local-mail/` directory. In local Compose it is bind-mounted at `/app/.local-mail`. Open the latest file for the test address, follow its link and select Confirm email address. This local preview is not evidence of owning a real inbox. No messages are sent to real SSN accounts in this mode. Never serve or commit this directory.

Production refuses the development mail mode and requires SMTP configuration. `SMTP_PORT=465` uses implicit TLS; other configured ports require STARTTLS and normal certificate validation. No paid service is mandatory, but a permitted working SMTP account and network access must be supplied before deployment. Actual delivery and Railway outbound SMTP eligibility remain unverified. A failed send leaves the account unverified, records a generic server error, and permits a resend.

### Trusted Admin bootstrap

After an operator verifies the intended administrator out of band, set `ADMIN_NAME`, `ADMIN_EMAIL` (exact institutional domain) and `ADMIN_PASSWORD` (12–128 characters) privately, then run:

```powershell
npm run admin:bootstrap -w backend
# In the built container:
docker compose run --rm -e ADMIN_NAME -e ADMIN_EMAIL -e ADMIN_PASSWORD app npm run admin:bootstrap:built -w backend
```

This command creates an Admin only for a previously unused email; it refuses to modify an existing public account or reset its password. Remove bootstrap credentials afterward. Account recovery, invitations, role revocation and full class/club administration remain later work.

### Phase 1.5 database change

`backend/prisma/migrations/202610080002_registration/migration.sql` adds verification state, a demo marker, hashed email tokens and role requests. Pending accounts may have an empty role list; authentication denies them. It preserves current passwords, roles and module data and marks only the four known synthetic demo emails as locally verified. Other existing accounts remain unverified until explicitly verified. Back up data before migration; application rollback does not undo database changes.

Focused PostgreSQL tests require `TEST_DATABASE_URL` pointing to an isolated test database. Without it, database tests are reported as skipped, not passed. SMTP delivery is tested through an injected local adapter; this is not a claim of real email delivery.
