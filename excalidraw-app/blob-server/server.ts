import crypto from "crypto";
import fs from "fs";
import path from "path";

import cors from "cors";
import express from "express";

import type { IncomingMessage } from "http";

const app = express();
const PORT = process.env.PORT || 3003;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024; // 5MB

// Ensure data directories exist
const BLOBS_DIR = path.join(DATA_DIR, "blobs");
const FILES_DIR = path.join(DATA_DIR, "files");
fs.mkdirSync(BLOBS_DIR, { recursive: true });
fs.mkdirSync(FILES_DIR, { recursive: true });

app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:3001",
      process.env.ALLOWED_ORIGIN,
    ].filter(Boolean) as string[],
  }),
);

// Collect raw body as Buffer for all POST requests
const getRawBody = (req: IncomingMessage): Promise<Buffer> => {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_PAYLOAD_BYTES) {
        req.destroy();
        reject(new Error("RequestTooLargeError"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
};

// POST /api/v2/post/ — store scene blob, return { id }
app.post("/api/v2/post/", async (req, res) => {
  try {
    const body = await getRawBody(req);

    if (body.length === 0) {
      res.status(400).json({ error: "Empty body" });
      return;
    }

    const id = crypto.randomBytes(10).toString("hex");
    const filePath = path.join(BLOBS_DIR, `${id}.bin`);

    await fs.promises.writeFile(filePath, body);
    res.json({ id });
  } catch (err: any) {
    if (err.message === "RequestTooLargeError") {
      res.status(413).json({ error_class: "RequestTooLargeError" });
    } else {
      res.status(500).json({ error: "Internal error" });
    }
  }
});

// GET /api/v2/:id — return scene blob
app.get("/api/v2/:id", (req, res) => {
  const { id } = req.params;

  if (!/^[a-f0-9]+$/i.test(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const filePath = path.join(BLOBS_DIR, `${id}.bin`);

  res.setHeader("Content-Type", "application/octet-stream");
  const stream = fs.createReadStream(filePath);
  stream.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") {
      res.status(404).json({ error: "Not found" });
    } else {
      res.status(500).json({ error: "Internal error" });
    }
  });
  stream.pipe(res);
});

// POST /api/v2/files/:sceneId — upload a file for a scene
// fileId sent as X-File-Id header
app.post("/api/v2/files/:sceneId", async (req, res) => {
  try {
    const { sceneId } = req.params;
    const fileId = req.headers["x-file-id"] as string;

    if (!/^[a-f0-9]+$/i.test(sceneId)) {
      res.status(400).json({ error: "Invalid sceneId" });
      return;
    }

    if (!fileId || !/^[a-f0-9_-]+$/i.test(fileId)) {
      res.status(400).json({ error: "Missing or invalid X-File-Id header" });
      return;
    }

    const body = await getRawBody(req);

    const sceneDir = path.join(FILES_DIR, sceneId);
    await fs.promises.mkdir(sceneDir, { recursive: true });

    const filePath = path.join(sceneDir, `${fileId}.bin`);
    await fs.promises.writeFile(filePath, body);

    res.json({ saved: true });
  } catch (err: any) {
    if (err.message === "RequestTooLargeError") {
      res.status(413).json({ error_class: "RequestTooLargeError" });
    } else {
      res.status(500).json({ error: "Internal error" });
    }
  }
});

// GET /api/v2/files/:sceneId/:fileId — return a file
app.get("/api/v2/files/:sceneId/:fileId", (req, res) => {
  const { sceneId, fileId } = req.params;

  if (!/^[a-f0-9]+$/i.test(sceneId)) {
    res.status(400).json({ error: "Invalid sceneId" });
    return;
  }

  if (!/^[a-f0-9_-]+$/i.test(fileId)) {
    res.status(400).json({ error: "Invalid fileId" });
    return;
  }

  const filePath = path.join(FILES_DIR, sceneId, `${fileId}.bin`);

  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Cache-Control", "public, max-age=31536000");
  const stream = fs.createReadStream(filePath);
  stream.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") {
      res.status(404).json({ error: "Not found" });
    } else {
      res.status(500).json({ error: "Internal error" });
    }
  });
  stream.pipe(res);
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Blob server listening on port ${PORT}, data: ${DATA_DIR}`);
});
