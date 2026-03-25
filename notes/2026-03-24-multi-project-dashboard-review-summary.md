# Plan Review Summary

**Plan:** docs/plans/multi-project-dashboard-plan.md **Rounds:** 2 **Final revision:** 2

---

## Issues Found & Fixed

### Round 1 — Critical Issues (all fixed in R2)

- **`window.history` calls bypass React Router and desync router state** — Five `pushState`/`replaceState` calls in `App.tsx` (lines 284, 301, 304) and `Collab.tsx` (lines 384, 492) navigate outside React Router's knowledge. Fixed in R2: Phase 5 enumerates all five call sites with explicit `navigate()` replacements; `Collab.tsx` (class component) receives `navigate` as a prop.

- **`ExcalidrawWrapper` does not remount on project switch — stale state and data corruption risk** — React reuses the component instance when only the `:id` param changes, meaning the canvas, refs, debounced save closures, and event listeners all retain the previous project's data. Fixed in R2: Phase 2 adds a `ProjectEditorRoute` wrapper that applies `key={projectId}` to `<ExcalidrawAPIProvider>`, forcing full teardown and remount on every project switch.

- **Migration file re-keying not atomic — data loss on partial failure** — Step 3c read old keys, wrote new `{projectId}:{fileId}` keys, and deleted old keys in a non-transactional sequence. A crash mid-migration could orphan files or corrupt the store. Fixed in R2: Phase 4 now specifies a three-phase approach — (1) copy files one-at-a-time via `keys()` + individual `get()` to avoid OOM, (2) set migration flag, (3) deferred cleanup of old keys on next load. Old keys are never deleted during migration itself, making re-runs genuinely idempotent.

- **Tab sync mechanism mischaracterized — BroadcastChannel replacement under-specified** (Agent 3 R1) — The plan incorrectly stated the current system uses `storage` event listeners; the actual mechanism is poll-on-focus via `isBrowserStorageStateNewer`. The BroadcastChannel replacement was under-specified with no description of how messages connect to the `syncData` flow in `App.tsx`. Fixed in R2: Phase 4 now accurately describes the poll-on-focus mechanism, explains why it breaks when scene data leaves localStorage, and specifies a four-step replacement: post a `{type, projectId, version}` message on save, set an in-memory dirty flag on receipt, check the flag on focus, reload from `SceneStore` if dirty.

### Round 1 — Must-Fix Issues (all fixed in R2)

- **`nanoid` is a transitive dependency, not a direct one** — The plan said nanoid was "already in the project" but it lives in `packages/excalidraw/package.json`, not `excalidraw-app/package.json`. Fixed: Phase 1 now explicitly adds `nanoid` to `excalidraw-app/package.json`.

- **`LocalData` is a static class — `projectId` threading not specified** — `LocalData.save()`, `flushSave()`, and `fileStorage` are all static with a single shared debounce. The plan didn't explain how `projectId` would flow through these without a per-project instance. Fixed: Phase 4 specifies capturing `projectId` in the debounce payload at call time (not execution time), flushing before navigation, and routing saves to `SceneStore.saveScene(projectId, ...)`.

- **BroadcastChannel tab sync consumer was unspecified** — The plan named the channel and message types but never described who listens or how messages connect to the existing sync logic. Fixed: see Critical tab sync fix above.

- **`stopCollaboration` navigates to origin root — bounces user to dashboard** — `Collab.tsx:384` pushes to `window.location.origin`, which with routing in place sends the user to the dashboard when ending a collab session. Fixed: Phase 6 "Changes Needed" now specifies navigating to `/project/${projectId}` instead.

- **`clearObsoleteFiles` will delete other projects' files** (Agent 3 R1) — The existing cleanup iterates all entries in `files-db` and deletes files not in the current canvas's `currentFileIds`. After namespacing, this would delete every other project's images. Fixed: Phase 4 now explicitly states cleanup must filter entries to the `{currentProjectId}:*` prefix before applying the unused-file heuristic, and keys must be compared in prefixed form.

- **`getCollaborationLink` embeds sender's local `projectId` in shared URLs** (Agent 3 R1) — Generated collab links like `https://host/project/abc123#room=...` are useless to recipients who don't have that `projectId` locally. Fixed: R2 introduces a dedicated `/join` route. Collab links now use `window.location.origin + "/join"` with the room hash, fully separating local project IDs from collab room IDs. `getCollaborationLink()` is explicitly updated in Phase 6.

- **`currentProjectIdAtom` creates a dual source of truth** (Agent 2 R1) — Having `projectId` in both the URL param and a Jotai atom creates a stale-tick problem if the atom is set in `useEffect`. Fixed: Phase 5 now establishes `useParams()` as the single authoritative source; `projectId` is passed explicitly to non-React code; the atom is "derived, not authoritative" and the plan recommends removing it entirely.

### Round 2 — Remaining Medium Issues Addressed

- **Collab join creates duplicate projects on re-open** — No deduplication when a user opens the same collab link multiple times. Fixed: `collabRoomId` field added to `ProjectMetadata`; the `/join` handler looks up existing projects by `collabRoomId` before creating a new one.

- **Migration `lastRetrieved` not reset — migrated files immediately GC'd** — `clearObsoleteFiles` deletes files older than 24 hours. Without resetting `lastRetrieved` on migration, all migrated files could be immediately garbage-collected. Fixed: Phase 4 step 3d now specifies setting `lastRetrieved: Date.now()` on all migrated file entries.

---

## Remaining Issues

### Medium

- **`exportToBackend` shareable link embeds `/project/:id` in URL** — `data/index.ts:282` constructs the URL from `window.location.href`, so links generated from within a project will be `https://host/project/abc123#json=id,key`. Recipients don't have that project ID locally. The fix is a one-line change: use `window.location.origin` instead of `href`. Not yet added to the plan's change tables. (Raised in R1 Agent 2, carried forward unaddressed through R2.)

- **`getCollaborationLink` fix is correct but buried in prose** — The fix is specified in Phase 6 but only in prose, not in the Files Changed table or the Phase 6 changes table. An implementer following the tables would miss the `data/index.ts` modification. Needs a row added to the change tables.

- **BroadcastChannel and event listeners not specified for unmount cleanup** — Phase 4 describes the sync mechanism but does not specify where the channel is created or that it must be closed in a `useEffect` cleanup. The `hashchange` listener also needs guarding to fire only on `#room=` changes, not all hash changes, to avoid double-initialization with React Router navigation. (Raised in R1 Agent 1 and R2 Agent 1; never addressed.)

- **`currentProjectIdAtom` decision left open** — Phase 5 recommends removing the atom but does not commit. If the implementer retains it in some places and uses explicit params in others, the persistence layer could inconsistently read from a potentially-stale atom. (R2 Agent 1.)

### Low / Impl-notes (deferred to implementation)

- `deleteProject` file cleanup requires full `keys()` scan — `idb-keyval` has no prefix query support; the plan doesn't acknowledge this approach is an O(n) full-table iteration. Acceptable for v1.
- Thumbnail storage inline in `ProjectMetadata` may bloat dashboard queries at 50+ projects. Acceptable for v1; lazy-loading from a separate store is the future path.
- `ExcalidrawAPIProvider` existing wrapping in `ExcalidrawApp` must be explicitly removed as part of Phase 2 restructuring — implied by the plan but not stated.

---

## Implementation Notes

_(Logged across all six review files)_

- **`BroadcastChannel` browser support cutoff:** Safari 15.4+ (March 2022). No polyfill needed for 2026, but worth confirming the app's target browser matrix.
- **Thumbnail generation timing:** Call `exportToBlob` debounced after saves with a 2–5 second window. Guard against generating thumbnails before images are fully loaded (incomplete thumbnails). Consider generating only on navigation away from the editor rather than on every save.
- **IndexedDB storage quota:** Moving scene data to IDB removes the ~5–10MB localStorage ceiling but IDB has its own quotas. Add error handling around IDB writes similar to the existing `isQuotaExceededError` pattern.
- **Migration ordering relative to routing:** Migration runs on app startup. The router must wait for migration to resolve before rendering any project route (async IDB operations; loading gate needed). After migration creates the legacy project, decide whether to auto-navigate to `/project/{id}` or show the dashboard with the migrated project visible.
- **`nanoid` import path:** Verify the import resolves correctly from `excalidraw-app` — it may be re-exported from `@excalidraw/common` or `@excalidraw/element` rather than available as a bare `nanoid` import.
- **Debounce closure and `projectId` capture:** With `key={projectId}` remounting, unmount should flush the debounce before the new project mounts. Verify `flushSave()` is called synchronously in the cleanup effect and that the debounce from `@excalidraw/common` supports flushing. A pending save from the old project must not fire after the new project's context is active.
- **`clearObsoleteFiles` memory pressure:** The current implementation calls `entries(filesStore)` which loads all binary blobs into memory. After namespacing, the correct approach is `keys()` filtered by prefix, then individual `get()` calls. Apply this same pattern to avoid loading all blobs.
- **Deferred legacy file key cleanup trigger:** The post-migration cleanup pass (delete un-prefixed legacy keys) needs an explicit trigger. Suggested: gate it on a second flag (`excalibur-legacy-files-cleaned`) checked on app load after `excalibur-migrated` is set.
- **`saveFiles` dead code:** `LocalFileManager.saveFiles` calls `updateBrowserStateVersion(STORAGE_KEYS.VERSION_FILES)`. After the BroadcastChannel migration, this localStorage write is dead code and should be removed in Phase 4.
- **`StoredScene.version` field:** Either define its increment/comparison semantics (e.g., monotonic counter compared by the receiving tab before setting dirty flag) or remove it from the initial interface — the dirty-flag approach works without version comparison.
- **BroadcastChannel `currentProjectId` null guard:** When wiring the message listener, guard against `currentProjectId` being null (dashboard view) to prevent the dashboard from attempting a scene reload.
- **`ExcalidrawApp` restructuring:** The component currently checks `window.location.pathname` for `/excalidraw-plus-export` then renders `Provider > ExcalidrawAPIProvider > ExcalidrawWrapper`. With routing, this becomes `Provider > BrowserRouter > Routes`, with `ExcalidrawAPIProvider` moving into `ProjectEditorRoute`. Treat this as part of Phase 2 implementation; it's implied by the plan but not called out as an explicit change to `ExcalidrawApp`.

---

## Reviewer Personas Used

| Persona | Focus Area |
| --- | --- |
| **Agent 1 — Architectural Review** | System-level architecture: routing integration, history API interop, migration correctness, data integrity, IDB limitations, dependency management |
| **Agent 2 — React Architecture** | React Router internals, Jotai atom lifecycle, Excalidraw component lifecycle, re-render risks, hook dependency arrays, UX flow correctness |
| **Agent 3 — Storage & Persistence** | IndexedDB migration strategy, BroadcastChannel design, Firebase interaction, file store namespacing, data integrity under partial failure, storage quota and memory pressure |
