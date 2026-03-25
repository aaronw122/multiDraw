# Multi-Project Dashboard Plan Review (R2) — Agent 2: React Architecture

**Reviewer focus:** React Router integration, Jotai atom usage, Excalidraw component lifecycle, re-render risks, UX flow gaps.

**Review type:** Round 2 — evaluating whether R1 Critical/Must-fix issues were resolved and whether fixes introduced new problems.

---

## R1 Issue Resolution Status

### [RESOLVED] `history.replaceState` / `history.pushState` calls will fight React Router

**R1 severity:** Critical

**Status:** Fully addressed. Phase 5 now contains an explicit table of all 5 call sites (App.tsx lines ~284, ~301, ~304; Collab.tsx lines ~384, ~492) with their replacements using `navigate()`. The plan also correctly identifies that Collab.tsx is a class component and recommends passing `navigate` as a prop from the parent function component. The `stopCollaboration` navigation target is correctly specified as `/project/${projectId}` rather than root.

No new issues introduced.

### [RESOLVED] ExcalidrawWrapper does not unmount/remount on project switch

**R1 severity:** Critical

**Status:** Fully addressed. Phase 2 now includes the `ProjectEditorRoute` wrapper with `key={projectId}` on `<ExcalidrawAPIProvider>`, which forces a full teardown/recreate of the entire Excalidraw subtree on project switch. The explanation of why this is necessary is clear.

No new issues introduced.

### [RESOLVED] `initializeScene` threading of `projectId`

**R1 severity:** Must-fix

**Status:** Addressed. Phase 5 specifies that `initializeScene` accepts a `projectId` parameter, calls `SceneStore.loadScene(projectId)` instead of `importFromLocalStorage()`, and the `history.replaceState` calls inside use project-scoped URLs. The function signature change is described conceptually though not with the full typed signature from R1's suggestion — acceptable at plan level.

No new issues introduced.

### [RESOLVED] `LocalData.save()` static class with no project context

**R1 severity:** Must-fix

**Status:** Addressed. Phase 4 now specifies the approach: capture `projectId` in the debounce payload at call time (not execution time), flush before navigation, and route saves to `SceneStore.saveScene(projectId, ...)`. This is R1's "Option B" (less invasive). The plan also notes that `key={projectId}` unmount triggers flush via a cleanup effect.

See new finding below about a remaining gap.

### [RESOLVED] `currentProjectIdAtom` dual source of truth

**R1 severity:** Must-fix

**Status:** Well addressed. Phase 5 now explicitly states that `useParams()` is the authoritative source, `projectId` is passed explicitly to non-React code, and the atom is "derived, not authoritative." The plan even recommends removing the atom entirely and only retaining it if needed for deeply nested non-React code, with the constraint that it must be set synchronously during render (not in a `useEffect`).

No new issues introduced.

### [RESOLVED] `stopCollaboration` navigates to root

**R1 severity:** Must-fix

**Status:** Addressed in Phase 6 under "Changes Needed." The `stopCollaboration` call is explicitly listed as needing replacement with `navigate(/project/${projectId})`.

No new issues introduced.

### [RESOLVED] `exportToBackend` shareable link URL includes `/project/:id` prefix

**R1 severity:** Medium

**Status:** Not explicitly addressed in the plan text. The plan's Phase 7 legacy URL table handles `/#json=` at the root level, and `getCollaborationLink` is updated in Phase 6, but `exportToBackend` (data/index.ts line 282) still constructs shareable URLs from `window.location.href`. See new finding below.

### [RESOLVED] Migration re-keying atomicity

**R1 severity:** Medium

**Status:** Well addressed. Phase 4 now specifies a three-phase non-destructive approach: Phase 1 copies files one at a time (avoiding `entries()` OOM), Phase 2 sets the migration flag, Phase 3 does deferred cleanup of old keys on next load. Idempotency is explicit. The plan also addresses `lastRetrieved` reset to prevent immediate GC of migrated files.

No new issues introduced.

### [RESOLVED] Tab sync BroadcastChannel lifecycle

**R1 severity:** Medium

**Status:** Partially addressed. Phase 4 now describes a single channel named `excalibur-sync` (not per-project as R1 discussed) with project-scoped messages containing `projectId`. The dirty-flag-on-focus approach is sensible. However, the plan does not specify where the channel is created/destroyed in the component lifecycle. See Impl-note below.

### [RESOLVED] `DashboardOrLegacyRedirect` hash preservation

**R1 severity:** Medium

**Status:** Addressed. The Phase 7 URL table explicitly maps `/#room={roomId},{roomKey}` to redirect to `/join#room=...`, and the `/join` route handles the flow. The hash preservation path is now clear.

### [RESOLVED] Double `ExcalidrawAPIProvider` wrapping

**R1 severity:** Low

**Status:** Addressed. The `ProjectEditorRoute` wrapper in Phase 2 shows `ExcalidrawAPIProvider` wrapping `ExcalidrawWrapper` inside the route. The existing `ExcalidrawApp` component (App.tsx line 1279) currently has this wrapping at the top level, and the plan's route structure replaces that — the `<Routes>` go inside `<Provider store={appJotaiStore}>` with `ExcalidrawAPIProvider` moved into the editor route element. This is implied but could be more explicit about removing the existing wrapping from `ExcalidrawApp`.

---

## New Findings in R2

### [Medium] `exportToBackend` shareable link still uses `window.location.href` — will embed `/project/:id` in shared URLs

**Location:** Phase 7 (Legacy URL Handling), `excalidraw-app/data/index.ts` line 282

**Issue:** R1 flagged this and the plan's Phase 7 URL table handles inbound `/#json=` links, but the outbound link generation in `exportToBackend` is not addressed. The function does `const url = new URL(window.location.href)` then sets the hash. When called from `/project/abc123`, the generated shareable link will be `https://host/project/abc123#json=id,key`. Recipients clicking this will hit `/project/abc123` — a project ID that doesn't exist on their machine.

**Scope test:** Yes — this affects the sharing architecture. If not caught until implementation, every shareable link generated from the editor would be broken for recipients, requiring a fix to both the URL generation and possibly adding `#json=` handling to the `/project/:id` route.

**Suggested fix:** Add `exportToBackend` to the Phase 5 or Phase 7 changes list. The URL should be constructed from `window.location.origin` (not `href`), producing `https://host/#json=id,key` which flows through `DashboardOrLegacyRedirect`. One-line change: `const url = new URL(window.location.origin)`.

### [Medium] `getCollaborationLink` uses `window.location.pathname` — generates wrong collab links from within a project

**Location:** Phase 6 (Collab Per-Project), `excalidraw-app/data/index.ts` line 163

**Issue:** The plan's Phase 6 section says `getCollaborationLink()` "must be changed from `window.location.origin + window.location.pathname` to `window.location.origin + "/join"`." This is correct and stated clearly. However, looking at the actual code, the function is: `${window.location.origin}${window.location.pathname}#room=${data.roomId},${data.roomKey}`. The current pathname when collaborating from a project will be `/project/abc123`, producing links like `https://host/project/abc123#room=...`. The plan correctly identifies this needs to change to `/join`, but it's listed deep in Phase 6 prose rather than in the Phase 6 changes table or the Files Changed table.

**Scope test:** The fix is stated in the plan, so this is really about visibility. If an implementer follows only the tables and skips the prose, they'll miss this. Upgrading to Medium because broken collab links are a showstopper.

**Suggested fix:** Add `excalidraw-app/data/index.ts` to the Phase 6 "Changes Needed" section with a clear bullet, and add a row in the Files Changed table noting the Phase 6 modification (currently it only says "Minor" for Phase 6, which undersells the collab link format change).

### [Impl-note] `LocalData._save` debounce closure must capture `projectId` at call time — verify the debounce implementation supports this

The plan correctly states "capture `projectId` in the debounce payload at call time, not execution time." The existing `_save` is `debounce(async (elements, appState, files, onFilesSaved) => {...})`. The debounce from `@excalidraw/common` likely implements a standard trailing-edge debounce. Adding `projectId` to the argument list means the debounced function receives whatever args were passed in the most recent call — but if a different project's save comes in during the debounce window, the earlier project's data is silently dropped. With `key={projectId}` remounting this shouldn't happen in practice (unmount flushes), but during rapid navigation without waiting for flush, data loss is theoretically possible. During implementation, verify that `flushSave()` in the unmount cleanup effect is called synchronously before the new project's component mounts.

### [Impl-note] BroadcastChannel creation/cleanup lifecycle

The plan describes the sync mechanism well but doesn't specify where the `BroadcastChannel` instance is created and closed. With `key={projectId}` remounting, the natural place is a `useEffect` in the editor component (or in `ProjectEditorRoute`). The channel should be closed in the effect's cleanup function. Since the plan uses a single channel name (`excalibur-sync`) with project-scoped messages, only one channel instance per tab is needed — it could even be a module-level singleton. During implementation, decide between per-mount (cleaner lifecycle) and singleton (simpler).

### [Impl-note] `ExcalidrawApp` component needs structural refactor for routes

The current `ExcalidrawApp` (App.tsx line 1269-1285) checks for `/excalidraw-plus-export` using `window.location.pathname`, then renders `Provider > ExcalidrawAPIProvider > ExcalidrawWrapper`. With routing, this becomes `Provider > BrowserRouter > Routes`. The `/excalidraw-plus-export` check should become a route. The `ExcalidrawAPIProvider` moves into `ProjectEditorRoute`. This restructuring is implied by the plan but not explicitly described as a change to `ExcalidrawApp` — during implementation, treat this as part of Phase 2.

---

## Summary

The revision addressed all 6 Critical/Must-fix items from R1 and most Medium items. The fixes are architecturally sound — the `key={projectId}` remount pattern, explicit `navigate()` replacement table, three-phase migration, and single-source-of-truth for `projectId` are all solid choices.

Two Medium items remain:

1. `exportToBackend` shareable link URL generation (carried forward from R1, still unaddressed)
2. `getCollaborationLink` fix is stated but buried in prose — needs better visibility in the change tables

Neither requires architectural rework. Both are targeted one-line fixes that should be added to the plan's change tables for implementer visibility.
