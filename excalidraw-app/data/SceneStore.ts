import { createStore, get, set, del } from "idb-keyval";

import { clearAppStateForLocalStorage } from "@excalidraw/excalidraw/appState";

import { CANVAS_SEARCH_TAB, DEFAULT_SIDEBAR } from "@excalidraw/common";

import { getNonDeletedElements } from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";

import { broadcastSceneUpdate } from "./tabSync";

export interface StoredScene {
  projectId: string;
  elements: ExcalidrawElement[];
  appState: Partial<AppState>;
  version: number;
}

export const sceneStore = createStore("multidraw-scenes-db", "scenes-store");

export const loadScene = async (
  projectId: string,
): Promise<StoredScene | undefined> => {
  return get<StoredScene>(projectId, sceneStore);
};

export const saveScene = async (
  projectId: string,
  elements: readonly ExcalidrawElement[],
  appState: AppState,
): Promise<void> => {
  const cleanedAppState = clearAppStateForLocalStorage(appState);

  if (
    cleanedAppState.openSidebar?.name === DEFAULT_SIDEBAR.name &&
    cleanedAppState.openSidebar.tab === CANVAS_SEARCH_TAB
  ) {
    cleanedAppState.openSidebar = null;
  }

  const existing = await get<StoredScene>(projectId, sceneStore);
  const version = (existing?.version ?? 0) + 1;

  const stored: StoredScene = {
    projectId,
    elements: getNonDeletedElements(elements) as ExcalidrawElement[],
    appState: cleanedAppState,
    version,
  };

  await set(projectId, stored, sceneStore);

  broadcastSceneUpdate(projectId, version);
};

export const deleteScene = async (projectId: string): Promise<void> => {
  await del(projectId, sceneStore);
};
