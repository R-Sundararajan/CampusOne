# CampusOne — Software Development Life Cycle (SDLC)

**Project:** CampusOne — Unified College Management Web Application

**Document type:** SDLC report — reconciled requirements and implementation baseline

**Reference:** [CampusOne repository](https://github.com/R-Sundararajan/CampusOne)

## 1. Project overview

CampusOne is a modular-monolith, full-stack college web application that combines **attendance**, **club events** and **campus complaints** in a single authenticated portal. Students can view their own attendance, discover published events, register internally for eligible events and submit/track complaints. Authorized Staff can manage attendance for assigned classes and submit complaints. Approved Club Heads manage events for their assigned clubs. Admins manage institutional setup, approvals and complaint verification; designated Staff Supervisors coordinate and resolve accepted complaints.

### Problems addressed

- Event information and registrations are dispersed across email, messaging apps, forms and websites.
- Students lack a unified, self-service view of their own subject-wise attendance.
- Campus and hostel complaints may rely on manual or fragmented reporting and follow-up.
- Administrative oversight and auditability are difficult when records are scattered.

### Solution boundaries

CampusOne centralizes these workflows. It does not independently verify institutional identity, integrate with an official warden directory, or guarantee complaint response times. It is initially scoped to a single institution and academic demonstration.

## 2. SDLC methodology and phases

CampusOne is documented through six conventional SDLC phases:

1. **Requirements analysis:** Define scope, stakeholders, functional requirements, constraints and quality targets.
2. **System design:** Establish the modular-monolith architecture, data relationships, module boundaries and access-control design.
3. **Development and integration:** Implement the shared account services and the attendance, events and complaints modules.
4. **Testing and verification:** Validate functional behavior, integration, business rules and release checks.
5. **Deployment:** Build, configure and release the application through the documented CI/CD and hosting setup.
6. **Maintenance:** Monitor operational health, manage updates, review access assignments and plan backup/recovery procedures.

Security and privacy are addressed as requirements and engineering practices within these phases. Their presence does not mean a separate formal secure development methodology was followed.

## 3. Requirements analysis

### 3.1 Scope

**In scope**

- Attendance: academic catalog, teaching assignments, class rosters, session marking, corrections, student views and scoped CSV reports.
- Events: club-owned drafts, publication, cancellation, event posters, internal registration, optional external registration URL, participation statistics and club access management.
- Complaints: submission, optional image, Admin verification, five-group Supervisor assignment, private coordination, resolution/rejection, tracking and one-time feedback.
- Institutional account registration, authentication, multi-role authorization, privileged-role approval and Admin bootstrap.
- Relevant attendance reports, event statistics, complaint statistics, transaction audits and secure image handling.

**Out of scope**

- Online fee payment, examinations, hostel room allocation, food ordering and library circulation.
- Direct ERP or official student-record integration; automatic proof of student identity from register number or admission year.
- Automated Block Warden provisioning/communication, service-level enforcement and escalation scheduling.
- Multi-institution tenancy, a separate microservice per module or unrestricted external public access.

### 3.2 Stakeholders and actors

- College management and system administrators
- Students
- Teaching Staff / Faculty
- Club Heads
- **Designated Complaint Supervisors** (approved Staff assigned to one or more groups)
- Block Wardens as **external coordination contacts**, not CampusOne account holders
- Development, deployment and maintenance team

**Actual application roles:** `STUDENT`, `STAFF`, `CLUB_HEAD`, `ADMIN`. Users may hold multiple approved roles. **Supervisor is not a fifth database role**; it is a restricted assignment granted to eligible Staff for complaint processing. A Club Head role alone does not grant Staff, complaint-submission or Admin permissions.

### 3.3 Assumptions and trust boundaries

1. Users access the portal through a supported browser with internet connectivity.

2. Public self-registration accepts an exact normalized `@ssn.edu.in` email for Student, Staff or Club Head requests; **existing pre-registration is not assumed**.

3. In the approved `domain-only-demo` configuration, institutional email **ownership is not verified**. New Students may sign in immediately; Staff and Club Head access requires Admin review and approval. The alternative email-verification mode exists, but live production email delivery is not established by these specifications.

4. The first Admin is created only through a trusted, operator-controlled bootstrap; public registration cannot create an Admin.

5. Admins explicitly approve class/subject teaching assignments and Club Head club assignments. No assignment is inferred merely from the selected account type.

6. Student academic identity and class-roster account linkage require authorized administrative checks; self-claimed email/register number is not trusted proof.

7. Privileged approvals, Supervisor designations and student linkage require **out-of-band identity checks** in demo mode.

### 3.4 Constraints and quality attributes

- Single-college implementation; one Dockerized Node/Express modular monolith serves the React/Vite interface and same-origin REST API.
- PostgreSQL with Prisma stores structured records and sanitized event/complaint image bytes.
- Authentication uses signed JWT in an HttpOnly cookie, live role checks, same-origin protection and login/request rate limits; authorization is enforced server-side.
- Student attendance and other users' private records must not be writable/readable through unauthorized role or identity substitutions.
- Event posters and complaint images must be valid JPEG/PNG, at most **2 MiB per input and stored image**, with a **shared 50 MiB image quota** across both modules. Complaint images have case-specific access controls.
- Destructive or state-changing actions must be checked for permissions, versions, business-state validity and audit consistency; multi-step writes should be atomic.
- Design remains usable on desktop and narrow mobile viewports; frontend appearance is not a substitute for backend authorization.

### 3.5 Capacity and workload (targets, not measured guarantees)

| Metric | Reconciled specification | Status |
|---|---|---|
| Estimated Student accounts | ~2,000 | Planning estimate |
| Estimated Staff/Faculty | ~100 | Planning estimate |
| Estimated Club Heads | ~20 | Planning estimate; may overlap Student accounts |
| Estimated Admins | ~5 | Planning estimate; roles may overlap |
| Total registered users | Up to **2,500** | Design target |
| Typical concurrently active users | **50–100** | Design target |
| Peak concurrently active users | **300** | Design target |
| Typical read requests | Aim for **≤500 ms** under normal conditions | Unverified performance target |
| Typical mutation requests | Aim for **≤2 s** under normal conditions, excluding image upload | Unverified performance target |

Demand examples are illustrative rather than load-test results: 300 attendance views in 10 minutes imply approximately **30 requests/minute** for that one operation; 500 event views in 30 minutes imply approximately **17 requests/minute**. These examples **do not establish** whole-system throughput, 300 concurrent-user capacity, a fixed 60-requests/minute ceiling or cloud latency. Mixed/overlapping peak traffic requires representative load testing.

### 3.6 Module 1 — Attendance management

**Authorized Staff and Admin setup**

- Admins maintain academic terms, classes/sections, subjects, official rosters and verified teaching assignments.
- Assigned Staff view classes/subjects within their teaching scope; Admins can review roster/catalog/report administration.
- Only a currently assigned, approved Staff user may submit or correct attendance for that class/subject offering. Admin status alone does **not** bypass teaching-assignment requirements for attendance edits.
- Staff preview attendance against the official class roster, select present/absent values and explicitly confirm marking for a specified offering, date and period.
- Previously submitted sessions can be corrected only by authorized assigned Staff with a **reason**, and changed statuses are audited.
- Staff/Admin can view authorized reports and export scoped CSV reports by term, class, section, subject or date range.

**Students**

- See only the attendance records linked to their authenticated student identity, including subject-wise percentage and history.
- Cannot create, alter, correct or retrieve another student's attendance.
- Have a configurable attendance warning indicator (default 75%); this is a reminder threshold, not an institutional eligibility policy.

**Integrity/security rules**

1. The unique attendance session is defined by **subject offering + date + period**; the offering already identifies the relevant class/section and academic context.

2. Each Student identity receives at most one attendance record per saved session.

3. Roster membership used for submitted attendance must remain historically consistent even if the active roster changes later.

4. Session submission and records save atomically; stale/concurrent edits must be rejected rather than creating duplicates or partial results.

5. Corrections retain actor, timestamp, reason, old status and new status in the audit trail.

6. Student identity is taken from the authenticated session, never a user-supplied Student ID query override.

### 3.7 Module 2 — College event management

**Admin**

- Manage/revoke approved Club Head access to clubs and supervise events across clubs.
- Review event registration counts and per-club statistics; registration count is **not physical attendance**.
- Exercise Admin-only operations where appropriate, such as restricted unpublication.

**Approved Club Heads**

- Create and maintain **only events belonging to currently assigned clubs**.
- Draft an event, upload a poster and publish it after required details, a valid future start time and registration deadline are present.
- Provide event title, description, venue, schedule, optional end time and optional HTTP(S) external link. **Internal CampusOne registration remains the tracked registration mechanism**; an external URL does not replace it.
- Edit or cancel eligible events subject to ownership, lifecycle and version rules; cannot modify another club's events.

**Students**

- Browse **published** events across clubs and view details, grouped into upcoming/ongoing/past based on actual times.
- Register through the internal app only while an event is published and its registration deadline/start have not passed.
- See their own registrations but not other students' private registration records; cannot edit events or register the same event twice.

**Integrity/security rules**

1. Every event has one immutable owning club.

2. Events use `DRAFT`, `PUBLISHED` and `CANCELLED`; upcoming/ongoing/past are time-derived display groups, not additional database statuses.

3. Only approved, currently assigned organizers or Admins may see/manage authorized drafts; ordinary discovery excludes drafts.

4. One Student may have **one registration per event**, enforced in the database. Duplicate/repeated requests do not create duplicates.

5. Registration closes at the registration deadline and at the event start, whichever occurs first; cancelling an event preserves existing registration history.

6. Updates, poster changes and lifecycle transitions are version-checked and audited.

7. Event lists and organizer registrations use bounded, scoped pagination.

### 3.8 Module 3 — Complaint management

**Submitters (Students or approved Staff)**

- Submit a title, issue description, optional location/category and one optional image; Staff submissions use manual routing.
- Track only their own complaints, view public rejection reasons or public resolution details and provide **feedback once** after a resolved or rejected outcome.
- Add/replace an image only **before Admin verification**; failed uploads can be retried against the existing complaint.

**Admin — verification and assignment, not ordinary resolution**

- View all complaints, verify submissions and either **accept** with a confirmed routing group or **reject** with a mandatory public reason.
- Configure eligible Staff Supervisors for five assignment groups: **UG I, UG II, UG III, UG IV and PG**.
- On acceptance, assign the configured eligible Supervisor for the confirmed group, or show an accepted-but-unassigned case if no eligible Supervisor is configured.
- Monitor queues and statistics, review feedback/private notes and perform exceptional, reasoned reassignment where authorized.
- Do **not** ordinarily mark accepted complaints resolved; that action belongs to the currently assigned eligible Supervisor.

**Designated Staff Supervisors — processing and resolution**

- View/process only accepted complaints currently assigned to them under an active eligible group designation.
- Coordinate with the corresponding Block Warden **outside** CampusOne, storing private coordination notes and optionally the actual contact/handoff information.
- Resolve an accepted case by entering mandatory **public resolution details**; their designation does not grant Admin, event or attendance authority.
- Lose access to active cases and private images when their designation is revoked/reassigned, except when they retain an independently authorized role.

**State transition and routing rules**

```text
SUBMITTED --Admin accepts + confirms group--> ACCEPTED --Supervisor resolves--> RESOLVED
    |
    +--Admin rejects with reason------------------------------------------> REJECTED
```

- `SUBMITTED`, `ACCEPTED`, `RESOLVED` and `REJECTED` are the **four persisted primary statuses**; detailed processing stages (awaiting verification/assignment, assigned, coordination) are derived rather than extra primary statuses.
- `RESOLVED` and `REJECTED` are terminal. No second Admin approval of a Supervisor's resolution is required.
- Each case has a submitter and nonempty description; rejection requires a reason and resolution requires details.
- Admin confirms the UG-year/PG assignment manually. A Student's current year is **not automatically trusted** from class names, register number or admission batch. Staff routing is manual.
- Five group slots are persisted as configuration, **not five precreated Supervisor user accounts**. One Staff user may hold more than one group assignment.
- A changed designation transfers still-open accepted cases transactionally, with auditing; closed history is retained.
- Submitters cannot view other users' complaints or Supervisor-only internal notes. Case images are available only to the submitter, Admin and currently authorized assigned Supervisor. Feedback is visible to owner/Admin, not automatically Supervisors.
- All status, assignment, progress, image and feedback changes are version/permission-checked and audited; feedback is single-use after closure.

**Operating-time distinction:** The early document's “Admin accepts/rejects within 2 hours” and “complaints resolved in 2 days” are **not implemented SLAs or measured service guarantees**. Any such timelines would require institutional agreement, responsible staff coverage, severity definitions, monitoring and escalation rules before being recorded as enforceable requirements.

### 3.9 Data requirements

| Data group | Important attributes / relationships |
|---|---|
| User/account | User ID, name, exact institutional email, optional phone, department, approved role array, active/verification/demo state and approval history |
| Academic structures | Academic term, class/section, subject offering, teaching assignment, independent Student identity, official roster membership and controlled account linkage |
| Attendance session | Offering, date, period, roster snapshot, submitter/Staff, submitted timestamp, version and unique session identifier |
| Attendance record | Student identity, session, PRESENT/ABSENT value and change/audit history |
| Club/event | Club, event ID/title/description/venue, start/end/deadline, draft/published/cancelled state, optional external registration link, poster, creator, version |
| Event registration | Unique event–Student pair, internal registration ID and time; counts based on persisted registrations |
| Complaint | ID, title, description, category/location, submitter, created time, four-state status, confirmed routing group, Admin verifier, assigned Supervisor/group, timestamps, public reason/details, feedback and version |
| Complaint coordination | Five UG/PG assignment slots, current eligible assignee, private internal notes, optional Warden handoff data and audit history |
| Image storage | Sanitized bytes, MIME, related event/complaint record, size, shared quota and permission-checked retrieval |
| Audit logs | Relevant actor, action, affected record, time, reason and permitted changes; never passwords or raw image bytes |

### 3.10 Reports

- **Attendance:** Student-wise, subject-wise and class/section summaries; authorized term/date filters and CSV for Staff/Admin.
- **Events:** Published event discovery plus organizer/Admin counts and per-club registration statistics.
- **Complaints:** Admin review/processing-state counts and filtered lists; owner and Supervisor see only their permitted scopes.

These are different report capabilities, not a promise of a separate enterprise analytics/reporting module.

## 4. System design — architecture baseline

- **Frontend:** React + Vite, with role/capability-aware pages and responsive layouts.
- **Backend:** Single Express API (modular monolith) with auth/registration, attendance, events, complaints and shared services.
- **Database:** PostgreSQL + Prisma migrations; relational unique constraints, transactions, audits and shared image storage.
- **Security:** Argon2id password hashes, HS256 JWTs in HttpOnly cookies, current-role authorization, same-origin write checks, validation, bounded uploads and scoped responses.
- **Deployment architecture currently approved in the repository:** One Render Docker Web Service with same-origin frontend/API, managed **Neon PostgreSQL**, GitHub Actions for CI and Render's **After CI Checks Pass** deployment gate. Historical Railway references are not the current architecture decision.
- **Deployment status caveat:** Repository configuration/approval does not prove the live Neon migration, owner-controlled branch protection, backups or every cloud check has been executed. Verify production status separately rather than assuming it from a design diagram.

## 5. Development and integration — implementation boundaries

Development covers the three modules and shared account services within the existing monolith. Business rules are enforced in the API/database, not merely in UI controls. The implementation baseline includes transactional writes, idempotent/unique registration and attendance, versioned corrections/assignments, private-image authorization and audit evidence. Supervisors coordinate with Wardens externally; no new queue, Redis, warden portal or background SLA scheduler is implied.

## 6. Testing and quality assurance — verification and acceptance

**Existing historical verification evidence:** The repository documents **176 passing application tests and 4 passing release-guard tests** in an isolated PostgreSQL/local Docker setting during Phase 5. It also documents desktop/mobile workflow checks and limited sequential localhost timings. This supports tested functionality, **not** 300 concurrent-user capacity, cloud availability or latency SLAs.

**Required additional acceptance checks before claiming target capacity or operational readiness:**

- Load testing at 50–100 normal and 300 peak concurrent users with representative attendance, event and complaint mixes.
- Server-side authorization tests for role overlap, revoked assignments, identity spoofing and private images.
- Transaction/concurrency tests for duplicate sessions, duplicate event registrations, complaint reassignment and failed writes.
- Actual release verification of protected branch/CI gate, HTTPS cookies, origin rules, production migrations, database connectivity and cloud-specific recovery.
- Backup/restore rehearsals for the selected live PostgreSQL service, especially before schema changes.

## 7. Deployment and release

The documented deployment design uses one Dockerized Render service connected to Neon through pooled runtime and direct migration URLs; the application serves its UI and API from one HTTPS origin. CI runs tests and build checks. The approved release workflow requires Render deployment to depend on checks for the merged `main` commit, with migrations running before HTTP startup. The first Admin is bootstrapped through a trusted operator procedure; **production startup does not seed demonstration accounts**. The live URL, database, access controls and successful cloud checks require separate owner verification; repository configuration alone is not proof of successful production execution.

## 8. Maintenance and support

- Review role/club/teaching/Supervisor assignments and the associated audit trail.
- Monitor Render health/cold starts and Neon storage/connection usage; free-plan limits are availability constraints.
- Back up before schema changes, practice restore into a separate database and use compatible releases for recovery; application rollback **does not undo database migrations**.
- Review dependency updates, auth modes, retention/privacy policies and rate-limit limitations before expanding beyond a controlled demo.
- Reassess unmeasured load/latency objectives and any proposed institutional complaint SLAs with real evidence.

## 10. Project references

- [README — current milestone and application behavior](https://github.com/R-Sundararajan/CampusOne/blob/main/README.md)
- [Architecture decisions](https://github.com/R-Sundararajan/CampusOne/blob/main/docs/architecture.md)
- [Phase 2 — attendance](https://github.com/R-Sundararajan/CampusOne/blob/main/docs/phase2-attendance.md)
- [Phase 3 — events](https://github.com/R-Sundararajan/CampusOne/blob/main/docs/phase3-events.md)
- [Phase 4 — complaint and Supervisor workflow](https://github.com/R-Sundararajan/CampusOne/blob/main/docs/phase4-complaints.md)
- [Phase 5 — integration and local verification](https://github.com/R-Sundararajan/CampusOne/blob/main/docs/phase5-integration-deployment.md)
- [Current Render + Neon deployment guide](https://github.com/R-Sundararajan/CampusOne/blob/main/docs/render-neon-deployment.md)
