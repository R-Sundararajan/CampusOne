import { useEffect, useState, type FormEvent } from "react";
import { api, roleLabel, type RoleRequest, type User } from "../services/api";
export function Profile({ user }: { user: User }) {
  const [requests, setRequests] = useState<RoleRequest[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () =>
    api<{ requests: RoleRequest[] }>("/auth/role-requests").then((r) =>
      setRequests(r.requests),
    );
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api(
        "/auth/role-requests",
        Object.fromEntries(new FormData(e.currentTarget)),
      );
      await load();
      setMessage("Your request has been sent for Admin review.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const choices = (["STAFF", "CLUB_HEAD"] as const).filter(
    (r) => !user.roles.includes(r),
  );
  return (
    <>
      <div className="page-heading">
        <p className="eyebrow">ACCOUNT</p>
        <h1>Profile & access</h1>
        <p>Your identity and permissions on CampusOne.</p>
      </div>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="notice success" role="status">
          {message}
        </p>
      )}
      <div className="home-grid">
        <section className="panel profile-detail">
          <h2>{user.name}</h2>
          <dl>
            <dt>Institutional email</dt>
            <dd>{user.email}</dd>
            <dt>Department</dt>
            <dd>{user.department || "Not assigned"}</dd>
            <dt>Approved roles</dt>
            <dd>{user.roles.map((r) => roleLabel[r]).join(", ")}</dd>
          </dl>
          <p className="muted">
            Your roles are cumulative. Requesting access does not remove
            existing permissions.
          </p>
        </section>
        <section className="panel profile-detail">
          <h2>Request additional access</h2>
          <p>
            Staff and Club Head permissions require Admin approval and relevant
            assignments.
          </p>
          {choices.length ? (
            <form onSubmit={submit}>
              <label>
                Requested role
                <select name="role">
                  {choices.map((r) => (
                    <option key={r} value={r}>
                      {roleLabel[r]}
                    </option>
                  ))}
                </select>
              </label>
              <button className="primary-button" disabled={busy}>
                Submit request
              </button>
            </form>
          ) : (
            <p>You already hold both requestable roles.</p>
          )}
        </section>
      </div>
      <section className="panel requests-panel">
        <h2>Your access requests</h2>
        {!requests.length ? (
          <p className="muted">No requests to show.</p>
        ) : (
          requests.map((r) => (
            <div className="request-row" key={r.id}>
              <strong>{roleLabel[r.role]}</strong>
              <span className="status-tag">{r.status.toLowerCase()}</span>
              {r.reason && <p>{r.reason}</p>}
            </div>
          ))
        )}
      </section>
    </>
  );
}
