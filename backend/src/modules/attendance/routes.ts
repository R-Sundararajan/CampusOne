import { Router } from "express";
import type { z } from "zod";
import type { Config } from "../../config.js";
import type { AuthRepository } from "../auth/repository.js";
import { authentication, requireRoles } from "../auth/routes.js";
import { AccountError } from "../registration/service.js";
import { csv, type AttendanceService } from "./service.js";
import {
  assignmentSchema,
  classSchema,
  importSchema,
  linkSchema,
  membershipSchema,
  offeringSchema,
  previewSchema,
  reportSchema,
  rosterSchema,
  saveSchema,
  termSchema,
} from "./validation.js";

function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new AccountError(
      400,
      result.error.issues.map((i) => i.message).join(" "),
    );
  return result.data;
}
export function attendanceRoutes(
  service: AttendanceService,
  repo: AuthRepository,
  config: Config,
) {
  const router = Router();
  router.use(authentication(repo, config.jwtSecret));
  router.get("/student", requireRoles("STUDENT"), async (req, res) => {
    if (Object.keys(req.query).length)
      throw new AccountError(
        400,
        "Student attendance does not accept identity parameters.",
      );
    res.json(await service.student(req.user!));
  });
  router.use(requireRoles("STAFF", "ADMIN"));
  router.get("/catalog", async (req, res) =>
    res.json(await service.catalog(req.user!)),
  );
  router.get("/admin/staff", requireRoles("ADMIN"), async (req, res) =>
    res.json({ staff: await service.adminAccounts(req.user!) }),
  );
  router.post("/admin/terms", requireRoles("ADMIN"), async (req, res) =>
    res
      .status(201)
      .json(
        await service.createTerm(req.user!, parse(termSchema, req.body).name),
      ),
  );
  router.post("/admin/classes", requireRoles("ADMIN"), async (req, res) =>
    res
      .status(201)
      .json(await service.createClass(req.user!, parse(classSchema, req.body))),
  );
  router.post("/admin/offerings", requireRoles("ADMIN"), async (req, res) =>
    res
      .status(201)
      .json(
        await service.createOffering(
          req.user!,
          parse(offeringSchema, req.body),
        ),
      ),
  );
  router.post("/admin/assignments", requireRoles("ADMIN"), async (req, res) => {
    await service.assign(req.user!, parse(assignmentSchema, req.body));
    res.status(204).end();
  });
  router.post("/admin/link", requireRoles("ADMIN"), async (req, res) => {
    await service.link(req.user!, parse(linkSchema, req.body));
    res.status(204).end();
  });
  router.get("/rosters/:id", async (req, res) =>
    res.json(await service.roster(req.user!, String(req.params.id))),
  );
  router.post("/rosters/preview", async (req, res) =>
    res.json(
      await service.rosterPreview(req.user!, parse(rosterSchema, req.body)),
    ),
  );
  router.post("/rosters/import", async (req, res) =>
    res
      .status(201)
      .json(
        await service.importRoster(req.user!, parse(importSchema, req.body)),
      ),
  );
  router.post("/rosters/:id/membership", async (req, res) => {
    await service.membership(
      req.user!,
      String(req.params.id),
      parse(membershipSchema, req.body),
    );
    res.status(204).end();
  });
  router.post("/preview", requireRoles("STAFF"), async (req, res) =>
    res.json(await service.preview(req.user!, parse(previewSchema, req.body))),
  );
  router.post("/sessions", requireRoles("STAFF"), async (req, res) =>
    res
      .status(200)
      .json(await service.save(req.user!, parse(saveSchema, req.body))),
  );
  router.get("/sessions/:id/audits", async (req, res) =>
    res.json({
      audits: await service.audits(req.user!, String(req.params.id)),
    }),
  );
  router.get("/reports", async (req, res) =>
    res.json(await service.reports(req.user!, parse(reportSchema, req.query))),
  );
  router.get("/reports.csv", async (req, res) => {
    const report = await service.reports(
      req.user!,
      parse(reportSchema, req.query),
    );
    const rows = report.records.map((r) => {
      const offering = report.offerings.find((o) => o.id === r.offeringId)!;
      return [
        offering.classGroup.academicYear,
        offering.classGroup.department,
        offering.classGroup.name,
        offering.classGroup.section,
        offering.subject.code,
        offering.subject.name,
        r.date,
        r.period,
        r.registerNumber,
        r.name,
        r.status,
      ];
    });
    res
      .set("Content-Type", "text/csv; charset=utf-8")
      .set(
        "Content-Disposition",
        'attachment; filename="campusone-attendance.csv"',
      )
      .send(
        csv([
          [
            "Term",
            "Department",
            "Class",
            "Section",
            "Subject code",
            "Subject",
            "Date",
            "Period",
            "Register number",
            "Name",
            "Status",
          ],
          ...rows,
        ]),
      );
  });
  return router;
}
