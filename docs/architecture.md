# CampusOne deployment architecture and decisions

Approved production architecture: **Render + GitHub Actions + Neon PostgreSQL**. One Dockerized Express modular monolith serves the React/Vite frontend and REST backend from one HTTPS origin. Node 24, npm workspaces, Prisma 7, PostgreSQL models/migrations and database image storage are retained.

```text
Users
  |
  v
Render HTTPS Web Service (one Free instance)
  |
  +-- React/Vite frontend
  |
  +-- Express modular REST backend
  |
  +-- Prisma ORM (existing pg adapter, pool max 5)
         |
         v
    Neon PostgreSQL (TLS, pooled application URL)
```

```text
Developer / Codex -> feature branch -> PR to main
  -> GitHub Actions checks:
     PostgreSQL 17 test service -> seven migrations -> upgrade preservation
     -> repeated local seed -> typechecks -> unit/integration + release guards
     -> frontend/backend builds -> Docker build
     -> production startup on empty test DB -> readiness/frontend checks
     -> restart with completed migrations -> migration failure blocks HTTP
  -> required checks + maintainer review -> merge to protected main
  -> GitHub Actions checks on main
  -> Render: After CI Checks Pass
  -> Render builds root Dockerfile
  -> validate environment -> Prisma migrate deploy (direct Neon URL)
  -> Express frontend + API -> Neon -> readiness check
```

GitHub branch protection is an owner-configured merge gate; Render's `checksPass` setting is a distinct deployment gate on the merged commit. Pull requests never deploy production. CI validates disposable databases only and has no deployment token or cloud deployment job. Render uses the GitHub-connected repository integration. Keep checks unconditional because Render treats neutral/skipped checks as passing as well as success. Manual/initial deployment requires owner authorization and inspection of the main commit's CI.

| Decision | Selected approach | Reason and boundary |
|---|---|---|
| Application hosting | One Render Docker Web Service | Managed builds/deployments of the existing image; one same-origin release. |
| Database hosting | Neon PostgreSQL | Managed persistent PostgreSQL independent of the application lifecycle. |
| CI/CD | GitHub Actions validation + Render GitHub integration | GitHub-native CI and managed deployment gating without duplicate deploy jobs/secrets. |
| Packaging | Existing multi-stage Node 24 Dockerfile | Workspace builds and Prisma generation in build stage; pruned runtime runs as uid 1000. |
| Migrations | Startup command before HTTP | Compatible with Free; Prisma ledger supports repeat restarts and errors stop startup. |
| Connections | Pooled `DATABASE_URL`, direct CLI `DIRECT_URL` | Follow Neon/Prisma CLI guidance while retaining max 5 runtime connections. Local direct-only URLs still work. |
| Images | PostgreSQL bytea and existing storage service | Persistent storage with shared 50 MiB quota, 2 MiB JPEG/PNG limit and authorized retrieval. |
| Authentication | Approved `domain-only-demo` | Controlled demonstration only; exact domain does not establish identity/mailbox ownership. |
| Privileged access | Trusted bootstrap + Admin approval/assignment | Explicit operator authorization, no public Admin signup; live roles and ownership checks preserved. |
| HTTPS/CSRF | Exact deployed `APP_ORIGIN`, secure cookie, one trusted proxy hop | Same-origin requests without permissive CORS; verify actual proxy topology after provisioning. |
| Free plan | Single instance, ephemeral app disk, Neon allowances | Cold starts/restarts and external traffic limits; no shell, paid pre-deploy or zero-downtime schema guarantee. |

No application modules or security rules change as part of this hosting selection. Production startup never seeds synthetic users. All migration files/checksums remain unchanged. Startup is easy to audit in `backend/start.sh` and uses no development-only runtime tools. Schema changes must be backward-compatible because a replaced process may still access the database during deployment; multi-instance concurrent rollout is outside this design.

Use [the exact operator guide](render-neon-deployment.md) for provisioning, environment, initial administrator, verification and recovery. Owner settings and live deployment remain unverified until performed. Prior phase reports retain their historical results and are not current setup instructions. Ignored source design images and local planning records remain local references; this tracked document is the current deployment architecture.
