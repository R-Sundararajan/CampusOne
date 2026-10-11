import { useState, type FormEvent } from "react";
import { api } from "../../services/api";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { groupLabels, type Assignment, type Catalog } from "./types";
export function SupervisorAssignments({ catalog, refresh }: { catalog: Catalog; refresh: () => void }) {
  const [error, setError] = useState(""), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ slot: Assignment; userId: string | null; reason: string; synthetic: boolean }>();
  function prepare(e: FormEvent<HTMLFormElement>, slot: Assignment) {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    setError(""); setMessage(""); setPending({ slot, userId: String(f.get("userId")) || null, reason: String(f.get("reason")).trim(), synthetic: !!f.get("userId") && f.get("synthetic") === "on" });
  }
  async function save() {
    if (!pending) return; setBusy(true);
    try {
      const r = await api<{ transferredCases: number }>("/complaints/supervisors/" + pending.slot.studentGroup, { userId: pending.userId, reason: pending.reason, version: pending.slot.version, identityConfirmed: !!pending.userId && !pending.synthetic, ...(pending.synthetic ? { syntheticIdentityAttested: true } : {}) });
      setMessage(`Assignment saved. ${r.transferredCases} unresolved case(s) updated.`); setPending(undefined); refresh();
    } catch (e) { setError((e as Error).message); setPending(undefined); refresh(); }
    finally { setBusy(false); }
  }
  if (!catalog.canAdmin) return <p role="alert" className="notice error">Admin access required.</p>;
  return <>
    <div className="page-heading"><p className="eyebrow">COMPLAINT ADMINISTRATION</p><h1>Supervisor assignments</h1><p>Designate one approved Staff account for each group. Replacement transfers unresolved cases; revocation leaves them awaiting assignment.</p></div>
    {error && <p role="alert" className="notice error">{error}</p>}{message && <p role="status" className="notice">{message}</p>}
    <div className="assignment-grid">{catalog.assignments?.map(slot => <form key={slot.studentGroup + slot.version} className="panel" onSubmit={e => prepare(e, slot)}>
      <h2>{groupLabels[slot.studentGroup]}</h2><p className="muted">{slot.user ? `${slot.user.name}${slot.eligible ? "" : " · Account no longer eligible"}` : "Awaiting designation"}</p>
      <label>Designated Supervisor<select name="userId" defaultValue={slot.userId ?? ""} disabled={busy}><option value="">No Supervisor / revoke</option>{slot.user && !catalog.candidates?.some(u => u.id === slot.userId) && <option value={slot.user.id} disabled>{slot.user.name} (ineligible)</option>}{catalog.candidates?.map(u => <option key={u.id} value={u.id}>{u.name} · {u.email}</option>)}</select></label>
      <label>Reason for assignment change<textarea name="reason" required maxLength={2000} rows={2} disabled={busy} /></label>
      {catalog.institutionalAuthMode === "domain-only-demo" && <label className="checkbox-label"><input type="checkbox" name="synthetic" disabled={busy} />I reviewed the Admin authorization for this controlled synthetic Staff fixture and recorded the evidence in the reason. No institutional identity or mailbox ownership claim.</label>}
      <button className="secondary-button" disabled={busy}>Save {groupLabels[slot.studentGroup]} assignment</button>
    </form>)}</div>
    {pending && <ConfirmDialog title="Change Supervisor assignment?" description={(pending.userId ? (pending.synthetic ? "Confirm the recorded operator authorization for this synthetic fixture. This is audited as synthetic authorization, without institutional identity or mailbox ownership verification. " : "Confirm only after verifying this Staff account's institutional identity out of band. ") : "") + "All unresolved cases for this processing group will be transferred or left awaiting assignment. The former Supervisor loses access. The reason and history will be recorded."} busy={busy} onConfirm={save} onClose={() => setPending(undefined)} />}
  </>;
}
