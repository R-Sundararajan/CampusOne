export type Club = { id: string; name: string };
export type CampusEvent = {
  id: string;
  name: string;
  description: string;
  venue: string;
  clubId: string;
  club: Club;
  creatorId: string;
  startsAt: string | null;
  endsAt: string | null;
  registrationEndsAt: string | null;
  registrationLink: string | null;
  status: "DRAFT" | "PUBLISHED" | "CANCELLED";
  version: number;
  posterUrl: string | null;
  registrationCount: number;
  registered: boolean;
  registrationOpen: boolean;
  group: string;
  canManage?: boolean;
  canRegister?: boolean;
  registeredAt: string | null;
};
export type Catalog = { clubs: Club[]; authorizedClubs: Club[] };
export type EventList = {
  events: CampusEvent[];
  total: number;
  page: number;
  pageSize: number;
};
export type Statistics = {
  totalEvents: number;
  upcomingEvents: number;
  pastEvents: number;
  totalRegistrations: number;
  clubs: (Club & {
    clubId: string;
    totalEvents: number;
    upcomingEvents: number;
    pastEvents: number;
    totalRegistrations: number;
  })[];
};
export function eventDate(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Kolkata",
      }).format(new Date(value)) + " IST"
    : "Schedule to be announced";
}
export function localDate(value: string | null) {
  return value
    ? new Date(new Date(value).getTime() + 330 * 60000)
        .toISOString()
        .slice(0, 16)
    : "";
}
export function utcDate(value: FormDataEntryValue | null) {
  return value ? new Date(String(value) + ":00+05:30").toISOString() : null;
}
export function registrationLabel(e: CampusEvent) {
  return e.status === "CANCELLED"
    ? "Event cancelled"
    : e.registered
      ? "Registered"
      : e.status === "DRAFT"
        ? "Draft"
        : e.registrationOpen
          ? "Registration open"
          : "Registration closed";
}
