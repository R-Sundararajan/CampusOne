export type Role = "STUDENT" | "STAFF" | "CLUB_HEAD" | "ADMIN";
export type User = {
  id: string;
  name: string;
  email: string;
  department: string;
  roles: Role[];
};
export type RoleRequest = {
  id: string;
  role: Role;
  status: "PENDING" | "APPROVED" | "REJECTED";
  reason: string | null;
  createdAt: string;
  user?: Pick<User, "id" | "name" | "email">;
};
export const roleLabel: Record<Role, string> = {
  STUDENT: "Student",
  STAFF: "Staff",
  CLUB_HEAD: "Club Head",
  ADMIN: "Admin",
};
export const sessionExpiredEvent = "campusone:session-expired";
export type ApiFieldError = { field: string; message: string };
export class ApiError extends Error {
  code?: string;
  details?: ApiFieldError[];

  constructor(message: string, code?: string, details?: ApiFieldError[]) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.details = details;
  }
}
export function apiErrorMessage(data: unknown, fallback = "Unable to connect. Please try again.") {
  if (typeof data !== "object" || data === null) return fallback;
  const value = data as { error?: unknown; details?: unknown };
  const message = typeof value.error === "string" ? value.error : fallback;
  const details = Array.isArray(value.details)
    ? value.details.filter((v: unknown): v is ApiFieldError =>
        typeof v === "object" && v !== null &&
        typeof (v as ApiFieldError).field === "string" &&
        typeof (v as ApiFieldError).message === "string",
      )
    : [];
  return details.length
    ? message + " " + details.map((v: ApiFieldError) => `${v.field}: ${v.message}`).join("; ")
    : message;
}
export async function api<T = void>(path: string, body?: unknown): Promise<T> {
  const response = await fetch("/api" + path, {
    credentials: "same-origin",
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 401 && path !== "/auth/login" && path !== "/auth/me")
    window.dispatchEvent(new Event(sessionExpiredEvent));
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const details = Array.isArray(data.details)
      ? data.details.filter((v: unknown): v is ApiFieldError =>
          typeof v === "object" && v !== null &&
          typeof (v as ApiFieldError).field === "string" &&
          typeof (v as ApiFieldError).message === "string",
        )
      : undefined;
    throw new ApiError(
      apiErrorMessage(data),
      typeof data.code === "string" ? data.code : undefined,
      details,
    );
  }
  return data as T;
}
