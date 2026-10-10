# CampusOne Phase 2 — implementation and verification

> Historical implementation/verification record. Current deployment: [Render + Neon operator guide](render-neon-deployment.md). Previous platform references describe this phase only.

Implemented locally on `feature/attendance-module`, based on the verified Phase 1.5 integration commit `23d88cf`. Main remains `bb03854`. No push, merge into main, Railway deployment, Event implementation or Complaint implementation was performed.

Implementation commits:

- `2a847c6` — schema, migrations, shared parser, transactional backend and seed compatibility.
- `4a84fb1` — faculty/student/Admin portal, roster preview, reports and configurable UI threshold.
- `d179001` — parser and PostgreSQL authorization/concurrency/rollback/report tests.

## Behavior

- Admin manages academic terms, department/cohort/class/section metadata, subjects, and verified Staff teaching assignments.
- Admin and assigned Staff preview and maintain one official class roster reused across subjects. Imports deduplicate and add entries; omissions do not remove students. Deactivation/reactivation requires a reason and explicit confirmation. Historical sessions retain their submitted membership.
- Roster entries have independent identities and optional verified account links. An Admin supplies the exact existing Student account email, institutional verification evidence and confirmation. Backend checks role, verification, activity and uniqueness; no Student claim API or automatic verified-account creation exists. Linkage is serialized and audited. Legacy blank identities can be reconciled without discarding memberships or attendance; overlapping historical records block an unsafe merge.
- Faculty see only their assigned classes/subjects for marking. Present-list and absent-list modes calculate against the official roster. Unknown numbers and empty input block saving. Full register numbers, counts, mode and individual status toggles appear before an explicit save confirmation. Uniform statuses require another deliberate confirmation.
- Session uniqueness is enforced by subject offering/date/hour. Offerings already identify the term/class/section. Records are unique by session/student. Class row locks serialize roster changes, assignment changes and attendance saves. Transactions save all records together. Roster and session versions reject stale submissions.
- Corrections require an assigned Staff role and a reason, use the original session membership, and audit only changed records with student, prior/new status, actor, reason and timestamp. Concurrent creation returns a conflict instead of creating a second session.
- Student identity comes only from the authenticated user. The Student endpoint rejects browser identity parameters. Student subjects, history and percentages use persisted records. Zero sessions render explicitly. The UI reminder threshold is configurable and defaults to 75%.
- Faculty/Admin reports support term, class, section, subject and date-range filters, subject/student/class summaries, saved-session reopening and correction audit history. CSV applies the same authorization/filter scope and quotes/escapes fields, including formula-injection protection.
- Both dashboards exclude unsubmitted and incomplete sessions. A saved membership-size snapshot is independent of subsequent roster changes.

## Schema and migration summary

`202610090001_attendance` adds `AcademicTerm`, `StudentIdentity` and `ClassEnrollment`. It extends existing `ClassGroup` with department/cohort/prefix/width/version and term linkage, and reuses `Subject`, `CourseOffering`, `TeachingAssignment`, `AttendanceSession`, `AttendanceRecord` and `AuditLog`.

The migration copies existing account-based enrollment into independent identities and class memberships, preserving user IDs, passwords, roles and historical attendance references. It replaces the legacy `Enrollment` table after copying its relationships. Register numbers remain nullable for migrated identities because the application must not invent real register numbers. One string register number and one account per identity are enforced by unique constraints. Sessions gain submitted state/version and date indexes; records gain timestamps. SQL checks constrain suffix width and period.

`202610090002_attendance_snapshot` adds the original session membership size. Existing record counts initialize historical snapshots; future submissions persist the full validated roster size. Incomplete or unsubmitted sessions are excluded from reports and cannot be corrected through the normal workflow until administrative data reconciliation.

The local development database was backed up to the ignored `.local-backups/campusone-before-phase2.dump` before migration. Both migrations applied to development and isolated test PostgreSQL. Demo seed reruns preserve existing passwords/roles and create only synthetic identities, memberships and assignments; attendance is entered explicitly through the workflow.

## Shared parser

`@campusone/attendance-core` is a dependency-free local ESM workspace used by API validation and live frontend feedback. It accepts commas, whitespace/newlines and mixed separators; inclusive ranges such as `62-132`; and nonconsecutive lateral-entry values such as `304,305`. Suffixes normalize to padded strings, sort and deduplicate, with duplicate values separately reported. Leading zeroes in prefixes are preserved.

It rejects malformed/negative/decimal values, reversed ranges, suffix overflow and ambiguous ellipsis shorthand, with a `62-132` example. Width is 1–6; prefix is 1–24 digits. Bulk text is limited to 20,000 characters, each range to 1,000 values, and total expansion to 5,000 values. Class imports additionally limit active membership to 1,000 students. Invalid input never saves a partial parsed subset. Marking validates the generated numbers against actual enrolled identities rather than inferring a continuous class sequence.

## Changed/new files

Backend:

- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/202610090001_attendance/migration.sql`
- `backend/prisma/migrations/202610090002_attendance_snapshot/migration.sql`
- `backend/prisma/seed.ts`
- `backend/src/modules/attendance/{routes,service,validation,registerNumber}.ts`
- `backend/src/{app,index}.ts`
- `backend/tests/{attendance,registerNumber}.test.ts`
- `backend/package.json`

Frontend:

- `frontend/src/pages/Attendance.tsx`
- `frontend/src/pages/attendance/{AcademicSetup,AttendanceReports,FacultyAttendance,MarkAttendance,Rosters,StudentAttendance,types}.tsx`
- `frontend/src/App.tsx`, `frontend/src/pages/Dashboard.tsx`
- `frontend/src/styles/portal.css`, `frontend/vite.config.ts`, `frontend/package.json`

Shared/runtime/docs:

- `shared/{package.json,registerNumber.js,registerNumber.d.ts}`
- Root `package.json`, `package-lock.json`, `.env.example`, `Dockerfile`, `compose.yaml`, `README.md`, this report
- Local `workflow.md` and `decisions.md` updated and kept ignored/untracked. Demonstration credentials remain ignored/untracked. Generated Prisma client/build output remain ignored.

## API

All routes below are under `/api/attendance`, reuse JWT authentication/current roles, and require the existing trusted Origin on writes.

| Route | Capability |
| --- | --- |
| `GET /student` | Authenticated Student's own overview and history; identity query parameters rejected |
| `GET /catalog` | Assigned faculty subjects/classes; Admin academic catalog |
| `GET /admin/staff` | Admin list of active verified Staff |
| `POST /admin/{terms,classes,offerings,assignments,link}` | Admin academic setup and validated account reconciliation |
| `GET /rosters/:id` | Admin or Staff assigned to this class |
| `POST /rosters/{preview,import}` | Scoped roster preview/import with confirmed current version |
| `POST /rosters/:id/membership` | Scoped deliberate membership change with reason |
| `POST /preview` | Assigned Staff's session preview/validation |
| `POST /sessions` | Assigned Staff's transactional create/correction |
| `GET /sessions/:id/audits` | Scoped correction history |
| `GET /reports`, `GET /reports.csv` | Assigned Staff reports/CSV or Admin reports/CSV |

Admin privileges alone do not grant attendance editing; an active Staff role and the specific teaching assignment are required. Club Head alone does not grant attendance editing. Cumulative roles retain only their applicable capabilities.

## Local run commands

From the root, with Node 24 and Docker Desktop:

```powershell
npm ci
docker compose up -d db
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

Open `http://127.0.0.1:5173`. Use only the ignored local demonstration credential file for synthetic accounts. Stop the app container before host development if it occupies port 3000.

For the complete container:

```powershell
docker compose build app
docker compose run --rm app npm run db:migrate
docker compose run --rm app npm run db:seed:built -w backend
docker compose up -d app
```

Open `http://localhost:3000`. Local Compose uses development accounts/mail; the image defaults to production. Production still rejects synthetic accounts and local mail previews.

Checks against the existing disposable local test database (create it first on a fresh installation):

```powershell
$env:DATABASE_URL = 'postgresql://campusone:campusone@127.0.0.1:5432/campusone_test'
$env:TEST_DATABASE_URL = $env:DATABASE_URL
npm run db:migrate
npm run db:generate
npm run typecheck
npm test
npm run build
Remove-Item Env:DATABASE_URL
Remove-Item Env:TEST_DATABASE_URL
```

Use your configured localhost database password instead of the sample when applicable. Do not point `TEST_DATABASE_URL` at a real institutional database: tests create disposable fixtures and temporarily inject record/audit failures. Without the variable, PostgreSQL tests are skipped, not passed.

## Verification — 9 October 2026 (Asia/Calcutta)

- **64/64 Vitest tests passed** across five files with isolated PostgreSQL, including the existing authentication/registration/foundation checks.
- Parser cases cover separators, ranges, lateral entries, padding, duplicates, invalid characters, ellipses, reverse/large ranges, overflow, widths and prefixes.
- PostgreSQL API checks cover additive/idempotent imports, no duplicate memberships, access scopes, linkage spoofing/unverified accounts/concurrency, present/absent computation, manual overrides, empty/unknown safety, explicit all-class confirmations, duplicate/concurrent sessions, stale versions, historical membership, status/audit correction, no-op corrections, unaffected sessions, student privacy, percentages, zero/incomplete sessions, filters and authorized CSV.
- Database fault injection proves full rollback on record insertion failure and on audit persistence failure during a correction.
- Root frontend/backend typechecks and independent production builds passed. Docker's clean `npm ci`, Prisma generation and both builds passed.
- Desktop browser: faculty load/preview/save/reopen/manual correction/reason/audit/CSV; unknown suffix rejection; additive roster preview with duplicates, unmatched identities and retained omitted members; invalid ellipsis feedback; Admin term/class/subject/assignment setup and Student reconciliation; Student own percentages/history and keyboard date filtering.
- Mobile browser at **390 × 844**: absent-list preview/save, Student submitted history, linked Student zero-session state and Admin setup. No page-wide horizontal overflow; wide tables scroll inside their containers. This is responsive viewport testing, not physical-device certification.
- Refresh and sign-out/sign-in persistence were exercised through the Vite proxy with the existing synthetic accounts.
- Screenshots are saved in the Codex visualization output folder: `attendance-faculty-desktop.jpg`, `attendance-faculty-mobile.jpg`, `attendance-roster-desktop.jpg`, `attendance-student-desktop.jpg`, `attendance-student-mobile.jpg`, `attendance-student-zero-mobile.jpg`, `attendance-admin-desktop.jpg`, `attendance-admin-mobile.jpg`.

- Docker runtime migration reports no pending migrations. Compiled seeding ran twice without duplicate/destructive resets. App/PostgreSQL are healthy; `/api/health/ready` reports ready, the attendance SPA route returns 200, and the application runs as UID 1000.
- The built Docker UI preserves the submitted attendance and correction across startup. Student + Club Head login shows only that account's records (1/2, 50%), the configurable warning indicator and date/hour history. Refresh persistence passed. Screenshot: `attendance-docker-student.jpg`.
- Host development was stopped after browser checks; the local Compose app remains available at `http://localhost:3000`.

Phase 2 workflow checklist is complete in the ignored root `workflow.md`: assigned roster marking/correction and transaction/audit; Student-owned attendance/percentages/CSV; duplicates/atomicity/scope/privacy tests; desktop/mobile Student/Staff verification. The unchanged later phases remain pending.

## Known limitations

- Performance/scale targets and remote GitHub CI execution have not been measured or run. Reports currently return all matching records; use date/term filters for the local demo. Large-history pagination remains future work.
- Account linkage depends on an authorized Admin checking institutional records; no ERP integration or public register-number claim flow is introduced. Conflicting legacy identities require administrative reconciliation instead of an automatic destructive merge.
- Existing incomplete/unsubmitted historical data stays excluded until reconciled. No draft-session authoring workflow or public data-repair endpoint is provided.
- Names/prefix formats are validated but actual college register-number ownership requires institutional verification. Migrated records without register numbers deliberately block new faculty marking until reconciliation.
- Changing a class prefix does not rewrite historical identities. Use a new term/class for a new register format; historical corrections continue to show the original full register numbers.
- CSV preserves raw strings in the file; spreadsheet software should import register numbers as Text to avoid automatic numeric conversion.
- The configurable 75% default is only a UI reminder policy. Live SMTP delivery and Railway deployment remain unverified and outside this phase.
