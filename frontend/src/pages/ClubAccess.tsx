import { useEffect, useState, type FormEvent } from "react";
import { api } from "../services/api";
import { ConfirmDialog } from "../components/ConfirmDialog";
type Access = {
  institutionalAuthMode?: string;
  clubs: { id: string; name: string }[];
  heads: { id: string; name: string; email: string }[];
  assignments: {
    userId: string;
    clubId: string;
    user: { name: string };
    club: { name: string };
  }[];
};
export function ClubAccess({ revision, onClubsChanged }: { revision: number; onClubsChanged: () => Promise<void> }) {
  const [data, setData] = useState<Access>();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{
    userId: string;
    clubId: string;
    active: boolean;
    reason: string;
    synthetic: boolean;
  }>();
  const load = () => api<Access>("/admin/club-access").then(setData);
  async function createClub(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const name = String(new FormData(form).get("name") ?? "").trim();
    setBusy(true); setError(""); setMessage("");
    try {
      await api("/admin/clubs", { name });
      await Promise.all([load(), onClubsChanged()]);
      form.reset();
      setMessage("Club saved. It is available for Club Head approval and assignments.");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [revision]);
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setPending({
      userId: String(f.get("userId")),
      clubId: String(f.get("clubId")),
      active: f.get("active") === "true",
      reason: String(f.get("reason")).trim(),
      synthetic: f.get("active") === "true" && f.get("synthetic") === "on",
    });
  }
  async function save() {
    if (!pending) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const { synthetic, ...change } = pending;
      await api("/admin/club-access", { ...change, identityConfirmed: pending.active && !synthetic, ...(synthetic ? { syntheticIdentityAttested: true } : {}) });
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
      <h2>Clubs</h2>
      <p>Create a club before approving its Club Head. Saving an existing name reuses that club.</p>
      <form onSubmit={createClub}>
        <label>Club name<input name="name" required minLength={3} maxLength={100} disabled={busy} /></label>
        <button className="secondary-button" disabled={busy}>Save club</button>
      </form>
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
            {data.institutionalAuthMode === "domain-only-demo" && <label className="checkbox-label"><input type="checkbox" name="synthetic" />I reviewed the Admin authorization for this controlled synthetic Club Head and recorded the evidence in the reason. No institutional identity or mailbox ownership claim.</label>}
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
              ? (pending.synthetic ? "Confirm the recorded operator authorization for this synthetic fixture, without claiming institutional identity or mailbox ownership. " : "Confirm only after verifying this person's institutional identity out of band. ") + "The selected approved Club Head will be able to manage this club’s events."
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
