import { useEffect, useState, type FormEvent } from "react";
import { api, roleLabel, type RoleRequest } from "../services/api";
import { ClubAccess } from "./ClubAccess";
type Inbox = {
  requests: RoleRequest[];
  clubs: { id: string; name: string }[];
  offerings: { id: string; label: string }[];
};
export function Approvals() {
  const [data, setData] = useState<Inbox>({
    requests: [],
    clubs: [],
    offerings: [],
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const load = () => api<Inbox>("/admin/role-requests").then(setData);
  useEffect(() => {
    load()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  async function decide(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    setBusy(id);
    setError("");
    setMessage("");
    const form = new FormData(event.currentTarget);
    const decision = form.get("decision");
    const payload =
      decision === "REJECTED"
        ? { decision, reason: form.get("reason") }
        : {
            decision,
            identityConfirmed: form.get("identityConfirmed") === "on",
            ...(form.has("clubId")
              ? { clubId: form.get("clubId") }
              : { offeringIds: form.getAll("offeringIds") }),
          };
    try {
      if (decision === "REJECTED" && !String(form.get("reason") ?? "").trim()) {
        throw new Error("Enter a reason before rejecting this request.");
      }
      if (
        decision === "APPROVED" &&
        form.has("clubId") &&
        !form.get("clubId")
      ) {
        throw new Error("Select a club before approving Club Head access.");
      }
      await api("/admin/role-requests/" + id + "/decision", payload);
      await load();
      setMessage(
        "Request " + (decision === "APPROVED" ? "approved." : "rejected."),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <>
      <div className="page-heading">
        <p className="eyebrow">ADMINISTRATION</p>
        <h1>Access requests</h1>
        <p>
          Verify each person's real institutional identity out of band before granting Staff or Club Head permissions. An email domain does not prove identity.
        </p>
      </div>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="notice success">
          {message}
        </p>
      )}
      {loading ? (
        <p role="status">Loading requests…</p>
      ) : !data.requests.length ? (
        <section className="panel empty-state">
          <h2>No pending requests</h2>
          <p>
            Requests appear here when the applicant meets the configured registration policy.
          </p>
        </section>
      ) : (
        <div className="approval-list">
          {data.requests.map((r) => (
            <section className="panel approval-item" key={r.id}>
              <div className="approval-person">
                <span className="status-tag">{roleLabel[r.role]} request</span>
                <h2>{r.user?.name}</h2>
                <p className="email-text">{r.user?.email}</p>
                <small>
                  Requested {new Date(r.createdAt).toLocaleDateString()}
                </small>
              </div>
              <form onSubmit={(e) => decide(e, r.id)}>
                <label>
                  Decision
                  <select name="decision">
                    <option value="APPROVED">Approve</option>
                    <option value="REJECTED">Reject</option>
                  </select>
                </label>
                {r.role === "CLUB_HEAD" ? (
                  <label>
                    Club (required for approval)
                    <select name="clubId">
                      <option value="">Select a club</option>
                      {data.clubs.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <fieldset>
                    <legend>Teaching assignments (optional)</legend>
                    {data.offerings.length ? (
                      data.offerings.map((o) => (
                        <label className="checkbox-label" key={o.id}>
                          <input
                            type="checkbox"
                            name="offeringIds"
                            value={o.id}
                          />
                          {o.label}
                        </label>
                      ))
                    ) : (
                      <p className="muted">No class offerings configured.</p>
                    )}
                  </fieldset>
                )}
                <label>
                  Reason (required when rejecting)
                  <textarea name="reason" maxLength={500} rows={2} />
                </label>
                <label className="checkbox-label">
                  <input type="checkbox" name="identityConfirmed" />
                  I verified this person's institutional identity out of band (required for demo-mode approval).
                </label>
                <button className="primary-button" disabled={busy === r.id}>
                  {busy === r.id ? "Saving…" : "Save decision"}
                </button>
              </form>
            </section>
          ))}
        </div>
      )}
      <ClubAccess />
    </>
  );
}
