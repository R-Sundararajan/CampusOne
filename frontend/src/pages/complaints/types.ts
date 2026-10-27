import { apiErrorMessage } from "../../services/api";

export const groupLabels: Record<string, string> = { UG_I: "UG Year I", UG_II: "UG Year II", UG_III: "UG Year III", UG_IV: "UG Year IV", PG: "PG Students" };
export const categoryLabels: Record<string, string> = { FACILITIES: "Facilities", HOSTEL: "Hostel", SANITATION: "Sanitation", SAFETY: "Safety", OTHER: "Other" };
export const statusLabels: Record<string, string> = { SUBMITTED: "Submitted", ACCEPTED: "Accepted", RESOLVED: "Resolved", REJECTED: "Rejected" };
export type Person = { id: string; name: string; email: string; department?: string };
export type Assignment = { studentGroup: string; userId: string | null; user: Person | null; version: number; eligible: boolean };
export type Catalog = { institutionalAuthMode?: string; groups: string[]; categories: string[]; canSubmit: boolean; canAdmin: boolean; supervisorGroups: string[]; provisionalSelectionAllowed: boolean; routingExplanation: string; assignments?: Assignment[]; candidates?: Person[] };
export type Complaint = {
  id: string; title: string; description: string; status: string; version: number; stage: string;
  studentGroup: string | null; routingConfirmed: boolean; routingSource: string; category: string; location: string | null;
  verifiedAt: string | null; assignedAt: string | null; resolvedAt: string | null; createdAt: string;
  supervisorGroup: string | null; supervisorId?: string | null; supervisor?: { id: string; name: string } | null;
  submitter?: Person; rejectionReason: string | null; resolutionDetails: string | null; adminResponse: string | null;
  feedback?: string | null; feedbackAt?: string | null; imageUrl: string | null;
  canReview: boolean; canReassign: boolean; canProcess: boolean; canFeedback: boolean; canUpload: boolean;
  internalNotes?: { id: string; text: string; wardenContact: string | null; createdAt: string; author: { name: string } }[];
  history?: { id: string; action: string; createdAt: string; actor?: { name: string }; changes?: { reason?: string; supervisorGroup?: string } }[];
};
export type ComplaintList = { complaints: Complaint[]; total: number; page: number; pageSize: number };
export type Statistics = { submitted: number; unassigned: number; pending: number; resolved: number; rejected: number };
export function complaintDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(value)) + " IST";
}
export async function uploadImage(c: Complaint, file: File) {
  if (!["image/jpeg", "image/png"].includes(file.type) || !/\.(png|jpe?g)$/i.test(file.name)) throw new Error("Choose a JPEG or PNG image.");
  if (file.size > 2 * 1024 * 1024) throw new Error("Images must be at most 2 MiB.");
  const response = await fetch(`/api/complaints/${c.id}/image?version=${c.version}`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": file.type, "X-Image-Filename": encodeURIComponent(file.name) }, body: file });
  const data = await response.json();
  if (!response.ok) throw new Error(apiErrorMessage(data, "Image upload failed."));
  return data as Complaint;
}
