/**
 * This file deals with saving data state (appState, elements, images, ...)
 * locally to the browser.
 *
 * Notes:
 *
 * - DataState refers to full state of the app: appState, elements, images,
 *   though some state is saved separately (collab username, library) for one
 *   reason or another. We also save different data to different storage
 *   (localStorage, indexedDB).
 */

import { debounce } from "@excalidraw/common";
import { createStore, del, getMany, set, setMany, get, keys } from "idb-keyval";

import { atom } from "excalidraw-app/app-jotai";

import type { LibraryPersistedData } from "@excalidraw/excalidraw/data/library";
import type { ImportedDataState } from "@excalidraw/excalidraw/data/types";
import type { ExcalidrawElement, FileId } from "@excalidraw/element/types";
import type {
  AppState,
  BinaryFileData,
  BinaryFiles,
} from "@excalidraw/excalidraw/types";
import type { MaybePromise } from "@excalidraw/common/utility-types";

import { SAVE_TO_LOCAL_STORAGE_TIMEOUT, STORAGE_KEYS } from "../app_constants";

import { FileManager } from "./FileManager";
import { FileStatusStore } from "./fileStatusStore";
import { Locker } from "./Locker";
import { saveScene } from "./SceneStore";
import { broadcastFileUpdate } from "./tabSync";

const filesStore = createStore("files-db", "files-store");

/**
 * Deletes all files belonging to a project from the files store.
 * Files are keyed as `${projectId}:${fileId}`.
 */
export const deleteProjectFiles = async (projectId: string): Promise<void> => {
  const allKeys = await keys<string>(filesStore);
  const prefix = `${projectId}:`;
  await Promise.all(
    allKeys
      .filter((key) => typeof key === "string" && key.startsWith(prefix))
      .map((key) => del(key, filesStore)),
  );
};

export const localStorageQuotaExceededAtom = atom(false);

class LocalFileManager extends FileManager {
  clearObsoleteFiles = async (opts: {
    currentFileIds: FileId[];
    projectId?: string;
  }) => {
    const allKeys = await keys<string>(filesStore);

    for (const key of allKeys) {
      if (typeof key !== "string") {
        continue;
      }

      let fileId: FileId;
      if (opts.projectId) {
        const prefix = `${opts.projectId}:`;
        if (!key.startsWith(prefix)) {
          continue;
        }
        fileId = key.slice(prefix.length) as FileId;
      } else {
        // Legacy mode: only process un-namespaced keys
        if (key.includes(":")) {
          continue;
        }
        fileId = key as FileId;
      }

      const imageData = await get<BinaryFileData>(key, filesStore);

      if (!imageData) {
        continue;
      }

      // if image is unused (not on canvas) & is older than 1 day, delete it
      // from storage. We check `lastRetrieved` — we care about the last time
      // the image was used (loaded on canvas), not when it was initially
      // created.
      if (
        (!imageData.lastRetrieved ||
          Date.now() - imageData.lastRetrieved > 24 * 3600 * 1000) &&
        !opts.currentFileIds.includes(fileId)
      ) {
        del(key, filesStore);
      }
    }
  };
}

type SavingLockTypes = "collaboration";

export class LocalData {
  private static _save = debounce(
    async (
      projectId: string | undefined,
      elements: readonly ExcalidrawElement[],
      appState: AppState,
      files: BinaryFiles,
      onFilesSaved: () => void,
    ) => {
      if (projectId) {
        await saveScene(projectId, elements, appState);
      }

      await LocalData.fileStorage.saveFiles({
        elements,
        files,
        projectId,
      });
      onFilesSaved();
    },
    SAVE_TO_LOCAL_STORAGE_TIMEOUT,
  );

  /**
   * Saves DataState, including files. Bails if saving is paused.
   *
   * Accepts an optional projectId as the first argument. When provided,
   * scene data is persisted to IndexedDB via SceneStore. When omitted
   * (legacy call sites), only file persistence runs.
   */
  static save = (
    projectIdOrElements: string | readonly ExcalidrawElement[],
    elementsOrAppState: readonly ExcalidrawElement[] | AppState,
    appStateOrFiles: AppState | BinaryFiles,
    filesOrCallback: BinaryFiles | (() => void),
    onFilesSavedOrUndefined?: () => void,
  ) => {
    let projectId: string | undefined;
    let elements: readonly ExcalidrawElement[];
    let appState: AppState;
    let files: BinaryFiles;
    let onFilesSaved: () => void;

    if (typeof projectIdOrElements === "string") {
      projectId = projectIdOrElements;
      elements = elementsOrAppState as readonly ExcalidrawElement[];
      appState = appStateOrFiles as AppState;
      files = filesOrCallback as BinaryFiles;
      onFilesSaved = onFilesSavedOrUndefined!;
    } else {
      projectId = undefined;
      elements = projectIdOrElements;
      appState = elementsOrAppState as AppState;
      files = appStateOrFiles as BinaryFiles;
      onFilesSaved = filesOrCallback as () => void;
    }

    // we need to make the `isSavePaused` check synchronously (undebounced)
    if (!this.isSavePaused()) {
      this._save(projectId, elements, appState, files, onFilesSaved);
    }
  };

  static flushSave = () => {
    this._save.flush();
  };

  private static locker = new Locker<SavingLockTypes>();

  static pauseSave = (lockType: SavingLockTypes) => {
    this.locker.lock(lockType);
  };

  static resumeSave = (lockType: SavingLockTypes) => {
    this.locker.unlock(lockType);
  };

  static isSavePaused = () => {
    return document.hidden || this.locker.isLocked();
  };

  // ---------------------------------------------------------------------------

  static fileStorage = new LocalFileManager({
    onFileStatusChange: FileStatusStore.updateStatuses.bind(FileStatusStore),
    getFiles(ids, projectId?: string) {
      const namespacedIds = projectId
        ? ids.map((id) => `${projectId}:${id}` as FileId)
        : ids;

      return getMany(namespacedIds, filesStore).then(
        async (filesData: (BinaryFileData | undefined)[]) => {
          const loadedFiles: BinaryFileData[] = [];
          const erroredFiles = new Map<FileId, true>();

          const filesToSave: [string, BinaryFileData][] = [];

          filesData.forEach((data, index) => {
            const originalId = ids[index];
            const storageKey = namespacedIds[index];
            if (data) {
              const _data: BinaryFileData = {
                ...data,
                lastRetrieved: Date.now(),
              };
              filesToSave.push([storageKey as string, _data]);
              loadedFiles.push(_data);
            } else {
              erroredFiles.set(originalId, true);
            }
          });

          try {
            // save loaded files back to storage with updated `lastRetrieved`
            setMany(filesToSave as [IDBValidKey, BinaryFileData][], filesStore);
          } catch (error) {
            console.warn(error);
          }

          return { loadedFiles, erroredFiles };
        },
      );
    },
    async saveFiles({ addedFiles }, projectId?: string) {
      const savedFiles = new Map<FileId, BinaryFileData>();
      const erroredFiles = new Map<FileId, BinaryFileData>();

      await Promise.all(
        [...addedFiles].map(async ([id, fileData]) => {
          const storageKey = projectId ? `${projectId}:${id}` : id;
          try {
            await set(storageKey, fileData, filesStore);
            savedFiles.set(id, fileData);
            if (projectId) {
              broadcastFileUpdate(projectId, id);
            }
          } catch (error: any) {
            console.error(error);
            erroredFiles.set(id, fileData);
          }
        }),
      );

      return { savedFiles, erroredFiles };
    },
  });
}

export class LibraryIndexedDBAdapter {
  /** IndexedDB database and store name */
  private static idb_name = STORAGE_KEYS.IDB_LIBRARY;
  /** library data store key */
  private static key = "libraryData";

  private static store = createStore(
    `${LibraryIndexedDBAdapter.idb_name}-db`,
    `${LibraryIndexedDBAdapter.idb_name}-store`,
  );

  static async load() {
    const IDBData = await get<LibraryPersistedData>(
      LibraryIndexedDBAdapter.key,
      LibraryIndexedDBAdapter.store,
    );

    return IDBData || null;
  }

  static save(data: LibraryPersistedData): MaybePromise<void> {
    return set(
      LibraryIndexedDBAdapter.key,
      data,
      LibraryIndexedDBAdapter.store,
    );
  }
}

/** LS Adapter used only for migrating LS library data
 * to indexedDB */
export class LibraryLocalStorageMigrationAdapter {
  static load() {
    const LSData = localStorage.getItem(
      STORAGE_KEYS.__LEGACY_LOCAL_STORAGE_LIBRARY,
    );
    if (LSData != null) {
      const libraryItems: ImportedDataState["libraryItems"] =
        JSON.parse(LSData);
      if (libraryItems) {
        return { libraryItems };
      }
    }
    return null;
  }
  static clear() {
    localStorage.removeItem(STORAGE_KEYS.__LEGACY_LOCAL_STORAGE_LIBRARY);
  }
}
