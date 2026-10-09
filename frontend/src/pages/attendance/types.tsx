export type ClassGroup = {
  id: string;
  name: string;
  section: string;
  academicYear: string;
  department: string;
  admissionBatch: string;
  termId: string | null;
  registerPrefix: string;
  suffixWidth: number;
  rosterVersion: number;
};
export type Offering = {
  id: string;
  classGroupId: string;
  classGroup: ClassGroup;
  subject: { code: string; name: string };
  assignments?: { staffId: string; staff: { name: string } }[];
};
export type Catalog = {
  classes: ClassGroup[];
  offerings: Offering[];
  terms: { id: string; name: string }[];
};
export type StudentRow = {
  studentId: string;
  registerNumber: string | null;
  name: string;
  linked: boolean;
  active?: boolean;
  status?: "PRESENT" | "ABSENT";
};
export type Mode =
  "PRESENT" | "ABSENT" | "ALL_PRESENT" | "ALL_ABSENT" | "EXISTING";
export type Preview = {
  offering: Offering;
  date: string;
  period: number;
  mode: Mode;
  rows: StudentRow[];
  total: number;
  present: number;
  absent: number;
  errors: string[];
  duplicates: string[];
  valid: number;
  rosterVersion: number;
  sessionId: string | null;
  sessionVersion: number | null;
};
export type Report = {
  offerings: Offering[];
  sessions: {
    id: string;
    offeringId: string;
    date: string;
    period: number;
    total: number;
    present: number;
  }[];
  students: (StudentRow & {
    offeringId: string;
    present: number;
    conducted: number;
    percentage: number;
  })[];
  summary: {
    offering: Offering;
    sessions: number;
    present: number;
    conducted: number;
    percentage: number;
  }[];
  classes: {
    classGroup: ClassGroup;
    sessions: number;
    present: number;
    conducted: number;
    percentage: number;
  }[];
};
export const classLabel = (group: ClassGroup) =>
  `${group.name} · ${group.department || "Department pending"} · ${group.section} (${group.academicYear})`;
export const subjectLabel = (offering: Offering) =>
  `${offering.subject.code} · ${offering.subject.name}`;
export const message = (e: unknown) =>
  e instanceof Error ? e.message : "Unable to complete this request.";
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export function Warning({ errors }: { errors: string[] }) {
  return errors.length ? (
    <div role="alert" className="notice error">
      {errors.map((e, i) => (
        <p key={i}>{e}</p>
      ))}
    </div>
  ) : null;
}
