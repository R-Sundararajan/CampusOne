import { useEffect, useState, type FormEvent } from "react";
import { api } from "../../services/api";
import { navigate } from "../../hooks/useRoute";
import { Link } from "../../components/Link";
import { categoryLabels, groupLabels, uploadImage, type Catalog, type Complaint } from "./types";
export function ComplaintForm({ catalog }: { catalog: Catalog }) {
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState("");
  const [saved, setSaved] = useState<Complaint>();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    if (!file) { setPreview(""); return; }
    const url = URL.createObjectURL(file); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError(""); setBusy(true);
    const f = new FormData(e.currentTarget);
    const title = String(f.get("title") ?? "").trim();
    const description = String(f.get("description") ?? "").trim();
    try {
      if (!saved && (title.length < 1 || title.length > 160)) throw new Error("Enter a title of 1–160 non-whitespace characters.");
      if (!saved && (description.length < 1 || description.length > 6000)) throw new Error("Enter a description of 1–6000 non-whitespace characters.");
      if (file && (!["image/jpeg", "image/png"].includes(file.type) || file.size > 2 * 1024 * 1024)) throw new Error("Choose a JPEG/PNG image no larger than 2 MiB.");
      const c = saved ?? await api<Complaint>("/complaints", { title, description, category: f.get("category"), location: f.get("location"), studentGroup: catalog.provisionalSelectionAllowed ? f.get("studentGroup") || null : null });
      setSaved(c);
      if (file) await uploadImage(c, file);
      navigate("/complaints/" + c.id);
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }
  if (!catalog.canSubmit) return <p className="notice error" role="alert">Student or approved Staff access is required to submit a complaint.</p>;
  return <>
    <div className="page-heading"><p className="eyebrow">CAMPUS SUPPORT</p><h1>Submit a complaint</h1><p>Describe the issue so the responsible team can review it.</p></div>
    <form className="panel complaint-form" onSubmit={submit}>
      {error && <p role="alert" className="notice error">{error}</p>}
      {saved && <p role="status" className="notice">Complaint {saved.id} is saved as Submitted. The image could not be attached. Retry below or <Link href={"/complaints/" + saved.id}>open the saved complaint</Link>.</p>}
      <fieldset disabled={busy || !!saved}><legend>Complaint details</legend>
        <label>Title<input name="title" required maxLength={160} /></label>
        <label>Detailed description<textarea name="description" required maxLength={6000} rows={6} /></label>
        <div className="form-grid"><label>Category<select name="category" defaultValue="OTHER">{catalog.categories.map(c => <option key={c} value={c}>{categoryLabels[c]}</option>)}</select></label>
          <label>Location / hostel block<input name="location" maxLength={200} /><small>Use the actual campus location. No block names are assumed.</small></label></div>
        {catalog.provisionalSelectionAllowed ? <label>Provisional student group<select name="studentGroup" defaultValue=""><option value="">Not sure / Admin to confirm</option>{catalog.groups.map(g => <option key={g} value={g}>{groupLabels[g]}</option>)}</select><small>Your selection requires Admin confirmation before assignment.</small></label> : <p className="muted">Staff complaints require manual routing by Admin.</p>}
      </fieldset>
      <label>Optional image<input type="file" accept="image/jpeg,image/png" disabled={busy} onChange={e => setFile(e.target.files?.[0])} /><small>One JPEG or PNG, up to 2 MiB. Visible only to you, Admin and the authorized assigned Supervisor.</small></label>
      {preview && <img className="complaint-image" src={preview} alt="Selected complaint attachment preview" />}
      <div className="button-row"><button className="primary-button" disabled={busy}>{busy ? "Saving…" : saved ? "Retry attachment" : "Submit complaint"}</button><Link href="/complaints" className="secondary-button">Back to complaints</Link></div>
    </form>
  </>;
}
