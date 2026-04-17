import crypto from "crypto";
import fs from "fs";
import http from "http";
import path from "path";

import cors from "cors";
import express from "express";
import { Server as SocketIOServer } from "socket.io";

import type { IncomingMessage } from "http";

const app = express();
const server = http.createServer(app);
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

// --- WebSocket relay (replaces excalidraw-room) ---

const io = new SocketIOServer(server, {
  transports: ["websocket", "polling"],
  cors: {
    origin: [
      "http://localhost:5173",
      "http://localhost:3001",
      process.env.ALLOWED_ORIGIN,
    ].filter(Boolean) as string[],
    methods: ["GET", "POST"],
  },
});

// Track who follows whom: leader socketId -> set of follower socketIds
const followState = new Map<string, Set<string>>();

io.on("connection", (socket) => {
  io.to(socket.id).emit("init-room");

  socket.on("join-room", (roomId: string) => {
    socket.join(roomId);

    const clients = Array.from(io.sockets.adapter.rooms.get(roomId) ?? []);

    if (clients.length <= 1) {
      // first user in room — tell them so they can load the scene immediately
      io.to(socket.id).emit("first-in-room");
    } else {
      // notify existing clients about the new user
      socket.broadcast.to(roomId).emit("new-user", socket.id);
    }

    // tell everyone in the room who's connected
    io.in(roomId).emit("room-user-change", clients);
  });

  socket.on(
    "server-broadcast",
    (roomId: string, encryptedData: ArrayBuffer, iv: Uint8Array) => {
      socket.broadcast.to(roomId).emit("client-broadcast", encryptedData, iv);
    },
  );

  socket.on(
    "server-volatile-broadcast",
    (roomId: string, encryptedData: ArrayBuffer, iv: Uint8Array) => {
      socket.volatile.broadcast
        .to(roomId)
        .emit("client-broadcast", encryptedData, iv);
    },
  );

  socket.on(
    "user-follow",
    (payload: { userToFollow: { socketId: string }; action: string }) => {
      const leaderSocketId = payload.userToFollow?.socketId;
      if (!leaderSocketId) {
        return;
      }

      if (payload.action === "FOLLOW") {
        // track the follow relationship
        if (!followState.has(leaderSocketId)) {
          followState.set(leaderSocketId, new Set());
        }
        followState.get(leaderSocketId)!.add(socket.id);

        // join the follow@ room so viewport broadcasts reach this follower
        socket.join(`follow@${leaderSocketId}`);
      } else {
        // UNFOLLOW
        followState.get(leaderSocketId)?.delete(socket.id);
        if (followState.get(leaderSocketId)?.size === 0) {
          followState.delete(leaderSocketId);
        }
        socket.leave(`follow@${leaderSocketId}`);
      }

      // notify the leader who is following them (as SocketId[])
      const followers = Array.from(followState.get(leaderSocketId) ?? []);
      const leaderSocket = io.sockets.sockets.get(leaderSocketId);
      if (leaderSocket) {
        leaderSocket.emit("user-follow-room-change", followers);
      }
    },
  );

  socket.on("disconnecting", () => {
    const rooms = Array.from(socket.rooms).filter(
      (r) => r !== socket.id && !r.startsWith("follow@"),
    );

    // update room-user-change for collab rooms
    for (const roomId of rooms) {
      const clients = Array.from(
        io.sockets.adapter.rooms.get(roomId) ?? [],
      ).filter((id) => id !== socket.id);
      io.in(roomId).emit("room-user-change", clients);
    }

    // clean up follow state: remove as follower from any leader
    for (const [leaderId, followers] of followState) {
      if (followers.delete(socket.id)) {
        // notify the leader of updated follower list
        const leaderSocket = io.sockets.sockets.get(leaderId);
        if (leaderSocket) {
          leaderSocket.emit("user-follow-room-change", Array.from(followers));
        }
        if (followers.size === 0) {
          followState.delete(leaderId);
        }
      }
    }

    // clean up as leader
    followState.delete(socket.id);
  });
});

// --- Blob TTL cleanup sweep ---

const BLOB_TTL_DAYS = parseInt(process.env.BLOB_TTL_DAYS || "30", 10);
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

async function cleanupExpiredBlobs(): Promise<void> {
  const maxAge = BLOB_TTL_DAYS * 24 * 60 * 60 * 1000;
  const now = Date.now();
  let deleted = 0;

  try {
    const entries = await fs.promises.readdir(BLOBS_DIR);

    for (const entry of entries) {
      if (!entry.endsWith(".bin")) {
        continue;
      }

      const blobPath = path.join(BLOBS_DIR, entry);

      try {
        const stat = await fs.promises.stat(blobPath);

        if (now - stat.mtimeMs > maxAge) {
          const id = entry.replace(/\.bin$/, "");

          // Delete the blob file
          await fs.promises.unlink(blobPath);

          // Delete associated files directory if it exists
          const filesDir = path.join(FILES_DIR, id);
          await fs.promises.rm(filesDir, { recursive: true, force: true });

          deleted++;
        }
      } catch (err) {
        // Skip individual file errors (e.g. deleted between readdir and stat)
        continue;
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Blob cleanup sweep failed:", err);
    return;
  }

  // eslint-disable-next-line no-console
  console.log(
    `Blob cleanup: deleted ${deleted} expired blob(s) (TTL: ${BLOB_TTL_DAYS}d)`,
  );
}

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(
    `Blob + collab server listening on port ${PORT}, data: ${DATA_DIR}`,
  );

  // Run cleanup on startup, then every 6 hours
  cleanupExpiredBlobs();
  setInterval(cleanupExpiredBlobs, CLEANUP_INTERVAL_MS);
});
