-- Keep the submitted membership size independent of later roster changes.
ALTER TABLE "AttendanceSession" ADD COLUMN "rosterSize" INTEGER NOT NULL DEFAULT 0;
UPDATE "AttendanceSession" s SET "rosterSize" = (SELECT count(*) FROM "AttendanceRecord" r WHERE r."sessionId" = s."id");
ALTER TABLE "AttendanceSession" ADD CONSTRAINT "AttendanceSession_rosterSize_check" CHECK ("rosterSize" >= 0);
