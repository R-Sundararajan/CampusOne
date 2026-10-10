CREATE TYPE "ComplaintStudentGroup" AS ENUM ('UG_I', 'UG_II', 'UG_III', 'UG_IV', 'PG');
ALTER TABLE "Complaint"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "studentGroup" "ComplaintStudentGroup",
  ADD COLUMN "routingConfirmed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "routingSource" TEXT NOT NULL DEFAULT 'PROVISIONAL',
  ADD COLUMN "category" TEXT NOT NULL DEFAULT 'OTHER',
  ADD COLUMN "location" TEXT,
  ADD COLUMN "verifiedById" TEXT,
  ADD COLUMN "verifiedAt" TIMESTAMP(3),
  ADD COLUMN "rejectionReason" TEXT,
  ADD COLUMN "supervisorId" TEXT,
  ADD COLUMN "supervisorGroup" "ComplaintStudentGroup",
  ADD COLUMN "assignedAt" TIMESTAMP(3),
  ADD COLUMN "coordinationStartedAt" TIMESTAMP(3),
  ADD COLUMN "feedbackAt" TIMESTAMP(3);
-- Preserve preliminary outcomes; legacy records have no invented actor or routing evidence.
UPDATE "Complaint" SET "rejectionReason" = "adminResponse" WHERE "status" = 'REJECTED';
UPDATE "Complaint" SET "routingSource" = 'LEGACY';
CREATE TABLE "ComplaintSupervisorAssignment" (
  "studentGroup" "ComplaintStudentGroup" PRIMARY KEY,
  "userId" TEXT,
  "assignedById" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "ComplaintSupervisorAssignment" ("studentGroup") VALUES ('UG_I'), ('UG_II'), ('UG_III'), ('UG_IV'), ('PG');
CREATE INDEX "ComplaintSupervisorAssignment_userId_idx" ON "ComplaintSupervisorAssignment"("userId");
CREATE TABLE "ComplaintNote" (
  "id" TEXT PRIMARY KEY,
  "complaintId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "text" TEXT NOT NULL CHECK (length(trim("text")) > 0),
  "wardenContact" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("complaintId") REFERENCES "Complaint"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "ComplaintNote_complaintId_createdAt_idx" ON "ComplaintNote"("complaintId", "createdAt");
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_version_positive" CHECK ("version" > 0);
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_assignment_consistent" CHECK ("supervisorId" IS NULL OR ("supervisorGroup" IS NOT NULL AND "assignedAt" IS NOT NULL));
CREATE INDEX "Complaint_status_createdAt_idx" ON "Complaint"("status", "createdAt");
CREATE INDEX "Complaint_supervisorId_status_idx" ON "Complaint"("supervisorId", "status");
