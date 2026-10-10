import express from "express";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { BOARDS, publicBoard } from "./boards.js";
import { BoardError, unseal } from "./net.js";

function contentType(url, header) {
  const clean = header.split(";")[0].trim().toLowerCase();
  if (clean.startsWith("image/") || clean.startsWith("video/")) return clean;
  const path = new URL(url).pathname.toLowerCase();
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".gif")) return "image/gif";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".avif")) return "image/avif";
  if (path.endsWith(".webm")) return "video/webm";
  if (path.endsWith(".mp4") || path.endsWith(".m4v")) return "video/mp4";
  return "";
}
import { getPosts, openMedia, resolveOriginal, suggestTags } from "./providers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, "..", "dist");
const port = Number(process.env.PORT || 4178);

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "80kb" }));

app.get("/api/boards", (_req, res) => {
  res.json({ boards: BOARDS.map(publicBoard) });
});

app.post("/api/posts", async (req, res) => {
  try {
    res.json(await getPosts(req.body || {}));
  } catch (error) {
    const status = error.status || 502;
    if (!(error instanceof BoardError)) console.error(error);
    res.status(status).json({
      error: error.message || "queryFailed",
      vars: error.vars || null,
      posts: [],
      hasMore: false,
      note: "",
    });
  }
});

app.post("/api/resolve", async (req, res) => {
  try {
    res.json(await resolveOriginal(req.body || {}));
  } catch (error) {
    const status = error.status || 502;
    res.status(status).json({ error: error.message || "originalNotFound", vars: error.vars || null });
  }
});

app.post("/api/suggest", async (req, res) => {
  try {
    res.json({ tags: await suggestTags(req.body || {}) });
  } catch {
    res.json({ tags: [] });
  }
});

app.get("/api/media", async (req, res) => {
  try {
    const opened = await openMedia(String(req.query.t || ""), unseal);
    if (!opened) return res.status(404).end();
    const upstream = opened.response;
    if (!upstream.ok || !upstream.body) return res.status(502).end();
    const type = contentType(opened.finalUrl, upstream.headers.get("content-type") || "");
    if (!type.startsWith("image/") && !type.startsWith("video/")) return res.status(502).end();
    res.setHeader("Content-Type", type);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const length = upstream.headers.get("content-length");
    if (length) res.setHeader("Content-Length", length);
    const stream = Readable.fromWeb(upstream.body);
    stream.on("error", () => {
      if (!res.writableEnded) res.end();
    });
    res.on("close", () => stream.destroy());
    stream.pipe(res);
  } catch {
    if (!res.headersSent) res.status(502).end();
  }
});

process.on("unhandledRejection", (error) => {
  console.error(error);
});
process.on("uncaughtException", (error) => {
  console.error(error);
});

const indexFile = path.join(distDir, "index.html");
if (fs.existsSync(indexFile)) {
  app.use(express.static(distDir));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(indexFile);
  });
} else {
  app.get("/", (_req, res) => {
    res.type("html").send(`<!doctype html><meta charset="utf-8"><title>imgbrd</title>
      <body style="font-family:sans-serif;background:#111;color:#eee;padding:2rem">
      <p>The interface has not been built yet.</p>
      <p>Development: <code>npm run dev</code>, then <a href="http://localhost:5173">localhost:5173</a></p>
      <p>Production: <code>npm run build</code>, then <code>npm start</code></p>
      </body>`);
  });
}

app.listen(port, "0.0.0.0", () => {
  console.log(`imgbrd API auf http://localhost:${port}`);
});
