import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env", "../.env"], quiet: true });
import { createDatabase } from "../src/db.js";
import { hashPassword } from "../src/modules/auth/routes.js";
import type { Role } from "../src/generated/prisma/enums.js";

const databaseUrl = process.env.DATABASE_URL;
const password = process.env.DEMO_PASSWORD;
if (process.env.NODE_ENV === "production")
  throw new Error(
    "Demo seeding is disabled in production. Use the trusted Admin bootstrap command.",
  );
if (
  !databaseUrl ||
  !password ||
  password.length < 12 ||
  password.length > 128
) {
  throw new Error(
    "Seeding requires DATABASE_URL and DEMO_PASSWORD (12–128 characters)",
  );
}
const db = createDatabase(databaseUrl);
try {
  const passwordHash = await hashPassword(password);
  const demoUsers: {
    id: string;
    name: string;
    email: string;
    roles: Role[];
  }[] = [
    {
      id: "demo-student",
      name: "Asha Student",
      email: "student@campusone.example",
      roles: ["STUDENT"],
    },
    {
      id: "demo-staff",
      name: "Ravi Faculty",
      email: "staff@campusone.example",
      roles: ["STAFF"],
    },
    {
      id: "demo-club-head",
      name: "Meera Club Head",
      email: "clubhead@campusone.example",
      roles: ["STUDENT", "CLUB_HEAD"],
    },
    {
      id: "demo-admin",
      name: "Campus Admin",
      email: "admin@campusone.example",
      roles: ["STAFF", "ADMIN"],
    },
  ];
  await db.$transaction(async (tx) => {
    for (const user of demoUsers) {
      await tx.user.upsert({
        where: { email: user.email },
        // Reruns repair assignments without resetting changed passwords/roles.
        update: {},
        create: {
          ...user,
          passwordHash,
          department: "Computer Science",
          isDemo: true,
          emailVerifiedAt: new Date(),
        },
      });
    }
    const term = await tx.academicTerm.upsert({
      where: { name: "2026–2027" },
      create: { name: "2026–2027" },
      update: {},
    });
    const group = await tx.classGroup.upsert({
      where: { id: "demo-class" },
      update: { termId: term.id },
      create: {
        id: "demo-class",
        name: "BSc CS Year 2",
        section: "A",
        academicYear: "2026–2027",
        termId: term.id,
        department: "Computer Science",
        admissionBatch: "2025",
      },
    });
    const subject = await tx.subject.upsert({
      where: { code: "CS201" },
      update: {},
      create: {
        id: "demo-subject",
        code: "CS201",
        name: "Software Engineering",
      },
    });
    const offering = await tx.courseOffering.upsert({
      where: {
        classGroupId_subjectId: {
          classGroupId: group.id,
          subjectId: subject.id,
        },
      },
      update: {},
      create: {
        id: "demo-offering",
        classGroupId: group.id,
        subjectId: subject.id,
      },
    });
    const users = await tx.user.findMany({
      where: { email: { in: demoUsers.map((user) => user.email) } },
    });
    for (const user of users.filter((user) => user.roles.includes("STUDENT"))) {
      const registerNumber =
        user.email === "student@campusone.example"
          ? "3122255002062"
          : "3122255002304";
      const identity = await tx.studentIdentity.upsert({
        where: { userId: user.id },
        update: {},
        create: { userId: user.id, registerNumber, name: user.name },
      });
      if (!identity.registerNumber)
        await tx.studentIdentity.update({
          where: { id: identity.id },
          data: { registerNumber },
        });
      await tx.classEnrollment.upsert({
        where: {
          studentId_classGroupId: {
            studentId: identity.id,
            classGroupId: group.id,
          },
        },
        update: {},
        create: { studentId: identity.id, classGroupId: group.id },
      });
    }
    if (!group.registerPrefix)
      await tx.classGroup.update({
        where: { id: group.id },
        data: {
          registerPrefix: "3122255002",
          suffixWidth: 3,
          rosterVersion: { increment: 1 },
        },
      });
    if (!group.department || !group.admissionBatch)
      await tx.classGroup.update({
        where: { id: group.id },
        data: {
          ...(!group.department ? { department: "Computer Science" } : {}),
          ...(!group.admissionBatch ? { admissionBatch: "2025" } : {}),
        },
      });
    const staff = users.find(
      (user) => user.email === "staff@campusone.example",
    )!;
    await tx.teachingAssignment.upsert({
      where: {
        staffId_offeringId: { staffId: staff.id, offeringId: offering.id },
      },
      update: {},
      create: { staffId: staff.id, offeringId: offering.id },
    });
    const club = await tx.club.upsert({
      where: { name: "Coding Club" },
      update: {},
      create: { id: "demo-club", name: "Coding Club" },
    });
    const clubHead = users.find(
      (user) => user.email === "clubhead@campusone.example",
    )!;
    await tx.clubAssignment.upsert({
      where: { userId_clubId: { userId: clubHead.id, clubId: club.id } },
      update: {},
      create: { userId: clubHead.id, clubId: club.id },
    });
    await tx.imageBudget.upsert({
      where: { id: 1 },
      update: {},
      create: { id: 1 },
    });
  });
  console.log(
    "Demo accounts and class/club assignments seeded. Existing passwords and roles preserved.",
  );
} finally {
  await db.$disconnect();
}
