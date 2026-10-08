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
export async function api<T = void>(path: string, body?: unknown): Promise<T> {
  const response = await fetch("/api" + path, {
    credentials: "same-origin",
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(data.error ?? "Unable to connect. Please try again.");
  return data as T;
}
