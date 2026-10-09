import { useEffect, useState, type FormEvent } from "react";
import { api, type User } from "../services/api";
import { Link } from "../components/Link";
import { EventPoster } from "../components/EventPoster";
import { EventDetails } from "./events/EventDetails";
import { EventForm } from "./events/EventForm";
import {
  eventDate,
  registrationLabel,
  type Catalog,
  type EventList,
  type Statistics,
} from "./events/types";
export function Events({ user, route }: { user: User; route: string }) {
  const manage = user.roles.some((r) => ["CLUB_HEAD", "ADMIN"].includes(r));
  const scope =
    route === "/events/manage"
      ? "manage"
      : route === "/events/registrations"
        ? "mine"
        : "browse";
  const subroute = route.slice(8);
  return (
    <>
      <nav className="module-tabs" aria-label="Events navigation">
        <Link
          href="/events"
          aria-current={route === "/events" ? "page" : undefined}
        >
          Browse events
        </Link>
        {user.roles.includes("STUDENT") && (
          <Link
            href="/events/registrations"
            aria-current={scope === "mine" ? "page" : undefined}
          >
            My registrations
          </Link>
        )}
        {manage && (
          <Link
            href="/events/manage"
            aria-current={scope === "manage" ? "page" : undefined}
          >
            {user.roles.includes("ADMIN")
              ? "Event supervision"
              : "My club events"}
          </Link>
        )}
      </nav>
      {subroute === "new" ? (
        <EventForm user={user} />
      ) : subroute.endsWith("/edit") ? (
        <EventForm user={user} id={subroute.slice(0, -5)} />
      ) : subroute && !["manage", "registrations"].includes(subroute) ? (
        <EventDetails user={user} id={subroute} />
      ) : (
        <Directory key={scope} user={user} scope={scope} />
      )}
    </>
  );
}
function Directory({
  user,
  scope,
}: {
  user: User;
  scope: "browse" | "mine" | "manage";
}) {
  const [catalog, setCatalog] = useState<Catalog>({
    clubs: [],
    authorizedClubs: [],
  });
  const [data, setData] = useState<EventList>();
  const [stats, setStats] = useState<Statistics>();
  const [group, setGroup] = useState(scope === "browse" ? "upcoming" : "all");
  const [club, setClub] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("asc");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let alive = true;
    api<Catalog>("/events/catalog")
      .then((c) => {
        if (alive) setCatalog(c);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      scope,
      group,
      q: query,
      sort,
      page: String(page),
    });
    if (club) params.set("clubId", club);
    if (status) params.set("status", status);
    Promise.all([
      api<EventList>("/events?" + params),
      scope === "manage"
        ? api<Statistics>("/events/statistics")
        : Promise.resolve(undefined),
    ])
      .then(([d, s]) => {
        if (alive) {
          setData(d);
          setStats(s);
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
  }, [scope, group, club, status, query, sort, page, refresh]);
  const change = (fn: () => void) => {
    fn();
    setPage(1);
  };
  function searchEvents(e: FormEvent) {
    e.preventDefault();
    change(() => setQuery(search));
  }
  return (
    <>
      <div className="page-heading events-heading">
        <div>
          <p className="eyebrow">CAMPUS LIFE · ASIA/KOLKATA</p>
          <h1>
            {scope === "browse"
              ? "Find your next campus experience."
              : scope === "mine"
                ? "My registrations"
                : user.roles.includes("ADMIN")
                  ? "Event supervision"
                  : "My club events"}
          </h1>
          <p>
            {scope === "browse"
              ? "Discover workshops, meet your community, and make room for something new."
              : scope === "mine"
                ? "Your registrations stay here, including past and cancelled events."
                : "Create club activities and review registrations. All times are displayed in IST."}
          </p>
        </div>
        {scope === "manage" && (
          <Link className="primary-button" href="/events/new">
            + Create event
          </Link>
        )}
      </div>
      {scope === "manage" && user.roles.includes("ADMIN") && (
        <p className="panel-footnote">
          <Link href="/approvals">Manage Club Head access →</Link>
        </p>
      )}
      {stats && (
        <>
          <div className="event-summary">
            <div>
              <strong>{stats.totalEvents}</strong>
              <span>Total events</span>
            </div>
            <div>
              <strong>{stats.upcomingEvents}</strong>
              <span>Upcoming published</span>
            </div>
            <div>
              <strong>{stats.pastEvents}</strong>
              <span>Past published</span>
            </div>
            <div>
              <strong>{stats.totalRegistrations}</strong>
              <span>Registrations</span>
            </div>
          </div>
          <details className="panel club-statistics">
            <summary>Registrations by club</summary>
            <p className="muted">
              Registration counts indicate sign-ups, not physical attendance.
            </p>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Club</th>
                    <th>Events</th>
                    <th>Upcoming</th>
                    <th>Past</th>
                    <th>Registrations</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.clubs.map((c) => (
                    <tr key={c.clubId}>
                      <td>{c.name}</td>
                      <td>{c.totalEvents}</td>
                      <td>{c.upcomingEvents}</td>
                      <td>{c.pastEvents}</td>
                      <td>{c.totalRegistrations}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
      <div className="event-group-tabs" role="group" aria-label="Event timing">
        {[
          ...(scope !== "browse" ? ["all"] : []),
          "upcoming",
          "ongoing",
          "past",
        ].map((g) => (
          <button
            key={g}
            aria-pressed={group === g}
            onClick={() => change(() => setGroup(g))}
          >
            {g === "all"
              ? "All events"
              : g.charAt(0).toUpperCase() + g.slice(1)}
          </button>
        ))}
      </div>
      <form className="event-filters" onSubmit={searchEvents}>
        <label className="search-field">
          Search events
          <div className="search-row">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Title or description"
              maxLength={120}
            />
            <button className="secondary-button">Search</button>
          </div>
        </label>
        <label>
          Club
          <select
            value={club}
            onChange={(e) => change(() => setClub(e.target.value))}
          >
            <option value="">All clubs</option>
            {(scope === "manage" ? catalog.authorizedClubs : catalog.clubs).map(
              (c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ),
            )}
          </select>
        </label>
        {scope === "manage" && (
          <label>
            Status
            <select
              value={status}
              onChange={(e) => change(() => setStatus(e.target.value))}
            >
              <option value="">All statuses</option>
              {["DRAFT", "PUBLISHED", "CANCELLED"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
        )}
        <label>
          Sort by date
          <select
            value={sort}
            onChange={(e) => change(() => setSort(e.target.value))}
          >
            <option value="asc">Earliest first</option>
            <option value="desc">Latest first</option>
          </select>
        </label>
      </form>
      {error ? (
        <div className="notice error" role="alert">
          {error}{" "}
          <button
            className="text-button"
            onClick={() => setRefresh((v) => v + 1)}
          >
            Try again
          </button>
        </div>
      ) : loading ? (
        <p role="status">Loading events…</p>
      ) : data?.events.length ? (
        <>
          <p className="event-result-count">
            {data.total} {data.total === 1 ? "event" : "events"} · Dates and
            times in IST
          </p>
          {scope === "manage" ? (
            <div className="panel table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>Club</th>
                    <th>Start (IST)</th>
                    <th>Status</th>
                    <th>Registrations</th>
                    <th>Manage</th>
                  </tr>
                </thead>
                <tbody>
                  {data.events.map((e) => (
                    <tr key={e.id}>
                      <td>
                        <Link href={"/events/" + e.id}>{e.name}</Link>
                      </td>
                      <td>{e.club.name}</td>
                      <td>{eventDate(e.startsAt)}</td>
                      <td>
                        <span className="status-tag">{e.status}</span>
                      </td>
                      <td>{e.registrationCount}</td>
                      <td>
                        <Link href={"/events/" + e.id}>View & manage →</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="events-grid">
              {data.events.map((e) => (
                <article className="event-card" key={e.id}>
                  <Link href={"/events/" + e.id} aria-label={"View " + e.name}>
                    <EventPoster
                      src={e.posterUrl ?? undefined}
                      title={e.name}
                    />
                  </Link>
                  <div className="event-card-body">
                    <p className="eyebrow">{e.club.name}</p>
                    <h2>
                      <Link href={"/events/" + e.id}>{e.name}</Link>
                    </h2>
                    <p className="event-card-time">{eventDate(e.startsAt)}</p>
                    <p className="muted">
                      {e.venue || "Venue to be announced"}
                    </p>
                    <div className="event-card-foot">
                      <span
                        className={
                          "status-tag " +
                          (e.registered || e.registrationOpen ? "active" : "")
                        }
                      >
                        {registrationLabel(e)}
                      </span>
                      <Link href={"/events/" + e.id}>Details →</Link>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
          <div className="pagination">
            <button
              className="secondary-button"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </button>
            <span>
              Page {page} of {Math.ceil(data.total / data.pageSize)}
            </span>
            <button
              className="secondary-button"
              disabled={page * data.pageSize >= data.total}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </>
      ) : (
        <section className="panel empty-state">
          <p className="eyebrow">
            {scope === "mine" ? "YOUR CAMPUS CALENDAR" : "ROOM FOR WHAT’S NEXT"}
          </p>
          <h2>
            {scope === "mine"
              ? "No registrations match these filters"
              : "No events match these filters"}
          </h2>
          <p>
            {scope === "manage"
              ? "Create a draft for an authorized club to get started."
              : "Try another club or time period, or check back when a club publishes an event."}
          </p>
          {scope === "mine" && <Link href="/events">Explore events →</Link>}
          {scope === "manage" && !catalog.authorizedClubs.length && (
            <p className="muted">
              You have no current club assignments. Contact an Admin for access.
            </p>
          )}
        </section>
      )}
    </>
  );
}
