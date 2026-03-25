# Multi-Project Dashboard Plan Review (R1) — Agent 2: React Architecture

**Reviewer focus:** React Router integration, Jotai atom usage, Excalidraw component lifecycle, re-render risks, UX flow gaps.

---

## [Critical] `history.replaceState` and `history.pushState` calls will fight React Router

**Location:** Phase 5 (ExcalidrawWrapper integration), Phase 6 (Collab per-project)

**Issue:** The existing codebase uses raw `window.history.replaceState` and `window.history.pushState` extensively — three `replaceState` calls in `initializeScene` (App.tsx lines 284, 301, 304) and two `pushState` calls in Collab.tsx (lines 384, 492). All of these navigate to `window.location.origin` (the root) or construct collab URLs using `window.location.origin + window.location.pathname`.

Once React Router (BrowserRouter) is introduced, these raw history manipulations will desync React Router's internal state from the actual browser URL. BrowserRouter listens to `popstate` events but does NOT detect `pushState`/`replaceState` calls made outside its own `navigate()` function. This means:

1. After `initializeScene` clears the hash and replaces state to `/`, React Router still thinks the user is on `/project/:id`. The component tree won't re-render to show the dashboard.
2. After `stopCollaboration` pushes state to origin, same desync occurs.
3. After `startCollaboration` pushes the `#room=` URL via `pushState`, React Router's location object won't reflect the hash change.

**Suggested fix:** The plan needs an explicit phase (likely part of Phase 5) that catalogs every `history.replaceState` and `history.pushState` call and converts them to use React Router's `navigate()` (from `useNavigate` hook or passed as a parameter to `initializeScene`). For the Collab class component, which can't use hooks directly, pass a `navigate` callback via props or through a Jotai atom/ref. The plan should list each call site and its replacement:

- `App.tsx:284,301,304` — replace with `navigate(\`/project/${projectId}\`, { replace: true })` (keeps the user in the editor but cleans the hash)
- `Collab.tsx:384` (stopCollaboration) — replace with `navigate(\`/project/${projectId}\`)`to stay on the project, or`navigate("/")` to return to dashboard
- `Collab.tsx:492` (startCollaboration) — replace with `navigate(\`/project/${projectId}#room=${roomId},${roomKey}\`)`or simply update`window.location.hash` (React Router ignores hash, so this one may actually be fine)

---

## [Critical] ExcalidrawWrapper does not unmount/remount on project switch — stale state

**Location:** Phase 2 (Routing), Phase 5 (ExcalidrawWrapper integration)

**Issue:** The plan's route structure mounts `<ExcalidrawWrapper />` at `/project/:id`. When a user navigates from `/project/abc` to `/project/def` (e.g., via back-to-dashboard then opening another project), React Router will reuse the same `<ExcalidrawWrapper />` component instance by default because the route path pattern is the same — only the param changes. This means:

1. All `useRef` values persist (including `initialStatePromiseRef`, which is already resolved with the old project's data)
2. The `useEffect` that calls `initializeScene` has `[isCollabDisabled, collabAPI, excalidrawAPI, setLangCode, loadImages]` as dependencies — none of which change when `projectId` changes
3. The Excalidraw canvas retains its internal state from the previous project
4. Event listeners (hashchange, unload, visibility) remain bound to the old closure

The result: switching projects shows the old project's data.

**Suggested fix:** Add a `key={projectId}` prop on the route element to force full unmount/remount:

```tsx
<Route
  path="/project/:id"
  element={
    <ProjectKeyWrapper /> // reads useParams, passes key
  }
/>

// or inline:
// The wrapper reads projectId and renders <ExcalidrawAPIProvider key={projectId}>
```

This is the simplest correct solution given the 900+ line component. The plan should explicitly state this pattern and explain why it's necessary. The alternative (making every hook and ref `projectId`-aware) would be a massive rewrite that contradicts the "minimal invasion" design principle.

---

## [Must-fix] `initializeScene` is a standalone async function, not inside the component — threading `projectId` through is non-trivial

**Location:** Phase 5 (Modify `initializeScene`)

**Issue:** `initializeScene` is defined at module scope (line 216), outside the `ExcalidrawWrapper` component. The plan says to "accept `projectId` parameter" and "call `SceneStore.loadScene(projectId)`", which is correct. But the plan understates the complexity: `initializeScene` currently reads from `window.location.hash`, `window.location.search`, and calls `importFromLocalStorage()` directly. It also calls `getCollaborationLinkData(window.location.href)` which parses the hash.

With routing, the function needs to know the project ID AND still handle hash-based collab/json links. The plan should specify the new function signature and clarify what changes vs. what stays:

**Suggested fix:** Add to Phase 5 a concrete description of the modified `initializeScene` signature and behavior:

```typescript
const initializeScene = async (opts: {
  collabAPI: CollabAPI | null;
  excalidrawAPI: ExcalidrawImperativeAPI;
  projectId: string;  // NEW: from useParams
}): Promise<...>
```

- Replace `importFromLocalStorage()` call with `SceneStore.loadScene(opts.projectId)`
- Keep `getCollaborationLinkData(window.location.href)` as-is (hash is still used for collab)
- The `history.replaceState` calls inside this function must use the project-scoped URL (`/project/${projectId}`) instead of `window.location.origin` (ties into the Critical finding above)

---

## [Must-fix] `LocalData.save()` is a static class method with no project context — plan underspecifies the threading

**Location:** Phase 4 (Modify LocalData.ts), Phase 5 (Modify onChange handler)

**Issue:** `LocalData` is a static class. `LocalData.save()` calls `saveDataStateToLocalStorage(elements, appState)` which writes to fixed localStorage keys. `LocalData.fileStorage` is a static instance of `LocalFileManager` whose `getFiles`/`saveFiles` methods use `filesStore` with flat `fileId` keys.

The plan says to "modify [LocalData] to accept `projectId` and route to SceneStore" and to "prefix keys with `projectId`" for file storage. But `LocalData` is static — there's no instance per project. The `_save` debounce is a single shared function. If two project tabs exist, the debounced save from one project could be flushed for a different project if the `projectId` parameter isn't captured in the closure correctly.

**Suggested fix:** The plan should specify one of two approaches:

Option A (simpler, recommended): Convert `LocalData` from static methods to an instantiated class, one per project. Pass the instance down via a Jotai atom or React context. Combined with `key={projectId}` on the wrapper, each mount gets its own `LocalData` instance.

Option B (less invasive): Add a `currentProjectId` parameter to `LocalData.save()` and `LocalData.flushSave()` and capture it in the debounced closure. But this requires careful handling of the debounce — the debounced function must check that the projectId hasn't changed before writing.

State which approach the implementation should take. Option A pairs naturally with the `key={projectId}` pattern from the previous finding.

---

## [Must-fix] `currentProjectIdAtom` is redundant if using `key={projectId}` remounting — and dangerous if not

**Location:** Phase 5 (Jotai Atom)

**Issue:** The plan adds `currentProjectIdAtom` to `app-jotai.ts` and says "set when entering a project route, read by persistence layer." But:

1. If the `key={projectId}` remount pattern is used (recommended above), the atom must be set BEFORE the component mounts, otherwise `initializeScene` runs before the atom is populated. Setting it in a `useEffect` is too late (effects run after render). Setting it in the route wrapper before mounting `ExcalidrawAPIProvider` works but adds complexity.

2. The Jotai store (`appJotaiStore`) is global and shared across all routes. If the dashboard and editor are rendered in the same Jotai Provider, atoms from the editor (like `collabAPIAtom`, `isCollaboratingAtom`) persist even when viewing the dashboard. This is probably fine but should be called out.

3. Having project ID in both the URL (useParams) and a Jotai atom creates two sources of truth.

**Suggested fix:** Decide on a single source of truth for `projectId`:

- Use `useParams()` in React components (they're inside the Router)
- For non-React code (like if `LocalData` needs it), pass it explicitly as a function parameter rather than reading from an atom
- If the atom IS needed (e.g., for the persistence layer to read outside React), set it synchronously in the route wrapper component's render path (not in an effect), and document that it's a derived mirror of the URL param, not the source of truth

---

## [Must-fix] Collab `stopCollaboration` navigates to root — will bounce user to dashboard

**Location:** Phase 6 (Collab per-project)

**Issue:** When a user stops a collaboration session, `Collab.tsx:384` does `window.history.pushState({}, APP_NAME, window.location.origin)`. With routing in place, this navigates to `/` which is the dashboard. The user probably expects to stay on their project with the collab data saved locally.

The plan's Phase 6 section says "What Already Works (No Changes Needed)" for the core collab flow, but this navigation behavior is a UX regression.

**Suggested fix:** Add to Phase 6 "Changes Needed" section: `stopCollaboration`'s `pushState` call must be updated to navigate to `/project/${projectId}` (keeping the user in the editor) instead of root. This ties into the broader `history.*` migration from the first Critical finding.

---

## [Medium] `DashboardOrLegacyRedirect` as a component on the `/` route — mounting order with ExcalidrawWrapper

**Location:** Phase 2 (Route Structure)

**Issue:** The plan puts `<DashboardOrLegacyRedirect />` on the `/` route. This component checks `window.location.hash` for `#room=` or `#json=`, creates a project, and navigates to `/project/{id}#...`. But the navigation target (`/project/:id`) mounts `ExcalidrawAPIProvider > ExcalidrawWrapper`, which needs `collabAPI` to be available before `initializeScene` runs.

The `collabAPI` is set via a Jotai atom by the `<Collab>` component, which is rendered inside `ExcalidrawWrapper` (App.tsx line 1040). There's an existing guard for this: the `useEffect` at line 523-524 waits for `!isCollabDisabled && !collabAPI` to be false before calling `initializeScene`. So the existing pattern handles deferred collabAPI availability.

However, the plan should explicitly call out that the hash must survive the navigation. When `DashboardOrLegacyRedirect` does `navigate("/project/{id}#room=abc,key")`, the hash must be present on the destination URL for `initializeScene` to detect the collab link. React Router's `navigate()` does preserve hash fragments, but this assumption should be stated explicitly and tested.

**Suggested fix:** Add a note to Phase 2 or Phase 7 confirming that `navigate("/project/{id}#room=...",)` preserves the hash. Add an E2E test case for legacy collab link redirect.

---

## [Medium] Tab sync replacement (BroadcastChannel) needs project-scoped channel lifecycle management

**Location:** Phase 4 (Tab Sync)

**Issue:** The plan says to use `BroadcastChannel` with channel name `excalibur-sync-{projectId}`. But BroadcastChannel instances must be explicitly closed when no longer needed (e.g., when unmounting the editor or switching projects). If using `key={projectId}` remounting, the cleanup happens in the component's useEffect return. But the plan doesn't specify where the channel is created or destroyed.

Also, the current tab sync (`tabSync.ts`) uses in-memory `LOCAL_STATE_VERSIONS` — a module-level singleton. With multiple projects, these version numbers are per-tab, not per-project. If a user has two tabs open with different projects, the version check logic will incorrectly compare versions across projects.

**Suggested fix:** Add to Phase 4: BroadcastChannel lifecycle must be tied to the editor component's mount/unmount cycle. The `LOCAL_STATE_VERSIONS` object should be scoped per project (either by namespacing the keys or by resetting on project change). Specify that channel creation happens in a `useEffect` within the editor route and cleanup happens on unmount.

---

## [Medium] `exportToBackend` constructs shareable link URL from `window.location.href` — will include `/project/:id` prefix

**Location:** Phase 6 / Phase 7

**Issue:** In `data/index.ts:282`, `exportToBackend` creates the shareable link URL:

```typescript
const url = new URL(window.location.href);
url.hash = `json=${json.id},${encryptionKey}`;
```

After routing is added, `window.location.href` will be `https://host/project/abc123`, so the shareable link becomes `https://host/project/abc123#json=...`. When someone opens this link, they'll hit the `/project/:id` route with that specific project ID — but they don't have that project locally. The plan's "auto-create project on collab join" logic (Phase 6) only covers `#room=` hashes, not `#json=` hashes.

**Suggested fix:** Add to Phase 7 (Legacy URL Handling): shareable links generated from within a project should use the root URL (`https://host/#json=...`) so they work universally via the `DashboardOrLegacyRedirect` flow. Either modify `exportToBackend` to construct the URL from `window.location.origin` (not `href`), or add `#json=` handling to the `/project/:id` route's init logic alongside the `#room=` handling.

---

## [Medium] Migration re-keying of files in `files-db` is a full table scan — no atomicity guarantee

**Location:** Phase 4 (Migration Script)

**Issue:** The migration step 3c says "Re-key existing files in `files-db` with the new project prefix." This means reading every entry from `files-db`, writing new entries with `{projectId}:{fileId}` keys, and (presumably) deleting the old entries. `idb-keyval` doesn't support transactions across stores, and even within a single store, `entries()` + `set()` + `del()` is not atomic. If the browser crashes mid-migration, some files will be re-keyed and others won't, and the `excalibur-migrated` flag won't be set.

On re-run, the migration will try again but the old-key entries may be partially gone.

**Suggested fix:** Add to Phase 4 migration: the re-keying should be a two-phase write — write new keys first, set migration flag, then delete old keys in a subsequent cleanup pass (which can be deferred or run lazily). Alternatively, keep the old keys and have the file loading code fall back to checking the un-prefixed key if the prefixed key doesn't exist. This is safer and simpler.

---

## [Low] `ExcalidrawAPIProvider` is already in `ExcalidrawApp` — plan's route structure wraps it again

**Location:** Phase 2 (Route Structure)

**Issue:** The current `ExcalidrawApp` component (App.tsx lines 1276-1284) already wraps `ExcalidrawWrapper` in `<ExcalidrawAPIProvider>`. The plan's route structure in Phase 2 shows:

```tsx
<Route
  path="/project/:id"
  element={
    <ExcalidrawAPIProvider>
      <ExcalidrawWrapper />
    </ExcalidrawAPIProvider>
  }
/>
```

This is correct for the editor route, but the plan needs to clarify that the existing `ExcalidrawApp` component's structure must be refactored — the `ExcalidrawAPIProvider` wrapper moves from `ExcalidrawApp` into the route definition. The dashboard route should NOT have `ExcalidrawAPIProvider`. This is minor but if both the existing wrapper AND the route definition have it, you get double-wrapping.

**Suggested fix:** Add a note to Phase 2: refactor `ExcalidrawApp` to remove the current `ExcalidrawAPIProvider` wrapping (since it moves into the route element). The Provider/Jotai store wrapper stays at the top level; only the Excalidraw-specific providers move into the editor route.

---

## [Impl-note] Thumbnail generation timing and `exportToBlob` availability

The plan says to call `exportToBlob` with `maxWidthOrHeight: 320` debounced after saves. `exportToBlob` requires an initialized Excalidraw instance and access to all image files. If called too early (before images load) or during collab sync, the thumbnail may be incomplete. During implementation, add a guard that skips thumbnail generation if the scene has unloaded images.

## [Impl-note] BroadcastChannel browser support

BroadcastChannel is supported in all modern browsers including Safari 15.4+. No polyfill needed, but the plan's risk table says "well-supported" without citing the Safari cutoff. Safari 15.4 shipped March 2022, so this is fine for 2026 but worth a brief comment during implementation.

## [Impl-note] `nanoid` import path

The plan says nanoid is "already in the project (used by Excalidraw core)." During implementation, verify the import path — it may be re-exported from `@excalidraw/common` or `@excalidraw/element` rather than available as a direct `nanoid` dependency in `excalidraw-app/package.json`.

## [Impl-note] Debounce on `LocalData._save` and project context

The existing debounce on `LocalData._save` has `SAVE_TO_LOCAL_STORAGE_TIMEOUT` delay. When switching projects rapidly (if not using `key={projectId}` remounting), a pending debounced save could fire after the project context has changed, writing data to the wrong project. The `key={projectId}` pattern avoids this by unmounting (which should cancel/flush the debounce), but verify during implementation that the debounce is properly flushed on unmount.
