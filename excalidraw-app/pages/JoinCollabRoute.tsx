import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  findProjectByCollabRoomId,
  createProject,
  updateProject,
} from "../data/ProjectStore";

/**
 * Route handler for `/join#room={roomId},{roomKey}`.
 *
 * When a user opens a collaboration link:
 * 1. Parse roomId and roomKey from the hash
 * 2. Look up an existing local project that already tracks this collab room
 * 3. If found → redirect to that project's editor with the collab hash
 * 4. If not found → create a new project, tag it with the collabRoomId, redirect
 */
const JoinCollabRoute = () => {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const processJoin = async () => {
      const hash = window.location.hash;
      const match = hash.match(/^#room=([a-zA-Z0-9_-]+),([a-zA-Z0-9_-]+)$/);

      if (!match) {
        // No valid collab hash — redirect to dashboard
        navigate("/", { replace: true });
        return;
      }

      const roomId = match[1];
      const roomKey = match[2];
      const collabHash = `#room=${roomId},${roomKey}`;

      try {
        // Check if we already have a local joiner project for this collab room.
        // Skip host projects — in same-browser testing, both tabs share IndexedDB
        // and reusing the host's project causes data corruption.
        const existing = await findProjectByCollabRoomId(roomId);

        if (existing && existing.collabRole !== "host") {
          navigate(`/project/${existing.id}${collabHash}`, { replace: true });
          return;
        }

        // Create a new project for this collab session
        const project = await createProject("Shared Drawing");
        await updateProject(project.id, {
          collabRoomId: roomId,
          collabRole: "joiner",
        });

        navigate(`/project/${project.id}${collabHash}`, { replace: true });
      } catch (err) {
        console.error("Failed to process collab join:", err);
        setError("Failed to join collaboration session. Redirecting...");
        // Fall back to dashboard after a brief delay
        setTimeout(() => navigate("/", { replace: true }), 2000);
      }
    };

    processJoin();
  }, [navigate]);

  if (error) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          fontFamily: "system-ui, sans-serif",
          color: "var(--color-on-surface, #333)",
        }}
      >
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        fontFamily: "system-ui, sans-serif",
        color: "var(--color-on-surface, #333)",
      }}
    >
      <p>Joining collaboration session…</p>
    </div>
  );
};

export default JoinCollabRoute;
