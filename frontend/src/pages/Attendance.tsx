import { useState } from "react";
import type { User } from "../services/api";
import { StudentAttendance } from "./attendance/StudentAttendance";
import { FacultyAttendance } from "./attendance/FacultyAttendance";

export function Attendance({ user }: { user: User }) {
  const faculty = user.roles.some((r) => r === "STAFF" || r === "ADMIN");
  const student = user.roles.includes("STUDENT");
  const [view, setView] = useState(faculty ? "faculty" : "student");
  return (
    <>
      <div className="page-heading">
        <p className="eyebrow">ACADEMIC SERVICES</p>
        <h1>Attendance</h1>
        <p>
          {view === "faculty"
            ? "Class registers, daily marking and attendance reports."
            : "Your enrolled subjects and submitted class records."}
        </p>
      </div>
      {faculty && student && (
        <div className="attendance-tabs" aria-label="Attendance view">
          <button
            aria-pressed={view === "faculty"}
            onClick={() => setView("faculty")}
          >
            Faculty portal
          </button>
          <button
            aria-pressed={view === "student"}
            onClick={() => setView("student")}
          >
            My attendance
          </button>
        </div>
      )}
      {view === "faculty" && faculty ? (
        <FacultyAttendance user={user} />
      ) : student ? (
        <StudentAttendance />
      ) : (
        <p className="notice">
          Attendance access requires Student, Staff or Admin authorization.
        </p>
      )}
    </>
  );
}
