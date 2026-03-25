# Multi-Project Dashboard Plan Review R2 — Agent 3 (Storage & Persistence)

**Reviewer focus:** IndexedDB migration, BroadcastChannel, Firebase interaction, data integrity, storage quota **Plan revision:** 2 **Prior review:** R1 **Date:** 2026-03-24

---

## R1 Issue Resolution Status

### [Critical] Tab sync mechanism mischaracterized — RESOLVED

R1 flagged that the plan incorrectly described the current tab sync as using `storage` event listeners. R2 now accurately describes the poll-on-focus mechanism (`isBrowserStorageStateNewer` / `updateBrowserStateVersion`) and correctly identifies why it breaks when scene data moves to IndexedDB (the localStorage version write stops happening).

The plan chose Option A from R1's suggestion (keep poll-on-focus semantics, use BroadcastChannel to set a dirty flag, check on focus). This is the right call. The four-step replacement mechanism in Phase 4 is clear and correct.

**Status: Fixed. No new issues introduced.**

---

### [Critical] Migration step 3c (re-keying files) risks data loss — RESOLVED

R2 now specifies:

- Two-phase copy-then-flag approach (copy first, set flag second, deferred cleanup third)
- One-at-a-time file iteration via `keys()` then individual `get()` (avoids OOM from `entries()`)
- Idempotency rationale: if crash happens between Phase 1 and Phase 2, re-running is safe because writes are idempotent
- `lastRetrieved = Date.now()` on migrated files to prevent GC

**Status: Fixed. No new issues introduced.**

---

### [Must-fix] `clearObsoleteFiles` will delete other projects' files — RESOLVED

Phase 4 "File Store Namespacing" now explicitly states: "must scope to entries matching `{currentProjectId}:*` prefix only" and calls out that without the prefix filter, cleanup deletes files from other projects. Also mentions resetting `lastRetrieved` on migrated files.

**Status: Fixed. No new issues introduced.**

---

### [Must-fix] `LocalData` is static — cannot hold per-project state — RESOLVED

Phase 4 now specifies both defensive measures:

1. Capture `projectId` in the debounce payload at call time (not execution time)
2. Flush before navigation (explicit step in Phase 5 nav handling)
3. Notes that `key={projectId}` unmount triggers flush via cleanup effect

**Status: Fixed. No new issues introduced.**

---

### [Must-fix] `getCollaborationLink` produces wrong URLs — RESOLVED

R2 introduces a dedicated `/join` route. Collab links now use `https://host/join#room={roomId},{roomKey}` — no sender `projectId` in the URL. The `/join` handler finds/creates a local project and redirects. `getCollaborationLink()` is explicitly called out as needing to change from `window.location.origin + window.location.pathname` to `window.location.origin + "/join"`.

**Status: Fixed. No new issues introduced.**

---

### [Medium] No plan for project-to-roomId association — RESOLVED

`ProjectMetadata` now includes `collabRoomId?: string`. The `/join` handler looks up existing projects by `collabRoomId` before creating a new one. This prevents duplicate projects when re-joining the same room.

Note: R1 also suggested storing `collabRoomKey` — the plan only stores `collabRoomId`. This is actually correct: the room key is a secret that should stay in the URL hash (not persisted to disk), and the user re-joins via the collab link which contains the key. No issue here.

**Status: Fixed.**

---

### [Medium] `StoredScene.version` field unused — PARTIALLY RESOLVED

The `version` field is now referenced in the BroadcastChannel message format: `{ type: "scene-update", projectId, version }`. This implies the version is used for the dirty-flag mechanism. However, the plan still doesn't specify:

- How `version` is incremented (on every save? monotonic counter? timestamp?)
- Whether the receiving tab compares the incoming version against its local version, or just sets the dirty flag unconditionally

This no longer blocks architecture — the dirty-flag approach works even without version comparison (just always set dirty on any message for the same projectId). The version field is defense-in-depth.

**Status: Downgraded to Impl-note.** During implementation, either remove the version from the BroadcastChannel message (dirty flag doesn't need it) or define the increment/comparison semantics.

---

### [Medium] `deleteProject` file cleanup O(n) — NO CHANGE NEEDED

R1 already classified this as acceptable for v1 with an impl-note. Plan hasn't changed here. Fine.

**Status: Acknowledged, remains Impl-note.**

---

### [Medium] Migration `lastRetrieved` reset — RESOLVED

Now explicitly specified in step 3d of the migration script.

**Status: Fixed.**

---

### [Low] Thumbnail bloat in metadata — NO CHANGE NEEDED

R1 already classified this as acceptable for v1. Plan specifies max ~320px wide. Fine.

**Status: Acknowledged, remains Low/Impl-note.**

---

### R1 Impl-notes — Status

| Impl-note | Status |
| --- | --- |
| BroadcastChannel leak on unmount | Still relevant — plan now uses a single `excalibur-sync` channel (not per-project), which actually eliminates this issue. Only one channel to manage. **Resolved by design.** |
| `entries()` memory pressure | Resolved for migration (now uses `keys()` + individual `get()`). Still relevant for `clearObsoleteFiles` which calls `entries(filesStore)`. **Remains Impl-note.** |
| Race between migration and first render | Still relevant — plan says migration runs "on app startup" but doesn't specify a loading gate. **Remains Impl-note.** |

---

## New Issues in R2

### [Medium] BroadcastChannel single-channel design needs message filtering

**Location:** Phase 4, Tab Sync replacement, step 2-3

The plan uses a single channel (`excalibur-sync`) for all projects. Step 2 says "if `projectId` matches the current project, set dirty flag." This is correct, but the plan doesn't address what happens when the tab has NO current project (user is on the dashboard). Dashboard tabs will receive scene-update messages and should ignore them entirely — the plan should note this explicitly, or the dashboard will attempt to "reload the scene from IndexedDB" with no active project.

Scope test: Would discovering this during implementation cause significant rework? No — it's a single conditional check. **Downgraded to Impl-note.**

**Impl-note:** When wiring BroadcastChannel listener, guard against the case where `currentProjectId` is null (dashboard view). Discard messages when no project is active.

---

### [Impl-note] `clearObsoleteFiles` still calls `entries(filesStore)` — needs prefix filter implementation detail

**Location:** Phase 4, File Store Namespacing

The plan correctly says cleanup must scope to `{currentProjectId}:*` entries. But the current code (`LocalData.ts` line 55) uses `entries(filesStore)` which loads ALL key-value pairs (including binary blobs) into memory across all projects. The plan should note that during implementation, the prefix filter should be applied on `keys()` first (lightweight — just strings), then only `get()` the matching entries individually, rather than loading all blobs and filtering after.

---

### [Impl-note] Deferred cleanup of legacy un-prefixed file keys needs a trigger

**Location:** Phase 4, Migration Script, Phase 3 (deferred cleanup)

The plan says "On the next app load after migration, a separate cleanup pass reads `keys()`, identifies entries without a `:` separator (legacy keys), and deletes them." This cleanup code needs to be explicitly placed somewhere — it's not part of the migration function itself (which only runs when the flag is NOT set), and it's not part of normal app operation. During implementation, add this as a post-migration cleanup step that runs when the flag IS set, gated by a second flag like `excalibur-legacy-files-cleaned`.

---

### [Impl-note] `saveFiles` in `LocalFileManager` still calls `updateBrowserStateVersion`

**Location:** `LocalData.ts` line 211

The `saveFiles` method calls `updateBrowserStateVersion(STORAGE_KEYS.VERSION_FILES)` (line 211). After the migration, this localStorage write is still happening but serves no purpose (the new BroadcastChannel handles sync). Not a bug — just dead code that should be removed when wiring the new sync. The plan's Phase 4 says the old functions become "legacy" but doesn't call out this specific call site in `saveFiles`.

---

## Summary

| Severity | Count | Notes |
| --- | --- | --- |
| Critical | 0 | Both R1 criticals resolved cleanly |
| Must-fix | 0 | All three R1 must-fixes resolved cleanly |
| Medium | 0 | R1 mediums resolved or downgraded |
| Low | 0 | — |
| Impl-note | 6 | 2 carried from R1, 4 new (all minor implementation details) |

**Overall assessment:** R2 addressed all Critical and Must-fix issues from R1 without introducing new architectural problems. The plan is now architecturally sound for the storage/persistence layer. The remaining impl-notes are all discoverable during implementation without causing rework. Ready to proceed.
