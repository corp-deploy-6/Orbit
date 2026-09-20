# pane-detach — fix root-direction-flip tile detach (issue #86)

## Goal
When a console is added or removed in split mode and the root split's
direction changes (`buildFromOrder`: 2 tiles → `row`, 3+ tiles → `column`),
every already-open terminal tile must stay attached to the DOM throughout the
layout update and keep keyboard focus. Currently `patchSplitDom`'s fallback
path rebuilds the whole subtree with `buildSplitDom` + `replaceChildren`,
which detaches and reattaches every tile — the exact regression PR #72 fixed,
now reachable again via the direction flip.

## Approach
Add one small helper, `mountSplitDom(node, parentPane, beforeEl)`, and use it
only as `patchSplitDom`'s fallback (`src/renderer/console-panel.js:246-247`),
replacing `buildSplitDom(newNode)` + `parentPane.replaceChildren(fresh)`.

`mountSplitDom` walks `newNode` top-down and, for each split node, inserts a
freshly built shell (`createSplitShell`) into the *live* parent pane **before**
recursing into its children — so by the time a leaf is reached, the pane it's
moving into is already attached to the document. For a leaf, it moves the
tile's existing element (`tileEls.get(tileId).el`) into place with
`parentPane.moveBefore(el, beforeEl)` if the element is already mounted
somewhere (live-to-live move, no detach — same primitive the existing
insert/remove fast paths already use), or `insertBefore` if it's a brand-new,
never-mounted tile. After the whole new subtree is built and attached this
way, the old subtree (`existingEl`, now leaf-less) is removed with
`existingEl.remove()`.

This keeps every currently-working fast path in `patchSplitDom` (same-direction
recurse, leaf-wrap insert, sibling-promotion remove) untouched — they already
handle their cases correctly per #72 — and only replaces the one fallback that
currently regresses. It generalizes to *any* structural mismatch between
oldNode and newNode at a given recursion point (not just a root direction
flip), so it also covers any future shape mismatch `buildFromOrder` might
produce, without needing to special-case "direction changed" specifically.

**Rejected alternative:** a full tile-id-keyed tree diff/reconciler replacing
all of `patchSplitDom`. Rejected as overbuilt for a hobby project — the three
existing fast paths already correctly cover insert/remove/same-shape, which
are the only shapes `insertNode`/`removeNode` produce; only the fallback
(reached solely via `foldSplitRoot`'s wholesale rebuild) needed fixing.

**Rejected alternative:** keep `buildSplitDom` as-is but swap its internal
`appendChild` for `moveBefore` everywhere. Rejected because `buildSplitDom`
builds bottom-up into a detached container before that container is ever
attached to the document — so even with `moveBefore`, a tile moved into it
would still ride along inside a subtree that's momentarily detached until
`replaceChildren` attaches the whole thing. `mountSplitDom` avoids this by
attaching each shell to a live parent *before* moving any leaf into it.

## Files
- `src/renderer/console-panel.js` — add `mountSplitDom` (near `buildSplitDom`,
  ~line 190); change `patchSplitDom`'s fallback (~line 246-247) to call it
  instead of `buildSplitDom` + `replaceChildren`.
- No changes needed to `src/renderer/split-layout.js` (pure data model, not
  implicated — `buildFromOrder`'s varying direction is correct/intended
  behavior per the 2x2 quadrant work, not something to revert).

## Flow
1. `addTerminal` (no anchor, or an edge-insert that doesn't fit the quadrant
   cap) calls `foldSplitRoot()`, which replaces `splitRoot` wholesale via
   `buildFromOrder`. Same for `removeTile` → `removeNode`, when it also lands
   on `foldSplitRoot` indirectly through a subsequent fold, or any other path
   that produces a structurally unrelated new tree.
2. `render()` sees `splitRoot !== lastRenderedSplitRoot` and calls
   `patchSplitDom(lastRenderedSplitRoot, splitRoot, splitEl.firstElementChild, splitEl)`.
3. None of the three shape checks match (root direction differs, e.g. `row` →
   `column`), so the fallback runs: `mountSplitDom(newNode, parentPane, existingEl)`
   builds the new shell tree live, moving each existing tile element in place
   via `moveBefore`, then `existingEl.remove()` drops the emptied old subtree.
4. Tile elements never leave the document during the whole operation; focus
   and terminal state survive.

## Risks / blast radius
- Scope is one function's fallback branch in one file; the three existing
  fast paths, `split-layout.js`, and grid-mode rendering are untouched.
- `moveBefore` is already used elsewhere in this file (`patchSplitDom`'s
  insert/remove paths), so no new browser-API dependency — just a new call
  site. Electron's bundled Chromium already supports it.
- Must not call `moveBefore` on a tile element that has no current parent
  (a brand-new tile created this render, not yet mounted anywhere) —
  `mountSplitDom` branches on `el.parentElement` and uses `insertBefore` for
  that case, mirroring how `buildSplitDom` already treats new leaves.
- `existingEl.remove()` must only run after every leaf under the *new* tree
  has been moved out from wherever it lived — since `foldSplitRoot` always
  rebuilds from the same `tiles` array, oldNode and newNode at the point this
  fallback fires cover the same tile-id set, so nothing is orphaned. Worth a
  reviewer double-check since it's the one place this invariant matters.
- Divider elements/drag state inside the replaced subtree are rebuilt (fresh
  `createSplitShell` per split node), same as today's `buildSplitDom` fallback
  — not a regression, and not mid-drag-reachable (this only runs on discrete
  add/remove events).

## Open questions
None blocking — scope and approach are fully determined by the existing code
patterns (`moveBefore` already in use, `createSplitShell` already factored
out). Flag to review: manually exercise the add-3rd-tile (2→3, row→column)
and remove-back-to-2 (3→2, column→row) transitions in split mode with a tile
focused and typing, per the issue's EARS criteria.
