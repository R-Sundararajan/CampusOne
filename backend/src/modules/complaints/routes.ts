import { Router, raw } from "express";
import type { Config } from "../../config.js";
import type { AuthRepository } from "../auth/repository.js";
import { authentication } from "../auth/routes.js";
import { MAX_IMAGE_BYTES } from "../../services/image-storage.js";
import type { ComplaintsService } from "./service.js";
import { acceptSchema, assignmentSchema, feedbackSchema, groups, imageSchema, listSchema, noteSchema, parse, reassignSchema, rejectSchema, resolveSchema, submissionSchema } from "./validation.js";
import { z } from "zod";
export function complaintsRoutes(service: ComplaintsService, repo: AuthRepository, config: Config) {
  const r = Router();
  r.use(authentication(repo, config.jwtSecret));
  r.get("/catalog", async (req, res) => res.json(await service.catalog(req.user!)));
  r.get("/statistics", async (req, res) => res.json(await service.statistics(req.user!)));
  r.post("/supervisors/:group", async (req, res) => {
    const group = parse(z.enum(groups), req.params.group), b = parse(assignmentSchema, req.body);
    res.json(await service.configure(req.user!, group, b.version, b.userId, b.reason, b.identityConfirmed));
  });
  r.get("/", async (req, res) => res.json(await service.list(req.user!, parse(listSchema, req.query))));
  r.post("/", async (req, res) => res.status(201).json(await service.create(req.user!, parse(submissionSchema, req.body))));
  r.get("/:id", async (req, res) => res.json(await service.detail(req.user!, String(req.params.id))));
  r.post("/:id/accept", async (req, res) => {
    const b = parse(acceptSchema, req.body);
    res.json(await service.accept(req.user!, String(req.params.id), b.version, b.studentGroup));
  });
  r.post("/:id/reject", async (req, res) => {
    const b = parse(rejectSchema, req.body);
    res.json(await service.reject(req.user!, String(req.params.id), b.version, b.reason));
  });
  r.post("/:id/reassign", async (req, res) => {
    const b = parse(reassignSchema, req.body);
    res.json(await service.reassign(req.user!, String(req.params.id), b.version, b.supervisorGroup, b.reason));
  });
  r.post("/:id/notes", async (req, res) => {
    const b = parse(noteSchema, req.body);
    res.json(await service.note(req.user!, String(req.params.id), b.version, b.text, b.wardenContact));
  });
  r.post("/:id/resolve", async (req, res) => {
    const b = parse(resolveSchema, req.body);
    res.json(await service.resolve(req.user!, String(req.params.id), b.version, b.resolutionDetails));
  });
  r.post("/:id/feedback", async (req, res) => {
    const b = parse(feedbackSchema, req.body);
    res.json(await service.feedback(req.user!, String(req.params.id), b.version, b.feedback));
  });
  r.post("/:id/image", raw({ type: () => true, limit: MAX_IMAGE_BYTES }), async (req, res) => {
    const b = parse(imageSchema, req.query);
    res.json(await service.saveImage(req.user!, String(req.params.id), b.version, req.body, (req.get("Content-Type") ?? "").split(";")[0]!, req.get("X-Image-Filename")));
  });
  r.get("/:id/image", async (req, res) => {
    const i = await service.image(req.user!, String(req.params.id));
    res.set({ "Content-Type": i.mimeType, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store", "Content-Disposition": "inline" }).send(Buffer.from(i.bytes!));
  });
  return r;
}
