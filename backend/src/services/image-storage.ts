import sharp from "sharp";
import type { NextFunction, Request, Response } from "express";
import type { Prisma } from "../generated/prisma/client.js";
import { AccountError } from "../modules/registration/service.js";
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_STORED_BYTES = 50 * 1024 * 1024;
const imageMimes = ["image/jpeg", "image/png"] as const;

function requestImageMime(req: Request) {
  return (req.get("Content-Type") ?? "").split(";")[0]!.trim().toLowerCase();
}

export function requireImageContentType(req: Request, _res: Response, next: NextFunction) {
  if (!imageMimes.includes(requestImageMime(req) as typeof imageMimes[number])) {
    next(new AccountError(415, "Only JPEG and PNG images are supported."));
    return;
  }
  next();
}

export function normalizedImageMime(req: Request) {
  return requestImageMime(req);
}

export type StoredImage = {
  bytes: Buffer;
  mimeType: "image/jpeg" | "image/png";
};

/** Decode the URI-encoded filename sent in X-Image-Filename and reject values
 * that cannot safely be treated as a single, bounded filename. */
export function decodeImageFilename(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  let filename: string;
  try {
    filename = decodeURIComponent(value);
  } catch {
    throw new AccountError(400, "Image filename encoding is invalid.");
  }
  if (
    !filename ||
    filename.length > 255 ||
    /[\u0000-\u001f\u007f]/.test(filename) ||
    /[\\/]/.test(filename)
  ) {
    throw new AccountError(400, "Image filename is invalid.");
  }
  return filename;
}

export async function validateImage(
  bytes: Buffer,
  mimeType: string,
  filename?: string,
): Promise<StoredImage> {
  if (!Buffer.isBuffer(bytes) || !bytes.length)
    throw new AccountError(400, "Select a JPEG or PNG image.");
  if (bytes.length > MAX_IMAGE_BYTES)
    throw new AccountError(413, "Images must be at most 2 MiB.");
  if (!["image/jpeg", "image/png"].includes(mimeType))
    throw new AccountError(400, "Only JPEG and PNG images are supported.");
  if (
    filename &&
    !(mimeType === "image/png" ? /\.png$/i : /\.jpe?g$/i).test(filename)
  )
    throw new AccountError(400, "Filename and image format must match.");
  try {
    const decoder = sharp(bytes, {
      failOn: "warning",
      limitInputPixels: 24_000_000,
    });
    const meta = await decoder.metadata();
    if (
      meta.format !== (mimeType === "image/png" ? "png" : "jpeg") ||
      (meta.pages ?? 1) > 1
    )
      throw new Error("format");
    // Decode all pixels, then encode a clean image without metadata or trailing payloads.
    const pixels = await decoder
      .rotate()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const clean = sharp(pixels.data, {
      raw: {
        width: pixels.info.width,
        height: pixels.info.height,
        channels: pixels.info.channels,
      },
    });
    const output = await (
      mimeType === "image/png" ? clean.png() : clean.jpeg({ quality: 95 })
    ).toBuffer();
    if (output.length > MAX_IMAGE_BYTES)
      throw new AccountError(
        413,
        "The decoded image exceeds 2 MiB. Use a smaller image.",
      );
    return { bytes: output, mimeType: mimeType as StoredImage["mimeType"] };
  } catch (error) {
    if (error instanceof AccountError) throw error;
    throw new AccountError(
      400,
      "Image is invalid, corrupted, animated, or too large in dimensions.",
    );
  }
}
type Owner =
  | { eventId: string; complaintId?: never }
  | { complaintId: string; eventId?: never };
// Caller checks owner authorization and locks the owning row within this same transaction.
export function imageStorage() {
  async function budget(tx: Prisma.TransactionClient) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(731003)::text`;
    await tx.imageBudget.upsert({
      where: { id: 1 },
      create: { id: 1 },
      update: {},
    });
    await tx.$queryRaw`SELECT "id" FROM "ImageBudget" WHERE "id" = 1 FOR UPDATE`;
    return tx.imageBudget.findUniqueOrThrow({ where: { id: 1 } });
  }
  return {
    async replace(
      tx: Prisma.TransactionClient,
      owner: Owner,
      image: StoredImage,
    ) {
      const b = await budget(tx);
      const existing = await tx.image.findFirst({
        where: owner,
        select: { id: true, sizeBytes: true },
      });
      const usedBytes =
        b.usedBytes - (existing?.sizeBytes ?? 0) + image.bytes.length;
      if (usedBytes > MAX_STORED_BYTES)
        throw new AccountError(
          409,
          "The campus image storage limit of 50 MiB has been reached.",
        );
      if (existing)
        await tx.image.update({
          where: { id: existing.id },
          data: {
            bytes: new Uint8Array(image.bytes),
            mimeType: image.mimeType,
            sizeBytes: image.bytes.length,
            objectKey: null,
          },
        });
      else
        await tx.image.create({
          data: {
            ...owner,
            bytes: new Uint8Array(image.bytes),
            mimeType: image.mimeType,
            sizeBytes: image.bytes.length,
          },
        });
      await tx.imageBudget.update({ where: { id: 1 }, data: { usedBytes } });
    },
    async remove(tx: Prisma.TransactionClient, owner: Owner) {
      const b = await budget(tx);
      const old = await tx.image.findFirst({
        where: owner,
        select: { id: true, sizeBytes: true },
      });
      if (!old) return;
      await tx.image.delete({ where: { id: old.id } });
      await tx.imageBudget.update({
        where: { id: 1 },
        data: { usedBytes: b.usedBytes - old.sizeBytes },
      });
    },
  };
}
