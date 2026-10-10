# Phase 5 — Integration and deployment preparation

Verified locally on 2026-10-10. The release branch is `integration/campusone-release`, based on the actual local Complaints tip `08e01f452db028d432ffbfc477892b10d7e1d768`. Remote references were fetched; the Registration, Attendance and Events feature tips were already ancestors, so no redundant merges were needed. The teammate's `docs` branch was left separate. Main was not changed.

This release prepares an owner-reviewed academic demonstration. **Domain-only registration is insecure for genuine institutional identity assurance.** It proves neither mailbox ownership nor a person's identity. Railway resources, account settings, GitHub deployment settings and production data were not changed. Deployment remains disabled.

## Integrated inventory

| Module | Integrated behavior |
|---|---|
| Foundation/authentication | React/Vite + Express in one container, PostgreSQL/Prisma, Argon2id, JWT cookie sessions, current database roles, Origin checks, health endpoints |
| Registration | Exact institutional domain, immediate demo Student access, privileged role requests, Admin review, cumulative roles, trusted Admin bootstrap, optional legacy verification |
| Attendance | Academic setup, additive roster import, Admin-only identity reconciliation, teaching assignments, previews, marking/corrections/version conflicts, audit trails, Student history and CSV reports |
| Events | Admin club management, assigned Club Head editing/publishing, posters, deadlines, unique Student registrations, supervision/reporting |
| Complaints | Student/Staff submission, Admin verification, UG I–IV and PG Supervisor slots, current assignment, private Warden coordination, resolution, feedback and authorized private attachments |
| Image storage | Shared validated JPEG/PNG storage in PostgreSQL, one image per owner, 2 MiB limits, atomic 50 MiB aggregate quota |
| Release | Isolated CI database, full tests/migrations/builds, production Docker smoke checks, explicitly gated Railway CLI deployment and exact deployment status polling |

## Registration policy and compatibility

Set `INSTITUTIONAL_AUTH_MODE=domain-only-demo` explicitly for the approved demonstration. Configuration otherwise defaults to `email-verification`; unknown modes fail startup. `.env.example` and local Compose explicitly select the demo mode.

Registration normalizes case/whitespace and validates the exact domain server-side. `person@fake-ssn.edu.in`, subdomains and unrelated domains are rejected. Strict request schemas reject client-supplied roles, Admin/Supervisor requests, activation flags and verification fields. Unique email constraints prevent concurrent duplicate accounts; a duplicate signup never replaces a password, role or request. Signup/resend responses remain generic.

New demo Students receive `STUDENT` immediately and can log in. Staff and Club Head applicants retain empty roles until Admin approval, and approved users receive only the requested role plus their existing roles. Admin creation remains a trusted command; Complaint Supervisor access remains an Admin designation of an eligible Staff account. Teaching and club access still depend on actual assignments. No verification mail/token is created in demo mode, and SMTP configuration/startup validation is bypassed. `emailVerifiedAt` remains null for new demo accounts and demo Admin bootstrap.

A shared eligibility policy now covers authentication, approvals, Attendance, Events and Complaints, including assignment candidates and targets. Null ownership timestamps do not block eligible demo accounts. Production rejects `isDemo` and noninstitutional accounts from login and privileged candidate/grant paths. Local development retains explicitly seeded fixtures.

Admins must check real institutional identity out of band before privileged role approval, club/teaching grants, Supervisor designation or register-number linkage. The API requires `identityConfirmed: true` for these grants in demo mode, and records it with the operation's audit evidence. UI approval/linking flows explain this requirement. This confirmation is an operator assertion, not automated identity proof. Public users cannot claim register numbers; existing linkage reasons, confirmation, uniqueness and transactions remain enforced.

Verification fields, token hashing/expiry and the inexpensive legacy flow remain compatible. Existing pending Student accounts retain empty roles; no migration automatically approves them or invents verification dates. Retained valid verification links can complete such accounts, or the owner can use the legacy mode. Switching back to strict mode blocks unverified demo accounts until genuine verification is completed; plan that transition before changing production configuration.

Accepted risk: an attacker can claim an unused institutional address, sign in as a Student and preempt its legitimate owner. A domain check and Admin checkbox do not solve this. Use synthetic data, a limited demo audience and verified Admin reconciliation; genuine institutional deployment needs a later verified identity mechanism.

## Security review

| Area | Finding and evidence |
|---|---|
| Passwords and sessions | Argon2id (19 MiB, two iterations); signed HS256 JWT, issuer/audience/algorithm/expiry checked; 30-minute lifetime. HttpOnly, SameSite=Lax, `/api` cookie; Secure for HTTPS. Unknown login checks a dummy hash and returns a generic eligibility/password error. |
| Live authorization | Roles/active status are read from PostgreSQL on every authenticated request and checked again inside sensitive services. Integration tests revoke Staff/Club Head/Supervisor access using existing cookies and verify immediate denial. |
| Origin and proxy | Mutations, login and logout require exact configured Origin. Production HTTPS required except local loopback tests. One trusted proxy hop matches the planned Railway edge; deployment topology must preserve that assumption. No permissive CORS. |
| Rate limiting | Failed login: 10/IP/15 minutes. Registration/resend, verification and role-request limits retained; account resend cooldown retained. Stores are process-local, reset on restart and are unsuitable for multi-instance global enforcement. |
| Privacy | Student attendance is restricted to linked identity. Complaint details/images are submitter/Admin/current authorized assigned Supervisor only; internal notes remain restricted to Admin/current Supervisor. Reassignment/revocation removes prior access. Lists contain metadata, not image bytes. |
| Images | Decode/re-encode validated JPEG/PNG, strip metadata/trailing payloads, reject mismatches/animation/excess dimensions; private API reads are no-store. Shared advisory quota lock and owner mutations roll back together. Event/Complaint contention tested. |
| Validation/errors | Strict Zod input validation; body/upload limits, generic unexpected errors, JSON API 404 boundary. Expected conflicts remain specific. Logs omit request bodies, cookies, credentials and database connection details; startup explicitly warns about insecure demo identity. |
| Data integrity | Existing unique constraints, foreign keys/checks, query indexes, owner/class locks and optimistic versions retained. Approval, linkage, attendance, assignment and image operations are transactional. No Phase 5 schema rewrite. |
| Production fixtures | Runtime seed command refuses production. Bootstrap refuses any existing email instead of promoting a public account. Seeded demo accounts remain excluded from production authentication and assignment candidates/grants. |
| Logout limit | Logout clears the browser cookie. A copied JWT is usable until expiry unless the account/roles are revoked. Central session revocation, password recovery, distributed rate limiting and full observability remain outside this MVP. |

The verified eligibility gap was corrected: former timestamp-only guards would reject new demo users; assignment queries also needed production fixture exclusion. Legacy email verification no longer overwrites cumulative roles. Existing security/privacy/transaction suites remain passing.

## Database and migration evidence

No new Phase 5 migration is necessary: this release changes application/configuration policy. The complete unchanged chain was applied to fresh isolated PostgreSQL databases:

1. `202610080001_foundation`
2. `202610080002_registration`
3. `202610090001_attendance`
4. `202610090002_attendance_snapshot`
5. `202610090002_event_drafts`
6. `202610090003_events`
7. `202610100001_complaints`

`npm run db:verify-upgrade` requires an explicitly named test database. It creates representative Phase 4 records with users/password hashes/roles, enrollments, teaching assignments, attendance, club/event registration, accepted complaint/current Supervisor/private note/image bytes and quota. It snapshots them and migration history, runs `prisma migrate deploy` twice, compares all fixture data, verifies all seven migration file checksums and completion states, and checks quota against image metadata. It restores prior slot state and cleans only its synthetic records. Since Phase 5 has no schema delta, this exercises the existing Phase 4 schema under the release migration command without an artificial extra migration.

Results: fresh migrations passed; representative upgrade/repeated migrations passed; idempotent development seed ran twice; built-container migration ran with no pending migrations. Existing hashes, roles, module records, assignments, images and quotas stayed intact.

The production pre-deploy command remains **`npm run db:migrate`** (`prisma migrate deploy`). Never run `migrate reset`, `db push`, destructive seed or a schema reset on production.

Local backup rehearsal used PostgreSQL 17 `pg_dump -Fc` and `pg_restore --no-owner --exit-on-error` into a new isolated database. All 23 public tables, including migration history, matched counts and sorted complete-row digests. A second backup included two nonempty synthetic Event/Complaint PNGs (250 stored bytes); bytes and the shared budget survived restoration. Backup files, QA scripts, synthetic credentials and session snapshots are ignored local artifacts, not release source. Cloud backup/restore has not been exercised.

## Executed tests and fixes

Host: Windows PowerShell, Node 24.18.0, npm 11.16.0, Docker 29.6.1; image Node 24.21.0, PostgreSQL 17. Automated suites used `campusone_phase5_suite_test`; populated browser QA used separate `campusone_phase5_test`. No real institutional data was used.

| Check | Final executed result |
|---|---|
| `npm ci` | Passed; 345 packages, npm audit reported zero vulnerabilities at installation time |
| `npm run db:generate` | Passed |
| Fresh migrations + representative upgrade twice + seed twice | Passed |
| `npm run typecheck` | Passed for both workspaces |
| `npm test` | **176 passed, 0 failed, 0 skipped**, including all database suites; previous baseline 161 |
| `npm run test:release` | **4 passed, 0 failed, 0 skipped** |
| `npm run build` | Frontend/backend passed |
| `docker compose build app` / `docker compose up -d` | Passed; app/database healthy |
| Production container, no SMTP | Passed on localhost:3001, non-root uid 1000, explicit demo warning |
| HTTP checks | Ready JSON, home HTML, both built JS/CSS assets with correct MIME/content and unknown API JSON 404 passed on local Compose and production container |
| Persistence | Database/authenticated Student roles, attendance, event registration and complaints survived container restart |
| Backup/restore | 23-table row/digest comparison and nonempty image/quota checks passed |

The 15 new application tests include explicit production/no-SMTP configuration, normalized registration and hashing, Secure cookie/session/logout, lookalike domains and injected privileges, concurrent duplicate signup, pending Staff/Head requests, confirmed approval/linkage/assignments with rollback, cumulative Student + Club Head attendance/events, Staff + Supervisor restrictions, all five group slots, image/internal-note privacy after reassignment, closure/feedback, live revocation, shared quota contention, production fixture exclusion and safe bootstrap. Existing module suites cover detailed roster import/corrections/audits/CSV, event deadlines/uniqueness/supervision and complaint state transitions. Four release tests cover missing configuration before upload, exact targets, waiting for the new deployment rather than an older success, and timeout/missing ID failure.

Failures encountered and corrected:

| Failure | Correction / final evidence |
|---|---|
| Sandbox Git metadata write, Docker engine access, npm workspace symlink EPERM | Used approved access for authorized local operations; started Docker Desktop; clean installation and subsequent commands passed |
| Typecheck could not narrow nullable eligibility result | Shared generic type predicate; root typecheck passed |
| New event fixture used uppercase action | Corrected fixture to existing lowercase `publish` API; integrated suite passed |
| Upgrade complaint fixture omitted required assignment timestamp | Completed representative verified/routed fixture; database check passed |
| Full suite accidentally ran against populated browser QA DB: 171 passed / 5 failed (four Complaint global count/slot tests, one Attendance global report count) | Separated automated clean DB from populated QA DB; reran migration/upgrade/seed twice/typecheck/176 tests/4 release tests/build successfully; no real data was touched |
| Backup image helper compared `Uint8Array` to `Buffer` type identity | Normalized arrays before byte comparison; two images/privacy/quota checks and complete restoration passed |

The PostgreSQL adapter emits an existing deprecation warning about concurrent queries on one transaction client; current pg version passes all checks. Address that compatibility warning before upgrading to pg 9. There are no outstanding failed local checks. Remote PR CI is a separate release gate; consult the PR's latest head checks, not this historical local result.

## Desktop/mobile and timing observations

Actual browser inspection used desktop 1280 × 900 and mobile 390 × 844 against the production-mode container. Student signup showed the insecure mode warning and immediate access; Staff signup showed pending Admin approval without mandatory email resend. Login persisted across refresh; logout persisted after refresh. An Admin confirmed identity, selected a teaching offering and approved Staff; the approved account then saw the faculty class. Student + Club Head viewed their own attendance (1/1), registered event and private complaint without coordination notes. Current Staff + Supervisor saw the assigned queue, internal Warden coordination and resolution form. Navigation, form feedback and internal table scrolling worked; inspected mobile pages had no page-wide horizontal overflow. Screenshots were retained locally. Physical devices, real mail and live cloud UI were not tested.

Limited localhost production timing used a single sequential client, one warmup, 20 samples per read and five complaint writes (milliseconds):

| Endpoint | p50 | p95 | Maximum |
|---|---:|---:|---:|
| Readiness | 14.8 | 19.0 | 22.5 |
| Student Attendance | 16.1 | 20.9 | 21.1 |
| Events | 16.5 | 19.3 | 20.7 |
| Complaints | 16.6 | 20.6 | 21.6 |
| Complaint creation | 15.5 | 18.2 | 18.2 |

These observations exclude network/cloud variability and concurrency. The 50–100 normal / 300 peak users and 500 ms read / 2 s write targets remain **unproven**.

## Runtime variables

Keep service secrets in Railway; do not copy the database URL or JWT secret into GitHub.

| Variable | Runtime requirement |
|---|---|
| `NODE_ENV` | `production` |
| `APP_ORIGIN` | Exact owner-provided HTTPS public origin, without path/trailing slash; controls cookies and Origin validation |
| `DATABASE_URL` | Private PostgreSQL reference, provided through Railway service variables |
| `JWT_SECRET` | Random secret >=32 characters; no example/placeholder value |
| `INSTITUTIONAL_AUTH_MODE` | Explicit `domain-only-demo` for this accepted-risk academic demonstration; otherwise default strict legacy mode |
| `STORAGE_MODE` | `database`; other modes are not implemented and fail startup |
| `PORT` | Supplied by Railway; validated 1–65535; defaults 3000 locally |
| `HOST` | Optional `0.0.0.0` for container; production already defaults to that; development defaults loopback |
| `MAIL_MODE`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | Unused/not required in demo mode. Legacy production verification requires SMTP/TLS; live delivery remains untested. |
| `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Temporary trusted bootstrap inputs; remove after successful bootstrap |
| `DEMO_PASSWORD` | Development seed only; do not configure a production seed |
| `VITE_ATTENDANCE_WARNING_THRESHOLD` | Optional frontend Docker build argument, default 75 (0–100); changing runtime env does not rebuild the UI |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Local Compose PostgreSQL only; sample localhost credentials are not cloud credentials |

The image's CMD starts the server as `node`, serves frontend and API on one port and handles SIGTERM. `railway.toml` selects Dockerfile build, pre-deploy migration, `/api/health/ready`, 120-second health timeout and three failure restarts. Application startup itself does not reset/seed the database or require SMTP in demo mode.

## GitHub CI/CD and owner settings

The workflow triggers on PRs targeting main and pushes to main. The `checks` job creates PostgreSQL 17, installs/generates, applies all migrations, verifies representative upgrade, seeds twice, typechecks, runs all tests/release guards, builds both workspaces and Docker, then starts the production image without SMTP and verifies readiness/home/assets/API routing. A failed command fails checks and prevents deployment. CI uses synthetic credentials only and removes its local container.

The deploy job requires successful checks **and** a push to `refs/heads/main` **and** repository variable `ENABLE_RAILWAY_DEPLOY` exactly `true`. It uses GitHub environment `production`, serialized `campusone-production` concurrency (`cancel-in-progress: false`) and a 30-minute bound. PR runs never deploy. Missing configuration fails before upload; nothing silently enables deployment.

Owner configuration (not performed during Phase 5):

| GitHub setting | Value/scope |
|---|---|
| Environment | `production`; add required reviewer/protection rules available for the repository plan |
| Secret | `RAILWAY_TOKEN`, preferably scoped to `production`; token for the intended Railway project/environment |
| Variables | `RAILWAY_PROJECT_ID`, `RAILWAY_SERVICE_ID`, `RAILWAY_ENVIRONMENT_ID`: exact owner-provided IDs; repository or `production` scope |
| Variable | `RAILWAY_PUBLIC_URL`: exact HTTPS origin, without trailing slash |
| Repository variable | `ENABLE_RAILWAY_DEPLOY`: keep absent/false until explicit owner authorization; must be repository-scoped because the job condition is evaluated before environment variables are available |
| Branch protection | Require the `checks` job on main and review before merge; scope deployments to main where supported |

CLI syntax was checked on 2026-10-10 against official [Railway CLI docs](https://docs.railway.com/cli), [up command](https://docs.railway.com/cli/up), [deployment list](https://docs.railway.com/cli/deployment), installed CLI help and pinned [5.64.2 up source](https://github.com/railwayapp/cli/blob/v5.64.2/src/commands/up.rs) / [deployment source](https://github.com/railwayapp/cli/blob/v5.64.2/src/commands/deployment.rs). No authenticated Railway account command was run.

`.github/scripts/deploy-railway.mjs` uploads with `railway up --project <ID> --service <ID> --environment <ID> --detach --json`, captures that upload's deployment ID and polls `railway deployment list` with the same explicit selectors. Only that deployment's `SUCCESS` permits HTTP smoke checks; terminal failures, missing IDs or timeout fail the job. This avoids the build-only behavior of `--ci` / `CI=true` and avoids accepting an older successful deployment. Per-command timeout is three minutes; normal polling is bounded to about twenty minutes. No live upload/status polling has been executed. Railway rebuilds checked source using the Dockerfile/lockfile; the CI image is not promoted as an identical image digest.

## First deployment — owner procedure

- [x] Local integration/security/migration/tests/Docker/manual UI and recovery evidence recorded.
- [x] Deployment workflow prepared with explicit gates and exact target selection.
- [ ] Owner reviews release PR and verifies its latest GitHub `checks` result.
- [ ] Owner confirms college account eligibility, credits/storage limits and actual service configuration; no paid upgrade is assumed.
- [ ] Owner supplies an empty application service and PostgreSQL in the intended project/environment, with no GitHub source/autodeploy connection.
- [ ] Owner sets Railway runtime variables above, generates the public domain and sets the exact `APP_ORIGIN`.
- [ ] Owner verifies backups and backward-compatible migration plan for any existing data.
- [ ] Owner configures GitHub production environment, scoped token, exact IDs/public URL and branch protections.
- [ ] Owner explicitly authorizes the first deployment and sets repository `ENABLE_RAILWAY_DEPLOY=true` before the reviewed merge/push to main. Enabling it after a push does not retroactively deploy that push; this workflow has no manual dispatch trigger.
- [ ] Owner merges after CI/review; main checks run again, then the protected deployment job uploads/waits/checks.
- [ ] Owner verifies deployment logs, all seven migrations, readiness, frontend assets, HTTPS Secure cookie/Origin, privileged identity checks and persistent records after restart.
- [ ] Owner bootstraps a trusted Admin, removes bootstrap inputs and verifies all modules using synthetic records.
- [ ] Owner records successful cloud deployment/backup/rollback evidence and public URL; only then marks cloud tasks complete.

No merge, Railway provisioning, token creation/configuration, flag enablement or cloud deployment was performed for this release preparation.

## Trusted Admin bootstrap

Before granting Admin, the operator must verify the intended person's real identity out of band. Use an unused exact institutional email and set `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` privately in the already authorized container environment. Run `npm run admin:bootstrap:built -w backend` inside the deployed application container using the owner's approved execution mechanism. Host development uses `npm run admin:bootstrap -w backend`.

The bootstrap creates one new Admin with Argon2id password hashing; it refuses existing emails, public-account promotion and password resets. Demo mode leaves ownership timestamp null. Strict mode requires prior operator verification of mailbox ownership. Remove temporary bootstrap variables after success; do not put passwords in commits, PRs, shell transcripts or public logs. Production seeding is refused; migrations do not create demo users.

## Backup, rollback and operating limits

Before upgrades, create a PostgreSQL custom-format backup through an owner-approved private connection/tool; protect it as sensitive data. Record source database, migration versions, application commit and mode. Rehearse `pg_restore --no-owner --exit-on-error` into a **new separate** database, compare records/migrations/image bytes/quota and run application smoke checks there. Local rehearsal passed; owner cloud retention, remote connectivity and restore procedure still require verification.

For release failure, keep `ENABLE_RAILWAY_DEPLOY` false while diagnosing. Preserve logs and the exact deployment ID. Redeploy a compatible known-good application commit or use the owner's Railway rollback controls after review. Application rollback does not undo migrations; Phase 5 leaves the schema unchanged, but the older strict-only application would block new unverified demo users. Do not fabricate verification timestamps to make a rollback work. Decide whether to preserve this mode-aware application or perform a genuine verification transition.

For data recovery, pause affected writes, restore into a separate database first, validate it, and switch only through an owner-approved recovery plan. Restoring an older backup loses newer writes; reconcile them before cutover. Never reset a production database as a rollback shortcut.

Operational limits: single application instance/process-local rate limits, PostgreSQL images/shared 50 MiB budget, no implemented bucket backend, no distributed session revocation, no real identity assurance in demo mode, no real SMTP evidence, no load/concurrency/SLO proof, no physical-device QA and no live Railway migration/health/rollback evidence. Credits/availability and account eligibility remain the owner's responsibility. Local Docker remains a usable demo option when cloud credits expire.
