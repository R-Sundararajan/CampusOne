# Phase 3 — Events implementation and verification

> Historical implementation/verification record. Current deployment: [Render + Neon operator guide](render-neon-deployment.md). Previous platform references describe this phase only.

Verified locally on 2026-10-09. No push, main merge, Railway deployment or production data change.

## Branch and commits

- Branch: `feature/events-module`.
- Base: `90ecf40`, the inspected Phase 2 tip. It contains verified `d179001`, completion documentation `69c3acc` and the design-document ignore adjustment. Both later commits were preserved.
- Phase 2 branch remains at `90ecf40`; main remains `bb03854`.
- `e5468c3`: reusable validated PostgreSQL image storage and Sharp dependency.
- `60a4e13`: events schema, API, internal registration and club assignment administration.
- `a03c341`: event frontend and shared natural portal theme.
- Verification/documentation commit: `git log -1 --oneline` on this branch (the commit containing this report cannot embed its own hash).

## Data and permissions

Reuses Event, EventRegistration, ClubAssignment, Image, ImageBudget and AuditLog. Event adds DRAFT, optional draft schedule fields, optional endsAt and a version. One owning club is immutable. EventRegistration preserves its composite primary key and adds a unique registration ID plus an index for private Student history. Indexes cover club/start, status/start and deadline. Chronology is checked in validation and PostgreSQL.

Approved Club Heads manage only their current assignments; every write rechecks persisted roles and club assignments after acquiring the club lock. Admin may supervise every club. Draft metadata/posters are visible only to currently authorized club organizers and Admin. Ordinary discovery shows published events only. Students see their own registration history and no other Student identities in event listings. Organizer registration tables are paginated and limited to the owning club.

Drafts require title/club. Publication requires description, venue, future start and open deadline. Deadline must be on/before start; optional end must be later. Cancellation is terminal and keeps registrations. Only Admin may unpublish, and only without registrations. Edits preserve records and reject a deadline on/before the latest registration or a reschedule into the past.

Every metadata, poster and lifecycle change increments version and writes an audit in the same transaction. Club access changes reuse the registration/approval service, operate only on already approved Club Heads, require a reason and write an audit. Club locks serialize revocation against event writes; event locks serialize registration against cancellation, editing and duplicate requests.

All timestamp APIs accept explicit UTC offsets. The UI uses Asia/Kolkata (IST); categorization uses instants, not manually managed lifecycle states. Without an optional end, an event becomes past at start. Registration closes at deadline equality and also at start, independently of the UI. Registration uses only the authenticated approved Student identity, with idempotent already-registered responses. Students cannot submit identity overrides or withdraw.

## API

All routes require the existing JWT cookie. All writes require the configured Origin. JSON bodies/queries are strictly validated.

| Method | Route | Behavior |
|---|---|---|
| GET | /api/events/catalog | Club directory and current authorized clubs |
| GET | /api/events | Paginated discovery; scope=browse/manage/mine, group=upcoming/ongoing/past/all, clubId, status, q, sort, page, pageSize |
| GET | /api/events/statistics | Authorized club/college totals and registrations by club |
| POST | /api/events | Create an authorized club draft |
| GET | /api/events/:id | Authorized details, own registration state and eligible actions |
| POST | /api/events/:id/edit | Full metadata update with current version; rejects owning-club changes |
| POST | /api/events/:id/action | publish/cancel/unpublish with current version |
| POST | /api/events/:id/register | Empty body; authenticated Student registration |
| GET | /api/events/:id/registrations | Organizer/Admin Student list, page and pageSize |
| POST | /api/events/:id/poster?version=N | Raw JPEG/PNG; matching Content-Type and optional matching X-Image-Filename |
| GET | /api/events/:id/poster | Authorized image bytes |
| POST | /api/events/:id/poster/remove | Remove poster with version |
| GET | /api/admin/club-access | Existing clubs, approved heads and assignments |
| POST | /api/admin/club-access | Audited grant/revoke: userId, clubId, active, reason |

Event listing limits default to 12 and cap at 24; registration table limits default to 25 and cap at 50. Event counts and own registration state use bounded relational queries; no binary data or all-Student registration arrays appear in lists. Registration summaries are persisted-record counts, never physical attendance. Total events include drafts/cancelled; upcoming/past summaries count published events. Cancelled registrations remain in totals.

## Images

Shared `backend/src/services/image-storage.ts` accepts event or complaint ownership for later reuse; Phase 4 routes/workflows remain absent. Express bounds raw requests at 2 MiB before decoding. Only actual JPEG/PNG content is accepted; MIME, optional filename extension, pixel data and dimensions are validated. Sharp fully decodes and re-encodes clean bytes without metadata or trailing payloads. A decoded output above 2 MiB is rejected. The processing cap is 24 million pixels; animation is rejected.

The separate Image table stores bytea; Event queries select only an image reference. A transaction-level advisory lock and ImageBudget row lock serialize all quota changes across owners. Replacement reserves only the size delta; removal releases stored bytes. Quota, poster, version and audit updates roll back together. Retrieval checks event visibility, uses the verified MIME type, `private, no-store`, and `X-Content-Type-Options: nosniff`. CSP permits local blob image previews while retaining the existing script policy. No new storage volume or external service.

## Files

Added:
- `backend/src/modules/events/{permissions,routes,service,validation}.ts`
- `backend/src/services/image-storage.ts`
- `backend/tests/events.test.ts`
- The two migration files listed below
- `frontend/src/pages/Events.tsx`, `frontend/src/pages/events/{EventDetails,EventForm}.tsx`, `frontend/src/pages/events/types.ts`
- `frontend/src/pages/ClubAccess.tsx`, `frontend/src/components/ConfirmDialog.tsx`
- `docs/phase3-events.md`

Modified:
- Prisma schema, backend app/index, existing registration service/routes and backend package/lockfile
- Frontend App, PortalLayout, EventPoster, Approvals, Dashboard and shared portal CSS
- README; ignored local workflow/decisions files

Attendance business logic and its 64 existing tests were preserved.

## Migration and local run

1. `202610090002_event_drafts`: adds the enum value separately so PostgreSQL commits it before its new default is used.
2. `202610090003_events`: optional draft columns, endsAt/version, chronology check, registration IDs/indexes and budget initialization. Legacy registration IDs are deterministic; existing records are preserved.

A pre-migration local development dump was preserved in ignored `.local-backups/campusone-before-phase3.sql`. Migrations applied successfully to local `campusone` and separate `campusone_test`. No production connection was used.

```powershell
npm ci
docker compose up -d db
npm run db:generate
npm run db:migrate
npm run dev
# http://127.0.0.1:5173 — stop the Compose app first to free API port 3000

# Complete local container
docker compose build app
docker compose run --rm app npm run db:migrate
docker compose up -d
# http://localhost:3000
```

For database tests, set DATABASE_URL and TEST_DATABASE_URL to the isolated test database, apply migrations there, then run npm test. The new suite refuses a database name without 'test'. Without TEST_DATABASE_URL, database suites skip rather than pretending to pass. Existing README explains the disposable database workflow.

## Verification

- `npm run db:generate`: passed.
- `npm run typecheck`: passed.
- `npm test` with isolated PostgreSQL: **111 passed, 0 failed, 0 skipped**; all original 64 plus 47 new tests.
- `npm run build`: frontend/backend passed.
- Docker build and Compose startup passed; runtime migrations had no pending changes.
- Compiled development seed ran twice successfully, preserving credentials/roles and producing no seeded events.

New tests cover permission/ownership/revocation, unauthorized drafts and images, client privilege fields, chronology, version races, exact deadlines/IST categorization, successful and concurrent duplicate registration, combined roles, history/privacy, cancellation races, safe unpublish, scoped counts/search/pagination, JPEG/PNG validation, MIME/extensions, corrupted/oversized uploads, sanitized bytes, replacement/removal quota, concurrent quota reservation, stale poster changes, and injected transaction rollback. Quota stress fixtures reserve a nearly full budget rather than allocating 50 MiB.

Browser checks used existing synthetic development accounts and actual persisted records, explicitly titled [Local demo]. One synthetic Arts Club and four labeled events remain in the development database for review; these are not hardcoded directory placeholders and no events were added to seed.

| Browser workflow | Evidence |
|---|---|
| Desktop/mobile Club Head draft/create; desktop upload/publish | Passed via actual form and internal poster endpoint |
| Local portrait and landscape previews/replacements | Loaded 600×800 PNG and 900×500 JPEG; object-fit contain |
| Mobile event editing | Passed at 390×844; prior registrations preserved |
| Student discovery and registration | Passed; success status and My registrations updated |
| Duplicate UI and refresh | Registered persisted; Register button absent; API duplicate/concurrency verified in tests |
| Expired deadline | Student saw disabled Registration closed action |
| Admin cross-club supervision/unpublish | Passed for second club; returned to draft and republished |
| Registration statistics | Persisted two workshop registrations and per-club table verified |
| Confirmed cancellation/history | Admin cancelled separate registered event; count/Student history retained |
| Role/club access UI | Existing Approvals screen shows assignments and grant/revoke form; mutation/revocation tested on PostgreSQL |
| Existing Student + Club Head attendance | Private subjects/history continued to load in the natural theme |
| Responsive desktop/mobile | 1280×900 and 390×844 inspected; no page-wide horizontal overflow |

Browser review found and fixed blocked blob previews in CSP, inherited mobile poster width, panel padding, and partial-save/file-clear feedback. Full-page screenshots were unavailable for some long views; viewport evidence was saved in the Codex visualization directory.

## Limits

The supplied ProCode URL refused connections through both web retrieval and the browser; its live visual design was not inspected. The implementation follows the brief’s original poster hierarchy/proportions and uses original local verification artwork. No copied assets/source.

No cloud deployment, SMTP delivery, remote CI, physical-device test or scale/latency guarantee. pg emits a query-concurrency deprecation warning in the full regression run; tests pass with the current locked dependency. Image decoding adds native Sharp dependencies, verified on Windows and the Debian Docker image. Bucket storage remains deferred. Notifications, event check-in, attendance, certificates, QR codes, withdrawals and complaints remain outside Phase 3.

Phase 3 implementation and required local critical checks are complete; Phases 4–6 remain unchecked.
