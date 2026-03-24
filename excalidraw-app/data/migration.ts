import { createStore, get, set, del, keys } from "idb-keyval";

import { importFromLocalStorage } from "./localStorage";
import { saveScene } from "./SceneStore";
import { createProject } from "./ProjectStore";

import type { AppState, BinaryFileData } from "@excalidraw/excalidraw/types";

const MIGRATION_FLAG = "excalibur-migrated";
const LEGACY_CLEANUP_FLAG = "excalibur-legacy-files-cleaned";

const filesStore = createStore("files-db", "files-store");

/**
 * Migrates legacy single-project data from localStorage and un-namespaced
 * IndexedDB files into the new per-project storage layout.
 *
 * Runs once on app startup. Idempotent — safe to re-run.
 */
export const runMigration = async (): Promise<string | null> => {
  if (localStorage.getItem(MIGRATION_FLAG)) {
    await cleanupLegacyFiles();
    return null;
  }

  const { elements, appState } = importFromLocalStorage();

  const hasElements = elements && elements.length > 0;
  const hasAppState = appState !== null;

  if (!hasElements && !hasAppState) {
    localStorage.setItem(MIGRATION_FLAG, String(Date.now()));
    return null;
  }

  const project = await createProject("My Drawing");

  await saveScene(
    project.id,
    elements,
    (appState ?? {}) as AppState,
  );

  await rekeyFiles(project.id);

  localStorage.setItem(MIGRATION_FLAG, String(Date.now()));

  return project.id;
};

/**
 * Re-keys existing files in files-db by copying each entry from
 * `{fileId}` to `{projectId}:{fileId}`. Processes files one at a time
 * to avoid loading all blobs into memory.
 */
const rekeyFiles = async (projectId: string): Promise<void> => {
  const allKeys = await keys<string>(filesStore);

  for (const key of allKeys) {
    if (typeof key === "string" && key.includes(":")) {
      continue;
    }

    const fileData = await get<BinaryFileData>(key, filesStore);
    if (!fileData) {
      continue;
    }

    const namespacedKey = `${projectId}:${key}`;
    const updatedData: BinaryFileData = {
      ...fileData,
      lastRetrieved: Date.now(),
    };

    await set(namespacedKey, updatedData, filesStore);
  }
};

/**
 * Deferred cleanup: removes un-prefixed (legacy) file keys from files-db.
 * Runs on the first app load AFTER migration has completed.
 */
const cleanupLegacyFiles = async (): Promise<void> => {
  if (localStorage.getItem(LEGACY_CLEANUP_FLAG)) {
    return;
  }

  const allKeys = await keys<string>(filesStore);
  const legacyKeys = allKeys.filter(
    (key) => typeof key === "string" && !key.includes(":"),
  );

  for (const key of legacyKeys) {
    await del(key, filesStore);
  }

  localStorage.setItem(LEGACY_CLEANUP_FLAG, String(Date.now()));
};
