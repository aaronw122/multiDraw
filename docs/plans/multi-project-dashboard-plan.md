# Excalibur: Multi-Project Dashboard Plan

**revision:** 3 **status:** implemented **date:** 2026-03-24

## Goal

Transform the Excalidraw fork into "Excalibur" — a multi-project drawing app where users can create and manage unlimited projects from a dashboard, with per-project collaboration support.

## Context

This is a fork of the [Excalidraw open source repo](https://github.com/excalidraw/excalidraw). The fork preserves the full monorepo structure:

```
excalidrawClone2/
├── packages/              ← core library (common, math, element, utils, excalidraw)
├── excalidraw-app/        ← the full web app (our modification target)
│   ├── collab/            ← collaboration (Socket.IO + Firebase)
│   ├── data/              ← persistence (Firebase, localStorage, sync)
│   ├── share/             ← sharing UI
│   └── App.tsx            ← main app entry
├── firebase-project/      ← Firebase config
└── examples/              ← integration examples
```

### Current State

The existing app is single-project:

- **localStorage:** `excalidraw` (elements JSON), `excalidraw-state` (appState JSON), `excalidraw-collab` (username)
- **IndexedDB:** `files-db/files-store` (binary image files), `excalidraw-library-db` (library items)
- **Firebase Firestore:** `scenes/{roomId}` (collab scenes, encrypted)
- **Firebase Storage:** `files/rooms/{roomId}/` and `files/shareLinks/{id}/` (binary files)
- **State management:** Jotai atoms, no router
- **Tab sync:** poll-on-focus via `isBrowserStorageStateNewer` / `updateBrowserStateVersion` (compares a version number in localStorage on `focus`/`visibilitychange`)

### Design Decisions

- **Minimal invasion:** Layer multi-project support around the existing `ExcalidrawWrapper` rather than rewriting it. Preserves ability to merge upstream changes.
- **IndexedDB-only for scene data:** Move elements + appState out of localStorage into IndexedDB to avoid the ~5-10MB localStorage ceiling. localStorage retains only non-project-specific data (username, theme, library).
- **BroadcastChannel for tab sync:** Replace the existing poll-on-focus mechanism (`isBrowserStorageStateNewer` / `updateBrowserStateVersion`) with `BroadcastChannel` API, since scene data moves to IndexedDB and the localStorage version counter will no longer be written.
- **Firebase unchanged:** Collab rooms are already keyed by `roomId`, independent of any project concept. No Firebase schema changes needed.

---

## Phase 1: Project Metadata Store

**Goal:** Create a project CRUD layer. Pure addition — no existing code touched.

### Data Model

```typescript
interface ProjectMetadata {
  id: string; // nanoid
  name: string;
  createdAt: number; // epoch ms
  updatedAt: number; // epoch ms
  thumbnail?: string; // base64 data URL (max ~320px wide)
  collabRoomId?: string; // room ID if this project was created/joined via collab link
}
```

### Implementation

**New file:** `excalidraw-app/data/ProjectStore.ts`

Use the existing `idb-keyval` dependency with a dedicated store:

```typescript
import { createStore, get, set, del, keys, getMany } from "idb-keyval";

const projectStore = createStore("excalibur-projects-db", "projects-store");
```

**Operations:**

- `listProjects(): Promise<ProjectMetadata[]>` — get all, sort by `updatedAt` desc
- `getProject(id: string): Promise<ProjectMetadata | undefined>`
- `createProject(name: string): Promise<ProjectMetadata>` — generates nanoid, sets timestamps
- `updateProject(id: string, updates: Partial<ProjectMetadata>): Promise<void>`
- `deleteProject(id: string): Promise<void>` — also deletes associated scene data and files
- `renameProject(id: string, name: string): Promise<void>`

### Dependencies

- `idb-keyval` — already in the project
- `nanoid` — transitive dependency only (used internally by Excalidraw core but not declared in `excalidraw-app/package.json`). **Add `nanoid` as an explicit dependency in `excalidraw-app/package.json`.**

---

## Phase 2: Routing

**Goal:** Add client-side routing so the app can switch between dashboard and editor views.

### Install

Add `react-router-dom` to `excalidraw-app/package.json`.

### Route Structure

| Path | Component | Description |
| --- | --- | --- |
| `/` | `<Dashboard />` | Project list and management |
| `/project/:id` | `<ProjectEditorRoute />` | Editor for a specific project (see wrapper below) |
| `/join` | `<JoinCollabRoute />` | Collab join handler — reads `#room=` hash, finds/creates local project, redirects to `/project/{id}#room=...` |
| `/*` (catch-all) | redirect logic | Handle legacy `#room=` and `#json=` hashes |

### Changes

**`excalidraw-app/index.tsx`:** Wrap app in `<BrowserRouter>`.

**`excalidraw-app/App.tsx`:** Add `<Routes>` inside the existing `<Provider store={appJotaiStore}>`:

```tsx
<Routes>
  <Route path="/" element={<DashboardOrLegacyRedirect />} />
  <Route path="/project/:id" element={<ProjectEditorRoute />} />
</Routes>
```

**`ProjectEditorRoute` wrapper (critical for remount):**

`ExcalidrawWrapper` does not remount when the `:id` param changes — React Router reuses the same route element. Without a full remount, stale scene data, collab state, and atoms leak between projects. Add a thin wrapper that forces remount via `key`:

```tsx
function ProjectEditorRoute() {
  const { id: projectId } = useParams<{ id: string }>();
  return (
    <ExcalidrawAPIProvider key={projectId}>
      <ExcalidrawWrapper />
    </ExcalidrawAPIProvider>
  );
}
```

The `key={projectId}` ensures React tears down and recreates the entire subtree on project switch, giving each project a clean `ExcalidrawWrapper` instance.

**`DashboardOrLegacyRedirect`:** Checks `window.location.hash` on mount. If it contains `#room=` or `#json=`, creates a temporary project and navigates to `/project/{id}#...`. Otherwise renders `<Dashboard />`.

**`excalidraw-app/index.html`:** Move `overflow: hidden` from `html, body` into the `.excalidraw-app` container class. The dashboard needs a scrollable body.

**Vite config:** Dev server already supports SPA fallback. For production, add rewrite rules (Vercel already has `vercel.json`; for other hosts, add `_redirects` or equivalent).

---

## Phase 3: Dashboard Page

**Goal:** Build the project management UI.

### New Files

- `excalidraw-app/pages/Dashboard.tsx`
- `excalidraw-app/pages/Dashboard.css`

### Features (ported from the old wrapper)

- **Project grid:** Cards with thumbnails, project name, last modified date
- **Create new project:** Button that calls `ProjectStore.createProject()` and navigates to `/project/{id}`
- **Search:** Filter projects by name
- **Sort:** By recent, name, created date
- **Rename:** Double-click project name to edit inline
- **Delete:** With confirmation dialog
- **Resume banner:** Shows the last-opened project for quick access

### Styling

Port the existing `Dashboard.css` from the old wrapper (`excalidrawClone/src/pages/Dashboard.css`). Uses `exc-` prefixed classes — no conflicts with Excalidraw's styles.

---

## Phase 4: Move Persistence to IndexedDB + Namespace by Project

**Goal:** Move scene data out of localStorage into IndexedDB, keyed by project ID.

This is the highest-risk phase. The persistence layer is in the hot path — bugs here mean data loss.

### Storage Architecture (after migration)

| Data | Storage | Key Pattern |
| --- | --- | --- |
| Project metadata | IndexedDB (`excalibur-projects-db`) | `{projectId}` |
| Scene elements + appState | IndexedDB (`excalibur-scenes-db`) | `{projectId}` |
| Binary files (images) | IndexedDB (`files-db` — existing) | `{projectId}:{fileId}` |
| Username, theme, library | localStorage (unchanged) | existing keys |

### New Store

**New file:** `excalidraw-app/data/SceneStore.ts`

```typescript
import { createStore, get, set, del } from "idb-keyval";

const sceneStore = createStore("excalibur-scenes-db", "scenes-store");

interface StoredScene {
  projectId: string;
  elements: ExcalidrawElement[];
  appState: Partial<AppState>; // only view-relevant fields
  version: number;
}
```

**Operations:**

- `loadScene(projectId: string): Promise<StoredScene | undefined>`
- `saveScene(projectId: string, elements, appState): Promise<void>`
- `deleteScene(projectId: string): Promise<void>`

### Modify Existing Files

**`excalidraw-app/data/LocalData.ts`:**

- Replace `saveDataStateToLocalStorage()` calls with `SceneStore.saveScene(projectId, ...)`
- Replace `importFromLocalStorage()` calls with `SceneStore.loadScene(projectId)`
- The `LocalData` class is **fully static** — all methods are static, so `projectId` cannot be set on an instance. Threading approach:
  1. **Capture `projectId` in the debounce payload at call time, not execution time.** The debounced save closure must capture the `projectId` that was current when the save was requested, not when the debounce fires (which could be after a project switch).
  2. **Flush before navigation:** call `LocalData.flushSave()` before any project navigation (add to the Phase 5 nav handling / "back to dashboard" logic). The `key={projectId}` unmount from `ProjectEditorRoute` also triggers flush on project switch since the component teardown can call flush in a cleanup effect.
  3. Route saves to `SceneStore.saveScene(projectId, ...)` instead of localStorage.
- Keep the existing debounce/throttle timing logic

**`excalidraw-app/data/localStorage.ts`:**

- `importFromLocalStorage()` becomes a legacy-only function (used during migration)
- New code paths use `SceneStore` directly

**`excalidraw-app/app_constants.ts`:**

- Keep existing `STORAGE_KEYS` for migration compatibility
- No new dynamic key functions needed (IndexedDB keys are project IDs)

### Tab Sync: Replace Poll-on-Focus with BroadcastChannel

The existing tab sync does **not** use `storage` event listeners. It uses a **poll-on-focus** mechanism: `isBrowserStorageStateNewer()` / `updateBrowserStateVersion()` compare a version number stored in localStorage. When the tab regains focus, it checks whether that version has advanced and reloads if so. Once scene data moves to IndexedDB, the localStorage version write never happens, so the focus-poll silently stops detecting cross-tab changes.

**Replacement mechanism:**

1. **On `SceneStore.save()`:** post `{ type: "scene-update", projectId, version }` on a `BroadcastChannel` named `excalibur-sync`.
2. **On receiving a message:** if `projectId` matches the current project, set an in-memory `dirty` flag.
3. **On `focus` / `visibilitychange`:** if the `dirty` flag is set, reload the scene from IndexedDB and clear the flag.
4. File updates: post `{ type: "file-update", projectId, fileId }` on the same channel; handle identically.

**`excalidraw-app/data/tabSync.ts`:** The existing `isBrowserStorageStateNewer()` and `updateBrowserStateVersion()` functions become **legacy** — keep them for the migration transition period but do not call them from new code paths. New tab sync logic lives alongside or replaces the body of this file.

### File Store Namespacing

The existing `files-db/files-store` stores binary files keyed by `fileId`. Modify to prefix keys with `projectId`:

- Write: `set(\`${projectId}:${fileId}\`, fileData, filesStore)`
- Read: `get(\`${projectId}:${fileId}\`, filesStore)`
- Cleanup (`clearObsoleteFiles`): **must scope to entries matching `{currentProjectId}:*` prefix only** — without this prefix filter, cleanup will delete files belonging to other projects. Also reset `lastRetrieved` to `Date.now()` on migrated files (see Migration Script) or the 24-hour GC will collect them immediately after migration.

### Migration Script

**New file:** `excalidraw-app/data/migration.ts`

Runs once on app startup:

1. Check if migration flag exists in localStorage (`excalibur-migrated`)
2. If not, read legacy keys (`excalidraw`, `excalidraw-state`) from localStorage
3. If data exists: a. Create a project record via `ProjectStore.createProject("My Drawing")` b. Write scene data to `SceneStore.saveScene(projectId, elements, appState)` c. **Re-key existing files in `files-db` — two-phase, non-destructive:**
   - **Phase 1 (copy):** Iterate files **one at a time** (do NOT use `entries()` which loads all blobs into memory at once — use `keys()` then `get()` each individually to avoid OOM). For each `fileId`, read the value and write it to `{projectId}:{fileId}`.
   - **Phase 2 (flag):** After all new keys are written successfully, set `excalibur-migrated = true` in localStorage.
   - **Phase 3 (deferred cleanup):** Old un-prefixed keys are **NOT deleted during migration**. On the next app load after migration, a separate cleanup pass reads `keys()`, identifies entries without a `:` separator (legacy keys), and deletes them. If the app crashes between Phase 1 and Phase 2, re-running migration is safe because writes are idempotent (same key = same value). d. Also set `lastRetrieved = Date.now()` on each migrated file entry so the 24-hour `clearObsoleteFiles` GC does not immediately collect them.
4. If no legacy data, just set the flag
5. Migration is idempotent — safe to re-run

**Do NOT delete legacy localStorage keys immediately.** Keep them for one release cycle as a rollback safety net. Add a cleanup step in a future version.

---

## Phase 5: Wire ExcalidrawWrapper to Routing

**Goal:** Make the editor load/save the correct project based on URL.

### Changes to `excalidraw-app/App.tsx`

**Read project ID from URL:**

```typescript
const { id: projectId } = useParams<{ id: string }>();
```

**Modify `initializeScene` (lines ~216-372):**

- Accept `projectId` parameter
- Call `SceneStore.loadScene(projectId)` instead of `importFromLocalStorage()`
- If no scene found and no collab hash, initialize with empty canvas
- If collab hash present, proceed with existing collab initialization (unchanged)

**Modify `onChange` handler (lines ~678-728):**

- Pass `projectId` to `LocalData.save()` which routes to `SceneStore.saveScene()`
- Update `ProjectStore.updateProject(projectId, { updatedAt: Date.now() })` on save

**Replace raw `window.history` calls with `navigate()` (critical):**

Raw `window.history.replaceState()` / `pushState()` calls desync React Router — the URL changes but Router state does not update, causing stale renders and broken back-button behavior. All 5 call sites must be replaced:

| File | Line(s) | Current Call | Replacement |
| --- | --- | --- | --- |
| `App.tsx` | ~284 | `window.history.replaceState(...)` | `navigate(newPath, { replace: true })` |
| `App.tsx` | ~301 | `window.history.replaceState(...)` | `navigate(newPath, { replace: true })` |
| `App.tsx` | ~304 | `window.history.replaceState(...)` | `navigate(newPath, { replace: true })` |
| `Collab.tsx` | ~384 | `window.history.pushState(...)` | `navigate(newPath)` |
| `Collab.tsx` | ~492 | `window.history.pushState(...)` | `navigate(newPath)` |

For `App.tsx` (function component): use `const navigate = useNavigate()` directly.

For `Collab.tsx` (class component): `useNavigate()` cannot be called in a class. Pass `navigate` as a prop from the parent function component that renders `<Collab>`, or expose it via a ref/atom that the class can read. The prop approach is simpler and more explicit.

**Add "back to dashboard" navigation:**

- Add a back arrow / home button in the editor UI (in `AppMainMenu` or as a top-level element)
- `<Link to="/">` or `navigate("/")`
- Trigger a save before navigation

**Thumbnail generation:**

- Port `generateThumbnail` from the old wrapper (`excalidrawClone/src/pages/Editor.tsx` lines 83-113)
- Call debounced after saves
- Store base64 thumbnail via `ProjectStore.updateProject(projectId, { thumbnail })`
- Use `exportToBlob` with `maxWidthOrHeight: 320`

### Jotai Atom

**`excalidraw-app/app-jotai.ts`:**

```typescript
export const currentProjectIdAtom = atom<string | null>(null);
```

**Single source of truth:** `useParams()` is the authoritative source of `projectId` in all React components. `projectId` is passed explicitly as a function argument to non-React code (persistence layer, collab utilities). The `currentProjectIdAtom` is **derived, not authoritative** — if kept, it must be set synchronously during render (not in a `useEffect`, which creates a tick where the atom is stale). Prefer removing the atom entirely and passing `projectId` explicitly; if it is retained for convenience in deeply nested non-React code, document that it is a mirror of the URL param and must never be written to directly as a primary source.

---

## Phase 6: Collab Per-Project

**Goal:** Ensure collaboration works correctly in the multi-project context.

### What Already Works (Minimal Changes)

- Collab rooms are keyed by `roomId` in the URL hash — independent per session
- The `Portal` class connects to a specific room
- The `Collab` component manages one session at a time
- Firebase Firestore `scenes/{roomId}` and Storage `files/rooms/{roomId}/` are room-scoped

### Changes Needed

**`stopCollaboration` navigates to root `/`:** The `stopCollaboration` method in `Collab.tsx` calls `window.history.pushState({}, "", window.location.origin)`, which navigates to `/` — losing the project context. This must be replaced with `navigate(\`/project/${projectId}\`)`(using the`navigate`prop described in Phase 5's history API replacement). After stopping collab, the user should remain in the same project's editor, just without the`#room=` hash.

### Link Format Change (Requires Explicit Fix)

Collab links must **NOT** embed the sender's local `projectId`. The sender's project ID is a local organizational concept — it has no meaning to the recipient. If links contain `/project/{sendersProjectId}#room=...`, the recipient either gets a 404 (they don't have that project) or silently opens the wrong local project.

**Approach:** Use a dedicated join route that separates the collab room from local project identity:

- **Collab link format:** `https://host/join#room={roomId},{roomKey}`
- **`/join` route handler:** reads the `#room=` hash, creates (or finds) a local project for this collab session, and redirects to `/project/{localProjectId}#room={roomId},{roomKey}`

To map between local projects and collab rooms, add a `collabRoomId?: string` field to `ProjectMetadata`. When joining a collab link, look up existing projects by `collabRoomId` before creating a new one — this prevents duplicate projects when re-joining the same room.

**`getCollaborationLink()` in `data/index.ts`:** Must be changed from `window.location.origin + window.location.pathname` to `window.location.origin + "/join"`. The hash portion (`#room={roomId},{roomKey}`) is appended as before.

### New: Auto-Create Project on Collab Join

When someone opens a collab link and doesn't have that project locally:

1. In `DashboardOrLegacyRedirect` (for legacy links) or in `ExcalidrawWrapper` init (for `/project/:id` links)
2. Check if project exists in `ProjectStore`
3. If not, create one: `ProjectStore.createProject("Shared Drawing")`
4. The scene data syncs from Firebase via the existing collab flow

### Legacy Collab Links

Old-format links (`https://host/#room=...`) hit the catch-all route. `DashboardOrLegacyRedirect` detects the `#room=` hash, creates a project, and redirects to `/project/{id}#room=...`.

---

## Phase 7: Edge Cases and Polish

### Legacy URL Handling

| URL Pattern | Behavior |
| --- | --- |
| `/` (no hash) | Dashboard |
| `/#room={roomId},{roomKey}` | Legacy — redirect to `/join#room=...` |
| `/#json={data}` | Create project → redirect to `/project/{id}#json=...` |
| `/join#room={roomId},{roomKey}` | Find/create local project → redirect to `/project/{id}#room=...` |
| `/project/{id}` | Editor |
| `/project/{id}#room=...` | Editor with collab |
| `/excalidraw-plus-export` | Existing cloud export iframe (unchanged) |

### PWA / Service Worker

- `start_url: "/"` in manifest → now opens dashboard (reasonable)
- `.excalidraw` file handler → should create a new project and open it in editor (follow-up task)

### Storage Quota Indicator (Nice-to-Have)

Port `StorageQuota.tsx` from the old wrapper. Shows IndexedDB usage and warns when storage is getting high. Add to dashboard footer.

### Delete Project Cleanup

When deleting a project:

1. Delete project metadata from `ProjectStore`
2. Delete scene data from `SceneStore`
3. Delete all files with `{projectId}:*` prefix from files store
4. If the project had an active collab room, the room data in Firebase is left as-is (it expires naturally or is cleaned up separately)

---

## Implementation Order

1. [x] **Phase 1** — ProjectStore (pure addition, no risk) — PR #1
2. [x] **Phase 2** — Routing (structural change, but additive) — PR #2
3. [x] **Phase 3** — Dashboard page (new UI, references old wrapper) — PR #4
4. [x] **Phase 4** — IndexedDB persistence migration (highest risk, most complex) — PR #5
5. [x] **Phase 5** — ExcalidrawWrapper integration (connects everything) — PR #6
6. [x] **Phase 6** — Collab per-project (mostly works already) — PR #7
7. [x] **Phase 7** — Edge cases and polish — PR #8

---

## Risk Assessment

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Data loss during persistence migration | High | Keep legacy localStorage keys as rollback. Idempotent migration. |
| `ExcalidrawWrapper` is 900+ lines | Medium | Make targeted changes — pass `projectId` through existing call chains, don't restructure. |
| `overflow: hidden` on body breaks dashboard | Low | Move to `.excalidraw-app` container — straightforward CSS change. |
| Hash-based collab URLs vs react-router | Low | BrowserRouter uses `pushState`; collab uses `hashchange`. Orthogonal — test thoroughly. |
| Tab sync after BroadcastChannel switch | Medium | BroadcastChannel is well-supported (all modern browsers). Simpler than the existing poll-on-focus mechanism, which silently breaks when scene data moves out of localStorage. |

---

## Files Changed

| File | Action | Phase |
| --- | --- | --- |
| `excalidraw-app/data/ProjectStore.ts` | **New** | 1 |
| `excalidraw-app/package.json` | Modify (add react-router-dom) | 2 |
| `excalidraw-app/index.tsx` | Modify (BrowserRouter wrap) | 2 |
| `excalidraw-app/App.tsx` | Modify (routes, project ID, save changes) | 2, 5 |
| `excalidraw-app/index.html` | Modify (overflow CSS) | 2 |
| `excalidraw-app/pages/Dashboard.tsx` | **New** | 3 |
| `excalidraw-app/pages/Dashboard.css` | **New** | 3 |
| `excalidraw-app/data/SceneStore.ts` | **New** | 4 |
| `excalidraw-app/data/LocalData.ts` | Modify (route to SceneStore) | 4 |
| `excalidraw-app/data/localStorage.ts` | Modify (legacy-only) | 4 |
| `excalidraw-app/data/tabSync.ts` | Modify (BroadcastChannel) | 4 |
| `excalidraw-app/data/migration.ts` | **New** | 4 |
| `excalidraw-app/app_constants.ts` | Minor | 4 |
| `excalidraw-app/app-jotai.ts` | Modify (add atom) | 5 |
| `excalidraw-app/data/index.ts` | Minor (collab link auto-adapts) | 6 |
