import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, apiErrorMessage, type User } from "../../services/api";
import { navigate } from "../../hooks/useRoute";
import { Link } from "../../components/Link";
import { EventPoster } from "../../components/EventPoster";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { localDate, utcDate, type CampusEvent, type Catalog } from "./types";
export function EventForm({ user, id }: { user: User; id?: string }) {
  const [catalog, setCatalog] = useState<Catalog>();
  const [current, setCurrent] = useState<CampusEvent>();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [file, setFile] = useState<File>();
  const fileInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string>();
  const [remove, setRemove] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  useEffect(() => {
    let alive = true;
    Promise.all([
      api<Catalog>("/events/catalog"),
      id ? api<CampusEvent>("/events/" + id) : Promise.resolve(undefined),
    ])
      .then(([c, e]) => {
        if (alive) {
          setCatalog(c);
          setCurrent(e);
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [id]);
  useEffect(() => {
    if (!file) {
      setPreview(undefined);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const allowed =
    user.roles.some((r) => ["CLUB_HEAD", "ADMIN"].includes(r)) &&
    (!current || current.canManage) &&
    current?.status !== "CANCELLED";
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!catalog) return;
    setBusy(true);
    setError("");
    setMessage("");
    const f = new FormData(e.currentTarget);
    const publish =
      (e.nativeEvent as SubmitEvent).submitter?.getAttribute("value") ===
      "publish";
    const fields = {
      name: String(f.get("name") ?? ""),
      description: String(f.get("description") ?? ""),
      venue: String(f.get("venue") ?? ""),
      startsAt: utcDate(f.get("startsAt")),
      endsAt: utcDate(f.get("endsAt")),
      registrationEndsAt: utcDate(f.get("registrationEndsAt")),
      registrationLink: String(f.get("registrationLink") ?? "").trim() || null,
    };
    let saved = current;
    let detailsSaved = false;
    try {
      const start = fields.startsAt ? new Date(fields.startsAt) : null;
      const end = fields.endsAt ? new Date(fields.endsAt) : null;
      const registrationDeadline = fields.registrationEndsAt
        ? new Date(fields.registrationEndsAt)
        : null;
      if (end && (!start || end <= start))
        throw new Error("End time must follow the start time.");
      if (registrationDeadline && (!start || registrationDeadline > start))
        throw new Error("Registration deadline must be on or before the start time.");
      if (publish) {
        if (!fields.description.trim() || !fields.venue.trim() || !start || !registrationDeadline)
          throw new Error("Publishing requires a description, venue, start time and registration deadline.");
        if (start <= new Date() || registrationDeadline <= new Date())
          throw new Error("Publish with a future start and an open registration deadline.");
      }
      saved = await api<CampusEvent>(
        saved ? "/events/" + saved.id + "/edit" : "/events",
        saved
          ? { ...fields, version: saved.version }
          : { ...fields, clubId: String(f.get("clubId") ?? "") },
      );
      detailsSaved = true;
      setCurrent({ ...saved, canManage: true });
      if (file) {
        const response = await fetch(
          "/api/events/" + saved.id + "/poster?version=" + saved.version,
          {
            method: "POST",
            credentials: "same-origin",
            headers: {
              "Content-Type": file.type,
              "X-Image-Filename": encodeURIComponent(file.name),
            },
            body: file,
          },
        );
        const result = await response.json();
        if (!response.ok)
          throw new Error(apiErrorMessage(result, "Poster upload failed."));
        saved = result as CampusEvent;
        setCurrent({ ...saved, canManage: true });
        setFile(undefined);
      } else if (remove && saved.posterUrl) {
        saved = await api<CampusEvent>(
          "/events/" + saved.id + "/poster/remove",
          { version: saved.version },
        );
        setCurrent({ ...saved, canManage: true });
        setRemove(false);
      }
      if (publish && saved.status === "DRAFT") {
        saved = await api<CampusEvent>("/events/" + saved.id + "/action", {
          action: "publish",
          version: saved.version,
        });
        setCurrent({ ...saved, canManage: true });
      }
      navigate("/events/" + saved.id);
    } catch (err) {
      setError((err as Error).message);
      if (detailsSaved)
        setMessage(
          "Event details were saved. Resolve the error before continuing; your current draft is preserved.",
        );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Link
        className="back-link"
        href={current ? "/events/" + current.id : "/events/manage"}
      >
        ← Back to {current ? "event" : "my club events"}
      </Link>
      <div className="page-heading">
        <p className="eyebrow">CLUB ACTIVITIES</p>
        <h1>{id ? "Edit event" : "Create an event"}</h1>
        <p>
          Save a draft while you plan. Add the complete schedule and venue
          before publishing.
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
        <p role="status">Loading event editor…</p>
      ) : !allowed ? (
        <p className="notice error">
          You do not have access to edit this event.
        </p>
      ) : !catalog?.authorizedClubs.length ? (
        <section className="panel empty-state">
          <h2>No authorized clubs</h2>
          <p>
            An Admin must assign you to a club before you can create an event.
          </p>
        </section>
      ) : (
        <form className="event-editor" onSubmit={save}>
          <section className="panel">
            <h2>Event details</h2>
            <label>
              Event name
              <input
                name="name"
                required
                maxLength={160}
                defaultValue={current?.name}
              />
            </label>
            <label>
              Organizing club
              <select
                name="clubId"
                required
                disabled={!!current}
                defaultValue={current?.clubId ?? ""}
              >
                <option value="">Select your club</option>
                {catalog.authorizedClubs.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <small>The owning club stays fixed after creation.</small>
            </label>
            <label>
              Description
              <textarea
                name="description"
                rows={6}
                maxLength={10000}
                defaultValue={current?.description}
              />
            </label>
            <label>
              Venue
              <input
                name="venue"
                maxLength={200}
                defaultValue={current?.venue}
              />
            </label>
            <fieldset>
              <legend>Schedule · Asia/Kolkata (IST, UTC+05:30)</legend>
              <div className="event-form-dates">
                <label>
                  Start date & time
                  <input
                    type="datetime-local"
                    name="startsAt"
                    defaultValue={localDate(current?.startsAt ?? null)}
                  />
                </label>
                <label>
                  End date & time (optional)
                  <input
                    type="datetime-local"
                    name="endsAt"
                    defaultValue={localDate(current?.endsAt ?? null)}
                  />
                </label>
                <label>
                  Registration deadline
                  <input
                    type="datetime-local"
                    name="registrationEndsAt"
                    defaultValue={localDate(
                      current?.registrationEndsAt ?? null,
                    )}
                  />
                </label>
              </div>
            </fieldset>
            <label>
              External information link (optional)
              <input
                name="registrationLink"
                type="url"
                maxLength={2000}
                defaultValue={current?.registrationLink ?? ""}
              />
              <small>Students register internally through CampusOne.</small>
            </label>
            <div className="button-row">
              <button
                className="secondary-button"
                disabled={busy}
                type="submit"
                value="save"
              >
                {busy
                  ? "Saving…"
                  : current?.status === "PUBLISHED"
                    ? "Save changes"
                    : "Save draft"}
              </button>
              {current?.status !== "PUBLISHED" && (
                <button
                  className="primary-button"
                  disabled={busy}
                  type="submit"
                  value="publish"
                >
                  Save & publish
                </button>
              )}
            </div>
          </section>
          <aside className="panel event-poster-editor">
            <h2>Event poster</h2>
            <EventPoster
              src={
                preview ??
                (!remove ? (current?.posterUrl ?? undefined) : undefined)
              }
              title={current?.name ?? "Your event"}
            />
            <label>
              Upload or replace poster
              <input
                type="file"
                ref={fileInput}
                accept="image/png,image/jpeg,.jpg,.jpeg,.png"
                disabled={busy}
                onChange={(e) => {
                  const selected = e.target.files?.[0];
                  if (
                    selected &&
                    (!["image/png", "image/jpeg"].includes(selected.type) ||
                      selected.size > 2 * 1024 * 1024)
                  ) {
                    setError("Choose a JPEG or PNG of at most 2 MiB.");
                    e.target.value = "";
                    return;
                  }
                  setError("");
                  setFile(selected);
                  setRemove(false);
                }}
              />
              <small>
                JPEG or PNG · Maximum 2 MiB. The complete poster is preserved.
              </small>
            </label>
            {file && (
              <button
                className="text-button"
                type="button"
                onClick={() => {
                  setFile(undefined);
                  if (fileInput.current) fileInput.current.value = "";
                }}
                disabled={busy}
              >
                Clear selected poster
              </button>
            )}
            {current?.posterUrl && !remove && (
              <button
                className="text-button"
                type="button"
                disabled={busy}
                onClick={() => setConfirmRemove(true)}
              >
                Remove existing poster
              </button>
            )}
            {remove && (
              <p role="status">
                Poster will be removed when you save.{" "}
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setRemove(false)}
                >
                  Undo
                </button>
              </p>
            )}
            <p className="panel-footnote">
              Drafts are visible only to authorized club organizers and Admins.
            </p>
          </aside>
        </form>
      )}
      {confirmRemove && (
        <ConfirmDialog
          title="Remove this poster?"
          description="The poster will be removed when you save the event. You can upload a replacement later."
          busy={busy}
          onClose={() => setConfirmRemove(false)}
          onConfirm={() => {
            setRemove(true);
            setFile(undefined);
            if (fileInput.current) fileInput.current.value = "";
            setConfirmRemove(false);
          }}
        />
      )}
    </>
  );
}
