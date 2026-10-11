import { useEffect, useState, type FormEvent } from "react";
import { api } from "../services/api";
import { Link } from "../components/Link";
import { ComplaintForm } from "./complaints/ComplaintForm";
import { ComplaintDetails } from "./complaints/ComplaintDetails";
import { SupervisorAssignments } from "./complaints/SupervisorAssignments";
import { categoryLabels, complaintDate, groupLabels, statusLabels, type Catalog, type ComplaintList, type Statistics } from "./complaints/types";
export function Complaints({ route }: { route: string }) {
  const [catalog, setCatalog] = useState<Catalog>(), [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => { let alive = true; api<Catalog>("/complaints/catalog").then(c => { if (alive) setCatalog(c); }).catch(e => { if (alive) setError(e.message); }); return () => { alive = false; }; }, [refresh]);
  if (error && !catalog) return <p className="notice error" role="alert">{error}</p>;
  if (!catalog) return <p role="status">Loading complaint access…</p>;
  const subroute = route.slice("/complaints".length).replace(/^\//, "");
  const scope = subroute === "admin" || (!subroute && catalog.canAdmin) ? "admin" : subroute === "supervisor" ? "supervisor" : "mine";
  return <div className="complaint-module">
    <nav className="module-tabs" aria-label="Complaints navigation">
      {catalog.canSubmit && <Link href="/complaints/mine" aria-current={scope === "mine" && ["", "mine"].includes(subroute) ? "page" : undefined}>My Complaints</Link>}
      {catalog.canSubmit && <Link href="/complaints/new" aria-current={subroute === "new" ? "page" : undefined}>Submit Complaint</Link>}
      {catalog.canAdmin && <Link href="/complaints/admin" aria-current={scope === "admin" ? "page" : undefined}>Admin Review Queue</Link>}
      {catalog.canAdmin && <Link href="/complaints/assignments" aria-current={subroute === "assignments" ? "page" : undefined}>Supervisor Assignments</Link>}
      {!!catalog.supervisorGroups.length && <Link href="/complaints/supervisor" aria-current={scope === "supervisor" ? "page" : undefined}>Supervisor Work Queue</Link>}
    </nav>
    {subroute === "new" ? <ComplaintForm catalog={catalog} /> : subroute === "assignments" ? <SupervisorAssignments catalog={catalog} refresh={() => setRefresh(v => v + 1)} /> : subroute && !["mine", "admin", "supervisor"].includes(subroute) ? <ComplaintDetails id={subroute} catalog={catalog} /> : <Directory key={scope} scope={scope} catalog={catalog} />}
  </div>;
}
function Directory({ scope, catalog }: { scope: "mine" | "admin" | "supervisor"; catalog: Catalog }) {
  const [query, setQuery] = useState(""), [page, setPage] = useState(1), [refresh, setRefresh] = useState(0);
  const [data, setData] = useState<ComplaintList>(), [stats, setStats] = useState<Statistics>();
  const [error, setError] = useState(""), [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true; setLoading(true); setError("");
    Promise.all([api<ComplaintList>(`/complaints?scope=${scope}&page=${page}${query}`), scope === "admin" ? api<Statistics>("/complaints/statistics") : Promise.resolve(undefined)])
      .then(([d, s]) => { if (alive) { setData(d); setStats(s); } }).catch(e => { if (alive) setError(e.message); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [scope, page, query, refresh]);
  function filter(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = new FormData(e.currentTarget), q = new URLSearchParams();
    for (const name of ["status", "studentGroup", "supervisorId", "category", "location"]) if (f.get(name)) q.set(name, String(f.get(name)));
    if (f.get("from")) q.set("from", new Date(String(f.get("from")) + "T00:00:00+05:30").toISOString());
    if (f.get("to")) q.set("to", new Date(String(f.get("to")) + "T23:59:59.999+05:30").toISOString());
    setQuery("&" + q); setPage(1);
  }
  const title = scope === "admin" ? "Complaint review queue" : scope === "supervisor" ? "Supervisor work queue" : "My Complaints";
  return <>
    <div className="page-heading heading-with-action"><div><p className="eyebrow">CAMPUS SUPPORT</p><h1>{title}</h1><p>{scope === "admin" ? "Verify submissions, confirm routing and monitor outcomes." : scope === "supervisor" ? "Review your assigned cases and coordinate with the appropriate Block Warden." : "Track your submissions and share feedback after closure."}</p></div>{catalog.canSubmit && scope === "mine" && <Link href="/complaints/new" className="secondary-button">Submit complaint</Link>}</div>
    {stats && <div className="complaint-counts">{([["submitted", "Awaiting verification"], ["unassigned", "Accepted · unassigned"], ["pending", "Assigned · pending"], ["resolved", "Resolved"], ["rejected", "Rejected"]] as const).map(([key, label]) => <div className="panel" key={key}><strong>{stats[key]}</strong><span>{label}</span></div>)}</div>}
    <form className="panel complaint-filters" onSubmit={filter}>
      <label>Status<select name="status"><option value="">All statuses</option>{Object.entries(statusLabels).filter(([s]) => scope !== "supervisor" || ["ACCEPTED", "RESOLVED"].includes(s)).map(([s, label]) => <option key={s} value={s}>{label}</option>)}</select></label>
      <label>Student group<select name="studentGroup"><option value="">All groups</option>{catalog.groups.map(g => <option key={g} value={g}>{groupLabels[g]}</option>)}</select></label>
      {scope === "admin" && <label>Supervisor<select name="supervisorId"><option value="">All Supervisors</option>{catalog.candidates?.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>}
      <label>Category<select name="category"><option value="">All categories</option>{catalog.categories.map(c => <option key={c} value={c}>{categoryLabels[c]}</option>)}</select></label>
      <label>Location<input name="location" maxLength={200} /></label><label>Submitted from<input type="date" name="from" /></label><label>Submitted through<input type="date" name="to" /></label>
      <div className="button-row"><button className="secondary-button">Apply filters</button><button type="button" className="text-button" onClick={() => setRefresh(v => v + 1)}>Refresh</button></div>
    </form>
    {error && <p role="alert" className="notice error">{error}</p>}{loading ? <p role="status">Loading complaints…</p> : !error && <>
      <p className="muted">{data?.total ?? 0} complaint(s)</p>
      {!data?.complaints.length ? <section className="panel"><h2>No complaints to show</h2><p>New submissions or assigned cases will appear here. Try changing the filters.</p></section> : <div className="complaint-list">{data.complaints.map(c => <article className="panel complaint-card" key={c.id}>
        <div><p className="eyebrow">{categoryLabels[c.category]} · {c.location || "Location not supplied"}</p><h2><Link href={"/complaints/" + c.id}>{c.title}</Link></h2><p className="muted">{complaintDate(c.createdAt)}{c.submitter ? " · " + c.submitter.name : ""}</p><p>{c.stage}</p>
          {c.rejectionReason && <p className="complaint-snippet">Rejection reason: {c.rejectionReason}</p>}{c.resolutionDetails && <p className="complaint-snippet">Resolution: {c.resolutionDetails}</p>}
          {c.feedback !== undefined && <small>{c.feedback ? "Feedback submitted" : ["RESOLVED", "REJECTED"].includes(c.status) ? "Feedback available" : "Feedback available after closure"}</small>}</div>
        <div className="complaint-card-end"><span className={"status-tag " + (c.status === "RESOLVED" ? "active" : "")}>{statusLabels[c.status]}</span><small>{c.studentGroup ? groupLabels[c.studentGroup] + (c.routingConfirmed ? " · Confirmed" : " · Provisional") : "Manual routing / unconfirmed"}</small><Link href={"/complaints/" + c.id}>Open complaint →</Link></div>
      </article>)}</div>}
      {data && data.total > data.pageSize && <div className="button-row"><button className="secondary-button" disabled={page === 1} onClick={() => setPage(v => v - 1)}>Previous</button><span>Page {page} of {Math.ceil(data.total / data.pageSize)}</span><button className="secondary-button" disabled={page * data.pageSize >= data.total} onClick={() => setPage(v => v + 1)}>Next</button></div>}
    </>}
  </>;
}
