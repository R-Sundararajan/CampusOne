import { Link } from "../components/Link";
import { EventPoster } from "../components/EventPoster";
import { roleLabel, type User } from "../services/api";
const modules = [
  {
    href: "/attendance",
    title: "Attendance",
    description: "Your subjects, class records and attendance reports.",
    phase: "Available",
  },
  {
    href: "/events",
    title: "Club events",
    description: "Campus events, club activities and registrations.",
    phase: "Available",
  },
  {
    href: "/complaints",
    title: "Campus support",
    description: "Submit a concern and follow its resolution.",
    phase: "Phase 4",
  },
];
export function Dashboard({ user, route }: { user: User; route: string }) {
  const selected = modules.find((m) => m.href === route);
  if (selected)
    return (
      <>
        <div className="page-heading">
          <p className="eyebrow">CAMPUS SERVICES</p>
          <h1>{selected.title}</h1>
          <p>{selected.description}</p>
        </div>
        <section className="panel module-placeholder">
          {route === "/events" && (
            <EventPoster title="Event poster placeholder" />
          )}
          <div>
            <span className="status-tag">Coming in {selected.phase}</span>
            <h2>
              {route === "/events"
                ? "Club events will appear here"
                : selected.title + " is being prepared"}
            </h2>
            <p>
              {route === "/attendance"
                ? "Class records will become available when attendance management is introduced. No attendance records are shown yet."
                : route === "/events"
                  ? "Published events will include their poster, club, date, venue and registration details. There are no event listings in this release."
                  : "Complaint submission and status tracking will be available in a later release. This page does not submit a complaint."}
            </p>
            <Link href="/">Return to home</Link>
          </div>
        </section>
      </>
    );
  const visible = modules.filter(
    (m) =>
      m.href !== "/attendance" ||
      user.roles.some((r) => ["STUDENT", "STAFF", "ADMIN"].includes(r)),
  );
  return (
    <>
      <div className="page-heading welcome">
        <div>
          <p className="eyebrow">YOUR CAMPUS PORTAL</p>
          <h1>Welcome, {user.name.split(" ")[0]}.</h1>
          <p>Find your campus services and manage your account here.</p>
        </div>
        <span className="status-tag active">Account active</span>
      </div>
      <div className="home-grid">
        <section className="panel">
          <div className="panel-title">
            <h2>Campus services</h2>
            <span className="muted">Attendance & events are available</span>
          </div>
          <div className="service-list">
            {visible.map((m, i) => (
              <Link key={m.href} href={m.href} className="service-row">
                <span className="row-number">0{i + 1}</span>
                <span>
                  <strong>{m.title}</strong>
                  <small>{m.description}</small>
                </span>
                <span className="row-end">
                  {m.phase}
                  <span aria-hidden="true">→</span>
                </span>
              </Link>
            ))}
          </div>
          <p className="panel-footnote">
            Open Attendance for class records and Events for club activities.
            Campus support is an upcoming service.
          </p>
        </section>
        <aside className="panel profile-summary">
          <p className="eyebrow">YOUR ACCOUNT</p>
          <h2>{user.name}</h2>
          <p className="email-text">{user.email}</p>
          <div className="role-tags">
            {user.roles.map((role) => (
              <span key={role}>{roleLabel[role]}</span>
            ))}
          </div>
          <dl>
            <dt>Department</dt>
            <dd>{user.department || "Not assigned"}</dd>
          </dl>
          <Link href="/profile">View profile & access →</Link>
        </aside>
      </div>
      {user.roles.includes("ADMIN") && (
        <section className="admin-callout">
          <div>
            <h2>Account approvals</h2>
            <p>
              Review verified Staff and Club Head requests and assign their
              access.
            </p>
          </div>
          <Link href="/approvals" className="secondary-button">
            Review requests →
          </Link>
        </section>
      )}
    </>
  );
}
