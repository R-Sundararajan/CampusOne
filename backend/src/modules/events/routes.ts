import { Router, raw } from "express";
import type { Config } from "../../config.js";
import type { AuthRepository } from "../auth/repository.js";
import { authentication } from "../auth/routes.js";
import type { EventsService } from "./service.js";
import {
  actionSchema,
  createSchema,
  editSchema,
  listSchema,
  pageSchema,
  parse,
  versionSchema,
} from "./validation.js";
import { AccountError } from "../registration/service.js";
import { MAX_IMAGE_BYTES } from "../../services/image-storage.js";
export function eventsRoutes(
  service: EventsService,
  repo: AuthRepository,
  config: Config,
) {
  const r = Router();
  r.use(authentication(repo, config.jwtSecret));
  r.get("/catalog", async (req, res) =>
    res.json(await service.catalog(req.user!)),
  );
  r.get("/statistics", async (req, res) =>
    res.json(await service.statistics(req.user!)),
  );
  r.get("/", async (req, res) =>
    res.json(await service.list(req.user!, parse(listSchema, req.query))),
  );
  r.post("/", async (req, res) =>
    res
      .status(201)
      .json(await service.create(req.user!, parse(createSchema, req.body))),
  );
  r.get("/:id", async (req, res) =>
    res.json(await service.detail(req.user!, String(req.params.id))),
  );
  r.post("/:id/edit", async (req, res) =>
    res.json(
      await service.edit(
        req.user!,
        String(req.params.id),
        parse(editSchema, req.body),
      ),
    ),
  );
  r.post("/:id/action", async (req, res) => {
    const b = parse(actionSchema, req.body);
    res.json(
      await service.action(
        req.user!,
        String(req.params.id),
        b.version,
        b.action,
      ),
    );
  });
  r.post("/:id/register", async (req, res) => {
    if (
      Object.keys(req.query).length ||
      (req.body !== undefined &&
        (typeof req.body !== "object" ||
          req.body === null ||
          Array.isArray(req.body) ||
          Object.keys(req.body).length))
    )
      throw new AccountError(
        400,
        "Registration does not accept student identity or other fields.",
      );
    res.json(await service.register(req.user!, String(req.params.id)));
  });
  r.get("/:id/registrations", async (req, res) => {
    const p = parse(pageSchema, req.query);
    res.json(
      await service.registrations(
        req.user!,
        String(req.params.id),
        p.page,
        p.pageSize,
      ),
    );
  });
  r.get("/:id/poster", async (req, res) => {
    const i = await service.poster(req.user!, String(req.params.id));
    res
      .set({
        "Content-Type": i.mimeType,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
        "Content-Disposition": "inline",
      })
      .send(Buffer.from(i.bytes!));
  });
  r.post(
    "/:id/poster",
    raw({ type: () => true, limit: MAX_IMAGE_BYTES }),
    async (req, res) => {
      const p = parse(versionSchema, req.query);
      const mime = (req.get("Content-Type") ?? "").split(";")[0]!;
      const filename = req.get("X-Image-Filename");
      if (filename) {
        const ext = mime === "image/png" ? /\.png$/i : /\.jpe?g$/i;
        if (!ext.test(filename))
          throw new AccountError(400, "Filename and image format must match.");
      }
      res.json(
        await service.savePoster(
          req.user!,
          String(req.params.id),
          p.version,
          req.body,
          mime,
        ),
      );
    },
  );
  r.post("/:id/poster/remove", async (req, res) =>
    res.json(
      await service.removePoster(
        req.user!,
        String(req.params.id),
        parse(versionSchema, req.body).version,
      ),
    ),
  );
  return r;
}
