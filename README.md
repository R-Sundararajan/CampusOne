# CampusOne

One campus application for attendance, club events, and campus complaints. React/Vite and Express run together in one Docker container; PostgreSQL stores structured data. Render hosts the application; Neon PostgreSQL stores structured data and image bytes. GitHub Actions validates commits, and Render deploys main only after CI checks pass.

Current [deployment guide](docs/render-neon-deployment.md) and [architecture decisions](docs/architecture.md). Historical release integration and test evidence: [Phase 5](docs/phase5-integration-deployment.md). Module details: [Attendance](docs/phase2-attendance.md), [Events](docs/phase3-events.md), [Complaints](docs/phase4-complaints.md).

## Current milestone

The integrated MVP is on main. The approved production architecture is one Render Docker Web Service, Neon PostgreSQL and GitHub Actions CI. Prior Phase 5 local verification recorded 176 application tests and 4 former deployment guard tests; that historical evidence does not validate the new cloud setup. This change adds startup migrations and generic HTTP release guards. Provisioning, main protection and live deployment require owner completion of the deployment guide.

`INSTITUTIONAL_AUTH_MODE=domain-only-demo` accepts the exact normalized `@ssn.edu.in` domain and sends no verification email. Students can sign in immediately; Staff and Club Heads require Admin approval. **This is insecure for genuine institutional identity assurance:** anyone can claim an unused institutional address. Admins must verify identity out of band before granting privileges or linking student records. `emailVerifiedAt` stays null for demo registration and bootstrap.

The academic demo uses synthetic data. The revised SRS target is 50–100 normal active users and 300 peak; these targets and the 500 ms read / 2 s write targets have not been established by load tests.

## Local development

Prerequisites: Node.js 24, npm, and Docker Desktop running Linux containers. No cloud account is needed locally.

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

Local demonstration credentials are kept only in the ignored `local-demo-accounts.txt` file. Demo accounts are for development, not institutional identity verification. Seed reruns preserve existing passwords and roles.

## Run the complete container locally

After creating `.env`:

```powershell
docker compose build app
docker compose up -d db
docker compose run --rm app npm run db:migrate
docker compose run --rm app npm run db:seed:built -w backend
docker compose up -d app
```

Open `http://localhost:3000`. The container serves UI and API from one origin. Compose explicitly uses development mode for local accounts and mail previews; the image itself defaults to production for Render. Local HTTP cookies omit `Secure`; Render's HTTPS origin enables `Secure`. To run host development again, stop the app container with `docker compose stop app` to free port 3000. Database contents persist across restarts in `postgres-data`; do not remove the volume to restart the app.

## Checks

```powershell
npm run db:generate
npm run typecheck
npm test
npm run test:release
npm run build
```

Ordinary tests use a small in-memory authentication repository. PostgreSQL checks are opt-in using a disposable database:

```powershell
docker compose exec db createdb -U campusone campusone_test
$env:DATABASE_URL = 'postgresql://campusone:campusone@127.0.0.1:5432/campusone_test'
$env:TEST_DATABASE_URL = $env:DATABASE_URL
$env:DIRECT_URL = $env:DATABASE_URL
npm run db:migrate
npm test
Remove-Item Env:DATABASE_URL
Remove-Item Env:TEST_DATABASE_URL
Remove-Item Env:DIRECT_URL
```

CI uses a fresh PostgreSQL service, applies all seven migrations, verifies a representative Phase 4 upgrade twice, seeds twice, runs all application and release guard tests/typechecks/builds, builds Docker and checks production startup without SMTP on a separate empty database, readiness/frontend assets, restart idempotency and migration failure before HTTP. Keep automated suites separate from populated browser QA databases: several module tests deliberately exercise global counts and all five Supervisor slots.

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

## Render + Neon deployment

Follow the [operator guide](docs/render-neon-deployment.md) for the exact owner procedure. The root `render.yaml` selects one Free Docker Web Service on GitHub `main`, `autoDeployTrigger: checksPass` (**After CI Checks Pass**) and `/api/health/ready`. GitHub Actions keeps PostgreSQL, migration, test, build and production Docker checks; it never deploys directly. Protect main separately with required `checks` and maintainer review.

Configure `NODE_ENV=production`, `PORT=3000` (or Render's assigned port), the exact HTTPS `APP_ORIGIN`, Neon pooled `DATABASE_URL`, direct migration `DIRECT_URL` for the same database, a private random `JWT_SECRET`, `INSTITUTIONAL_AUTH_MODE=domain-only-demo` and `STORAGE_MODE=database`. Production listens on `0.0.0.0` by default. No cloud credentials belong in GitHub CI.

The default image CMD validates configuration, runs `npm run db:migrate` once per startup and starts Node only after migrations succeed. Completed migrations are not reapplied on restart. The non-root pruned runtime contains the Prisma CLI, schema/config/migrations and compiled server. No paid pre-deploy command, interactive shell, production seed or default Admin is required. Use the guide's authorized local compiled bootstrap procedure for the first administrator.

## Images, free plans and recovery

Neon stores raw PostgreSQL `bytea` in separate image tables through the existing shared service: one JPEG/PNG per record, 2 MiB input/stored limits, a shared 50 MiB atomic quota, authorized reads and metadata-only listings. Complaint images remain private to the submitter, Admin and current authorized assigned Supervisor.

Render Free can spin down and cold-start; its filesystem is ephemeral. Neon storage/connection/usage allowances and external network limits affect availability. Use one application instance and preserve the five-connection runtime pool. No zero-downtime schema, scale or cloud availability guarantee is claimed.

Before database changes, preserve a backup and practice restoration into a separate database. Prior Phase 5 local PostgreSQL backup/restore compared all 23 tables. Redeploy a compatible reviewed commit for application recovery; application rollback does not undo migrations. Current cloud backup/rollback remains unexecuted; see the operator guide.

Local `decisions.md` and `workflow.md` are intentionally ignored. Track progress there without committing them.

## Repository layout

`frontend/` owns React, Vite and its build. `backend/` owns Express, Prisma, migrations and tests. npm workspaces share one root lockfile. Run `npm run dev:ui` or `npm run dev:api` independently; `npm run build -w frontend` and `npm run build -w backend` build each package. Root scripts orchestrate both.

## Portal interface

Compact institutional forms and top navigation take layout cues from the supplied LMS screenshot and the public SSN LMS. The ProCoDe events reference informed readable poster/detail hierarchy. CampusOne uses an original SVG mark and illustration; no institutional photographs, logos or event artwork were copied or hotlinked. EventPoster preserves the complete image with object-fit: contain and has a missing-image fallback. Complaint forms, queues, private attachments and timelines use the same ivory/sage/forest portal theme.

## Interface screenshots

The following captures show the deployed demo interface. They contain synthetic demonstration records.

### Sign in

![CampusOne sign-in page](docs/screenshots/campusOne_Sign_in_ss.png)

### Student

![Student home dashboard](docs/screenshots/student_dashboard_ss.png)

![Student attendance summary and history](docs/screenshots/student_attendance_ss.png)

![Student event browser](docs/screenshots/student_events_ss.png)

![Student complaint list](docs/screenshots/student_complaints_ss.png)

### Staff

![Staff attendance workspace](docs/screenshots/staff_dashboard_ss.png)

![Staff complaint submission form](docs/screenshots/staff_complaints_ss.png)

### Club Head

![Club Head home dashboard](docs/screenshots/clubhead_dashboard_ss.png)

![Club Head events overview](docs/screenshots/clubhead_event_ss.png)

![Club Head event management list](docs/screenshots/clubhead_event_2_ss.png)
## Institutional registration and approval

- Public registration accepts only normalized, exact `@ssn.edu.in` addresses and Student, Staff or Club Head requests. Unknown fields (including roles, active state and verification flags) are rejected. Admin is never a public option.
- In explicit `domain-only-demo`, new Students receive Student access immediately. Email ownership is not verified and `emailVerifiedAt` stays null. With the default legacy `email-verification` mode, Student activation still requires a verification token.
- Staff/Club Head accounts remain unable to sign in until approval. Club Head approval requires a real club; Staff approval may include selected existing offerings. A Staff account without assignments cannot manage a class. No extra Student role is silently granted to a privileged applicant.
- Eligible active users can request additional Staff/Club Head roles from Profile. Approval preserves existing roles and writes assignments/audit atomically. Only Admins can review requests; self-approval is refused. Rejection requires a reason. Demo-mode privileged approvals, club/teaching/Supervisor grants and student linkage require explicit out-of-band identity confirmation, recorded in the audit trail.
- Registrations and resends return the same generic response for existing/unknown eligible addresses. Duplicate signup never overwrites a password or request. Per-IP limits cover login, signup/resend, role requests and verification; resends also have a 60-second account cooldown. Limits are process-local.
- Login requires active status, eligibility under the configured mode and at least one approved role. Production rejects `isDemo` accounts and noninstitutional domains; these accounts are also excluded from privileged assignment candidates/grants. Login errors do not reveal which eligibility condition failed.
- Existing local demo users keep their credentials. New databases need an explicit development seed; changing DEMO_PASSWORD does not reset existing users.

### Optional legacy email verification

With `INSTITUTIONAL_AUTH_MODE=email-verification`, `NODE_ENV=development`, `MAIL_MODE=development` and a loopback APP_ORIGIN, verification emails are written to ignored `.local-mail/`. Tokens contain 32 random bytes, are stored only as SHA-256 hashes, expire after 30 minutes and work once. This preview is not proof of inbox ownership. Never serve or commit the directory. Domain-only-demo skips mail creation/delivery and SMTP startup validation entirely.

Only production `email-verification` refuses development mail and requires SMTP. Port 465 uses implicit TLS; other ports require STARTTLS with certificate validation. Live SMTP delivery remains unverified and is outside Phase 5. Existing pending Student registrations retain their empty roles rather than receiving an implicit data migration; retained verification links remain usable, or complete them under the legacy mode. Newly registered demo Students have immediate access.

### Trusted Admin bootstrap

For Render Free, use the [authorized local compiled bootstrap procedure](docs/render-neon-deployment.md#6-bootstrap-the-first-administrator-locally). The commands below are local development alternatives.

After an operator verifies the intended administrator out of band, set `ADMIN_NAME`, `ADMIN_EMAIL` (exact institutional domain) and `ADMIN_PASSWORD` (12–128 characters) privately, then run:

```powershell
npm run admin:bootstrap -w backend
# In the built container:
docker compose run --rm -e ADMIN_NAME -e ADMIN_EMAIL -e ADMIN_PASSWORD app npm run admin:bootstrap:built -w backend
```

This command creates an Admin only for a previously unused email; it refuses to modify a public account or reset its password. In demo mode the ownership timestamp remains null. Legacy mode additionally requires the trusted operator to verify mailbox ownership. Remove bootstrap credentials afterward. Account recovery/invitations remain later work.

### Phase 1.5 database change

`backend/prisma/migrations/202610080002_registration/migration.sql` adds verification state, a demo marker, hashed email tokens and role requests. Pending accounts may have an empty role list; authentication denies them. It preserves current passwords, roles and module data and marks only the four known synthetic demo emails as locally verified. Other existing accounts remain unverified until explicitly verified. Back up data before migration; application rollback does not undo database changes.

Focused PostgreSQL tests require `TEST_DATABASE_URL` pointing to an isolated test database. Without it, database tests are reported as skipped, not passed. SMTP delivery is tested through an injected local adapter; this is not a claim of real email delivery.

## Historical Phase 1.5 completion — 2026-10-09

The following branch/layout/test record describes that phase, not the current deployment configuration.

```text
CampusOne/
├── frontend/
│   ├── src/{components,hooks,layouts,pages,services,styles}
│   ├── package.json
│   └── vite.config.ts
├── backend/
│   ├── src/{modules/auth,modules/registration,services,generated}
│   ├── prisma/{migrations,schema.prisma,seed.ts,bootstrap-admin.ts}
│   ├── tests/
│   └── package.json
├── .github/workflows/ci.yml
├── Dockerfile, compose.yaml, railway.toml
├── package.json, package-lock.json, .env.example
└── decisions.md, workflow.md, local-demo-accounts.txt (ignored local references)
```

Review branches are retained locally: `chore/monorepo-restructure` (36fa3c7), `feature/frontend-redesign` (2af73ff; original feature 0d74a20), and `feature/backend-registration` (1f5ebd7). Their combined result is on `integration/campusone-phase1-5`. The prior uncommitted foundation was preserved as a3b09de on the restructuring branch. No branches were pushed or merged into main.

Verified locally:

- 27 Vitest tests passed against isolated PostgreSQL; root type checking and both independent workspace builds passed.
- Docker image built; Compose app/database are healthy; runtime migration, idempotent seed, readiness, SPA routes and API 404 boundaries passed.
- All four original demo accounts logged in with their preserved credentials.
- Desktop Student signup, local email confirmation, additional-role request and cumulative-role approval passed.
- Mobile Staff signup, password mismatch feedback, verification, pending-login refusal and approved login passed at 390 × 844; no horizontal overflow was found.
- Admin club assignment, selected teaching assignment and rejection with a reason passed. Missing-club and missing-reason errors are specific.
- Refresh/login persistence and persistent logout passed. Root `npm run dev` and browser authentication/decisions through the Vite proxy passed.
- Accessible labels, heading hierarchy, alert/status messages, role-aware navigation and the event fallback’s 3:4 proportions were inspected. Actual event artwork/upload remains future work.
- Production-mode built static serving/readiness passed; synthetic demo users, development verification and demo seeding were refused. No real email was sent.

There are no outstanding failed application checks. The first clean-install attempt encountered a Windows file lock held by Vite; stopping Vite allowed the clean install to pass. Earlier sandbox loopback restrictions were resolved by running the local tests with appropriate access. A remote GitHub Actions run and live SMTP delivery are not claimed.

The two synthetic browser-verification accounts are marked `isDemo` and their credentials are recorded only in the ignored local file. Local previews and pre-migration backups remain ignored. Keep them out of production data.

## Phase 2 attendance

Open **Attendance** after signing in. Admin uses **Academic setup** to create terms/classes/subjects and grant or revoke teaching assignments. Admin and assigned Staff use **Class rosters** to preview register-number imports. Set a numeric prefix and a suffix width (1–6, default 3); enter suffixes such as `62-132, 304, 305`. Preview shows full string register numbers, duplicates, additions, existing members and unmatched accounts. Imports are additive; omitted students stay enrolled, inactive students stay inactive, and historical attendance is retained. A class supports at most 1,000 active students.

Unmatched numbers remain independent student identities. Admin can link them to eligible active Student accounts after checking institutional identity/register numbers out of band, entering evidence and confirming the link. Public registration and Student requests cannot claim register numbers. Migrated accounts with no register number need this reconciliation before faculty can mark their roster.

Assigned faculty select a class, subject, date and hour, then load the official roster or existing session. Enter present suffixes (default) or absent suffixes, calculate the preview, toggle individual statuses, and confirm the save. Empty input and unknown numbers block saving. Mark-all actions require an additional explicit confirmation. Existing sessions require a correction reason and a current version; only changed statuses create audit entries. Concurrent submissions, stale previews and partial saves are protected by transactions, class locks and database constraints.

Students see their own subjects, percentages and date/hour history. Reports include only complete submitted sessions and calculate percentages from persisted records. Staff reports/exports are scoped to assigned subjects; Admin can view all classes. CSV is UTF-8 with a BOM, quoted fields and protection against spreadsheet formula injection. Import the register-number column as **Text** in spreadsheet applications to preserve leading zeroes and long identifiers.

`VITE_ATTENDANCE_WARNING_THRESHOLD` sets the UI reminder threshold (0–100, default 75). For Compose, set it in the root `.env`; for host Vite, use the ignored `frontend/.env.local` or export the variable in your shell. Restart Vite for development or rebuild the frontend/Compose image after changing it. It is a display policy, not an enforced attendance regulation. Direct Docker builds can use `--build-arg VITE_ATTENDANCE_WARNING_THRESHOLD=75`.

The two Phase 2 migrations preserve existing users/attendance and convert account-dependent course enrollments into reusable class memberships. Back up the database first, then run the existing `db:generate`, `db:migrate` and local `db:seed` commands. Seeds remain disabled in production and do not create attendance sessions.

See [the Phase 2 implementation and verification report](docs/phase2-attendance.md) for changes, API details, checks, manual evidence and limitations. No scale/response-time targets, live SMTP delivery, remote CI run or Railway deployment are claimed.

## Phase 3 events

Open **Events** to browse upcoming, ongoing and past published events. Search title/description, filter by club and sort by start time. Cards show complete posters; portrait and landscape images use `object-fit: contain`. The portal shares a natural ivory, sage and forest-green palette. The supplied ProCode reference refused connections during this phase, so its live appearance could not be verified; no external artwork or source was copied.

Approved Club Heads use **My club events** to create drafts, upload posters, publish, edit and cancel events belonging to their current assignments. Drafts need only a title and club. Publishing also requires description, venue, a future start and an open registration deadline; optional end must follow start. The club cannot change after creation. Every modification, including poster changes, uses the current event version. Revocation takes effect immediately.

Approved Students register internally and see **My registrations**. Student + Club Head users keep Student privileges. Registration is idempotent, uses the authenticated identity, and closes at the exact deadline or event start. Cancellation retains registrations. Admin uses **Event supervision** across clubs and **Approvals** for audited Club Head assignment changes. Admin may return an event with no registrations to draft; events with registrations must be cancelled to retain visible history. Counts represent registrations, not physical attendance.

Dates are stored as UTC instants and displayed/entered in **Asia/Kolkata (IST, UTC+05:30)**. An event without an end time is categorized as past once it starts. JPEG/PNG posters are limited to 2 MiB, fully decoded and cleanly re-encoded, with a 24-million-pixel processing cap. Stored images share a transactionally locked 50 MiB budget. `STORAGE_MODE=database` is supported; private bucket integration remains deferred.

Back up local data, then use the existing commands:

```powershell
npm ci
npm run db:generate
npm run db:migrate
npm run dev
```

The two additive migrations preserve prior events/registrations and initialize the image budget from existing image metadata. No event records are added by the seed. See [the Phase 3 implementation report](docs/phase3-events.md) for APIs, migrations, files, test results, browser checks, commit hashes and limitations.

## Phase 4 complaints

Open **Complaints** after signing in. Student and approved Staff accounts can submit a title, description, controlled category, actual location/block and one optional JPEG/PNG image. **My Complaints** shows only the authenticated submitter's records, status, processing stage, rejection reason/resolution and feedback state.

Admin uses **Admin Review Queue** for persisted overview counts, status/group/Supervisor/date/category/location filters and verification. Acceptance requires explicit routing confirmation and assigns the eligible configured Supervisor in the same transaction. Rejection requires a public reason. Accepted cases without eligible configuration remain visibly awaiting assignment.

**Supervisor Assignments** manages exactly five group slots: UG I–IV and PG. Admin selects eligible active approved institutional Staff accounts after out-of-band identity review. No Supervisor authentication role or public signup exists. One account may hold multiple slots; each group has at most one designation. Replacement/revocation requires a reason and atomically updates unresolved cases/audits. Closed cases retain the historical assignee, but former Supervisors lose access when their designation changes. Production excludes synthetic local accounts.

Attendance terms/class rosters lack an explicit reliable current study-year/current-term marker. Student year selections are provisional until Admin confirmation. Staff complaints always require manual Admin routing; users holding both Staff and Student privileges use the Staff/manual path. Register-number prefixes and admission years are never used to guess the current year.

The currently designated and assigned Supervisor uses **Supervisor Work Queue** to record private progress and supplied Block Warden contact/handoff information, then resolve with public details. Warden coordination happens outside CampusOne; there is no Warden account/dashboard. Supervisor designation grants no attendance, club, or Admin capability. Submitters cannot see internal notes, actor personal details or internal reassignment reasons. Feedback is saved once by the original submitter after resolution or rejection and leaves status unchanged.

Back up the database, regenerate Prisma and apply `202610100001_complaints` using the existing commands. The migration extends Complaint, adds five initially empty Supervisor slots and internal notes, and preserves existing records. No Supervisor accounts or complaint records are added by application startup/seed.

Verified on 2026-10-10: 161 tests passed (111 prior + 50 complaint tests), 0 failed, 0 skipped, isolated PostgreSQL; generation, typechecks, builds, Docker build/readiness/non-root/runtime migration/repeated seed, root local development and Vite proxy writes passed. Desktop 1280 × 900 and mobile 390 × 844 flows passed, including images, Admin decisions, coordination, resolution, feedback, manual routing and replacement/access revocation. Direct private-image API navigation was blocked by browser tooling; API tests independently verify backend 403 responses and revoked access. See the Phase 4 report for precise evidence and limitations. No push, main merge or Railway deployment occurred.
