# Render + Neon operator guide

CampusOne uses GitHub Actions for validation, Render's native GitHub integration for deployment, and Neon PostgreSQL for persistence. This is the approved architecture selection: GitHub-native checks, managed application deployments and managed PostgreSQL keep the workflow simple. The root Dockerfile builds one Express modular monolith that serves the React/Vite frontend and REST API from one HTTPS origin.

Repository configuration does not provision an account, change GitHub protection, migrate an external database or deploy a live service. Those owner actions follow review and authorization. Historical test evidence is in [Phase 5](phase5-integration-deployment.md); current architecture decisions are in [architecture.md](architecture.md).

## 1. Review and protect main

Review the deployment PR and require its latest `checks` result to succeed before merging. Under GitHub repository **Settings → Rules → Rulesets** (or branch protection), target `main`, require pull requests, at least one maintainer approval and the **checks** status check from **CampusOne CI**. Require the branch to be up to date before merging and disallow force pushes/deletion. Confirm the exact check name after a workflow run. Protection availability depends on the repository's GitHub plan/visibility; verify enforcement before enabling automatic production deployment. Do not describe main as protected until the rules are active.

Branch protection controls what can merge. Render's deployment gate separately waits for the checks on the resulting `main` commit. PR success does not replace the main push run. CI has no cloud deployment job or production credentials.

## 2. Create Neon PostgreSQL

In the Neon Console, create a Free project, choose PostgreSQL 17 where available to match CI, and choose a region close to the intended Render service. Select the intended production branch, database and role. Use a new empty database for initial setup. Existing databases require an operator-reviewed backup and migration plan; their migration state is unknown until inspected.

Open **Connect**, select that same branch/database/role and copy both PostgreSQL URLs privately:

- **Connection pooling enabled**: hostname includes `-pooler`; use as Render `DATABASE_URL` for application queries.
- **Connection pooling disabled**: direct hostname; use as Render `DIRECT_URL` for Prisma CLI migrations.

Preserve Neon's TLS parameters (including `sslmode=require`) and URL-encoded credentials. Both URLs must identify the same database. Do not paste a `psql` command, shell quotes or a placeholder into the Render value. Never put the URLs in GitHub variables, commits, screenshots or PR text.

`backend/prisma.config.ts` selects `DIRECT_URL` when supplied, otherwise `DATABASE_URL` for local PostgreSQL compatibility. Prisma 7 puts this CLI URL in config, not a schema `directUrl` field. The separate URL follows Neon's documented pooled-runtime/direct-CLI setup and avoids depending on transaction-pooler session behavior for schema operations. The existing `@prisma/adapter-pg` TCP driver remains; its runtime pool is capped at five connections with a three-second connection timeout. No driver or model redesign is needed. Consult [Neon's Prisma guide](https://neon.com/docs/guides/prisma) and [Prisma 7 configuration](https://www.prisma.io/docs/orm/v7/reference/prisma-config-reference).

## 3. Create one Render Docker Web Service

After the approved change reaches `main` and that commit's checks pass, connect the owner's GitHub account to Render and grant access to **R-Sundararajan/CampusOne**. Use the connected GitHub repository integration; a public repository URL by itself does not provide native automatic deployment.

The root [render.yaml](../render.yaml) is the declarative source: one Free Docker Web Service, branch `main`, repository-root build context, `./Dockerfile`, health path `/api/health/ready`, `autoDeployTrigger: checksPass`, fixed nonsecret defaults and prompts for private values. It defines no Render database, worker, disk or preview service. Free services default to one instance. Choose a region near Neon during creation; do not create a second frontend service.

The dashboard equivalent is **New → Web Service → connected GitHub repository**, with these settings:

| Setting | Value |
|---|---|
| Branch | `main` |
| Language/runtime | Docker |
| Root directory | Repository root (leave blank) |
| Dockerfile path | `./Dockerfile` |
| Docker build context | `.` |
| Instance type | Free |
| Auto-Deploy | **After CI Checks Pass** |
| Health check path | `/api/health/ready` |
| Docker command | Leave blank to use the image CMD |
| Pre-deploy command | Leave blank; unsupported on Free |

Creating a service/Blueprint can initiate its first deployment. Treat creation and manual deployment as owner-authorized release actions and first verify the selected main SHA's successful CI. Manual deployment is not a substitute for the automatic gate. The Blueprint's `sync: false` values are prompted only at initial creation; later additions must be set manually in service Environment. Validate the YAML in Render's Blueprint creation screen before approving provisioning.

Confirm **Settings → Auto-Deploy → After CI Checks Pass** after creation. Render waits for all detected checks on the linked commit and does not automatically deploy a failed check or a commit with zero checks. Render also accepts `neutral`/`skipped` conclusions, so retain the unconditional `checks` job with no path filters, job-level skipping or `continue-on-error`. Keep PR previews disabled and the linked branch fixed to `main`. No Render token, deploy hook or Actions deployment job is required. See [Render deploy gates](https://render.com/docs/deploys) and the [Blueprint specification](https://render.com/docs/blueprint-spec).

## 4. Configure Render environment

Use actual private values in Render **Environment**. Obtain the service's assigned `onrender.com` URL from Render and set its exact HTTPS origin before a successful application start. If initial provisioning starts before the domain is known, update `APP_ORIGIN` and redeploy the same reviewed main commit; a placeholder origin is not a completed setup.

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `3000` in the Blueprint; respect any Render-provided override |
| `HOST` | `0.0.0.0` (also the production application default) |
| `APP_ORIGIN` | `https://<actual-render-domain>.onrender.com`, no path or trailing slash |
| `DATABASE_URL` | Neon pooled PostgreSQL URL with TLS |
| `DIRECT_URL` | Neon direct PostgreSQL URL with TLS, same database |
| `JWT_SECRET` | Cryptographically random secret, at least 32 characters; generate privately with `node:crypto` or a password manager |
| `INSTITUTIONAL_AUTH_MODE` | `domain-only-demo` for the approved controlled demonstration |
| `STORAGE_MODE` | `database` |

The values shown are illustrative placeholders, not production credentials. Do not configure `DEMO_PASSWORD` or automatic production seeding. Do not store `ADMIN_*` in Render; the one-time local bootstrap below supplies them privately. `MAIL_MODE`/`SMTP_*` are unused in domain-only-demo. Switching to real email verification requires a separately reviewed delivery/identity design; Free Render currently blocks common SMTP ports.

**Domain-only mode verifies neither mailbox ownership nor institutional identity.** Anyone can claim an unused exact `@ssn.edu.in` address. Use a controlled audience and synthetic demo records. Independently authorize the first Admin and verify identity out of band before Staff/Club Head approval, teaching/club/Supervisor assignments or student linkage. There is no public Admin signup.

## 5. First migration and readiness

Render builds the Dockerfile with Node 24, npm workspaces, Prisma generation and both workspace builds. The pruned non-root runtime retains the Prisma CLI production dependency, configuration, schema, all seven migration directories and compiled server/bootstrap scripts. Build needs no production URL or secret.

The default CMD runs `sh backend/start.sh`:

1. Validate the existing production runtime configuration.
2. Invoke `npm run db:migrate` (`prisma migrate deploy`) once for this startup using the CLI URL.
3. Only after success, switch to the backend workspace and `exec node dist/src/index.js` to preserve frontend path resolution, start HTTP and receive SIGTERM directly.

No `tsx`, seed, custom SQL bootstrap, `db push` or reset runs. A failed migration exits nonzero before HTTP starts. Prisma's migration ledger means ordinary restarts run the command again but do not reapply completed migrations. Do not add a second migration command in Render's Docker Command. Free has no paid pre-deploy feature; see [Render's deploy lifecycle](https://render.com/docs/deploys).

For the first owner-authorized deployment, inspect that exact deployment's logs for all pending migrations applied successfully followed by `CampusOne listening on port ...`. Verify Neon migration history privately using its SQL editor:

```sql
SELECT migration_name, finished_at, rolled_back_at
FROM "_prisma_migrations"
ORDER BY migration_name;
```

Expect seven completed entries, no rollback marker and no failed/unresolved entry. Restart the reviewed service once and confirm `No pending migrations to apply`, readiness and data preservation. This is a single-instance strategy; old/new processes can overlap during platform replacement, so migrations must remain backward-compatible. It does not establish zero-downtime schema changes or safe concurrent multi-instance rollout. Never disable Prisma migration locking.

For failures, inspect logs and connectivity, confirm direct/pooled URLs target the same database, and preserve the failed migration record. Do not repeatedly modify migration SQL or reset production. Investigate and use Prisma's reviewed migration recovery procedure when needed.

## 6. Bootstrap the first administrator locally

Render Free has no interactive service shell. On an authorized operator workstation, check out the exact deployed commit, use Node 24, and run `npm ci`, `npm run db:generate`, `npm run build`. These commands build locally without migrating production. Confirm section 5 completed before bootstrap and independently verify the intended administrator's identity.

Use a private PowerShell session with transcription disabled. Prompt for the Neon pooled URL and administrator password without echo or literal credentials in history; the bootstrap uses the same five-connection TCP adapter. Supply an unused institutional email and explicit name. Run the compiled bootstrap once:

```powershell
$campusDbInput = Read-Host 'Neon pooled PostgreSQL URL (private)' -AsSecureString
$campusAdminInput = Read-Host 'Administrator password (12–128 characters)' -AsSecureString
try {
  $env:DATABASE_URL = [System.Net.NetworkCredential]::new('', $campusDbInput).Password
  $env:ADMIN_NAME = Read-Host 'Verified administrator name'
  $env:ADMIN_EMAIL = Read-Host 'Verified unused institutional email'
  $env:ADMIN_PASSWORD = [System.Net.NetworkCredential]::new('', $campusAdminInput).Password
  $env:INSTITUTIONAL_AUTH_MODE = 'domain-only-demo'
  $env:NODE_ENV = 'production'
  npm run admin:bootstrap:built -w backend
  if ($LASTEXITCODE -ne 0) { throw 'Administrator bootstrap failed; inspect the error' }
} finally {
  Remove-Item Env:ADMIN_NAME, Env:ADMIN_EMAIL, Env:ADMIN_PASSWORD, Env:DATABASE_URL, Env:INSTITUTIONAL_AUTH_MODE, Env:NODE_ENV -ErrorAction SilentlyContinue
  $campusDbInput.Dispose()
  $campusAdminInput.Dispose()
}
```

Use a dedicated session so cleanup does not replace another task's environment. This operation writes the new Admin to the selected Neon database and requires owner authorization. Keep the workstation/session private: the Node process necessarily receives plaintext values in memory. Do not paste its environment into logs. No database URL belongs in a committed `.env`.

The existing bootstrap validates the exact institutional domain, explicit name and 12–128 character password, hashes with Argon2id, grants only `ADMIN`, and refuses to elevate or reset an existing account. Domain-only mode leaves `emailVerifiedAt` null. No default administrator or synthetic seed is created. Sign in over the Render HTTPS origin and confirm Admin access; existing-account refusal requires operator reconciliation, not a public promotion route.

## 7. Verify and operate

Run from the reviewed checkout with the actual origin (no credentials required):

```powershell
node .github/scripts/verify-http.mjs https://<actual-render-domain>.onrender.com
```

This verifies ready JSON, frontend HTML, built JS/CSS and API JSON 404 routing. Also inspect `/api/health/live`, login/logout, `Secure`/HttpOnly/SameSite cookies, same-origin writes and rejection of an unrelated Origin. Verify the one-hop trusted proxy assumption with the actual Render deployment. Use only authorized synthetic records for module checks. Record the deployed SHA, URL and results; no live Render/Neon validation is claimed by repository-only tests.

Render Free can spin down after inactivity and restart unexpectedly; cold starts include database wakeup and migration checks. Its filesystem is ephemeral, and it offers no persistent disk, shell, one-off job or paid pre-deploy command. Images stay in Neon's PostgreSQL `bytea` tables: one JPEG/PNG per record, 2 MiB per image, shared atomic 50 MiB quota and current authorization. No upload filesystem or object storage is required. Free external database traffic and build/runtime allowances can limit availability; check [Render Free limitations](https://render.com/docs/free) and [Neon plans](https://neon.com/pricing) in the owner's account. Local Docker remains usable independently.

Neon usage, connection/storage limits and compute suspension must be monitored by the owner. If readiness initially fails, inspect network/TLS and database wakeup; the retained three-second runtime connection timeout may produce a temporary 503 until compute is awake. Do not remove the pool cap or weaken TLS/Origin/auth checks to mask a failure.

Before schema changes, take an authorized direct-connection `pg_dump` backup and rehearse restoration into a separate database. Protect backups as sensitive data. Use reviewed compatible application commits for recovery; Render rollback/manual deploy does not undo migrations and may alter auto-deploy settings, which must be rechecked. Diagnose with Auto-Deploy Off when necessary, then restore **After CI Checks Pass** after review. Never reset production as a rollback shortcut. There is no cloud backup/restore or availability guarantee until the owner exercises it.

## Repository validation — 2026-10-10

Executed locally on Windows with Node 24, Docker Linux containers and isolated PostgreSQL 17. Production image used Node 24.21.0 and Prisma 7.10.0. Existing development/production databases were not used.

| Check | Executed result |
|---|---|
| Locked dependency installation | `npm ci` passed; audit reported zero vulnerabilities at installation time |
| Prisma client/schema | Generation and `prisma validate` passed |
| Seven migrations / existing-data upgrade | Fresh migration chain and representative upgrade checksums/data survived two deploy runs |
| Local seeds | Two explicit development seed runs passed on the isolated test database |
| Typechecks / workspace builds | Frontend/backend passed |
| Application tests | 176 passed, 0 failed, 0 skipped, with all PostgreSQL suites enabled |
| Generic HTTP release guards | 4 passed, 0 failed, 0 skipped |
| Docker production build/startup | Passed; empty database migrated before HTTP, custom port 3010 honored, ready/home/JS/CSS/API 404 verified |
| Image contents/process | Non-root uid 1000, Node PID 1, backend workspace directory, Prisma CLI/config/schema/seven migrations and compiled bootstrap present; `tsx` absent |
| Restart | Completed migration ledger/checksums/timestamps and test Admin preserved; no pending migrations; HTTP verification passed |
| Failure guards | Invalid direct migration credentials exited 1 without HTTP; missing JWT secret failed production configuration before migration |
| Compiled local administrator procedure | New synthetic institutional Admin created; Argon2id/role/null verification timestamp persisted; existing email refused; secure cookie and untrusted-Origin refusal verified |
| CI / Blueprint | YAML parsing, actionlint 1.7.12 and Render's current published JSON Schema passed; supported fields reviewed against current documentation |
| Obsolete configuration audit | No former platform references in active deployment configuration/code/guides; historical phase records retained and marked |

The first startup test exposed a repository-root working directory that made the frontend return 404. The startup script now changes to the backend workspace before executing Node; the corrected image passed the fresh startup and restart checks. The existing pg transaction-client query concurrency deprecation warning remains; tests pass with the locked pg version.

Local PostgreSQL tests do not validate Neon's pooled endpoint, TLS, network policy or cold-start behavior. Render provisioning, actual deployment gate, real-domain HTTPS/proxy behavior, Neon production migration/backup/rollback and cloud availability remain owner checks. GitHub PR CI is a separate gate; inspect the latest head's check result before merge.

## Owner completion checklist

- [ ] Latest PR `checks` succeeds; review/merge and main protection are enforced.
- [ ] Neon Free database created; pooled/direct TLS URLs copied privately for the same database.
- [ ] One Free Render Docker Web Service connected through GitHub to `main`; previews disabled.
- [ ] Auto-Deploy is **After CI Checks Pass**, health path is `/api/health/ready`, default Docker CMD preserved.
- [ ] Actual HTTPS `APP_ORIGIN`, both database URLs, random JWT secret and required runtime defaults configured.
- [ ] First authorized startup applies all migrations; Neon ledger, readiness and restart verified.
- [ ] Trusted local compiled administrator bootstrap completed; temporary inputs removed.
- [ ] Frontend/API/HTTPS cookies/Origin and authorized module checks verified; deployed SHA and evidence recorded.
