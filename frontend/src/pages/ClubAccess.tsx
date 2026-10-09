import { useEffect, useState, type FormEvent } from "react";
import { api } from "../services/api";
import { ConfirmDialog } from "../components/ConfirmDialog";
type Access = {
  clubs: { id: string; name: string }[];
  heads: { id: string; name: string; email: string }[];
  assignments: {
    userId: string;
    clubId: string;
    user: { name: string };
    club: { name: string };
  }[];
};
export function ClubAccess() {
  const [data, setData] = useState<Access>();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{
    userId: string;
    clubId: string;
    active: boolean;
    reason: string;
  }>();
  const load = () => api<Access>("/admin/club-access").then(setData);
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setPending({
      userId: String(f.get("userId")),
      clubId: String(f.get("clubId")),
      active: f.get("active") === "true",
      reason: String(f.get("reason")).trim(),
    });
  }
  async function save() {
    if (!pending) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api("/admin/club-access", pending);
      await load();
      setMessage("Club access updated and audited.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setPending(undefined);
    }
  }
  return (
    <section className="panel club-access">
      <h2>Club Head assignments</h2>
      <p>
        Grant or revoke club access for approved Club Heads. Revocation
        immediately blocks event changes.
      </p>
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
      {!data ? (
        <p role="status">Loading club access…</p>
      ) : (
        <>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Club Head</th>
                  <th>Club</th>
                </tr>
              </thead>
              <tbody>
                {data.assignments.map((a) => (
                  <tr key={a.userId + ":" + a.clubId}>
                    <td>{a.user.name}</td>
                    <td>{a.club.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.assignments.length && <p>No club assignments.</p>}
          </div>
          <form onSubmit={submit}>
            <div className="club-access-fields">
              <label>
                Approved Club Head
                <select required name="userId">
                  <option value="">Select account</option>
                  {data.heads.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name} · {h.email}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Club
                <select required name="clubId">
                  <option value="">Select club</option>
                  {data.clubs.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Action
                <select name="active">
                  <option value="true">Grant access</option>
                  <option value="false">Revoke access</option>
                </select>
              </label>
            </div>
            <label>
              Reason
              <input required minLength={3} maxLength={500} name="reason" />
            </label>
            <button className="secondary-button" disabled={busy}>
              Review access change
            </button>
          </form>
        </>
      )}
      {pending && (
        <ConfirmDialog
          title={pending.active ? "Grant club access?" : "Revoke club access?"}
          description={
            (pending.active
              ? "The selected approved Club Head will be able to manage this club’s events."
              : "The selected Club Head will immediately lose permission to manage this club’s events.") +
            " This change and its reason will be audited."
          }
          busy={busy}
          onClose={() => setPending(undefined)}
          onConfirm={save}
        />
      )}
    </section>
  );
}
