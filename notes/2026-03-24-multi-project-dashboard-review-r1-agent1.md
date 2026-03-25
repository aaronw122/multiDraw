# Plan Review: Multi-Project Dashboard (R1)

**Reviewer:** Architectural review agent **Date:** 2026-03-24 **Plan revision:** 1

---

## [Critical] `window.history` calls bypass react-router and will desync router state

**Location:** Phase 5 (ExcalidrawWrapper integration), affects Phase 2 (Routing)

**Issue:** The existing codebase has five `window.history.replaceState`/`pushState` calls that navigate directly to `window.location.origin` (the root):

- `App.tsx:284` — after loading a json backend link
- `App.tsx:301` — when user declines overwrite on external scene
- `App.tsx:304` — after loading an external URL
- `Collab.tsx:384` — when stopping collaboration
- `Collab.tsx:492` — when starting collaboration (pushes collab hash URL)

Once react-router's `BrowserRouter` owns the history, these raw `pushState`/`replaceState` calls will change the URL without notifying react-router. The router will continue rendering whatever component it had, creating a URL/UI desync. For example, stopping collaboration pushes to `/` (which should show the dashboard) but the router will keep rendering `ExcalidrawWrapper`.

**Suggested fix:** Add a phase 5 sub-task: "Replace all `window.history.replaceState/pushState` calls in `App.tsx` and `Collab.tsx` with react-router's `navigate()` (or `useNavigate` hook). For `Collab.tsx`, which is a class component, pass `navigate` as a prop or use a wrapper." Enumerate all five call sites in the plan so none are missed.

---

## [Critical] ExcalidrawWrapper does not remount on project switch — stale state across projects

**Location:** Phase 5 (ExcalidrawWrapper integration), Phase 2 (Routing)

**Issue:** The route `/project/:id` renders `<ExcalidrawWrapper />`. When a user navigates from `/project/A` to `/project/B` (e.g., via dashboard -> different project), React will reuse the same component instance because the route structure is identical — only the param changes. `ExcalidrawWrapper` initializes its scene in a `useEffect` that depends on `[isCollabDisabled, collabAPI, excalidrawAPI, setLangCode, loadImages]` — none of which include `projectId`. This means:

1. The effect won't re-run when `projectId` changes.
2. The Excalidraw canvas, all refs, debounced save closures, event listeners, and the `initialStatePromiseRef` will retain project A's data.
3. Saves will go to project A's slot even though the URL says project B.

This is a data-corruption-level bug.

**Suggested fix:** Add `key={projectId}` to the `<ExcalidrawWrapper />` element in the route definition so React fully unmounts and remounts when switching projects. This is the simplest correct approach and matches how the existing code is structured (one-time initialization in effects). The plan should call this out explicitly in Phase 2's route structure:

```tsx
<Route
  path="/project/:id"
  element={
    <ProjectKeyWrapper /> // reads useParams, passes key
  }
/>
```

Or more simply:

```tsx
// Inside route element, read param and use as key
<ExcalidrawAPIProvider key={projectId}>
  <ExcalidrawWrapper />
</ExcalidrawAPIProvider>
```

---

## [Critical] Migration step 3c (re-keying files) is not atomic and can duplicate/lose data

**Location:** Phase 4 — Migration Script, step 3c

**Issue:** The plan says to "re-key existing files in `files-db` with the new project prefix." This means reading each file by its old key, writing it under a new `{projectId}:{fileId}` key, then (presumably) deleting the old key. This is a multi-step operation on IndexedDB which has no cross-store transaction support via `idb-keyval`.

If the migration is interrupted between the write and delete (tab close, crash, OOM), some files exist under both keys. If the migration flag (`excalibur-migrated`) is set before all files are migrated, the remaining files are orphaned. The plan says "idempotent — safe to re-run," but the flag is set in step 3d, after 3c, so a failure in 3c that doesn't set the flag is fine — but a failure _during 3c_ where some files are already re-keyed means a re-run will attempt to read old keys that may already be deleted.

**Suggested fix:** Specify the migration strategy more precisely:

1. Read old key, write new key (never delete old keys during migration).
2. Set migration flag.
3. Schedule old-key cleanup as a separate, subsequent step (e.g., on next app load after migration flag is set).
4. The cleanup step iterates `files-db` entries, deletes any key that does NOT match the `{projectId}:{fileId}` pattern.

This makes migration truly idempotent: re-running always reads old keys (still present), writes new keys (idempotent put), and sets the flag.

---

## [Must-fix] `nanoid` is not a direct dependency of `excalidraw-app`

**Location:** Phase 1 — Dependencies

**Issue:** The plan states "nanoid — already in the project (used by Excalidraw core)." However, `nanoid` is a dependency of `packages/excalidraw/package.json`, not `excalidraw-app/package.json`. In a monorepo with hoisted dependencies this may resolve at runtime, but it's an implicit dependency that could break on a lockfile change, a different package manager, or a dependency update. The plan should not rely on transitive dependencies for a new feature's core ID generation.

**Suggested fix:** Add `nanoid` as an explicit dependency in `excalidraw-app/package.json`, or use the re-export from `@excalidraw/excalidraw` if one exists. Call this out in Phase 1.

---

## [Must-fix] `LocalData` is a static class — plan underestimates the refactoring needed to pass `projectId`

**Location:** Phase 4 (Modify `LocalData`), Phase 5 (`onChange` handler)

**Issue:** `LocalData` is implemented as a fully static class: `LocalData.save()`, `LocalData.flushSave()`, `LocalData.fileStorage` are all static. The debounced `_save` method is a static closure created once at class definition time. The plan says to "modify it to accept `projectId` and route to SceneStore" — but this is harder than it sounds:

1. `LocalData.save()` is called from `onChange` (line 690 in App.tsx) which fires on every canvas change. Adding a `projectId` parameter is straightforward at the call site.
2. But `LocalData.flushSave()` is called from `onUnload` and `visibilityChange` handlers (lines 620, 625) which have no access to `projectId` — they're closures over nothing project-specific.
3. The static `fileStorage` (`LocalFileManager`) reads/writes to `filesStore` with bare `fileId` keys. Namespacing requires either making `fileStorage` project-aware (breaking the static pattern) or creating per-project instances.

The plan doesn't address how `projectId` flows into `flushSave` and `fileStorage`. Since `flushSave` just forces the debounced function to execute its last-called arguments, `projectId` can be captured if it's passed to `save()`. But this needs to be stated.

**Suggested fix:** Add a sub-section to Phase 4 or 5 that specifies the `projectId` threading strategy:

- Option A: Add `projectId` as the first parameter to `LocalData.save()`. The debounced `_save` captures it from the most recent call. `flushSave` replays the last call (including `projectId`). `fileStorage` operations receive `projectId` from the save call chain.
- Option B: Store `currentProjectId` in a module-level variable (or read from the Jotai atom) inside `LocalData`, avoiding parameter threading.
- Either way, specify the approach so the implementer doesn't discover this mid-implementation.

---

## [Must-fix] `tabSync.ts` BroadcastChannel replacement breaks the `syncData` consumer in `App.tsx`

**Location:** Phase 4 (Tab Sync), Phase 5

**Issue:** The current `syncData` function in `App.tsx` (lines 560-617) is triggered by `visibilityChange` and `focus` events, and calls `isBrowserStorageStateNewer()` which reads version timestamps from localStorage. The plan says to replace the `storage` event listener with `BroadcastChannel`, but `tabSync.ts` never _had_ a `storage` event listener — it exposes `isBrowserStorageStateNewer` and `updateBrowserStateVersion`, which write/read version numbers to localStorage. The _implicit_ tab sync mechanism is that when tab B writes to localStorage, tab A receives a `storage` event (handled by the browser), which triggers `visibilityChange`/`focus` handlers that call `isBrowserStorageStateNewer`.

Once scene data moves to IndexedDB, `updateBrowserStateVersion` will no longer be called for scene saves (since there's no localStorage write to trigger). The `storage` event won't fire. The `syncData` function will never detect changes from other tabs.

The plan says to use BroadcastChannel with message types `scene-update` and `file-update`, but doesn't specify who listens to these messages or how they connect to the existing `syncData` flow in `App.tsx`.

**Suggested fix:** Expand the Phase 4 tab sync section to include:

1. On save in `SceneStore`, post a `{ type: "scene-update", projectId, version }` message to the BroadcastChannel.
2. In `App.tsx`, replace the `visibilityChange`-based sync with a `BroadcastChannel.onmessage` listener that checks if the incoming `projectId` matches the current project and, if so, reloads from `SceneStore`.
3. The `isBrowserStorageStateNewer` / `updateBrowserStateVersion` functions in `tabSync.ts` become legacy (used only during migration period). State this explicitly.

---

## [Must-fix] Collab `stopCollaboration` navigates to origin root, will land on dashboard instead of staying in project

**Location:** Phase 6 (Collab Per-Project)

**Issue:** In `Collab.tsx:384`, `stopCollaboration` calls `window.history.pushState({}, APP_NAME, window.location.origin)`, which navigates to `/`. After routing is added, this will navigate the user to the dashboard when they stop a collab session. The expected behavior is to stay in the editor with the project's local state.

The plan's Phase 6 says "No changes needed" for the Collab component's core behavior, but this navigation side effect needs to change.

**Suggested fix:** Add to Phase 6: "Modify `stopCollaboration` to navigate to `/project/{projectId}` (without the collab hash) instead of root. This keeps the user in the editor with their local copy."

---

## [Medium] `DashboardOrLegacyRedirect` creates a project for every collab join — no deduplication

**Location:** Phase 6 — Auto-Create Project on Collab Join

**Issue:** When a user opens a collab link, the plan creates a new project every time. If the same user opens the same collab link multiple times (e.g., bookmarked it, refreshed the page), they'll accumulate duplicate "Shared Drawing" projects in their dashboard. There's no mapping from `roomId` to `projectId`.

**Suggested fix:** Add an optional `roomId` field to `ProjectMetadata`. When creating a project for a collab join, first check if a project with that `roomId` already exists. If so, navigate to it instead of creating a duplicate. Add this to Phase 6's "Auto-Create Project" section.

---

## [Medium] `initializeScene` uses `window.location.hash` and `window.location.search` — incompatible with react-router params

**Location:** Phase 5 — Modify `initializeScene`

**Issue:** `initializeScene` (App.tsx lines 216-372) reads the room/json/url data from `window.location.hash` and `window.location.search` directly. The plan says to "accept `projectId` parameter" and call `SceneStore.loadScene(projectId)` instead of `importFromLocalStorage()`. But `initializeScene` is a standalone async function defined outside the component — it doesn't have access to react-router hooks.

More importantly, after routing, the URL structure changes from `/#room=X,Y` to `/project/:id#room=X,Y`. The hash parsing (`window.location.hash.match(...)`) still works since the hash is preserved. But the `window.location.search` parsing for `?id=` may conflict with the `:id` route param. The plan should clarify which `id` is which.

**Suggested fix:** In Phase 5, specify:

1. `initializeScene` receives `projectId` as a parameter (from `useParams`), not from URL parsing.
2. The legacy `?id=` search param (used for shared links) should be documented as distinct from the route `:id` param.
3. Consider renaming the search param check or removing it if it's superseded by the new routing.

---

## [Medium] No plan for ExcalidrawWrapper cleanup on unmount (BroadcastChannel, event listeners)

**Location:** Phase 4 (Tab Sync), Phase 5

**Issue:** The plan adds a `BroadcastChannel` per project (`excalibur-sync-{projectId}`). When the user navigates from the editor back to the dashboard, the channel needs to be closed. If using `key={projectId}` for remount (per the finding above), the component unmounts fully, but the BroadcastChannel won't auto-close unless explicitly closed in a cleanup function.

Additionally, the existing `hashchange` event listener in `ExcalidrawWrapper` (line 635) may fire when react-router navigates, causing unexpected `initializeScene` calls.

**Suggested fix:** Add a note in Phase 4/5 that:

1. BroadcastChannel must be closed in the useEffect cleanup.
2. The `hashchange` listener needs review — react-router navigation may trigger it depending on whether the hash changes. Consider whether this listener is still needed after routing is in place, or whether it should be scoped to only fire for collab hash changes.

---

## [Medium] `deleteProject` file cleanup uses prefix scan but `idb-keyval` has no prefix iteration

**Location:** Phase 7 — Delete Project Cleanup, step 3

**Issue:** The plan says to "delete all files with `{projectId}:*` prefix from files store." However, `idb-keyval` does not support prefix queries or range scans. The only way to find keys with a given prefix is to call `keys(filesStore)` (loading all keys into memory) and filter. For a user with many projects and files, this is O(n) over all files across all projects for every delete.

**Suggested fix:** This is workable but the plan should acknowledge the approach: "Iterate all keys via `keys(filesStore)`, filter by prefix, delete matching entries." Alternatively, consider using a separate IDB store per project for files (one `createStore` per project), which makes deletion a simple `clear()`. State the chosen approach.

---

## [Low] `ExcalidrawAPIProvider` wrapping in route definition may be redundant

**Location:** Phase 2 — Route Structure

**Issue:** The current `ExcalidrawApp` component (line 1278-1283) already wraps `ExcalidrawWrapper` in `<ExcalidrawAPIProvider>`. The plan's route definition also shows `<ExcalidrawAPIProvider>` wrapping the route element. If `ExcalidrawApp` is refactored to become the router host, one of these wrappings needs to be removed, or the provider will be doubled.

**Suggested fix:** Clarify in Phase 2 that the existing `ExcalidrawAPIProvider` in `ExcalidrawApp` moves into the route element, and is removed from the top-level `ExcalidrawApp` component (which now only provides `Provider store={appJotaiStore}` and `TopErrorBoundary` at the top level, with routes inside).

---

## [Impl-note] BroadcastChannel fallback for older browsers / web workers

`BroadcastChannel` is well-supported in modern browsers but has no Safari support before 15.4. If the app needs to support Safari < 15.4, a polyfill or fallback is needed. Worth checking target browser matrix during implementation.

## [Impl-note] Thumbnail generation performance

`exportToBlob` can be expensive for complex drawings. The plan says "call debounced after saves." During implementation, ensure the debounce window is long enough (e.g., 2-5 seconds) to avoid blocking the main thread on every keystroke. Consider generating thumbnails only on navigation away from the editor rather than on every save.

## [Impl-note] IndexedDB storage quota

Moving scene data to IndexedDB removes the ~5-10MB localStorage ceiling but IndexedDB has its own quotas (varies by browser, typically much larger). For very large drawings with many images, quota errors are still possible. During implementation, add error handling around IDB writes similar to the existing `isQuotaExceededError` pattern.

## [Impl-note] Migration ordering relative to routing

The migration runs "on app startup" (Phase 4) but routing is added in Phase 2. If the migration creates a project and sets `excalibur-migrated`, the dashboard needs to handle the case where the flag is set but the user lands on `/`. The migration should integrate with the router — e.g., after creating the migrated project, consider whether to auto-navigate to `/project/{id}` or show the dashboard with the new project visible. Decide during implementation.
