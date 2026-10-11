# Phase 4 — Complaint Management and Supervisor Workflow

> Historical implementation/verification record. Current deployment: [Render + Neon operator guide](render-neon-deployment.md). Previous platform references describe this phase only.

Implemented and verified locally on 2026-10-10. Branch: `feature/complaints-module`, based on the fetched and unchanged Events head `758c8ca`. No push, main merge, documentation merge or Railway deployment occurred.

## Documentation review before implementation

Fetched `origin/docs` at `3949dbc8c61d79c0c375a5c72c50cb2c01cc5803`, inspected its tree, the architecture/context PNGs and the six requested Draw.io source diagrams. Kept it separate from implementation; exported read-only reference images into ignored local backup storage.

Reusable concepts: a single backend with shared authentication/database/storage and logical Attendance, Events and Complaints modules; shared portal navigation/layout; complaint submission, image upload, tracking, verification, rejection reason, resolution and feedback responsibilities. No separate complaint application or additional service is needed.

Corrections: the preliminary Student diagram contains Admin complaint-review/response and club-access management responsibilities; these are not Student permissions. The SRS's earlier Admin resolution ownership is explicitly superseded by the approved assigned-Supervisor workflow. The old diagrams do not define the five group assignments, reliable year identification, concurrency or image privacy. Existing RBAC/service conventions and approved Phase 4 rules govern those details. Original diagrams were not rewritten.

## Workflow and capabilities

`SUBMITTED → ACCEPTED → RESOLVED` or `SUBMITTED → REJECTED`. Resolved and rejected are terminal. Only Admin verifies submissions. Rejection needs a nonempty public reason; resolution needs nonempty public details. There is no additional Admin approval after Supervisor resolution.

Student/approved Staff submits as the authenticated user, sees only their own complaints and can attach/replace one image before verification. Club Head alone cannot submit or administer complaints. Admin sees all cases, monitors five persisted overview counts, verifies routing, accepts/rejects, configures Supervisors, performs reasoned exceptional reassignment and reads feedback/internal notes. Only the currently assigned and currently designated eligible Supervisor processes an accepted case. A Supervisor designation grants no Admin, club or attendance rights.

Processing stages are derived from assignment eligibility and coordination metadata: Awaiting Admin Verification, Awaiting Supervisor Assignment, Assigned to Supervisor, Under Coordination, Resolved, Rejected. The primary enum retains the four SRS statuses.

Supervisors coordinate with the appropriate Block Warden outside CampusOne and record concise private notes and supplied contact/handoff information. No Warden login, account provisioning, invented block directory or automatic Warden assignment is introduced. Submitters see public rejection/resolution details and an audit timeline that excludes private progress and internal changes. Admin and the currently authorized Supervisor see the internal history. Feedback is visible to the owner and Admin, not automatically to the Supervisor.

## Five Supervisor slots and routing

`ComplaintSupervisorAssignment.studentGroup` is the enum primary key: `UG_I`, `UG_II`, `UG_III`, `UG_IV`, `PG`. Migration creates exactly five empty slots, not accounts. Nullable `userId` represents an unconfigured/revoked slot; version, assigning Admin and timestamps support trusted configuration. A group can have at most one current designation; one account may hold multiple group responsibilities.

Only active, email-verified, approved institutional Staff accounts are eligible in production. A local-development-only service option admits explicitly marked synthetic demo accounts for verification; production rejects them. Public registration does not grant Supervisor capability. Every operation reads current database roles and group designations.

Replacement/revocation requires a reason and the slot's current version. In the same transaction it changes the slot, transfers every accepted case using that processing group (or clears its assignee on revocation), increments case versions, and persists per-case and configuration audits. Closed cases retain their original assignee/history; former Supervisors lose case/image access when no longer designated for the case's processing group. Replacement does not grant the new Supervisor historical closed cases belonging to their predecessor. Owners and Admin retain their independent access.

Acceptance confirms/corrects `studentGroup`, records verifier/time and assigns its eligible configured Supervisor together. If configuration is missing/ineligible, acceptance succeeds with a clearly unassigned stage; completing configuration subsequently assigns relevant unresolved cases. Exceptional reassignment selects another active group designation with a reason. `supervisorGroup` records actual processing ownership separately from the confirmed student/manual routing group, preserving the original classification during exceptional transfers.

Phase 2 investigation: AcademicTerm has a name but no current-term marker; ClassGroup has free-form name/academicYear/admissionBatch but no explicit current study-year/program field; ClassEnrollment records active membership but may span classes/terms. These do not reliably establish the current UG year/PG program. No register-prefix/admission-year inference is performed. Student selection is optional and explicitly provisional until Admin confirms routing. Staff, including accounts holding both Staff and Student roles, uses manual routing without a student-year selection. Admin must select and explicitly confirm a responsible group before acceptance/assignment.

## Schema and integrity

Additive migration: `backend/prisma/migrations/202610100001_complaints/migration.sql`.

- Extends existing Complaint with version, routing/category/location, verifier/time, rejection reason, assignee/group/time, coordination time and feedback time. Reuses existing description, adminResponse, resolutionDetails, resolvedAt and single feedback field.
- Adds ComplaintStudentGroup, five Supervisor slots and ComplaintNote related to Complaint/User. User has named submitter/verifier/Supervisor and designation relationships. No Role enum change.
- Adds group uniqueness, positive versions, assignee/group/time consistency checks, foreign keys and queue indexes. Feedback's existing single column naturally permits one value; locked versioned writes prevent duplicates.
- Preserves legacy complaints/outcomes/images. Copies existing rejected adminResponse into rejectionReason and marks legacy routing as LEGACY without fabricating a verifier/group/history. Legacy accepted cases without a processing group need explicit Admin reassignment.

Case/configuration mutations take one short module advisory transaction lock (`731004`), then current authorization and case row locks/version checks. Shared reads use the corresponding shared module lock so configuration replacement cannot interleave with authorization/image reads. Concurrent verification/terminal decisions and configuration updates cannot overwrite each other. Audits commit in the same transaction; injected failures verify rollback. This deliberately simple module lock serializes complaint mutations for the single-instance demo; high-throughput scalability is not established.

Reuse AuditLog for submission, acceptance, rejection, assignment/reassignment, progress, resolution, feedback and attachment changes. Progress audits reference the separately stored internal note ID. No credentials or image bytes appear in audits; submitter projections remove actor identities/internal changes. No redundant feedback table, storage service, queue, Redis or scheduler was added.

## APIs

All paths are under `/api/complaints`, authenticated; writes require the configured Origin. JSON schemas reject unknown privilege/identity fields and bound all text. IDs/roles from request bodies cannot override session/database authorization.

| Method/path | Purpose and scope |
|---|---|
| GET `/catalog` | Current complaint capabilities, groups/categories; Admin-only candidates/configuration |
| POST `/` | Student/Staff submission, title ≤160, description ≤6000, location ≤200 |
| GET `/` | `scope=mine` (default), `admin`, `supervisor`; pagination ≤30 and status/group/Supervisor/date/category/location filters |
| GET `/statistics` | Admin counts: submitted, accepted unassigned, assigned pending, resolved, rejected |
| GET `/:id` | Owner/Admin/currently designated assigned Supervisor; scoped detail/history |
| POST `/:id/accept` | Admin; version, studentGroup, confirmRouting=true |
| POST `/:id/reject` | Admin; version and public reason ≤2000 |
| POST `/supervisors/:group` | Admin; slot version, eligible userId or null, reason ≤2000; transfers unresolved cases |
| POST `/:id/reassign` | Admin; case version, active supervisorGroup, reason ≤2000 |
| POST `/:id/notes` | Assigned current Supervisor; version, private text ≤4000, optional supplied wardenContact ≤240 |
| POST `/:id/resolve` | Assigned current Supervisor; version and public resolutionDetails ≤4000 |
| POST `/:id/feedback` | Original owner after closure; version and feedback ≤2000, saved once |
| POST `/:id/image?version=N` | Owner before verification; raw JPEG/PNG with optional X-Image-Filename |
| GET `/:id/image` | Owner/Admin/currently designated assigned Supervisor; private no-store bytes |

Stale updates return 409; invalid input 400; unsupported/oversize uploads 400/413; unauthorized access 401/403; absent case/image 404. Server errors remain generic. Images and JSON lists remain separate.

## Images and privacy

Reuses `backend/src/services/image-storage.ts`, Image, ImageBudget and the existing owner transaction. Sharp decodes/re-encodes JPEG/PNG, strips metadata/trailing payloads, limits request/stored image to 2 MiB and decoding to 24 million pixels, rejects corrupt/animated/mismatched content. One optional complaint image shares the existing locked 50 MiB aggregate quota with Event posters; replacement charges only the net size difference. Image/quota/version/audit roll back together on failure.

Image reads use case authorization, not possession of an image ID/URL; no generic private-image endpoint was introduced. Reassignment/revocation denies former Supervisor access even with a remembered URL. Responses send correct MIME, nosniff, inline and private/no-store headers. Lists/details never contain image bytes, storage object keys or password hashes. Attachment upload is a separate optional request after complaint creation; failure leaves a saved complaint and an explicit retry/open-existing path, never silently duplicates it. Attachments become immutable after verification.

## Portal UI

Uses existing PortalLayout, API client/authentication, Link, ConfirmDialog, ivory/sage/forest styles and loading/error patterns. New views: My Complaints, Submit Complaint, Complaint Details, Admin Review Queue, Supervisor Assignments and Supervisor Work Queue. Capability-aware module tabs load current server authorization, independent of auth role labels. Ordinary Student screens have no administrative controls.

Counts use persisted data; queues filter/paginate and show status, processing stage, routing confirmation, location, outcomes and feedback state. Details include reference, readable descriptions, contained authorized image previews and scoped timelines. Public outcome inputs and internal note/contact inputs are distinctly labeled. Rejection, resolution, reassignment and designation changes use confirmations. Mobile cards/forms stack; wrapped title links have a complete rectangular tap target. No deadlines, guarantees, invented statistics, institutional block names or extra UI dependencies were added.

## Verification evidence

Final PostgreSQL run: **161 passed, 0 failed, 0 skipped**, seven files, isolated `campusone_phase4_test`; all 111 earlier tests retained plus 50 new complaint tests. Fresh migration chain applied to the isolated database; subsequent deployment reports no pending migrations. Development database backed up to ignored `.local-backups/phase4-before.dump` before additive migration. No destructive resets used.

Coverage includes Student/Staff and identity-spoof prevention, strict limits, live roles, five UG I–IV/PG routes, unknown/provisional/manual routing, missing/ineligible configuration, Admin-only verification/designation, concurrent accept/reject/resolve/configuration/feedback/image writes, rollback of acceptance/configuration/image transactions, terminal boundaries, scoped Supervisor queues, internal-note privacy, cross-user/Club Head denial, exceptional reassignment, former Supervisor case/image revocation, production demo/noninstitutional exclusion, public feedback after both outcomes, JPEG/PNG/content/extensions/2 MiB validation, image net replacement, and concurrent Complaint/Event contention for the same 50 MiB budget. Existing auth, registration, approvals, attendance, Events and image tests pass.

Prisma generation, root typechecks, root frontend/backend production builds, Docker image build, container runtime migrations, twice-repeated compiled seed, non-root UID 1000, healthy app/database, readiness 200, complaint SPA route 200 and unknown API 404 passed. Root `npm run dev` started both workspaces; authenticated read and terminal feedback POST through the Vite proxy passed. Docker was restored after that check. The initial sandboxed Vitest attempt could not read its transformed temporary files; running the authorized isolated checks with local runtime access resolved the environment problem. No skipped checks are counted as passing. Existing pg driver deprecation warnings do not fail the suite; driver migration remains future maintenance.

Browser tests used four explicitly labeled synthetic local QA accounts, all isDemo=true, with six explicitly titled synthetic complaints and a synthetic PNG. Supervisor slots were configured through Admin UI, not seeded. Original demo/account/module data and credentials were preserved. QA fixtures/credentials and reference exports remain ignored; none are added by startup or production seed.

| Manual check | Desktop 1280 × 900 | Mobile 390 × 844 |
|---|---|---|
| Student submission/reference and image attachment/preview | Passed | Passed |
| Admin review and accept/confirmed group assignment | Passed (UG I) | Passed (unknown year confirmed UG II) |
| Rejection with reason/public visibility | Passed | Passed |
| Five-slot configuration and Supervisor work queue | Passed | Passed |
| Private coordination/supplied Warden handoff | Passed | Passed |
| Resolution confirmation/public outcome/feedback | Passed | Passed (replacement Supervisor) |
| Staff submission/manual Admin routing | Passed | Passed; Staff year selection absent |
| Cross-account case denial | Passed | Passed |
| Replacement retains history and revokes former case access | Passed (denial) | Passed (configuration/transfer/denial) |
| Narrow layout/forms/cards, no page-wide overflow | Passed | Passed (scrollWidth ≤ viewport width) |

Authorized attachment rendering was checked for owner, Admin and assigned/replacement Supervisor. Direct browser navigation to a remembered private-image API URL was blocked by the browser tool (`ERR_BLOCKED_BY_CLIENT`), so that attempt is not claimed as a manual backend 403 check; isolated API tests verify actual denial and reassignment revocation.

Saved screenshots in the Codex visualization output directory:

- `phase4-desktop-queue.jpg` — persisted Admin overview/filter controls.
- `phase4-desktop-outcome.jpg` — Student public resolution/feedback, image and scoped history.
- `phase4-mobile-submit.jpg`, `phase4-mobile-admin.jpg` — mobile form/image and assigned review.
- `phase4-mobile-revoked.jpg` — former Supervisor denial.
- `phase4-mobile-outcome.jpg`, `phase4-mobile-evidence.jpg` — mobile public outcome/feedback/history and contained image.

## Checklist and remaining limits

- [x] Student/Staff submission and private shared-storage attachments.
- [x] Admin verification with mandatory rejection reasons and atomic accepted assignment.
- [x] Five trusted group slots, provisional year confirmation and Staff/manual routing.
- [x] Current assignment-scoped Supervisor processing, private coordination and public resolution.
- [x] Audited replacement/reassignment/revocation and concurrent update protection.
- [x] Owner tracking and single terminal feedback; no internal-note leaks.
- [x] Full PostgreSQL regressions, migrations, builds, Docker and local development checks.
- [x] Desktop/mobile browser flows and saved evidence.

Known limits: reliable automated current-year derivation awaits authoritative academic fields; manual confirmation is intentional. Warden communication stays external; no notifications, escalation or service-time guarantees. Optional attachments use a second request with retry until verification. Feedback is immutable. Mutation throughput/300-user capacity/latency targets, physical devices, live SMTP, remote CI and hosted behavior were not measured. Global complaint locking is suitable for this verified demo, not a proven scale claim. Production account/bootstrap/SMTP/storage/credits and integration/backup-recovery checks remain Phase 5 work. Local synthetic fixtures and five QA designations are not institutional production configuration.

Phase 4 is ready for the Phase 5 integration/readiness milestone. Deployment still requires explicit authorization and environment verification.

## Focused implementation commits

- `067c71e` — schema, five Supervisor slots, validation and permission helpers.
- `d380f06` — complaint backend/lifecycle, audits, private images and app wiring.
- `463a840` — submitter/Admin/Supervisor portal views.
- Final verification/documentation commit — tests, production eligibility, browser-discovered form spacing/tap-target fixes, README and this report; see branch log for its hash.
