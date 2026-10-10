import { useEffect, useState } from "react";
import { api } from "../../services/api";
import { classLabel, subjectLabel, message, type Offering } from "./types";
type Overview = {
  linked: boolean;
  registerNumber?: string;
  subjects: {
    offering: Offering;
    present: number;
    conducted: number;
    percentage: number;
  }[];
  history: {
    offeringId: string;
    date: string;
    period: number;
    status: string;
  }[];
  present: number;
  conducted: number;
  percentage: number;
};
const configured = Number(
  import.meta.env.VITE_ATTENDANCE_WARNING_THRESHOLD ?? 75,
);
const threshold =
  Number.isFinite(configured) && configured >= 0 && configured <= 100
    ? configured
    : 75;
export function StudentAttendance() {
  const [data, setData] = useState<Overview>();
  const [error, setError] = useState("");
  const [subject, setSubject] = useState("");
  const [from, setFrom] = useState(""),
    [to, setTo] = useState("");
  async function load() {
    setError("");
    try {
      setData(await api<Overview>("/attendance/student"));
    } catch (e) {
      setError(message(e));
    }
  }
  useEffect(() => {
    void load();
  }, []);
  if (error)
    return (
      <div>
        <p role="alert" className="notice error">
          {error}
        </p>
        <button className="secondary-button" onClick={load}>
          Retry loading attendance
        </button>
      </div>
    );
  if (!data) return <p role="status">Loading your attendance…</p>;
  const history = data.history.filter(
    (r) =>
      (!subject || r.offeringId === subject) &&
      (!from || r.date >= from) &&
      (!to || r.date <= to),
  );
  return (
    <>
      {!data.linked && (
        <p className="notice">
          Your register number has not been linked to this account. Contact an
          Admin to verify your identity and enrollment.
        </p>
      )}
      <div className="attendance-summary" aria-label="Overall attendance">
        <div>
          <small>Register number</small>
          <strong>{data.registerNumber ?? "Pending linkage"}</strong>
        </div>
        <div>
          <small>Attended / conducted</small>
          <strong>
            {data.present} / {data.conducted}
          </strong>
        </div>
        <div>
          <small>Overall attendance</small>
          <strong
            className={
              data.conducted && data.percentage < threshold
                ? "attendance-warning"
                : ""
            }
          >
            {data.conducted
              ? data.percentage.toFixed(2) + "%"
              : "No sessions yet"}
          </strong>
        </div>
      </div>
      <section className="panel attendance-panel">
        <h2>Enrolled subjects</h2>
        <p className="muted">
          Calculated from submitted records. The portal highlights attendance
          below {threshold}% as a configurable reminder.
        </p>
        {!data.subjects.length ? (
          <p>No enrolled subjects are available yet.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Subject / class</th>
                  <th>Attended</th>
                  <th>Conducted</th>
                  <th>Attendance</th>
                </tr>
              </thead>
              <tbody>
                {data.subjects.map((s) => (
                  <tr key={s.offering.id}>
                    <td>
                      <strong>{subjectLabel(s.offering)}</strong>
                      <small>{classLabel(s.offering.classGroup)}</small>
                    </td>
                    <td>{s.present}</td>
                    <td>{s.conducted}</td>
                    <td>
                      <span
                        className={
                          s.conducted && s.percentage < threshold
                            ? "status-tag warning"
                            : "status-tag"
                        }
                      >
                        {s.conducted
                          ? s.percentage.toFixed(2) + "%"
                          : "No sessions"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="panel attendance-panel">
        <h2>Date and period history</h2>
        <div className="compact-grid">
          <label>
            Subject
            <select
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            >
              <option value="">All subjects</option>
              {data.subjects.map((s) => (
                <option key={s.offering.id} value={s.offering.id}>
                  {subjectLabel(s.offering)}
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
        {from && to && from > to ? (
          <p role="alert" className="notice error">
            Choose an end date on or after the start date.
          </p>
        ) : !history.length ? (
          <p>No submitted attendance matches these dates.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Period</th>
                  <th>Subject</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {history.map((r) => (
                  <tr key={r.offeringId + r.date + r.period}>
                    <td>{r.date}</td>
                    <td>{r.period}</td>
                    <td>
                      {subjectLabel(
                        data.subjects.find(
                          (s) => s.offering.id === r.offeringId,
                        )!.offering,
                      )}
                    </td>
                    <td>
                      <span
                        className={
                          "status-tag " +
                          (r.status === "PRESENT" ? "active" : "warning")
                        }
                      >
                        {r.status === "PRESENT" ? "Present" : "Absent"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
