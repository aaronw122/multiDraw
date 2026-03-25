# Multi-Project Dashboard Plan Review — Agent 3 (Storage & Persistence)

**Reviewer focus:** IndexedDB migration, BroadcastChannel, Firebase interaction, data integrity, storage quota **Plan revision:** 1 **Date:** 2026-03-24

---

## [Critical] Tab sync mechanism is mischaracterized — BroadcastChannel replacement is under-specified

**Location:** Phase 4, "Tab Sync: Replace with BroadcastChannel"

**Issue:** The plan states the current system uses `window.addEventListener("storage", ...)` events for tab sync (Context section: "Tab sync: `storage` events on localStorage keys"). This is wrong. The actual mechanism is:

1. `updateBrowserStateVersion()` writes a timestamp to localStorage keys (`version-dataState`, `version-files`)
2. On `visibilitychange`/`focus`, `syncData()` calls `isBrowserStorageStateNewer()` to compare the localStorage timestamp against an in-memory timestamp
3. If newer, it re-imports from localStorage

There is **no `storage` event listener** anywhere in the codebase. Sync is poll-on-focus, not event-driven. This matters because:

- The plan says "Replace `window.addEventListener('storage', ...)` with `BroadcastChannel`" — there's nothing to replace
- The actual sync trigger (visibility/focus polling) must be preserved or replaced, not just the data channel
- BroadcastChannel is push-based (messages arrive immediately), while the current system is pull-on-focus. Switching to push means the app must handle incoming scene updates while the user is actively drawing — a fundamentally different sync model that needs reconciliation logic the plan doesn't mention

**Suggested fix:** Rewrite Phase 4 tab sync section to accurately describe the current mechanism and choose one of:

- **(A) Keep poll-on-focus, change the version-check channel:** Replace localStorage version timestamps with BroadcastChannel notifications that update an in-memory "dirty" flag. On focus, check the flag instead of localStorage. Minimal behavioral change.
- **(B) Switch to push-based sync:** Use BroadcastChannel messages to trigger immediate scene reloads. Requires defining what happens when an update arrives while the user is editing (reconciliation, conflict resolution). This is a bigger design decision that should be explicit in the plan.

Option A is safer and closer to the current behavior. Either way, the plan must describe the actual trigger mechanism, not just the data channel.

---

## [Critical] Migration step 3c (re-keying files) risks data loss on partial failure

**Location:** Phase 4, "Migration Script", step 3c

**Issue:** The migration re-keys existing files in `files-db` from `{fileId}` to `{projectId}:{fileId}`. This is a destructive operation on a potentially large dataset (images can be multi-MB each). The plan says the migration is "idempotent — safe to re-run" but doesn't explain how.

Problems:

1. **No transaction boundary.** `idb-keyval` doesn't support multi-key transactions. If the browser crashes mid-migration after writing some `projectId:fileId` keys but before deleting the old `fileId` keys (or vice versa), the store is in an inconsistent state.
2. **Idempotency claim is unsupported.** If old keys are deleted after new keys are written, re-running would find no old keys and create a project with no files. If old keys are kept until a flag is set, a crash before the flag means duplicate storage (acceptable) but the flag-check must also verify the new keys actually exist.
3. **Memory pressure.** `entries(filesStore)` loads all binary file data into memory at once. For a user with many large images, this could cause an OOM crash during migration.

**Suggested fix:** Specify the migration algorithm:

- Use a copy-then-flag approach: write new `projectId:fileId` entries first, set migration flag, then schedule old key cleanup as a separate deferred step (not blocking app startup)
- Process files one at a time (iterate keys, copy individually) to avoid memory pressure
- Define the idempotency invariant: "If the flag is not set, the old keys are the source of truth. If the flag is set, the new keys are authoritative."
- Add a verification step: after migration, confirm at least one new-format key exists before considering it successful

---

## [Must-fix] `clearObsoleteFiles` will delete other projects' files

**Location:** Phase 4, "File Store Namespacing"

**Issue:** The plan says to scope `clearObsoleteFiles` to "current project's prefix," but the current implementation (LocalData.ts line 54-70) calls `entries(filesStore)` and deletes any file not in the current canvas's `currentFileIds` and older than 24 hours. After namespacing, this logic iterates ALL entries across ALL projects and deletes files that aren't on the CURRENT project's canvas.

This means: open Project A, its cleanup runs, and it deletes all of Project B's images (since they're not in Project A's `currentFileIds`).

**Suggested fix:** Add explicit guidance in the plan:

- `clearObsoleteFiles` must filter entries by the current project's `{projectId}:` prefix before applying the unused-file heuristic
- The `currentFileIds` comparison must also use prefixed keys: compare `{projectId}:{fileId}` not just `fileId`
- Consider whether the 24-hour expiry heuristic still makes sense in a multi-project world (a file unused for 24 hours in one project is normal if the user was working on other projects)

---

## [Must-fix] `LocalData` is a static class — cannot hold per-project state

**Location:** Phase 4/5, modifications to `LocalData.ts`

**Issue:** The plan says "modify [LocalData] to accept `projectId` and route to SceneStore instead of localStorage." But `LocalData` is entirely static — static methods, static `_save` debounce, static `fileStorage`, static `locker`. There is one `_save` debounce timer shared globally.

Consequences:

- If the user quickly switches from Project A to Project B, the debounced save from Project A could fire and write Project A's elements to Project B's store (since `projectId` would have changed in the closure)
- The `fileStorage` instance's `getFiles`/`saveFiles` methods reference `filesStore` directly with no project scoping — the `projectId` must be threaded through these closures

**Suggested fix:** The plan should specify one of:

- **(A) Flush on project switch:** Before navigating away from a project, call `LocalData.flushSave()` and then update the project ID. This ensures the debounced save fires with the correct project context. Add this as an explicit step in Phase 5's navigation handling.
- **(B) Capture `projectId` at call time:** Change `_save` to capture `projectId` in the debounce payload (not read it from a mutable ref at execution time). This requires modifying the debounce to use the arguments from the most recent call, which is already how `debounce` typically works — but the plan should call this out explicitly.

Option A is simpler and should be the minimum. Option B is defense-in-depth.

---

## [Must-fix] `getCollaborationLink` produces wrong URLs for `/project/:id` routes

**Location:** Phase 6, "Link Format Change (Automatic)"

**Issue:** The plan claims collab links auto-adapt because `getCollaborationLink` uses `window.location.origin + window.location.pathname`. It says the new format will be `https://host/project/{projectId}#room={roomId},{roomKey}`.

The problem: when a recipient opens this link, the router matches `/project/{projectId}` and tries to load that project from local IndexedDB. But the recipient doesn't have that `projectId` in their store — it's a local ID from the sender's machine. The plan's Phase 6 "Auto-Create Project on Collab Join" section partially addresses this, but:

1. The `projectId` in the URL is meaningless to the recipient (it's the sender's local nanoid)
2. The recipient's auto-created project will have a DIFFERENT local ID
3. If the recipient bookmarks the link or shares it further, the embedded `projectId` is the original sender's — still meaningless

**Suggested fix:** Collab links should NOT embed the sender's `projectId` in the path. Options:

- **(A) Use a dedicated collab route:** e.g., `/#room={roomId},{roomKey}` (keep the current format). The `DashboardOrLegacyRedirect` handler creates/finds a local project associated with that `roomId` and redirects to `/project/{localId}#room=...`. Store a `roomId -> projectId` mapping in ProjectStore.
- **(B) Use roomId as the URL path segment:** e.g., `/room/{roomId}#key={roomKey}`. This is a separate route from `/project/:id` and clearly distinguishes local projects from collab sessions.

Either way, the plan needs to separate "local project ID" from "collab room ID" in URLs.

---

## [Medium] No plan for project-to-roomId association persistence

**Location:** Phase 6, collab per-project

**Issue:** When a user starts collaboration on a project, a `roomId` is generated. But there's no plan for persisting the association between `projectId` and `roomId`. If the user closes the tab and reopens the project later, they won't be reconnected to the same room — they'll get a fresh local canvas with no way to rejoin.

Currently, the collab state lives in the URL hash and is ephemeral. In a multi-project world, the user expects to return to a project and still be in the collab session (or at least see the last-synced state).

**Suggested fix:** Add a `collabRoomId` and `collabRoomKey` field to `ProjectMetadata`. When collaboration starts, persist these. When opening a project that has collab metadata, auto-rejoin (or at least offer to). This also solves the URL problem from the previous finding — the project knows its room.

---

## [Medium] `StoredScene.version` field is unused and confusing

**Location:** Phase 4, SceneStore interface

**Issue:** The `StoredScene` interface includes a `version: number` field, but no code consumes it and the plan doesn't describe what it's for. If it's for conflict detection (tab sync), the plan should say how it's compared. If it's for future use, it should be omitted from the initial implementation to avoid confusion with Excalidraw's own `getSceneVersion()`.

**Suggested fix:** Either:

- Remove `version` from the interface (add it later if needed)
- Or define its purpose: "Incremented on each save. Used by BroadcastChannel sync to determine if the local scene is stale." and describe the comparison logic

---

## [Medium] `deleteProject` file cleanup via prefix scan is O(n) over all files

**Location:** Phase 7, "Delete Project Cleanup", step 3

**Issue:** The plan says to "delete all files with `{projectId}:*` prefix from files store." With `idb-keyval`, this requires calling `keys(filesStore)` to get ALL keys across ALL projects, then filtering by prefix, then deleting matching ones individually. For a user with many projects and many images, this is expensive.

**Suggested fix:** This is acceptable for v1 but add an Impl-note: consider maintaining a per-project file manifest (a list of fileIds stored alongside the scene) to enable O(1) lookup of which files to delete, rather than scanning the entire store. Alternatively, consider switching from `idb-keyval` to raw IndexedDB with a compound index on `[projectId, fileId]`.

---

## [Medium] Migration doesn't handle the `files-db` store's existing key format

**Location:** Phase 4, Migration Script

**Issue:** The migration plan re-keys files from `{fileId}` to `{projectId}:{fileId}`. But the existing `files-db` stores `BinaryFileData` objects with a `lastRetrieved` timestamp. The plan doesn't specify whether the migrated files should have their `lastRetrieved` reset. If not reset, the `clearObsoleteFiles` function (which deletes files older than 24 hours by `lastRetrieved`) might immediately garbage-collect migrated files after migration.

**Suggested fix:** Specify that migration should set `lastRetrieved: Date.now()` on all migrated file entries to prevent immediate garbage collection.

---

## [Low] Thumbnail storage in ProjectMetadata may bloat metadata queries

**Location:** Phase 1, Data Model

**Issue:** `ProjectMetadata.thumbnail` is a base64 data URL stored inline. `listProjects()` calls `getMany()` on all project keys, deserializing every thumbnail into memory. For a user with 50+ projects, each with a ~320px thumbnail (roughly 20-50KB as base64), this could be 1-2.5MB of data loaded just to render the dashboard.

**Suggested fix:** Impl-note: if dashboard performance degrades with many projects, move thumbnails to a separate IDB store keyed by `projectId`, and load them lazily (e.g., as cards scroll into view). For v1, inline is acceptable.

---

## [Impl-note] BroadcastChannel per-project channel naming may leak channels

**Location:** Phase 4, Tab Sync

The plan uses `excalibur-sync-{projectId}` as channel names. BroadcastChannel instances must be explicitly closed. If a user opens 10 projects in sequence without closing tabs, the old channels accumulate. During implementation, ensure channels are closed in the component's cleanup/unmount.

---

## [Impl-note] `idb-keyval` `entries()` loads all values — watch for memory

**Location:** Phase 4 (migration, clearObsoleteFiles)

Both migration and file cleanup use `entries()` which loads all key-value pairs into memory. For large file stores, this could be problematic. During implementation, consider using raw IndexedDB cursors for these operations.

---

## [Impl-note] Race between migration and first render

**Location:** Phase 4, Migration Script

The migration runs "on app startup." If it's async (which it must be — IDB operations are async), there's a window where the app might try to load a project before migration completes. During implementation, ensure the router/app waits for migration to resolve before rendering any project route.

---

## Summary

| Severity | Count | Key themes |
| --- | --- | --- |
| Critical | 2 | Tab sync mechanism mischaracterized; migration data loss risk |
| Must-fix | 3 | Cross-project file deletion; static class can't hold project state; collab URL design flaw |
| Medium | 3 | No roomId persistence; unused version field; file cleanup performance |
| Low | 1 | Thumbnail bloat |
| Impl-note | 3 | Channel cleanup, memory pressure, migration race |
