import { useEffect, useState } from "react";
import { api, type User } from "../../services/api";
import { MarkAttendance } from "./MarkAttendance";
import { Rosters } from "./Rosters";
import { AttendanceReports } from "./AttendanceReports";
import { AcademicSetup } from "./AcademicSetup";
import { message, type Catalog } from "./types";
export type Selection = { offeringId: string; date: string; period: number };
export function FacultyAttendance({ user }: { user: User }) {
  const [catalog, setCatalog] = useState<Catalog>();
  const [error, setError] = useState("");
  const [tab, setTab] = useState(
    user.roles.includes("STAFF") ? "mark" : "rosters",
  );
  const [selection, setSelection] = useState<Selection>();
  async function reload() {
    setError("");
    try {
      setCatalog(await api<Catalog>("/attendance/catalog"));
    } catch (e) {
      setError(message(e));
    }
  }
  useEffect(() => {
    void reload();
  }, []);
  if (!catalog)
    return (
      <div>
        <p
          role={error ? "alert" : "status"}
          className={error ? "notice error" : ""}
        >
          {error || "Loading assigned classes…"}
        </p>
        {error && (
          <button className="secondary-button" onClick={reload}>
            Retry loading classes
          </button>
        )}
      </div>
    );
  return (
    <>
      <div className="attendance-tabs" aria-label="Faculty attendance tools">
        {[
          ...(user.roles.includes("STAFF")
            ? [["mark", "Mark attendance"]]
            : []),
          ["rosters", "Class rosters"],
          ["reports", "Sessions & reports"],
          ...(user.roles.includes("ADMIN")
            ? [["setup", "Academic setup"]]
            : []),
        ].map(([key, label]) => (
          <button
            key={key}
            aria-pressed={tab === key}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {tab === "mark" && (
        <MarkAttendance
          key={
            selection
              ? `${selection.offeringId}-${selection.date}-${selection.period}`
              : "new"
          }
          catalog={catalog}
          user={user}
          initial={selection}
        />
      )}
      {tab === "rosters" && (
        <Rosters catalog={catalog} user={user} reload={reload} />
      )}
      {tab === "reports" && (
        <AttendanceReports
          catalog={catalog}
          user={user}
          onOpen={(s) => {
            setSelection(s);
            setTab("mark");
          }}
        />
      )}
      {tab === "setup" && <AcademicSetup catalog={catalog} reload={reload} />}
    </>
  );
}
