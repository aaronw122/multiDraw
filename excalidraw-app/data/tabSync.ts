import { STORAGE_KEYS } from "../app_constants";

// ---------------------------------------------------------------------------
// Legacy poll-on-focus mechanism (kept for migration transition period)
// ---------------------------------------------------------------------------

const LOCAL_STATE_VERSIONS = {
  [STORAGE_KEYS.VERSION_DATA_STATE]: -1,
  [STORAGE_KEYS.VERSION_FILES]: -1,
};

type BrowserStateTypes = keyof typeof LOCAL_STATE_VERSIONS;

export const isBrowserStorageStateNewer = (type: BrowserStateTypes) => {
  const storageTimestamp = JSON.parse(localStorage.getItem(type) || "-1");
  return storageTimestamp > LOCAL_STATE_VERSIONS[type];
};

export const updateBrowserStateVersion = (type: BrowserStateTypes) => {
  const timestamp = Date.now();
  try {
    localStorage.setItem(type, JSON.stringify(timestamp));
    LOCAL_STATE_VERSIONS[type] = timestamp;
  } catch (error) {
    console.error("error while updating browser state verison", error);
  }
};

export const resetBrowserStateVersions = () => {
  try {
    for (const key of Object.keys(
      LOCAL_STATE_VERSIONS,
    ) as BrowserStateTypes[]) {
      const timestamp = -1;
      localStorage.setItem(key, JSON.stringify(timestamp));
      LOCAL_STATE_VERSIONS[key] = timestamp;
    }
  } catch (error) {
    console.error("error while resetting browser state verison", error);
  }
};

// ---------------------------------------------------------------------------
// BroadcastChannel-based tab sync
// ---------------------------------------------------------------------------

const CHANNEL_NAME = "excalibur-sync";

type SyncMessage =
  | { type: "scene-update"; projectId: string; version: number }
  | { type: "file-update"; projectId: string; fileId: string };

let channel: BroadcastChannel | null = null;

const getChannel = (): BroadcastChannel => {
  if (!channel) {
    channel = new BroadcastChannel(CHANNEL_NAME);
  }
  return channel;
};

let dirtyProjectId: string | null = null;
const dirtyFiles = new Set<string>();
let currentProjectId: string | null = null;
let onSceneDirty: (() => void) | null = null;

/**
 * Initialize BroadcastChannel listener for the given project.
 * Call when entering a project editor. Returns a cleanup function.
 */
export const initTabSync = (
  projectId: string,
  callbacks: {
    onSceneDirty: () => void;
  },
): (() => void) => {
  currentProjectId = projectId;
  onSceneDirty = callbacks.onSceneDirty;
  dirtyProjectId = null;
  dirtyFiles.clear();

  const ch = getChannel();
  ch.onmessage = handleMessage;

  const handleVisibility = () => {
    if (
      document.visibilityState === "visible" &&
      dirtyProjectId === projectId
    ) {
      dirtyProjectId = null;
      dirtyFiles.clear();
      onSceneDirty?.();
    }
  };

  const handleFocus = () => {
    if (dirtyProjectId === projectId) {
      dirtyProjectId = null;
      dirtyFiles.clear();
      onSceneDirty?.();
    }
  };

  document.addEventListener("visibilitychange", handleVisibility);
  window.addEventListener("focus", handleFocus);

  return () => {
    currentProjectId = null;
    onSceneDirty = null;
    dirtyProjectId = null;
    dirtyFiles.clear();
    document.removeEventListener("visibilitychange", handleVisibility);
    window.removeEventListener("focus", handleFocus);
  };
};

const handleMessage = (event: MessageEvent<SyncMessage>) => {
  const msg = event.data;
  if (!currentProjectId || msg.projectId !== currentProjectId) {
    return;
  }

  if (msg.type === "scene-update" || msg.type === "file-update") {
    dirtyProjectId = msg.projectId;
    if (msg.type === "file-update") {
      dirtyFiles.add(msg.fileId);
    }

    if (document.visibilityState === "visible") {
      dirtyProjectId = null;
      dirtyFiles.clear();
      onSceneDirty?.();
    }
  }
};

/**
 * Broadcast a scene update to other tabs.
 * Called from SceneStore.saveScene().
 */
export const broadcastSceneUpdate = (
  projectId: string,
  version: number,
): void => {
  try {
    getChannel().postMessage({
      type: "scene-update",
      projectId,
      version,
    } as SyncMessage);
  } catch {
    // BroadcastChannel may not be available in all environments
  }
};

/**
 * Broadcast a file update to other tabs.
 */
export const broadcastFileUpdate = (
  projectId: string,
  fileId: string,
): void => {
  try {
    getChannel().postMessage({
      type: "file-update",
      projectId,
      fileId,
    } as SyncMessage);
  } catch {
    // BroadcastChannel may not be available in all environments
  }
};
