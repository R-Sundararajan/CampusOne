import { useEffect, useState, type FormEvent } from "react";
import { api, roleLabel, type RoleRequest } from "../services/api";
import { ClubAccess } from "./ClubAccess";
type Inbox = {
  institutionalAuthMode?: string;
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
  const [clubAccessRevision, setClubAccessRevision] = useState(0);
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
            ...(form.get("syntheticIdentityAttested") === "on" ? {
              syntheticIdentityAttested: true,
              identityEvidence: String(form.get("identityEvidence") ?? "").trim(),
            } : {}),
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
      if (decision === "APPROVED") {
        const synthetic = form.get("syntheticIdentityAttested") === "on";
        const identityConfirmed = form.get("identityConfirmed") === "on";
        const evidence = String(form.get("identityEvidence") ?? "").trim();
        if (synthetic && identityConfirmed)
          throw new Error("Choose either institutional identity confirmation or synthetic fixture attestation.");
        if (synthetic && evidence.length < 10)
          throw new Error("Enter at least 10 characters of synthetic fixture authorization evidence.");
        if (data.institutionalAuthMode === "domain-only-demo" && !synthetic && !identityConfirmed)
          throw new Error("Confirm institutional identity or attest an authorized synthetic fixture before approval.");
        if (form.has("offeringIds") && form.getAll("offeringIds").length > 30)
          throw new Error("Select no more than 30 teaching assignments.");
      }
      await api("/admin/role-requests/" + id + "/decision", payload);
      await load();
      setClubAccessRevision((revision) => revision + 1);
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
          Review identity and authorization out of band before granting Staff or Club Head permissions. An email domain does not prove identity. Controlled synthetic fixtures require explicit demo attestation rather than a claim of institutional identity.
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
                  I verified this person's institutional identity out of band.
                </label>
                {data.institutionalAuthMode === "domain-only-demo" && <fieldset>
                  <legend>Controlled synthetic demonstration alternative</legend>
                  <p>This attestation grants only the requested role and selected assignments. It does not verify institutional identity or mailbox ownership. Leave the institutional identity checkbox unchecked.</p>
                  <label className="checkbox-label">
                    <input type="checkbox" name="syntheticIdentityAttested" />
                    I reviewed and authorized this controlled synthetic account out of band for the demonstration.
                  </label>
                  <label>Out-of-band authorization evidence (required for synthetic attestation)
                    <textarea name="identityEvidence" minLength={10} maxLength={500} rows={2} placeholder="Record who authorized this fixture, when, and how its control was reviewed. Do not include passwords." />
                  </label>
                </fieldset>}
                <button className="primary-button" disabled={busy === r.id}>
                  {busy === r.id ? "Saving…" : "Save decision"}
                </button>
              </form>
            </section>
          ))}
        </div>
      )}
      <ClubAccess revision={clubAccessRevision} onClubsChanged={load} />
    </>
  );
}
