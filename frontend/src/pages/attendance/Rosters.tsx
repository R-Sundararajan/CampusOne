import { useEffect, useState } from "react";
import { parseRegisterNumbers } from "@campusone/attendance-core";
import { api, type User } from "../../services/api";
import {
  classLabel,
  message,
  Warning,
  type Catalog,
  type ClassGroup,
  type StudentRow,
} from "./types";
type RosterPreview = {
  rows: {
    registerNumber: string;
    name: string;
    linked: boolean;
    existing: boolean;
    inactive: boolean;
  }[];
  retained: StudentRow[];
  total: number;
  added: number;
  existing: number;
  unlinked: number;
  errors: string[];
  duplicates: string[];
  rosterVersion: number;
};
export function Rosters({
  catalog,
  user,
  reload,
}: {
  catalog: Catalog;
  user: User;
  reload: () => Promise<void>;
}) {
  const [classId, setClassId] = useState(catalog.classes[0]?.id ?? "");
  const [group, setGroup] = useState<ClassGroup>();
  const [entries, setEntries] = useState<StudentRow[]>([]);
  const [prefix, setPrefix] = useState(""),
    [width, setWidth] = useState(3),
    [input, setInput] = useState("");
  const [names, setNames] = useState<Record<string, string>>({}),
    [preview, setPreview] = useState<RosterPreview>();
  const [search, setSearch] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [confirmed, setConfirmed] = useState(false);
  const [member, setMember] = useState<StudentRow>(),
    [reason, setReason] = useState(""),
    [memberConfirmed, setMemberConfirmed] = useState(false);
  const parsed = parseRegisterNumbers(input, prefix, width);
  async function load() {
    if (!classId) return;
    setBusy(true);
    setError("");
    setPreview(undefined);
    setConfirmed(false);
    setMember(undefined);
    try {
      const data = await api<{ classGroup: ClassGroup; rows: StudentRow[] }>(
        "/attendance/rosters/" + encodeURIComponent(classId),
      );
      setGroup(data.classGroup);
      setEntries(data.rows);
      setPrefix(data.classGroup.registerPrefix);
      setWidth(data.classGroup.suffixWidth);
      setNames({});
      setInput(
        data.rows
          .filter(
            (r) =>
              r.active &&
              r.registerNumber?.startsWith(data.classGroup.registerPrefix),
          )
          .map((r) =>
            r.registerNumber!.slice(data.classGroup.registerPrefix.length),
          )
          .join(", "),
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, [classId]);
  function invalidate() {
    setPreview(undefined);
    setConfirmed(false);
    setNotice("");
  }
  async function calculate() {
    setBusy(true);
    setError("");
    setConfirmed(false);
    try {
      setPreview(
        await api<RosterPreview>("/attendance/rosters/preview", {
          classGroupId: classId,
          prefix,
          suffixWidth: width,
          input,
          names,
        }),
      );
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
      const result = await api<{ added: number; retained: number }>(
        "/attendance/rosters/import",
        {
          classGroupId: classId,
          prefix,
          suffixWidth: width,
          input,
          names,
          rosterVersion: preview.rosterVersion,
          confirmed: true,
        },
      );
      await load();
      await reload();
      setNotice(
        `Roster saved · ${result.added} added, ${result.retained} omitted members retained. Existing attendance is preserved.`,
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function changeMembership() {
    if (!group || !member || !memberConfirmed) return;
    setBusy(true);
    setError("");
    try {
      await api(
        "/attendance/rosters/" + encodeURIComponent(classId) + "/membership",
        {
          studentId: member.studentId,
          active: !member.active,
          reason,
          confirmed: true,
          rosterVersion: group.rosterVersion,
        },
      );
      await load();
      await reload();
      setNotice(
        "Membership updated. Submitted sessions retain their original students.",
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  if (!catalog.classes.length)
    return (
      <section className="panel attendance-panel">
        <h2>No classes available</h2>
        <p>
          {user.roles.includes("ADMIN")
            ? "Create an academic term and class in Academic setup."
            : "Ask an Admin to assign your class and subject."}
        </p>
      </section>
    );
  return (
    <section className="panel attendance-panel">
      <h2>Class roster</h2>
      <p className="muted">
        One official register is shared by all subjects in this class. Imports
        add members; omissions keep existing members enrolled.
      </p>
      <label>
        Class / section
        <select
          value={classId}
          disabled={busy}
          onChange={(e) => {
            setClassId(e.target.value);
            setNotice("");
          }}
        >
          {catalog.classes.map((c) => (
            <option key={c.id} value={c.id}>
              {classLabel(c)}
            </option>
          ))}
        </select>
      </label>
      {group && (
        <p className="roster-context">
          Department: {group.department || "Pending"} · Cohort:{" "}
          {group.admissionBatch || "Pending"} · Term: {group.academicYear} ·
          Class: {group.name} · Section: {group.section}
        </p>
      )}
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      <fieldset disabled={busy}>
        <legend>Import register numbers</legend>
        <div className="compact-grid">
          <label>
            Common register prefix
            <input
              value={prefix}
              inputMode="numeric"
              maxLength={24}
              onChange={(e) => {
                invalidate();
                setPrefix(e.target.value);
              }}
              placeholder="3122245002"
            />
          </label>
          <label>
            Suffix width
            <input
              type="number"
              min={1}
              max={6}
              value={width}
              onChange={(e) => {
                invalidate();
                setWidth(Number(e.target.value));
              }}
            />
          </label>
        </div>
        <label>
          Student suffixes
          <textarea
            rows={4}
            spellCheck={false}
            value={input}
            onChange={(e) => {
              invalidate();
              setInput(e.target.value);
            }}
            placeholder="62-132, 304, 305"
          />
          <small>
            Use commas, spaces, newlines or inclusive ranges. Lateral-entry
            suffixes are supported.
          </small>
        </label>
        <p className="parse-feedback" role="status">
          {parsed.suffixes.length} unique valid suffixes ·{" "}
          {parsed.duplicates.length} duplicates · {parsed.errors.length} invalid
          entries
          {parsed.duplicates.length
            ? ` · Duplicates: ${parsed.duplicates.join(", ")}`
            : ""}
        </p>
        <Warning errors={parsed.errors} />
        <button
          className="secondary-button"
          onClick={calculate}
          disabled={!input.trim() || !prefix}
        >
          Preview roster
        </button>
      </fieldset>
      {preview && (
        <>
          <h3>Proposed roster changes</h3>
          <div className="attendance-summary">
            <div>
              <small>Unique students</small>
              <strong>{preview.total}</strong>
            </div>
            <div>
              <small>Already enrolled / additions</small>
              <strong>
                {preview.existing} / {preview.added}
              </strong>
            </div>
            <div>
              <small>Unmatched accounts</small>
              <strong>{preview.unlinked}</strong>
            </div>
          </div>
          <Warning errors={preview.errors} />
          <p className="muted">
            Unmatched numbers remain unlinked until an Admin validates their
            Student account. Names entered here do not verify an identity.
          </p>
          {preview.retained.length > 0 && (
            <div className="notice">
              <strong>
                {preview.retained.length} omitted existing members will be
                retained:
              </strong>
              <p>
                {preview.retained
                  .map(
                    (r) => r.registerNumber ?? `${r.name} (register pending)`,
                  )
                  .join(", ")}
              </p>
            </div>
          )}
          <label>
            Search generated register numbers
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Full register number</th>
                  <th>Name / correction</th>
                  <th>Proposed change</th>
                  <th>Account</th>
                  <th>Remove from input</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows
                  .filter((r) =>
                    `${r.registerNumber} ${r.name}`
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                  )
                  .map((r) => (
                    <tr key={r.registerNumber}>
                      <td className="register-number">{r.registerNumber}</td>
                      <td>
                        <input
                          disabled={r.linked || busy}
                          aria-label={`Name for ${r.registerNumber}`}
                          value={names[r.registerNumber] ?? r.name}
                          onChange={(e) => {
                            setNames({
                              ...names,
                              [r.registerNumber]: e.target.value,
                            });
                            setConfirmed(false);
                          }}
                          maxLength={100}
                        />
                      </td>
                      <td>
                        {r.existing
                          ? "Keep enrolled"
                          : r.inactive
                            ? "Keep inactive"
                            : "Add enrollment"}
                      </td>
                      <td>{r.linked ? "Linked" : "Unmatched"}</td>
                      <td>
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() => {
                            setInput(
                              parsed.suffixes
                                .filter((s) => prefix + s !== r.registerNumber)
                                .join(", "),
                            );
                            invalidate();
                          }}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            I reviewed these full register numbers and the proposed additions.
            Omitted members remain enrolled.
          </label>
          <button
            className="primary-button attendance-save"
            disabled={busy || !confirmed || !!preview.errors.length}
            onClick={save}
          >
            Confirm & import roster
          </button>
        </>
      )}
      <h3 className="section-start">
        Current membership · {entries.filter((r) => r.active).length} active
      </h3>
      <label>
        Search current students
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Register number or name"
        />
      </label>
      {!entries.length ? (
        <p>No members yet. Preview an import above.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Register number</th>
                <th>Name</th>
                <th>Enrollment</th>
                <th>Account</th>
                <th>Change</th>
              </tr>
            </thead>
            <tbody>
              {entries
                .filter((r) =>
                  `${r.registerNumber} ${r.name}`
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                )
                .map((r) => (
                  <tr key={r.studentId}>
                    <td className="register-number">
                      {r.registerNumber ?? "Register pending"}
                    </td>
                    <td>{r.name}</td>
                    <td>{r.active ? "Active" : "Inactive"}</td>
                    <td>{r.linked ? "Linked" : "Unmatched"}</td>
                    <td>
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => {
                          setMember(r);
                          setReason("");
                          setMemberConfirmed(false);
                        }}
                      >
                        {r.active ? "Deactivate" : "Reactivate"}
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
      {member && (
        <fieldset disabled={busy}>
          <legend>
            {member.active ? "Deactivate" : "Reactivate"}{" "}
            {member.registerNumber ?? member.name}
          </legend>
          <label>
            Reason
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={memberConfirmed}
              onChange={(e) => setMemberConfirmed(e.target.checked)}
            />
            Confirm this membership change. Historical attendance remains
            available.
          </label>
          <div className="button-row">
            <button
              className="secondary-button"
              onClick={changeMembership}
              disabled={!memberConfirmed || reason.trim().length < 5}
            >
              Confirm membership change
            </button>
            <button
              className="text-button"
              onClick={() => setMember(undefined)}
            >
              Cancel
            </button>
          </div>
        </fieldset>
      )}
    </section>
  );
}
