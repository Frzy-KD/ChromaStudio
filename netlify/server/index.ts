import type { Config } from "@netlify/server";
import { getStore } from "@netlify/blobs";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { drawings } from "../../db/schema.ts";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const BG_MODES = new Set(["white", "dark", "transparent"]);
const ID_RE = /^[A-Za-z0-9-]{8,64}$/;

const images = () => getStore("drawing-images");

const json = (data: unknown, status = 200) => Response.json(data, { status });
const error = (message: string, status: number) => json({ error: message }, status);

const getOwner = (req: Request) => {
  const owner = req.headers.get("x-owner-id") ?? "";
  return ID_RE.test(owner) ? owner : null;
};

const toPublic = (d: typeof drawings.$inferSelect) => ({
  id: d.id,
  title: d.title,
  width: d.width,
  height: d.height,
  bgMode: d.bgMode,
  createdAt: d.createdAt,
  updatedAt: d.updatedAt,
  imageUrl: `/api/drawings/${d.id}/image?v=${new Date(d.updatedAt).getTime()}`,
});

const readMeta = (url: URL) => {
  const title = (url.searchParams.get("title") ?? "").trim().slice(0, 120) || "Untitled";
  const width = Number(url.searchParams.get("width"));
  const height = Number(url.searchParams.get("height"));
  const bgMode = url.searchParams.get("bgMode") ?? "white";
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 8192 || height > 8192) {
    return null;
  }
  return { title, width, height, bgMode: BG_MODES.has(bgMode) ? bgMode : "white" };
};

const readPng = async (req: Request) => {
  if (!(req.headers.get("content-type") ?? "").startsWith("image/png")) return null;
  const buf = await req.arrayBuffer();
  if (buf.byteLength === 0 || buf.byteLength > MAX_IMAGE_BYTES) return null;
  return buf;
};

export default async (req: Request) => {
  const url = new URL(req.url);
  const parts = url.pathname.replace(/\/+$/, "").split("/").filter(Boolean); // ["api","drawings",id?,"image"?]
  if (parts[0] !== "api" || parts[1] !== "drawings" || parts.length > 4) return error("Not found", 404);
  const id = parts[2];
  if (id !== undefined && !ID_RE.test(id)) return error("Not found", 404);

  // Public image fetch (ids are random UUIDs, so they act as unguessable links)
  if (id && parts[3] === "image") {
    if (req.method !== "GET") return error("Method not allowed", 405);
    const [row] = await db.select().from(drawings).where(eq(drawings.id, id));
    if (!row) return error("Not found", 404);
    const data = await images().get(row.imageKey, { type: "arrayBuffer" });
    if (!data) return error("Not found", 404);
    return new Response(data, {
      headers: { "content-type": "image/png", "cache-control": "public, max-age=31536000, immutable" },
    });
  }
  if (parts.length === 4) return error("Not found", 404);

  const owner = getOwner(req);
  if (!owner) return error("Missing or invalid owner id", 400);

  // Collection
  if (!id) {
    if (req.method === "GET") {
      const rows = await db
        .select()
        .from(drawings)
        .where(eq(drawings.ownerId, owner))
        .orderBy(desc(drawings.updatedAt))
        .limit(200);
      return json(rows.map(toPublic));
    }
    if (req.method === "POST") {
      const meta = readMeta(url);
      if (!meta) return error("Invalid width or height", 400);
      const png = await readPng(req);
      if (!png) return error("Body must be a PNG image under 20 MB", 400);
      const newId = crypto.randomUUID();
      const imageKey = `${owner}/${newId}.png`;
      await images().set(imageKey, png);
      const [row] = await db
        .insert(drawings)
        .values({ id: newId, ownerId: owner, imageKey, ...meta })
        .returning();
      return json(toPublic(row), 201);
    }
    return error("Method not allowed", 405);
  }

  // Single drawing
  const where = and(eq(drawings.id, id), eq(drawings.ownerId, owner));
  const [existing] = await db.select().from(drawings).where(where);
  if (!existing) return error("Not found", 404);

  if (req.method === "GET") return json(toPublic(existing));

  if (req.method === "PUT") {
    const meta = readMeta(url);
    if (!meta) return error("Invalid width or height", 400);
    const png = await readPng(req);
    if (!png) return error("Body must be a PNG image under 20 MB", 400);
    await images().set(existing.imageKey, png);
    const [row] = await db
      .update(drawings)
      .set({ ...meta, updatedAt: new Date() })
      .where(where)
      .returning();
    return json(toPublic(row));
  }

  if (req.method === "PATCH") {
    const body = (await req.json().catch(() => ({}))) as { title?: unknown };
    const title = typeof body.title === "string" ? body.title.trim().slice(0, 120) : "";
    if (!title) return error("Title is required", 400);
    const [row] = await db.update(drawings).set({ title }).where(where).returning();
    return json(toPublic(row));
  }

  if (req.method === "DELETE") {
    await db.delete(drawings).where(where);
    await images().delete(existing.imageKey);
    return new Response(null, { status: 204 });
  }

  return error("Method not allowed", 405);
};

export const config: Config = { path: ["/api/drawings", "/api/drawings/*"] };
