import { useEffect, useState } from "react";
import { api, type User } from "../../services/api";
import { Link } from "../../components/Link";
import { EventPoster } from "../../components/EventPoster";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { eventDate, registrationLabel, type CampusEvent } from "./types";
type Participants = {
  total: number;
  page: number;
  pageSize: number;
  registrations: {
    id: string;
    createdAt: string;
    student: { name: string; email: string; department: string };
  }[];
};
export function EventDetails({ user, id }: { user: User; id: string }) {
  const [event, setEvent] = useState<CampusEvent>();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<"cancel" | "unpublish">();
  const [participants, setParticipants] = useState<Participants>();
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    api<CampusEvent>("/events/" + id)
      .then((e) => {
        if (alive) {
          setEvent(e);
          setError("");
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
  }, [id, refresh]);
  useEffect(() => {
    let alive = true;
    if (event?.canManage)
      api<Participants>("/events/" + id + "/registrations?page=" + page)
        .then((p) => {
          if (alive) setParticipants(p);
        })
        .catch((e) => {
          if (alive) setError(e.message);
        });
    return () => {
      alive = false;
    };
  }, [id, event?.version, event?.registrationCount, event?.canManage, page]);
  async function act(action: "publish" | "cancel" | "unpublish" | "register") {
    if (!event) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (action === "register") {
        await api("/events/" + id + "/register", {});
        setEvent(await api<CampusEvent>("/events/" + id));
        setMessage("You’re registered. Find this event in My registrations.");
      } else {
        await api("/events/" + id + "/action", {
          action,
          version: event.version,
        });
        setEvent(await api<CampusEvent>("/events/" + id));
        setMessage(
          action === "publish"
            ? "Event published."
            : action === "cancel"
              ? "Event cancelled. Registration history is retained."
              : "Event returned to draft.",
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setConfirmation(undefined);
    }
  }
  return (
    <>
      <Link className="back-link" href="/events">
        ← Browse events
      </Link>
      {error && (
        <p className="notice error" role="alert">
          {error}{" "}
          <button
            className="text-button"
            onClick={() => setRefresh((v) => v + 1)}
          >
            Reload event
          </button>
        </p>
      )}
      {message && (
        <p className="notice success" role="status">
          {message}
        </p>
      )}
      {loading ? (
        <p role="status">Loading event…</p>
      ) : (
        event && (
          <>
            <div className="event-details">
              <aside>
                <EventPoster
                  src={event.posterUrl ?? undefined}
                  title={event.name}
                />
              </aside>
              <section className="panel event-details-content">
                <p className="eyebrow">{event.club.name}</p>
                <h1>{event.name}</h1>
                <div className="role-tags">
                  <span>{event.status}</span>
                  <span>{registrationLabel(event)}</span>
                </div>
                <dl className="event-facts">
                  <div>
                    <dt>Starts</dt>
                    <dd>{eventDate(event.startsAt)}</dd>
                  </div>
                  {event.endsAt && (
                    <div>
                      <dt>Ends</dt>
                      <dd>{eventDate(event.endsAt)}</dd>
                    </div>
                  )}
                  <div>
                    <dt>Venue</dt>
                    <dd>{event.venue || "Not yet set"}</dd>
                  </div>
                  <div>
                    <dt>Registration deadline</dt>
                    <dd>
                      {event.registrationEndsAt
                        ? eventDate(event.registrationEndsAt)
                        : "Not yet set"}
                    </dd>
                  </div>
                </dl>
                <p className="muted">
                  All times use Asia/Kolkata (IST, UTC+05:30).
                </p>
                <h2>About the event</h2>
                <p className="event-description">
                  {event.description ||
                    "The organizer is preparing the event details."}
                </p>
                {event.status === "CANCELLED" && (
                  <p className="notice error">
                    This event has been cancelled. Existing registration records
                    are retained.
                  </p>
                )}
                {event.registered ? (
                  <div className="notice success" role="status">
                    <strong>Registered</strong>
                    <p>
                      {event.registeredAt &&
                        "Registered on " + eventDate(event.registeredAt)}
                    </p>
                    <Link href="/events/registrations">My registrations →</Link>
                  </div>
                ) : event.canRegister && event.status === "PUBLISHED" ? (
                  <button
                    className="primary-button"
                    disabled={busy || !event.registrationOpen}
                    onClick={() => act("register")}
                  >
                    {busy
                      ? "Registering…"
                      : event.registrationOpen
                        ? "Register for this event"
                        : "Registration closed"}
                  </button>
                ) : (
                  event.status === "PUBLISHED" && (
                    <p className="muted">
                      Approved Student access is required for registration.
                    </p>
                  )
                )}
                {event.registrationLink && (
                  <p className="external-event-link">
                    <a
                      href={event.registrationLink}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Additional event information ↗
                    </a>
                    <small>
                      External information supplements your CampusOne
                      registration.
                    </small>
                  </p>
                )}
                {event.canManage && (
                  <div className="event-management-actions">
                    <h2>Manage event</h2>
                    <p>
                      {event.registrationCount} registrations · Registration
                      does not confirm physical attendance.
                    </p>
                    <div className="button-row">
                      {event.status !== "CANCELLED" && (
                        <Link
                          href={"/events/" + id + "/edit"}
                          className="secondary-button"
                        >
                          Edit event & poster
                        </Link>
                      )}
                      {event.status === "DRAFT" && (
                        <button
                          className="primary-button"
                          disabled={busy}
                          onClick={() => act("publish")}
                        >
                          Publish event
                        </button>
                      )}
                      {event.status !== "CANCELLED" && (
                        <button
                          className="secondary-button"
                          disabled={busy}
                          onClick={() => setConfirmation("cancel")}
                        >
                          Cancel event
                        </button>
                      )}
                      {user.roles.includes("ADMIN") &&
                        event.status === "PUBLISHED" && (
                          <button
                            className="secondary-button"
                            disabled={busy}
                            onClick={() => setConfirmation("unpublish")}
                          >
                            Unpublish
                          </button>
                        )}
                    </div>
                  </div>
                )}
              </section>
            </div>
            {event.canManage && (
              <section className="panel participants-panel">
                <h2>Registrations</h2>
                <p className="muted">
                  Student details are visible only to authorized organizers and
                  Admins.
                </p>
                {!participants ? (
                  <p role="status">Loading registrations…</p>
                ) : participants.total ? (
                  <>
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Student</th>
                            <th>Email</th>
                            <th>Department</th>
                            <th>Registered (IST)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {participants.registrations.map((r) => (
                            <tr key={r.id}>
                              <td>{r.student.name}</td>
                              <td>{r.student.email}</td>
                              <td>{r.student.department || "—"}</td>
                              <td>{eventDate(r.createdAt)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="pagination">
                      <button
                        className="secondary-button"
                        disabled={page <= 1}
                        onClick={() => setPage((p) => p - 1)}
                      >
                        Previous
                      </button>
                      <span>
                        {participants.total} registrations · Page {page}
                      </span>
                      <button
                        className="secondary-button"
                        disabled={
                          page * participants.pageSize >= participants.total
                        }
                        onClick={() => setPage((p) => p + 1)}
                      >
                        Next
                      </button>
                    </div>
                  </>
                ) : (
                  <p>No registrations yet.</p>
                )}
              </section>
            )}
          </>
        )
      )}
      {confirmation && (
        <ConfirmDialog
          title={
            confirmation === "cancel"
              ? "Cancel this event?"
              : "Return this event to draft?"
          }
          description={
            confirmation === "cancel"
              ? "Registration will close. Existing registrations will remain in students’ history. This event cannot be reopened."
              : "The event will leave the student directory. Events with registrations must be cancelled instead."
          }
          busy={busy}
          onClose={() => setConfirmation(undefined)}
          onConfirm={() => act(confirmation)}
        />
      )}
    </>
  );
}
