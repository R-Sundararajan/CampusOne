CREATE TYPE "RequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
ALTER TABLE "User"
  ADD COLUMN "emailVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "requestedAccountType" "Role" NOT NULL DEFAULT 'STUDENT';
-- Pending accounts intentionally hold no roles. Authentication also requires verification.
ALTER TABLE "User" DROP CONSTRAINT "User_roles_nonempty";
ALTER TABLE "User" ADD CONSTRAINT "User_email_normalized" CHECK ("email" = lower(btrim("email")));
-- Only the four known synthetic seeds are grandfathered. Other accounts fail closed.
UPDATE "User" SET "isDemo" = true, "emailVerifiedAt" = "createdAt"
WHERE "email" IN ('student@campusone.example', 'staff@campusone.example', 'clubhead@campusone.example', 'admin@campusone.example');
CREATE TABLE "EmailVerification" (
  "userId" TEXT NOT NULL PRIMARY KEY,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmailVerification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "EmailVerification_tokenHash_key" ON "EmailVerification"("tokenHash");
CREATE TABLE "RoleRequest" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "role" "Role" NOT NULL,
  "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
  "reason" TEXT,
  "reviewedById" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RoleRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RoleRequest_requestable_role" CHECK ("role" IN ('STAFF', 'CLUB_HEAD')),
  CONSTRAINT "RoleRequest_rejection_reason" CHECK ("status" <> 'REJECTED' OR length(btrim("reason")) > 0 AND "reason" IS NOT NULL)
);
CREATE UNIQUE INDEX "RoleRequest_userId_role_key" ON "RoleRequest"("userId", "role");
CREATE INDEX "RoleRequest_status_createdAt_idx" ON "RoleRequest"("status", "createdAt");
