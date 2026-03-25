# Plan Review: Multi-Project Dashboard (R2)

**Reviewer:** Architectural review agent **Date:** 2026-03-24 **Plan revision:** 2 **Prior review:** R1

---

## R1 Issue Resolution Summary

| R1 Issue | Severity | Status in R2 | Notes |
| --- | --- | --- | --- |
| `window.history` calls bypass react-router | Critical | **Fixed** | Phase 5 now enumerates all 5 call sites with replacement strategy. Collab.tsx class component approach (pass `navigate` as prop) is specified. |
| ExcalidrawWrapper does not remount on project switch | Critical | **Fixed** | Phase 2 adds `ProjectEditorRoute` with `key={projectId}` on `ExcalidrawAPIProvider`. |
| Migration file re-keying not atomic | Critical | **Fixed** | Phase 4 now specifies three-phase migration: copy, flag, deferred cleanup. Old keys never deleted during migration. Idempotency is genuine. |
| `nanoid` not a direct dependency | Must-fix | **Fixed** | Phase 1 explicitly calls out adding `nanoid` to `excalidraw-app/package.json`. |
| `LocalData` is static — projectId threading unclear | Must-fix | **Fixed** | Phase 4 now specifies: capture `projectId` in debounce payload at call time, flush before navigation, route to `SceneStore`. |
| BroadcastChannel tab sync consumer unspecified | Must-fix | **Fixed** | Phase 4 now details the message flow: post on save, dirty flag on receive, reload on focus. Legacy functions explicitly marked. |
| `stopCollaboration` navigates to root | Must-fix | **Fixed** | Phase 6 now specifies navigating to `/project/${projectId}` instead of root. |
| Collab join creates duplicate projects | Medium | **Fixed** | `collabRoomId` field added to `ProjectMetadata`. `/join` route looks up existing projects by `collabRoomId` before creating. |
| `initializeScene` uses raw `window.location` | Medium | **Partially fixed** | Phase 5 says `initializeScene` accepts `projectId` parameter. But see new issue below about hash parsing still using `window.location` directly. |
| No cleanup on unmount (BroadcastChannel) | Medium | **Not addressed** | See below. |
| `deleteProject` prefix scan with `idb-keyval` | Medium | **Not addressed** | Plan still says "delete all files with `{projectId}:*` prefix" without acknowledging the `keys()` iteration approach. See impl-note. |
| `ExcalidrawAPIProvider` wrapping may be redundant | Low | **Fixed** | Phase 2 route definition shows `ExcalidrawAPIProvider` inside `ProjectEditorRoute`, implying it moves out of `ExcalidrawApp`. |

---

## New Issues in R2

### [Medium] BroadcastChannel and event listeners not cleaned up on unmount — still unaddressed

**Location:** Phase 4 (Tab Sync), Phase 5

**Issue:** The R1 review flagged that `BroadcastChannel` must be closed in a `useEffect` cleanup, and that the `hashchange` listener (App.tsx line 635) may fire unexpectedly when react-router navigates. R2 does not address either point.

With `key={projectId}` forcing remounts, the component fully unmounts on project switch. The `useEffect` cleanup at lines 640-650 removes `hashchange`, `unload`, `blur`, `visibilitychange`, and `focus` listeners — so those are fine. But the new `BroadcastChannel` listener introduced in Phase 4 has no specified cleanup path. If the channel isn't closed on unmount, a stale listener from a previous project could receive a message and trigger a reload for the wrong project.

Additionally, the `hashchange` listener calls `initializeScene` on any hash change. React Router navigation that changes the hash (e.g., adding/removing `#room=...`) will trigger this listener, potentially causing a double-initialization race with the normal route-based init. This is worth explicitly addressing.

**Scope test:** Yes — discovering this during implementation would require rethinking where the channel is created and how the hashchange listener interacts with routing.

**Suggested fix:** Add to Phase 4/5:

1. BroadcastChannel creation and `.onmessage` assignment must happen inside the `useEffect` that sets up sync, with `channel.close()` in the cleanup return.
2. The `hashchange` listener should be removed or guarded to only handle collab hash changes (check for `#room=` prefix), not all hash changes.

---

### [Medium] `currentProjectIdAtom` stale-tick problem is identified but the resolution is ambiguous

**Location:** Phase 5 — Jotai Atom

**Issue:** The plan correctly identifies that setting `currentProjectIdAtom` in a `useEffect` creates a tick where the atom is stale. It then says "Prefer removing the atom entirely and passing `projectId` explicitly; if it is retained for convenience in deeply nested non-React code, document that it is a mirror."

This is good analysis but it leaves the decision open. The problem is that `LocalData` (static class), `tabSync`, and other non-React code need `projectId`. The plan says in Phase 4 that `projectId` is "captured in the debounce payload at call time" — which implies explicit parameter passing, not the atom. But Phase 5 still introduces the atom and says "if kept."

Leaving this as "TBD" creates a risk: the implementer might use the atom in some places and explicit params in others, producing an inconsistent threading model where some code reads from the atom (potentially stale) and other code uses the passed parameter.

**Scope test:** This could cause subtle bugs (saves to wrong project during the stale tick) but the plan already biases toward explicit params. Borderline.

**Suggested fix:** Make a decision in the plan: either remove the atom from the plan entirely (since explicit parameter passing is already specified for every call site), or keep it but specify that it is only for read-only convenience in UI components and is never used in the persistence/sync path.

---

### [Impl-note] Migration OOM risk is addressed but the `entries()` warning could be more prominent

Phase 4's migration script now says to iterate files "one at a time" using `keys()` then `get()` each individually, with a parenthetical warning not to use `entries()`. This is correct. The warning is embedded in step 3c-Phase 1. During implementation, this is easy to miss since `entries()` is the natural idb-keyval API for "iterate everything." Consider adding this to the Risk Assessment table as a low-severity item — "Migration must not use `entries()` on files store (OOM risk for users with many large images)."

### [Impl-note] `clearObsoleteFiles` scoping and `lastRetrieved` reset

Phase 4 correctly notes that `clearObsoleteFiles` must be scoped to `{currentProjectId}:*` entries only. It also notes that `lastRetrieved` must be reset to `Date.now()` on migrated files to avoid the 24-hour GC collecting them. Both are called out in the right places. During implementation, verify that the existing `clearObsoleteFiles` function in `LocalData.ts` / `FileManager` actually checks `lastRetrieved` — if it uses a different mechanism, the mitigation won't work.

### [Impl-note] `deleteProject` file cleanup still uses unacknowledged `keys()` iteration

The R1 review noted that `idb-keyval` has no prefix query support and the plan should acknowledge the `keys()` + filter approach. R2 still says "delete all files with `{projectId}:*` prefix from files store" without specifying the mechanism. This won't cause architectural rework — it's straightforward to implement — but stating the approach prevents implementer confusion about whether a more efficient API exists.

### [Impl-note] Collab link generation timing

Phase 6 says `getCollaborationLink()` must change from `window.location.origin + window.location.pathname` to `window.location.origin + "/join"`. Verify during implementation that this function is in `excalidraw-app/data/index.ts` and not re-exported or aliased elsewhere. The plan references `data/index.ts` which is correct based on the import at App.tsx line 116.

### [Impl-note] `ExcalidrawApp` component restructuring

The plan implies `ExcalidrawApp` (lines 1269-1285) becomes the routing host. Currently it wraps `ExcalidrawWrapper` in `ExcalidrawAPIProvider` inside `Provider`. With routing, the structure becomes `Provider > Routes > [Dashboard | ProjectEditorRoute > ExcalidrawAPIProvider > ExcalidrawWrapper]`. The `ExcalidrawAPIProvider` must NOT remain at the `ExcalidrawApp` level since that would persist across route changes, defeating the `key={projectId}` remount. The plan's Phase 2 route structure implies this correctly, but the restructuring of `ExcalidrawApp` itself should be explicit in the implementation.

---

## Verdict

R2 addresses all three Critical issues and four of the five Must-fix issues from R1. The fixes are well-specified and don't introduce new architectural problems. The remaining open items are Medium severity (BroadcastChannel cleanup, atom decision) and implementation notes. None would cause significant rework if discovered during implementation — they're more "specify the approach to avoid confusion" than "this will break."

**Recommendation:** Approve for implementation with the two Medium items noted above resolved in the plan or explicitly deferred to implementation-time decisions.
