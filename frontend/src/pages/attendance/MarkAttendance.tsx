import { useEffect, useState } from "react";
import { parseRegisterNumbers } from "@campusone/attendance-core";
import { api, type User } from "../../services/api";
import type { Selection } from "./FacultyAttendance";
import {
  classLabel,
  subjectLabel,
  message,
  today,
  Warning,
  type Catalog,
  type Preview,
  type Mode,
  type StudentRow,
} from "./types";
export function MarkAttendance({
  catalog,
  user,
  initial,
}: {
  catalog: Catalog;
  user: User;
  initial?: Selection;
}) {
  const assigned = catalog.offerings.filter((o) =>
    o.assignments?.some((a) => a.staffId === user.id),
  );
  const groups = catalog.classes.filter((c) =>
    assigned.some((o) => o.classGroupId === c.id),
  );
  const [classId, setClassId] = useState(
    assigned.find((o) => o.id === initial?.offeringId)?.classGroupId ??
      groups[0]?.id ??
      "",
  );
  const [offeringId, setOfferingId] = useState(
    initial?.offeringId ??
      assigned.find((o) => o.classGroupId === classId)?.id ??
      "",
  );
  const [date, setDate] = useState(initial?.date ?? today()),
    [period, setPeriod] = useState(initial?.period ?? 1);
  const [mode, setMode] = useState<Mode>("PRESENT"),
    [input, setInput] = useState("");
  const [preview, setPreview] = useState<Preview>(),
    [loaded, setLoaded] = useState(false);
  const [rows, setRows] = useState<StudentRow[]>([]);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false),
    [allConfirmed, setAllConfirmed] = useState(false),
    [reason, setReason] = useState(""),
    [search, setSearch] = useState("");
  const group = groups.find((c) => c.id === classId);
  const parsed = parseRegisterNumbers(
    input,
    group?.registerPrefix ?? "",
    group?.suffixWidth ?? 3,
  );
  const present = rows.filter((r) => r.status === "PRESENT").length;
  const uniform = rows.length > 0 && (present === 0 || present === rows.length);
  function invalidate() {
    setPreview(undefined);
    setRows([]);
    setConfirmed(false);
    setAllConfirmed(false);
    setNotice("");
    setError("");
  }
  useEffect(() => {
    setLoaded(false);
    invalidate();
  }, [classId, offeringId, date, period]);
  async function loadExisting() {
    if (!offeringId) return;
    setBusy(true);
    setError("");
    setConfirmed(false);
    setAllConfirmed(false);
    try {
      const p = await api<Preview>("/attendance/preview", {
        offeringId,
        date,
        period,
        mode: "EXISTING",
        input: "",
      });
      setLoaded(true);
      if (p.sessionId) {
        setPreview(p);
        setRows(p.rows);
        setMode("EXISTING");
        setInput("");
        setNotice(
          "Saved attendance loaded. Changes require a correction reason.",
        );
      } else {
        setMode("PRESENT");
        setPreview(undefined);
        setRows([]);
        setNotice(
          `New session · ${p.total} enrolled students. Paste present or absent suffixes to calculate attendance.`,
        );
        const errors = p.errors.filter(
          (e) => !e.startsWith("No saved attendance"),
        );
        if (errors.length) setError(errors.join(" "));
      }
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (initial) void loadExisting();
  }, []);
  async function calculate(nextMode: Mode = mode) {
    setBusy(true);
    setError("");
    setConfirmed(false);
    setAllConfirmed(false);
    try {
      const p = await api<Preview>("/attendance/preview", {
        offeringId,
        date,
        period,
        mode: nextMode,
        input: nextMode.startsWith("ALL_") ? "" : input,
      });
      setPreview(p);
      setRows(p.rows);
      setMode(nextMode);
      if (nextMode.startsWith("ALL_")) setInput("");
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!preview || !confirmed) return;
    setBusy(true);
    setError("");
    try {
      const saved = await api<{ changed: number }>("/attendance/sessions", {
        offeringId,
        date,
        period,
        mode,
        input,
        overrides: rows.map((r) => ({
          studentId: r.studentId,
          status: r.status,
        })),
        confirmed: true,
        rosterVersion: preview.rosterVersion,
        ...(preview.sessionVersion
          ? { sessionVersion: preview.sessionVersion }
          : {}),
        ...(uniform && allConfirmed
          ? { allConfirmation: present ? "PRESENT" : "ABSENT" }
          : {}),
        reason,
      });
      await loadExisting();
      setNotice(
        `Attendance saved · ${present} present, ${rows.length - present} absent. ${saved.changed} record(s) saved or corrected.`,
      );
      setReason("");
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  if (!assigned.length)
    return (
      <section className="panel attendance-panel">
        <h2>No teaching assignments</h2>
        <p>
          An Admin must assign a class and subject before you can mark
          attendance.
        </p>
      </section>
    );
  return (
    <section className="panel attendance-panel">
      <h2>Daily class register</h2>
      <p className="muted">
        Choose a session, load its roster, then preview and confirm your
        entries.
      </p>
      <fieldset disabled={busy}>
        <legend>Class and session</legend>
        <div className="compact-grid">
          <label>
            Assigned class / section
            <select
              value={classId}
              onChange={(e) => {
                setClassId(e.target.value);
                setOfferingId(
                  assigned.find((o) => o.classGroupId === e.target.value)?.id ??
                    "",
                );
              }}
            >
              {groups.map((c) => (
                <option key={c.id} value={c.id}>
                  {classLabel(c)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Subject
            <select
              value={offeringId}
              onChange={(e) => setOfferingId(e.target.value)}
            >
              {assigned
                .filter((o) => o.classGroupId === classId)
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {subjectLabel(o)}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Attendance date
            <input
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label>
            Period / hour
            <select
              value={period}
              onChange={(e) => setPeriod(Number(e.target.value))}
            >
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i + 1}>{i + 1}</option>
              ))}
            </select>
          </label>
        </div>
        <button
          className="secondary-button"
          onClick={loadExisting}
          disabled={!date}
        >
          Load roster / saved attendance
        </button>
      </fieldset>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {loaded && (
        <>
          <fieldset disabled={busy}>
            <legend>
              Bulk entry · prefix {group?.registerPrefix || "not configured"} ·
              width {group?.suffixWidth}
            </legend>
            <div className="attendance-tabs">
              <button
                aria-pressed={mode === "PRESENT"}
                onClick={() => {
                  invalidate();
                  setMode("PRESENT");
                }}
              >
                Enter present students
              </button>
              <button
                aria-pressed={mode === "ABSENT"}
                onClick={() => {
                  invalidate();
                  setMode("ABSENT");
                }}
              >
                Enter absent students
              </button>
            </div>
            <p className="mode-label">
              {mode === "EXISTING"
                ? "Editing saved statuses"
                : mode === "PRESENT"
                  ? "PRESENT list: everyone else will be absent"
                  : mode === "ABSENT"
                    ? "ABSENT list: everyone else will be present"
                    : mode === "ALL_PRESENT"
                      ? "MARK ALL PRESENT"
                      : "MARK ALL ABSENT"}
            </p>
            {!["EXISTING", "ALL_PRESENT", "ALL_ABSENT"].includes(mode) && (
              <>
                <label>
                  Student suffixes
                  <textarea
                    rows={3}
                    value={input}
                    onChange={(e) => {
                      invalidate();
                      setInput(e.target.value);
                    }}
                    placeholder="62-65, 304, 305"
                    spellCheck={false}
                  />
                  <small>
                    Commas, spaces, newlines and inclusive ranges (62-132).
                    Enter enrolled suffixes only.
                  </small>
                </label>
                <p className="parse-feedback" role="status">
                  {parsed.suffixes.length} valid · {parsed.duplicates.length}{" "}
                  duplicates · {parsed.errors.length} invalid entries
                  {parsed.duplicates.length
                    ? ` · Duplicate suffixes: ${parsed.duplicates.join(", ")}`
                    : ""}
                </p>
                <Warning errors={parsed.errors} />
              </>
            )}
            <div className="button-row">
              <button
                className="secondary-button"
                onClick={() => calculate()}
                disabled={!input.trim() && mode !== "EXISTING"}
              >
                Calculate preview
              </button>
              <button
                className="text-button"
                onClick={() => calculate("ALL_PRESENT")}
              >
                Mark all present
              </button>
              <button
                className="text-button"
                onClick={() => calculate("ALL_ABSENT")}
              >
                Mark all absent
              </button>
            </div>
          </fieldset>
          {preview && (
            <>
              <h3>
                Attendance preview · {preview.date} · Hour {preview.period}
              </h3>
              <p>
                {classLabel(preview.offering.classGroup)} ·{" "}
                {subjectLabel(preview.offering)}
              </p>
              <div className="attendance-summary">
                <div>
                  <small>Total students</small>
                  <strong>{rows.length}</strong>
                </div>
                <div>
                  <small>Present</small>
                  <strong>{present}</strong>
                </div>
                <div>
                  <small>Absent</small>
                  <strong>{rows.length - present}</strong>
                </div>
              </div>
              <Warning errors={preview.errors} />
              <label>
                Search students
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Register number or name"
                />
              </label>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Register number</th>
                      <th>Student</th>
                      <th>Status · click to change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows
                      .filter((r) =>
                        `${r.registerNumber} ${r.name}`
                          .toLowerCase()
                          .includes(search.toLowerCase()),
                      )
                      .map((r) => (
                        <tr key={r.studentId}>
                          <td className="register-number">
                            {r.registerNumber ?? "Pending reconciliation"}
                          </td>
                          <td>
                            {r.name}
                            {!r.linked && <small>Account unlinked</small>}
                          </td>
                          <td>
                            <button
                              disabled={busy || !!preview.errors.length}
                              className={
                                "status-toggle " +
                                (r.status === "PRESENT" ? "present" : "absent")
                              }
                              aria-label={`${r.registerNumber} ${r.status === "PRESENT" ? "Present" : "Absent"}; toggle status`}
                              onClick={() => {
                                setRows(
                                  rows.map((s) =>
                                    s.studentId === r.studentId
                                      ? {
                                          ...s,
                                          status:
                                            s.status === "PRESENT"
                                              ? "ABSENT"
                                              : "PRESENT",
                                        }
                                      : s,
                                  ),
                                );
                                setConfirmed(false);
                                setAllConfirmed(false);
                              }}
                            >
                              {r.status === "PRESENT" ? "Present" : "Absent"}
                            </button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              {preview.sessionId && (
                <label>
                  Reason for correction
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={2}
                    minLength={5}
                    maxLength={500}
                    placeholder="Explain the correction for the audit trail"
                  />
                </label>
              )}
              {uniform && (
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={allConfirmed}
                    onChange={(e) => setAllConfirmed(e.target.checked)}
                  />
                  I deliberately want to mark every student{" "}
                  {present ? "present" : "absent"}.
                </label>
              )}
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                I checked this class, subject, date, hour and all {rows.length}{" "}
                statuses.
              </label>
              <button
                className="primary-button attendance-save"
                onClick={save}
                disabled={
                  busy ||
                  !confirmed ||
                  !!preview.errors.length ||
                  (uniform && !allConfirmed) ||
                  (!!preview.sessionId && reason.trim().length < 5)
                }
              >
                {busy
                  ? "Saving…"
                  : preview.sessionId
                    ? "Confirm & save correction"
                    : "Confirm & save attendance"}
              </button>
            </>
          )}
        </>
      )}
    </section>
  );
}
