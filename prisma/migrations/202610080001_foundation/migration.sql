-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('STUDENT', 'STAFF', 'CLUB_HEAD', 'ADMIN');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('PUBLISHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ComplaintStatus" AS ENUM ('SUBMITTED', 'ACCEPTED', 'RESOLVED', 'REJECTED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "roles" "Role"[],
    "department" TEXT NOT NULL,
    "phone" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "academicYear" TEXT NOT NULL,

    CONSTRAINT "ClassGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subject" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Subject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseOffering" (
    "id" TEXT NOT NULL,
    "classGroupId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,

    CONSTRAINT "CourseOffering_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Enrollment" (
    "studentId" TEXT NOT NULL,
    "offeringId" TEXT NOT NULL,

    CONSTRAINT "Enrollment_pkey" PRIMARY KEY ("studentId","offeringId")
);

-- CreateTable
CREATE TABLE "TeachingAssignment" (
    "staffId" TEXT NOT NULL,
    "offeringId" TEXT NOT NULL,

    CONSTRAINT "TeachingAssignment_pkey" PRIMARY KEY ("staffId","offeringId")
);

-- CreateTable
CREATE TABLE "AttendanceSession" (
    "id" TEXT NOT NULL,
    "offeringId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "period" INTEGER NOT NULL,
    "markedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceRecord" (
    "sessionId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "status" "AttendanceStatus" NOT NULL,

    CONSTRAINT "AttendanceRecord_pkey" PRIMARY KEY ("sessionId","studentId")
);

-- CreateTable
CREATE TABLE "Club" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Club_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClubAssignment" (
    "userId" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,

    CONSTRAINT "ClubAssignment_pkey" PRIMARY KEY ("userId","clubId")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "venue" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "registrationEndsAt" TIMESTAMP(3) NOT NULL,
    "registrationLink" TEXT,
    "status" "EventStatus" NOT NULL DEFAULT 'PUBLISHED',
    "clubId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventRegistration" (
    "eventId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventRegistration_pkey" PRIMARY KEY ("eventId","studentId")
);

-- CreateTable
CREATE TABLE "Complaint" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "submitterId" TEXT NOT NULL,
    "status" "ComplaintStatus" NOT NULL DEFAULT 'SUBMITTED',
    "adminResponse" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionDetails" TEXT,
    "feedback" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Complaint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Image" (
    "id" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "bytes" BYTEA,
    "objectKey" TEXT,
    "eventId" TEXT,
    "complaintId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Image_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImageBudget" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "usedBytes" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ImageBudget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "ClassGroup_name_section_academicYear_key" ON "ClassGroup"("name", "section", "academicYear");

-- CreateIndex
CREATE UNIQUE INDEX "Subject_code_key" ON "Subject"("code");

-- CreateIndex
CREATE UNIQUE INDEX "CourseOffering_classGroupId_subjectId_key" ON "CourseOffering"("classGroupId", "subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceSession_offeringId_date_period_key" ON "AttendanceSession"("offeringId", "date", "period");

-- CreateIndex
CREATE INDEX "AttendanceRecord_studentId_idx" ON "AttendanceRecord"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "Club_name_key" ON "Club"("name");

-- CreateIndex
CREATE INDEX "Event_clubId_startsAt_idx" ON "Event"("clubId", "startsAt");

-- CreateIndex
CREATE INDEX "Complaint_submitterId_createdAt_idx" ON "Complaint"("submitterId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Image_eventId_key" ON "Image"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "Image_complaintId_key" ON "Image"("complaintId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_createdAt_idx" ON "AuditLog"("entityType", "entityId", "createdAt");

-- AddForeignKey
ALTER TABLE "CourseOffering" ADD CONSTRAINT "CourseOffering_classGroupId_fkey" FOREIGN KEY ("classGroupId") REFERENCES "ClassGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseOffering" ADD CONSTRAINT "CourseOffering_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "CourseOffering"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeachingAssignment" ADD CONSTRAINT "TeachingAssignment_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeachingAssignment" ADD CONSTRAINT "TeachingAssignment_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "CourseOffering"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceSession" ADD CONSTRAINT "AttendanceSession_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "CourseOffering"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceSession" ADD CONSTRAINT "AttendanceSession_markedById_fkey" FOREIGN KEY ("markedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AttendanceSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubAssignment" ADD CONSTRAINT "ClubAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubAssignment" ADD CONSTRAINT "ClubAssignment_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventRegistration" ADD CONSTRAINT "EventRegistration_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventRegistration" ADD CONSTRAINT "EventRegistration_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_submitterId_fkey" FOREIGN KEY ("submitterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Image" ADD CONSTRAINT "Image_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Image" ADD CONSTRAINT "Image_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "Complaint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Domain checks that Prisma's schema language cannot express.
ALTER TABLE "User" ADD CONSTRAINT "User_roles_nonempty" CHECK (cardinality("roles") > 0);
ALTER TABLE "AttendanceSession" ADD CONSTRAINT "AttendanceSession_positive_period" CHECK ("period" > 0);
ALTER TABLE "Image" ADD CONSTRAINT "Image_one_parent" CHECK (num_nonnulls("eventId", "complaintId") = 1);
ALTER TABLE "Image" ADD CONSTRAINT "Image_one_storage_source" CHECK (num_nonnulls("bytes", "objectKey") = 1);
ALTER TABLE "Image" ADD CONSTRAINT "Image_size_limit" CHECK ("sizeBytes" > 0 AND "sizeBytes" <= 2097152);
ALTER TABLE "Image" ADD CONSTRAINT "Image_mime_type" CHECK ("mimeType" IN ('image/jpeg', 'image/png'));
ALTER TABLE "Image" ADD CONSTRAINT "Image_byte_length" CHECK ("bytes" IS NULL OR octet_length("bytes") = "sizeBytes");
ALTER TABLE "ImageBudget" ADD CONSTRAINT "ImageBudget_singleton" CHECK ("id" = 1);
ALTER TABLE "ImageBudget" ADD CONSTRAINT "ImageBudget_limit" CHECK ("usedBytes" >= 0 AND "usedBytes" <= 52428800);
