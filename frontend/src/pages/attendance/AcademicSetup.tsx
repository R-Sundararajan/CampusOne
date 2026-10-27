import { useEffect, useState, type FormEvent } from "react";
import { api } from "../../services/api";
import { classLabel, subjectLabel, message, type Catalog } from "./types";
function fields(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  return Object.fromEntries(
    new FormData(event.currentTarget).entries(),
  ) as Record<string, string>;
}
export function AcademicSetup({
  catalog,
  reload,
}: {
  catalog: Catalog;
  reload: () => Promise<void>;
}) {
  const [staff, setStaff] = useState<
      { id: string; name: string; email: string }[]
    >([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    api<{ staff: typeof staff }>("/attendance/admin/staff")
      .then((d) => setStaff(d.staff))
      .catch((e) => setError(message(e)));
  }, []);
  async function save(path: string, body: unknown, success: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api("/attendance/admin/" + path, body);
      await reload();
      setNotice(success);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel attendance-panel">
      <h2>Academic setup</h2>
      <p className="muted">
        Admin manages terms, classes, subjects, teaching access and verified
        student identity linkage.
      </p>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <form onSubmit={(e) => save("terms", fields(e), "Academic term saved.")}>
        <fieldset disabled={busy}>
          <legend>Academic term</legend>
          <div className="compact-grid">
            <label>
              Academic year / term name
              <input
                name="name"
                required
                maxLength={100}
                placeholder="2026–2027 · Semester 5"
              />
            </label>
          </div>
          <button className="secondary-button">Save term</button>
        </fieldset>
      </form>
      <form
        onSubmit={(e) =>
          save(
            "classes",
            fields(e),
            "Class saved. Continue with Class rosters to preview register numbers.",
          )
        }
      >
        <fieldset disabled={busy}>
          <legend>Class / section</legend>
          <div className="compact-grid">
            <label>
              Academic term
              <select name="termId" required defaultValue="">
                <option value="" disabled>
                  Select term
                </option>
                {catalog.terms.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Department
              <input
                name="department"
                required
                maxLength={100}
                placeholder="IT"
              />
            </label>
            <label>
              Admission batch / cohort
              <input
                name="admissionBatch"
                required
                maxLength={100}
                placeholder="2024"
              />
            </label>
            <label>
              Class / year of study
              <input
                name="name"
                required
                maxLength={100}
                placeholder="III Year"
              />
            </label>
            <label>
              Section
              <input name="section" required maxLength={100} placeholder="A" />
            </label>
          </div>
          <button className="secondary-button">Save class</button>
        </fieldset>
      </form>
      <form
        onSubmit={(e) =>
          save(
            "offerings",
            fields(e),
            "Subject added to the class. Its official roster is shared.",
          )
        }
      >
        <fieldset disabled={busy}>
          <legend>Class subject</legend>
          <div className="compact-grid">
            <label>
              Class
              <select name="classGroupId" required defaultValue="">
                <option value="" disabled>
                  Select class
                </option>
                {catalog.classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {classLabel(c)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Subject code
              <input name="code" required maxLength={100} placeholder="IT301" />
            </label>
            <label>
              Subject name
              <input
                name="name"
                required
                maxLength={100}
                placeholder="Operating Systems"
              />
            </label>
          </div>
          <button className="secondary-button">Add subject</button>
        </fieldset>
      </form>
      <form
        onSubmit={(e) => {
          const f = fields(e);
          const assigning = f.action === "assign";
          const identityConfirmed = f.identityConfirmed === "on";
          const synthetic = f.synthetic === "on";
          const evidence = String(f.identityEvidence ?? "").trim();
          if (assigning && identityConfirmed && synthetic) {
            setError("Choose either institutional identity confirmation or synthetic fixture attestation.");
            return;
          }
          if (!assigning && (identityConfirmed || synthetic)) {
            setError("Identity confirmation applies only when granting an assignment.");
            return;
          }
          if (assigning && catalog.institutionalAuthMode === "domain-only-demo" && !identityConfirmed && !synthetic) {
            setError("Confirm institutional identity or attest an authorized synthetic fixture before assigning access.");
            return;
          }
          if (assigning && synthetic && evidence.length < 10) {
            setError("Enter at least 10 characters of synthetic fixture authorization evidence.");
            return;
          }
          return save(
            "assignments",
            {
              staffId: f.staffId,
              offeringId: f.offeringId,
              assigned: assigning,
              identityConfirmed,
              ...(synthetic ? { syntheticIdentityAttested: true, identityEvidence: f.identityEvidence } : {}),
            },
            "Teaching assignment updated.",
          );
        }}
      >
        <fieldset disabled={busy}>
          <legend>Faculty teaching assignment</legend>
          <div className="compact-grid">
            <label>
              Approved Staff account
              <select name="staffId" required defaultValue="">
                <option value="" disabled>
                  Select faculty
                </option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {s.email}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Class and subject
              <select name="offeringId" required defaultValue="">
                <option value="" disabled>
                  Select subject
                </option>
                {catalog.offerings.map((o) => (
                  <option key={o.id} value={o.id}>
                    {classLabel(o.classGroup)} · {subjectLabel(o)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Action
              <select name="action">
                <option value="assign">Assign access</option>
                <option value="revoke">Revoke access</option>
              </select>
            </label>
          </div>
          <label className="checkbox-label"><input type="checkbox" name="identityConfirmed" />I verified the Staff identity out of band before granting access.</label>
          {catalog.institutionalAuthMode === "domain-only-demo" && <>
            <label className="checkbox-label"><input type="checkbox" name="synthetic" />I attest this is an operator-authorized synthetic Staff fixture, without claiming institutional identity or mailbox ownership.</label>
            <label>Synthetic authorization evidence<textarea name="identityEvidence" minLength={10} maxLength={500} rows={2} /></label>
            <p className="muted">Use one identity basis. Synthetic grants require written authorization evidence and are audited.</p>
          </>}
          <button className="secondary-button">Update assignment</button>
        </fieldset>
      </form>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Class / subject</th>
              <th>Assigned faculty</th>
            </tr>
          </thead>
          <tbody>
            {catalog.offerings.map((o) => (
              <tr key={o.id}>
                <td>
                  {classLabel(o.classGroup)}
                  <small>{subjectLabel(o)}</small>
                </td>
                <td>
                  {o.assignments?.map((a) => a.staff.name).join(", ") ||
                    "No faculty assigned"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form
        onSubmit={(e) => {
          const f = fields(e);
          return save(
            "link",
            {
              registerNumber: f.registerNumber,
              email: f.email,
              reason: f.reason,
              confirmed: f.confirmed === "on",
              identityConfirmed: f.synthetic !== "on" && f.confirmed === "on",
              ...(f.synthetic === "on" ? { syntheticIdentityAttested: true } : {}),
            },
            "Student account linked using the recorded identity basis.",
          );
        }}
      >
        <fieldset disabled={busy}>
          <legend>Authorized student reconciliation</legend>
          <p className="muted">
            Verify the student's institutional records before linking a roster
            number, or explicitly attest an authorized synthetic fixture in demo mode. The identity basis and evidence are recorded in the audit trail.
          </p>
          <div className="compact-grid">
            <label>
              Full register number
              <input
                name="registerNumber"
                required
                inputMode="numeric"
                pattern="[0-9]{2,30}"
                maxLength={30}
              />
            </label>
            <label>
              Student account email
              <input name="email" type="email" required />
            </label>
          </div>
          <label>
            Verification evidence / reason
            <textarea
              name="reason"
              required
              minLength={10}
              maxLength={500}
              rows={2}
              placeholder="Describe the institutional record or explicit operator authorization for this synthetic fixture"
            />
          </label>
          <label className="checkbox-label">
            <input type="checkbox" name="confirmed" required />I reviewed the account and register number linkage using the evidence above.
          </label>
          {catalog.institutionalAuthMode === "domain-only-demo" && <label className="checkbox-label"><input type="checkbox" name="synthetic" />This is an operator-authorized synthetic Student fixture; I make no institutional identity or mailbox ownership claim.</label>}
          <button className="secondary-button">Confirm & link student</button>
        </fieldset>
      </form>
    </section>
  );
}
