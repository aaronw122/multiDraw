import { createStore, get, set, del, keys, getMany } from "idb-keyval";
import { nanoid } from "nanoid";

import { sceneStore } from "./SceneStore";
import { deleteProjectFiles } from "./LocalData";

import { deleteFromBackend } from "./index";

export interface ProjectMetadata {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  thumbnail?: string;
  collabRoomId?: string;
  collabRole?: "host" | "joiner";
  sharedBlobIds?: string[];
}

const projectStore = createStore("multidraw-projects-db", "projects-store");

export const listProjects = async (): Promise<ProjectMetadata[]> => {
  const allKeys = await keys<string>(projectStore);
  if (allKeys.length === 0) {
    return [];
  }
  const projects = await getMany<ProjectMetadata>(allKeys, projectStore);
  return projects
    .filter((p): p is ProjectMetadata => p != null)
    .sort((a, b) => b.updatedAt - a.updatedAt);
};

export const getProject = async (
  id: string,
): Promise<ProjectMetadata | undefined> => {
  return get<ProjectMetadata>(id, projectStore);
};

export const createProject = async (name: string): Promise<ProjectMetadata> => {
  const now = Date.now();
  const project: ProjectMetadata = {
    id: nanoid(),
    name,
    createdAt: now,
    updatedAt: now,
  };
  await set(project.id, project, projectStore);
  return project;
};

export const updateProject = async (
  id: string,
  updates: Partial<ProjectMetadata>,
): Promise<void> => {
  const existing = await get<ProjectMetadata>(id, projectStore);
  if (!existing) {
    throw new Error(`Project not found: ${id}`);
  }
  const updated: ProjectMetadata = {
    ...existing,
    ...updates,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: Date.now(),
  };
  await set(id, updated, projectStore);
};

export const deleteProject = async (id: string): Promise<void> => {
  // Best-effort cleanup of shareable link blobs on the server
  const metadata = await get<ProjectMetadata>(id, projectStore);
  if (metadata?.sharedBlobIds?.length) {
    await Promise.allSettled(
      metadata.sharedBlobIds.map((blobId) => deleteFromBackend(blobId)),
    );
  }

  // Delete files first, then scene, then metadata
  // so orphaned data is recoverable if interrupted
  await deleteProjectFiles(id);
  await del(id, sceneStore);
  await del(id, projectStore);
};

export const renameProject = async (
  id: string,
  name: string,
): Promise<void> => {
  await updateProject(id, { name });
};

export const addSharedBlobId = async (
  projectId: string,
  blobId: string,
): Promise<void> => {
  const existing = await get<ProjectMetadata>(projectId, projectStore);
  if (!existing) {
    return;
  }
  const ids = existing.sharedBlobIds ?? [];
  if (!ids.includes(blobId)) {
    ids.push(blobId);
  }
  await set(
    projectId,
    { ...existing, sharedBlobIds: ids, updatedAt: Date.now() },
    projectStore,
  );
};

export const findProjectByCollabRoomId = async (
  collabRoomId: string,
): Promise<ProjectMetadata | undefined> => {
  const allKeys = await keys<string>(projectStore);
  if (allKeys.length === 0) {
    return undefined;
  }
  const projects = await getMany<ProjectMetadata>(allKeys, projectStore);
  return projects.find(
    (p): p is ProjectMetadata => p != null && p.collabRoomId === collabRoomId,
  );
};
