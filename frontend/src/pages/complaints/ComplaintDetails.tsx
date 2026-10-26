import { useEffect, useState, type FormEvent } from "react";
import { api } from "../../services/api";
import { Link } from "../../components/Link";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { categoryLabels, complaintDate, groupLabels, statusLabels, uploadImage, type Catalog, type Complaint } from "./types";
const actionLabels: Record<string, string> = { SUBMITTED: "Complaint submitted", ACCEPTED: "Accepted by Admin", REJECTED: "Rejected by Admin", ASSIGNED: "Supervisor assignment recorded", REASSIGNED: "Supervisor reassigned", PROGRESS: "Internal coordination recorded", RESOLVED: "Complaint resolved", FEEDBACK: "Feedback submitted", IMAGE_ATTACHED: "Image attached" };
export function ComplaintDetails({ id, catalog }: { id: string; catalog: Catalog }) {
  const [c, setCase] = useState<Complaint>(), [loading, setLoading] = useState(true);
  const [error, setError] = useState(""), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ action: string; body: object; title: string; description: string }>();
  const [refresh, setRefresh] = useState(0), [imageFailed, setImageFailed] = useState(false);
  useEffect(() => {
    let alive = true; setLoading(true);
    api<Complaint>("/complaints/" + id).then(d => { if (alive) { setCase(d); setImageFailed(false); } }).catch(e => { if (alive) { setCase(undefined); setError(e.message); } }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [id, refresh]);
  async function save(action: string, body: object) {
    if (!c) return; setBusy(true); setError(""); setMessage("");
    try { setCase(await api<Complaint>(`/complaints/${id}/${action}`, { ...body, version: c.version })); setMessage("Saved successfully."); return true; }
    catch (e) { setError((e as Error).message); setRefresh(v => v + 1); return false; }
    finally { setBusy(false); setPending(undefined); }
  }
  function form(e: FormEvent<HTMLFormElement>, action: string) {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    const requiredText: Record<string, string> = { reject: "reason", resolve: "resolutionDetails", reassign: "reason", notes: "text", feedback: "feedback" };
    const requiredField = requiredText[action];
    if (requiredField && !String(f.get(requiredField) ?? "").trim()) {
      setError("Enter non-whitespace text before saving.");
      return;
    }
    if (action === "accept") setPending({ action, body: { studentGroup: f.get("studentGroup"), confirmRouting: true }, title: "Accept this complaint?", description: "You confirm the routing group. Acceptance and assignment to its configured eligible Supervisor are saved together. If no Supervisor is configured, the case awaits assignment." });
    if (action === "reject") setPending({ action, body: { reason: f.get("reason") }, title: "Reject and close this complaint?", description: "The rejection is final. The submitter will see your reason and may provide feedback." });
    if (action === "resolve") setPending({ action, body: { resolutionDetails: f.get("resolutionDetails") }, title: "Resolve and close this complaint?", description: "The resolution is final. The submitter will see these resolution details and may provide feedback." });
    if (action === "reassign") setPending({ action, body: { supervisorGroup: f.get("supervisorGroup"), reason: f.get("reason") }, title: "Reassign this complaint?", description: "Ownership will move to the selected group's active Supervisor. The reason and previous assignment remain in the internal history." });
    if (action === "notes") { const target = e.currentTarget; void save(action, { text: f.get("text"), wardenContact: f.get("wardenContact") }).then(saved => { if (saved) target.reset(); }); }
    if (action === "feedback") void save(action, { feedback: f.get("feedback") });
  }
  async function attach(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!c) return;
    const file = new FormData(e.currentTarget).get("image") as File;
    if (!file?.size) { setError("Select an image."); return; }
    setBusy(true); setError("");
    try { setCase(await uploadImage(c, file)); setImageFailed(false); setMessage("Image attached."); }
    catch (e) { setError((e as Error).message); setRefresh(v => v + 1); }
    finally { setBusy(false); }
  }
  if (loading) return <p role="status">Loading complaint…</p>;
  if (!c) return <><p role="alert" className="notice error">{error}</p><Link href="/complaints">Back to complaints</Link></>;
  return <>
    <div className="page-heading"><p className="eyebrow">COMPLAINT REFERENCE · {c.id}</p><h1>{c.title}</h1><p>{complaintDate(c.createdAt)}</p></div>
    {error && <p role="alert" className="notice error">{error}</p>}{message && <p role="status" className="notice">{message}</p>}
    <div className="complaint-detail-grid"><div>
      <section className="panel"><div className="panel-title"><h2>Complaint details</h2><span className="status-tag">{statusLabels[c.status]}</span></div><p className="notice">{c.stage}</p><p className="preserve-lines">{c.description}</p>
        <dl className="complaint-meta"><dt>Category</dt><dd>{categoryLabels[c.category] || c.category}</dd><dt>Location / block</dt><dd>{c.location || "Not supplied"}</dd><dt>Routing group</dt><dd>{c.studentGroup ? groupLabels[c.studentGroup] : "Admin to select"} · {c.routingConfirmed ? "Confirmed by Admin" : c.routingSource === "MANUAL" ? "Manual routing required" : "Provisional / unconfirmed"}</dd>
          {c.submitter && <><dt>Submitter</dt><dd>{c.submitter.name} · {c.submitter.email}<br />{c.submitter.department}</dd></>}
          {c.supervisor && <><dt>Assigned Supervisor</dt><dd>{c.supervisor.name} · {groupLabels[c.supervisorGroup ?? ""]}</dd></>}
        </dl>
        {c.imageUrl && (imageFailed ? <p className="notice error">Image could not be loaded. <button className="text-button" onClick={() => { setImageFailed(false); setRefresh(v => v + 1); }}>Retry</button></p> : <a href={c.imageUrl} target="_blank" rel="noreferrer"><img src={c.imageUrl} alt="Complaint attachment" className="complaint-image" onError={() => setImageFailed(true)} /></a>)}
        {c.canUpload && <form onSubmit={attach}><label>{c.imageUrl ? "Replace attachment" : "Attach an optional image"}<input type="file" name="image" accept="image/jpeg,image/png" required disabled={busy} /><small>JPEG/PNG up to 2 MiB. Available before Admin verification.</small></label><button className="secondary-button" disabled={busy}>Save image</button></form>}
      </section>
      {c.rejectionReason && <section className="panel"><h2>Rejection reason</h2><p className="preserve-lines">{c.rejectionReason}</p></section>}
      {c.resolutionDetails && <section className="panel"><h2>Resolution</h2><p className="preserve-lines">{c.resolutionDetails}</p>{c.resolvedAt && <small>{complaintDate(c.resolvedAt)}</small>}</section>}
      {c.feedback && <section className="panel"><h2>Submitter feedback</h2><p className="preserve-lines">{c.feedback}</p>{c.feedbackAt && <small>{complaintDate(c.feedbackAt)}</small>}</section>}
      {c.canFeedback && <form className="panel" onSubmit={e => form(e, "feedback")}><h2>Share feedback</h2><label>Feedback<textarea name="feedback" required maxLength={2000} rows={3} disabled={busy} /><small>Feedback is saved once and does not change the complaint status.</small></label><button className="secondary-button" disabled={busy}>Submit feedback</button></form>}
      {c.internalNotes && <section className="panel internal-panel"><h2>Internal coordination</h2><p className="muted">Visible to Admin and the authorized assigned Supervisor. Contact the appropriate Block Warden outside CampusOne; record relevant coordination here.</p>
        {!c.internalNotes.length && <p>No internal notes recorded.</p>}{c.internalNotes.map(n => <div key={n.id} className="coordination-note"><strong>{n.author.name}</strong><small> · {complaintDate(n.createdAt)}</small><p className="preserve-lines">{n.text}</p>{n.wardenContact && <p>Warden contact / handoff: {n.wardenContact}</p>}</div>)}
        {c.canProcess && <form onSubmit={e => form(e, "notes")}><label>Internal progress note<textarea name="text" required maxLength={4000} rows={4} disabled={busy} /></label><label>Block Warden contact / handoff (optional)<input name="wardenContact" maxLength={240} disabled={busy} /><small>Only record contact information supplied for this case.</small></label><button className="secondary-button" disabled={busy}>Record coordination</button></form>}
      </section>}
    </div><aside>
      {c.canReview && <section className="panel"><h2>Admin verification</h2><form onSubmit={e => form(e, "accept")}><label>Confirmed routing group<select name="studentGroup" defaultValue="" required disabled={busy}><option value="">Select responsible group</option>{catalog.groups.map(g => <option key={g} value={g}>{groupLabels[g]}</option>)}</select></label><label className="checkbox-label"><input type="checkbox" required disabled={busy} />I reviewed the complaint and confirm this routing group.</label><button className="primary-button" disabled={busy}>Accept and assign</button></form><hr /><form onSubmit={e => form(e, "reject")}><label>Submitter-visible rejection reason<textarea name="reason" required maxLength={2000} rows={3} disabled={busy} /></label><button className="secondary-button" disabled={busy}>Reject complaint</button></form></section>}
      {c.canReassign && <form className="panel" onSubmit={e => form(e, "reassign")}><h2>Admin reassignment</h2><label>Active responsible Supervisor<select name="supervisorGroup" required defaultValue="" disabled={busy}><option value="">Select Supervisor</option>{catalog.assignments?.filter(s => s.eligible).map(s => <option key={s.studentGroup} value={s.studentGroup}>{groupLabels[s.studentGroup]} · {s.user?.name}</option>)}</select></label><label>Internal reassignment reason<textarea name="reason" required maxLength={2000} rows={3} disabled={busy} /></label><button className="secondary-button" disabled={busy}>Reassign complaint</button></form>}
      {c.canProcess && <form className="panel" onSubmit={e => form(e, "resolve")}><h2>Resolve complaint</h2><label>Submitter-visible resolution details<textarea name="resolutionDetails" required maxLength={4000} rows={5} disabled={busy} /><small>Describe the outcome. Keep confidential coordination in internal notes.</small></label><button className="primary-button" disabled={busy}>Mark resolved</button></form>}
      <section className="panel"><h2>Complaint history</h2><ol className="complaint-timeline">{c.history?.map(h => <li key={h.id}><strong>{actionLabels[h.action.replace("COMPLAINT_", "")] || "Complaint updated"}</strong><small>{complaintDate(h.createdAt)}{h.actor ? " · " + h.actor.name : ""}</small>{h.changes?.supervisorGroup && <small>{groupLabels[h.changes.supervisorGroup]}</small>}{h.changes?.reason && <p className="preserve-lines">{h.changes.reason}</p>}</li>)}</ol></section>
    </aside></div>
    <Link href="/complaints">← Back to complaints</Link>
    {pending && <ConfirmDialog title={pending.title} description={pending.description} busy={busy} onClose={() => setPending(undefined)} onConfirm={() => void save(pending.action, pending.body)} />}
  </>;
}
