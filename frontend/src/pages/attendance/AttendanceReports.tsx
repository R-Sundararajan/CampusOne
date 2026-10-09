import { useEffect, useState, type FormEvent } from "react";
import { api, type User } from "../../services/api";
import type { Selection } from "./FacultyAttendance";
import {
  classLabel,
  subjectLabel,
  message,
  type Catalog,
  type Report,
} from "./types";
type Audit = {
  id: string;
  createdAt: string;
  actor: { name: string };
  changes: {
    studentId: string;
    previousStatus: string;
    newStatus: string;
    reason: string;
  };
};
export function AttendanceReports({
  catalog,
  user,
  onOpen,
}: {
  catalog: Catalog;
  user: User;
  onOpen: (s: Selection) => void;
}) {
  const [termId, setTermId] = useState(""),
    [classId, setClassId] = useState(""),
    [section, setSection] = useState(""),
    [offeringId, setOfferingId] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [search, setSearch] = useState("");
  const [report, setReport] = useState<Report>(),
    [query, setQuery] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [audits, setAudits] = useState<Audit[] | undefined>();
  async function load(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError("");
    setAudits(undefined);
    const params = new URLSearchParams(
      Object.fromEntries(
        Object.entries({
          termId,
          classGroupId: classId,
          section,
          offeringId,
          from,
          to,
        }).filter(([, value]) => value),
      ),
    );
    try {
      const q = params.toString();
      const result = await api<Report>(
        "/attendance/reports" + (q ? "?" + q : ""),
      );
      setReport(result);
      setQuery(q);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function audit(sessionId: string) {
    setError("");
    try {
      setAudits(
        (
          await api<{ audits: Audit[] }>(
            "/attendance/sessions/" + encodeURIComponent(sessionId) + "/audits",
          )
        ).audits,
      );
    } catch (e) {
      setError(message(e));
    }
  }
  return (
    <section className="panel attendance-panel">
      <h2>Sessions & reports</h2>
      <p className="muted">
        Only submitted sessions are counted. Reports follow your current class
        and subject permissions.
      </p>
      <form onSubmit={load}>
        <fieldset disabled={busy}>
          <legend>Report filters</legend>
          <div className="compact-grid">
            <label>
              Academic term
              <select
                value={termId}
                onChange={(e) => {
                  setTermId(e.target.value);
                  setClassId("");
                  setOfferingId("");
                }}
              >
                <option value="">All terms</option>
                {catalog.terms.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Class
              <select
                value={classId}
                onChange={(e) => {
                  setClassId(e.target.value);
                  setOfferingId("");
                }}
              >
                <option value="">All classes</option>
                {catalog.classes
                  .filter((c) => !termId || c.termId === termId)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {classLabel(c)}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Section
              <select
                value={section}
                onChange={(e) => setSection(e.target.value)}
              >
                <option value="">All sections</option>
                {[...new Set(catalog.classes.map((c) => c.section))].map(
                  (s) => (
                    <option key={s}>{s}</option>
                  ),
                )}
              </select>
            </label>
            <label>
              Subject
              <select
                value={offeringId}
                onChange={(e) => setOfferingId(e.target.value)}
              >
                <option value="">All subjects</option>
                {catalog.offerings
                  .filter(
                    (o) =>
                      (!classId || o.classGroupId === classId) &&
                      (!termId || o.classGroup.termId === termId),
                  )
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      {subjectLabel(o)} · {o.classGroup.section}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              From
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label>
              To
              <input
                type="date"
                value={to}
                min={from}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
          </div>
          <div className="button-row">
            <button
              className="secondary-button"
              disabled={!!from && !!to && from > to}
            >
              Apply filters
            </button>
            {report && (
              <a
                className="secondary-button"
                href={
                  "/api/attendance/reports.csv" + (query ? "?" + query : "")
                }
              >
                Export filtered CSV
              </a>
            )}
          </div>
        </fieldset>
      </form>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {busy && <p role="status">Loading reports…</p>}
      {report && (
        <>
          <h3>Subject summary</h3>
          {!report.summary.length ? (
            <p>No assigned subjects match these filters.</p>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Subject / class</th>
                    <th>Sessions</th>
                    <th>Present / student sessions</th>
                    <th>Attendance</th>
                  </tr>
                </thead>
                <tbody>
                  {report.summary.map((r) => (
                    <tr key={r.offering.id}>
                      <td>
                        {subjectLabel(r.offering)}
                        <small>{classLabel(r.offering.classGroup)}</small>
                      </td>
                      <td>{r.sessions}</td>
                      <td>
                        {r.present} / {r.conducted}
                      </td>
                      <td>
                        {r.conducted
                          ? r.percentage.toFixed(2) + "%"
                          : "No sessions"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <h3 className="section-start">Class / section summary</h3>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Class / section</th>
                  <th>Sessions</th>
                  <th>Present / student sessions</th>
                  <th>Attendance</th>
                </tr>
              </thead>
              <tbody>
                {report.classes.map((r) => (
                  <tr key={r.classGroup.id}>
                    <td>{classLabel(r.classGroup)}</td>
                    <td>{r.sessions}</td>
                    <td>
                      {r.present} / {r.conducted}
                    </td>
                    <td>
                      {r.conducted
                        ? r.percentage.toFixed(2) + "%"
                        : "No sessions"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3 className="section-start">Student-wise report</h3>
          <label>
            Search students
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Register number or name"
            />
          </label>
          {!report.students.length ? (
            <p>No student attendance records match these filters.</p>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Register / name</th>
                    <th>Subject</th>
                    <th>Attended</th>
                    <th>Conducted</th>
                    <th>Attendance</th>
                  </tr>
                </thead>
                <tbody>
                  {report.students
                    .filter((r) =>
                      `${r.registerNumber} ${r.name}`
                        .toLowerCase()
                        .includes(search.toLowerCase()),
                    )
                    .map((r) => (
                      <tr key={r.offeringId + r.studentId}>
                        <td>
                          {r.registerNumber}
                          <small>{r.name}</small>
                        </td>
                        <td>
                          {subjectLabel(
                            report.offerings.find(
                              (o) => o.id === r.offeringId,
                            )!,
                          )}
                        </td>
                        <td>{r.present}</td>
                        <td>{r.conducted}</td>
                        <td>
                          {r.conducted
                            ? r.percentage.toFixed(2) + "%"
                            : "No sessions"}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
          <h3 className="section-start">
            Saved sessions · {report.sessions.length}
          </h3>
          {!report.sessions.length ? (
            <p>No submitted sessions yet.</p>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Date / hour</th>
                    <th>Subject / class</th>
                    <th>Present / total</th>
                    <th>Review</th>
                  </tr>
                </thead>
                <tbody>
                  {report.sessions.map((s) => {
                    const o = report.offerings.find(
                      (o) => o.id === s.offeringId,
                    )!;
                    const canEdit =
                      user.roles.includes("STAFF") &&
                      catalog.offerings
                        .find((c) => c.id === o.id)
                        ?.assignments?.some((a) => a.staffId === user.id);
                    return (
                      <tr key={s.id}>
                        <td>
                          {s.date.slice(0, 10)}
                          <small>Hour {s.period}</small>
                        </td>
                        <td>
                          {subjectLabel(o)}
                          <small>{classLabel(o.classGroup)}</small>
                        </td>
                        <td>
                          {s.present} / {s.total}
                        </td>
                        <td>
                          {canEdit && (
                            <button
                              className="text-button"
                              onClick={() =>
                                onOpen({
                                  offeringId: o.id,
                                  date: s.date.slice(0, 10),
                                  period: s.period,
                                })
                              }
                            >
                              Reopen / correct
                            </button>
                          )}
                          <button
                            className="text-button"
                            onClick={() => audit(s.id)}
                          >
                            Audit history
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {audits && (
            <>
              <h3 className="section-start">Correction audit trail</h3>
              {!audits.length ? (
                <p>No corrections recorded for this session.</p>
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Timestamp / faculty</th>
                        <th>Student</th>
                        <th>Change</th>
                        <th>Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {audits.map((a) => (
                        <tr key={a.id}>
                          <td>
                            {new Date(a.createdAt).toLocaleString()}
                            <small>{a.actor.name}</small>
                          </td>
                          <td>
                            {report.students.find(
                              (s) => s.studentId === a.changes.studentId,
                            )?.registerNumber ?? a.changes.studentId}
                          </td>
                          <td>
                            {a.changes.previousStatus} → {a.changes.newStatus}
                          </td>
                          <td>{a.changes.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
