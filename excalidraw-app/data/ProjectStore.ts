import { createStore, get, set, del, keys, getMany } from "idb-keyval";
import { nanoid } from "nanoid";

export interface ProjectMetadata {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  thumbnail?: string;
  collabRoomId?: string;
}

const projectStore = createStore("excalibur-projects-db", "projects-store");

/**
 * Scene data store — stores elements + appState per project.
 * Keyed by project ID.
 */
const sceneStore = createStore("excalibur-scenes-db", "scenes-store");

/**
 * Files store — stores binary file data per project.
 * Keyed by `${projectId}:${fileId}`.
 */
const projectFilesStore = createStore(
  "excalibur-project-files-db",
  "project-files-store",
);

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
  await del(id, projectStore);

  // Delete associated scene data
  await del(id, sceneStore);

  // Delete associated files (keys prefixed with `${id}:`)
  const allFileKeys = await keys<string>(projectFilesStore);
  const prefix = `${id}:`;
  await Promise.all(
    allFileKeys
      .filter((key) => typeof key === "string" && key.startsWith(prefix))
      .map((key) => del(key, projectFilesStore)),
  );
};

export const renameProject = async (
  id: string,
  name: string,
): Promise<void> => {
  await updateProject(id, { name });
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
    (p): p is ProjectMetadata =>
      p != null && p.collabRoomId === collabRoomId,
  );
};
