// Console tile grid mechanics: in-memory terminal tile records, add/close/
// rename, auto-fit grid, and the per-tile lifecycle (folder-picker -> pty
// spawn). The graph is no longer a tile type — it's a single full-window
// backdrop instance owned by renderer.js (see graph-view.js).

import { createTileElement, updateTileHeader, renderBody } from './tile-chrome.js';
import { createTerminalSession } from './terminal-view.js';
import { insertNode, removeNode, buildFromOrder, fitsQuadrantGrid } from './split-layout.js';

// Four tiles max, arranged as at most a 2x2 quadrant grid: no row and no
// column ever holds more than two consoles.
const MAX_TILES = 4;
const SPLIT_MIN_RATIO = 0.15;
const SPLIT_MAX_RATIO = 0.85;

let tiles = [];
let nextId = 1;
let activeId = null;
let gridEl = null;
let splitEl = null;
let emptyStateEl = null;
let terminalTheme = null;
let terminalFont = null;
let terminalOpacity = 1;
let layoutMode = 'grid';
// The split tree is derived state over `tiles`, never persisted (see #66) —
// rebuilt wholesale by foldSplitRoot() on restore/mode-switch, edited
// in-place by insertNode/removeNode for live add/close so an existing
// subtree's structure and drag-resized sizes survive those. Compared by
// reference in render() to know whether the split DOM needs restructuring;
// `undefined` (not `null`) so the very first split render always builds it.
let splitRoot = null;
let lastRenderedSplitRoot;
// Saved sessions not yet turned into tiles: still queued mid-restore, or
// skipped for a cap. Always persisted after the live tiles, so a
// close/rename/add or a crash during restore never drops or reverts them.
let unrestored = [];

const tileEls = new Map(); // id -> entry from createTileElement
const sessions = new Map(); // id -> terminal session controller

export function setTerminalTheme(theme, font = null) {
  terminalTheme = theme;
  terminalFont = font;
  for (const session of sessions.values()) session.setTheme(theme, font);
}

export function closeActiveTile() {
  if (activeId === null) return;
  handlers.onClose(activeId);
}

export function setTerminalOpacity(value) {
  terminalOpacity = value;
  for (const session of sessions.values()) session.setOpacity(value);
}

export function forceRedrawConsole() {
  for (const session of sessions.values()) session.forceRedraw();
  const activeSession = sessions.get(activeId);
  activeSession?.focus();
}

function basename(p) {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

async function writeSessions(list) {
  try {
    await window.orbit.saveSessions(list);
  } catch (err) {
    console.error('Failed to save sessions', err);
  }
}

// Persist cwd/label/claudeSessionId/order so tiles can be recreated on next
// launch. Live process/renderer state is not preserved. Every terminal status
// is kept, including 'ended' and 'failed' — a tile only drops out of
// persistence by being explicitly closed (removeTile).
function persistSessions() {
  const toSave = tiles
    .filter((t) => t.cwd)
    .map((t) => ({ type: 'terminal', cwd: t.cwd, label: t.label, claudeSessionId: t.claudeSessionId }));
  writeSessions([...toSave, ...unrestored]);
}

function removeTile(id) {
  tiles = tiles.filter((t) => t.id !== id);
  if (activeId === id) activeId = null;
  if (splitRoot) splitRoot = removeNode(splitRoot, id);

  const entry = tileEls.get(id);
  if (entry) {
    entry.el.remove();
    tileEls.delete(id);
  }

  const session = sessions.get(id);
  if (session) {
    session.dispose();
    sessions.delete(id);
  }
}

// Rebuilds splitRoot wholesale from current tile order — the "derive, don't
// persist" fold used for restore and grid->split mode switches.
function foldSplitRoot() {
  splitRoot = buildFromOrder(tiles.map((t) => t.id));
}

function setActive(id) {
  if (activeId === id) return;
  activeId = id;
  render();
}

const handlers = {
  onRename: (id, value) => {
    const t = tiles.find((t) => t.id === id);
    if (t) {
      t.label = value;
      t.labelCustomized = true;
      persistSessions();
    }
  },
  onClose: (id) => {
    removeTile(id);
    persistSessions();
    render();
  },
  onFocus: setActive,
  onAddSide: (id, edgeSide) => {
    addTerminal({ id, edgeSide });
  },
};

// DOM element of the next tile (in `tiles` order) that's already a child of
// gridEl, or null if there isn't one (insertBefore(node, null) appends).
// Checking actual gridEl parentage — not just "has a tileEls entry" — matters
// once split mode exists: during a split->grid mode switch every tile still
// has an entry (parented under splitEl), so a same-pass reparent must treat
// them as un-mounted-in-grid until each is actually moved over, or an
// earlier tile's insertBefore would reference a sibling gridEl doesn't
// contain yet and throw.
function nextMountedEl(tileId) {
  const idx = tiles.findIndex((t) => t.id === tileId);
  for (let i = idx + 1; i < tiles.length; i++) {
    const entry = tileEls.get(tiles[i].id);
    if (entry && entry.el.parentElement === gridEl) return entry.el;
  }
  return null;
}

// Builds a .split-node (container + two panes + divider) for `node` with
// nothing placed in its panes yet. Layout is always children[0]=paneA,
// [1]=divider, [2]=paneB — patchSplitDom relies on that indexing.
function createSplitShell(node) {
  const container = document.createElement('div');
  container.className = `split-node split-${node.direction}`;

  const sizes = node.sizes || [0.5, 0.5];
  const paneA = document.createElement('div');
  paneA.className = 'split-pane';
  paneA.style.flex = `${sizes[0]} 1 0%`;
  const paneB = document.createElement('div');
  paneB.className = 'split-pane';
  paneB.style.flex = `${sizes[1]} 1 0%`;

  const divider = document.createElement('div');
  divider.className = `split-divider split-divider-${node.direction}`;
  attachDividerDrag(divider, container, node, paneA, paneB);

  container.appendChild(paneA);
  container.appendChild(divider);
  container.appendChild(paneB);
  return { container, paneA, paneB };
}

// Builds a whole subtree from scratch, placing existing tile elements (reused
// as-is) into nested wrappers. Only for the no-prior-DOM cases — the first
// split render, and a wholesale foldSplitRoot() rebuild where old and new
// trees share nothing to diff. Live add/close go through patchSplitDom.
function buildSplitDom(node) {
  if (node.type === 'leaf') return tileEls.get(node.tileId).el;
  const { container, paneA, paneB } = createSplitShell(node);
  paneA.appendChild(buildSplitDom(node.children[0]));
  paneB.appendChild(buildSplitDom(node.children[1]));
  return container;
}

// Builds newNode's subtree directly into `parentPane` (before `beforeEl`),
// top-down: each split shell is attached to its already-live parent before
// recursing into children, and each leaf's existing tile element is moved
// (not recreated) into place. Unlike buildSplitDom, which builds bottom-up
// into a detached container, nothing here is ever offscreen mid-build, so a
// tile with focus never gets detached. Used by patchSplitDom's fallback for
// shapes the fast paths above don't cover (e.g. a root direction flip).
function mountSplitDom(node, parentPane, beforeEl) {
  if (node.type === 'leaf') {
    const el = tileEls.get(node.tileId).el;
    if (el.parentElement) parentPane.moveBefore(el, beforeEl);
    else parentPane.insertBefore(el, beforeEl);
    return;
  }
  const { container, paneA, paneB } = createSplitShell(node);
  parentPane.insertBefore(container, beforeEl);
  mountSplitDom(node.children[0], paneA, null);
  mountSplitDom(node.children[1], paneB, null);
}

// Patches the live split DOM from oldNode's shape to newNode's, touching only
// what changed (PR #72 review: rebuilding the whole tree detached every tile
// and dropped xterm focus on tiles the edit never touched). split-layout.js
// reuses untouched subtrees by reference, so `oldNode === newNode` means that
// whole subtree's DOM is already correct and is left completely alone.
//
// The rule that keeps a move focus-safe: an already-attached element is only
// ever appended into a parent that is itself already attached to the document
// (a live-to-live move never detaches it), never into a fresh wrapper that
// isn't attached yet. Brand-new tile elements have never been attached, so
// they can go anywhere.
//
// `existingEl` is the live element currently representing oldNode, and
// `parentPane` the attached element holding it. Handles exactly the shapes
// insertNode/removeNode produce: same-shape split (recurse), a leaf wrapped
// into a new split (insert), and a split collapsed into its surviving child
// (close).
function patchSplitDom(oldNode, newNode, existingEl, parentPane) {
  if (oldNode === newNode) return;

  // foldSplitRoot() (buildFromOrder) never reuses object references, even for
  // a tile whose position didn't change — so an unrelated ancestor's fast
  // path can recurse all the way down to two leaf objects that represent the
  // *same* tile. Treat that as the no-op it actually is: existingEl already
  // is that tile's element, in the right place.
  if (oldNode.type === 'leaf' && newNode.type === 'leaf' && oldNode.tileId === newNode.tileId) return;

  if (newNode.type === 'split' && (newNode.children[0] === oldNode || newNode.children[1] === oldNode)) {
    // insertNode: oldNode (a leaf) became one child of a new split beside a
    // brand-new leaf. Attach the shell first, then move the old leaf in.
    const oldIsFirst = newNode.children[0] === oldNode;
    const { container, paneA, paneB } = createSplitShell(newNode);
    const newLeaf = newNode.children[oldIsFirst ? 1 : 0];
    (oldIsFirst ? paneB : paneA).appendChild(tileEls.get(newLeaf.tileId).el);
    parentPane.insertBefore(container, existingEl);
    (oldIsFirst ? paneA : paneB).moveBefore(existingEl, null);
    return;
  }

  if (oldNode.type === 'split' && (oldNode.children[0] === newNode || oldNode.children[1] === newNode)) {
    // removeNode: the surviving sibling is promoted one level up. It is
    // already live under existingEl, so it's a live-to-live move.
    const survivorPane = oldNode.children[0] === newNode ? existingEl.children[0] : existingEl.children[2];
    parentPane.moveBefore(survivorPane.firstElementChild, existingEl);
    existingEl.remove();
    return;
  }

  // Same-shape split (an ancestor on the edited path): keep its wrappers,
  // recurse into each side.
  if (newNode.type === 'split' && oldNode.type === 'split' && oldNode.direction === newNode.direction) {
    const [paneA, divider, paneB] = existingEl.children;
    const sizes = newNode.sizes || [0.5, 0.5];
    paneA.style.flex = `${sizes[0]} 1 0%`;
    paneB.style.flex = `${sizes[1]} 1 0%`;
    divider.splitNode = newNode;
    patchSplitDom(oldNode.children[0], newNode.children[0], paneA.firstElementChild, paneA);
    patchSplitDom(oldNode.children[1], newNode.children[1], paneB.firstElementChild, paneB);
    return;
  }

  // Structural mismatch (e.g. a root direction flip from buildFromOrder):
  // mount the new subtree live, moving every existing tile element in place,
  // then drop the emptied old subtree. Only drop it if it's still parked
  // where it started, though: when oldNode is itself a leaf whose tile
  // persists in newNode, mountSplitDom's walk over newNode will have moved
  // that very element (existingEl) into its new position already, and
  // removing it here would delete a live tile instead of an emptied wrapper.
  mountSplitDom(newNode, parentPane, existingEl);
  if (existingEl.parentElement === parentPane) existingEl.remove();
}

// Drags the divider between two panes. Style writes (and therefore the
// terminals' ResizeObserver-driven pty resize, terminal-view.js) are
// throttled to one per animation frame rather than firing on every
// pointermove, so a fast drag can't spam pty resize calls (#66 risk note).
// The node lives on the element (`splitNode`) so patchSplitDom can repoint a
// reused divider at the current node without stacking a second listener.
function attachDividerDrag(dividerEl, containerEl, node, paneA, paneB) {
  const isRow = node.direction === 'row';
  dividerEl.splitNode = node;

  function apply(ratio) {
    dividerEl.splitNode.sizes = [ratio, 1 - ratio];
    paneA.style.flex = `${ratio} 1 0%`;
    paneB.style.flex = `${1 - ratio} 1 0%`;
  }

  dividerEl.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    dividerEl.setPointerCapture(e.pointerId);
    dividerEl.classList.add('dragging');
    const rect = containerEl.getBoundingClientRect();
    const total = isRow ? rect.width : rect.height;
    let rafId = null;
    let pendingRatio = null;

    function onMove(ev) {
      if (total <= 0) return;
      const pos = isRow ? ev.clientX - rect.left : ev.clientY - rect.top;
      pendingRatio = Math.min(SPLIT_MAX_RATIO, Math.max(SPLIT_MIN_RATIO, pos / total));
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        apply(pendingRatio);
      });
    }

    function onUp() {
      dividerEl.removeEventListener('pointermove', onMove);
      dividerEl.releasePointerCapture(e.pointerId);
      dividerEl.classList.remove('dragging');
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        apply(pendingRatio);
      }
    }

    dividerEl.addEventListener('pointermove', onMove);
    dividerEl.addEventListener('pointerup', onUp, { once: true });
  });
}

function render() {
  // The edge affordance only exists on a tile, so it can't create the very
  // first terminal after a fresh install or the last tile being closed —
  // fall back to a plain centered button for that one case.
  const isEmpty = tiles.length === 0;
  emptyStateEl.hidden = !isEmpty;
  gridEl.hidden = isEmpty || layoutMode !== 'grid';
  splitEl.hidden = isEmpty || layoutMode !== 'split';

  // Drives the grid's column/row template (styles.css) so the tiles always
  // fill the panel instead of leaving a half-empty auto-fit track.
  gridEl.dataset.count = String(tiles.length);

  const disabled = tiles.length >= MAX_TILES;
  const disabledTitle = disabled ? `Maximum of ${MAX_TILES} terminals reached` : 'Add terminal';

  for (const tile of tiles) {
    let entry = tileEls.get(tile.id);
    if (!entry) {
      entry = createTileElement({ ...tile, active: tile.id === activeId }, handlers);
      tileEls.set(tile.id, entry);
      // Only insert on first mount, and at this tile's actual position among
      // already-mounted siblings (insertBefore(node, null) appends). Tiles
      // are never reordered or re-placed once mounted — re-appending an
      // already-placed node on every render (e.g. on the mousedown->onFocus
      // render triggered by clicking into a tile to type) would detach and
      // reattach it, which drops xterm's just-set input focus.
      if (layoutMode === 'grid') gridEl.insertBefore(entry.el, nextMountedEl(tile.id));
    } else {
      updateTileHeader(entry, { ...tile, active: tile.id === activeId });
      renderBody(entry, tile);
      // A tile created under one mode and left mounted there needs a one-time
      // reparent into the other mode's container on a mode switch — cheap
      // reference check, so it's a no-op on every other (cosmetic) render.
      if (layoutMode === 'grid' && entry.el.parentElement !== gridEl) {
        gridEl.insertBefore(entry.el, nextMountedEl(tile.id));
      }
    }
    entry.setAddDisabled?.(disabled, disabledTitle);
  }

  if (layoutMode === 'split' && splitRoot !== lastRenderedSplitRoot) {
    if (splitRoot && lastRenderedSplitRoot) {
      patchSplitDom(lastRenderedSplitRoot, splitRoot, splitEl.firstElementChild, splitEl);
    } else {
      splitEl.replaceChildren(...(splitRoot ? [buildSplitDom(splitRoot)] : []));
    }
    lastRenderedSplitRoot = splitRoot;
  }
}

async function spawnSession(record) {
  const hadPriorSessionId = !!record.claudeSessionId;

  const session = createTerminalSession({
    id: record.id,
    cwd: record.cwd,
    theme: terminalTheme,
    font: terminalFont,
    opacity: terminalOpacity,
    claudeSessionId: record.claudeSessionId,
  });
  sessions.set(record.id, session);

  const result = await session.ready;

  // Tile may have been closed while the pty was spawning.
  if (!tiles.includes(record)) {
    session.dispose();
    sessions.delete(record.id);
    return;
  }

  if (!result?.ok) {
    record.status = 'failed';
    record.error = result?.error || 'unknown error';
    session.dispose();
    sessions.delete(record.id);
    render();
    persistSessions();
    return;
  }

  // Main owns the fresh-vs-resume decision and may have generated a new id
  // (e.g. resume fallback) — always record what it actually used.
  record.claudeSessionId = result.claudeSessionId;
  record.status = 'running';
  render();
  persistSessions();

  const entry = tileEls.get(record.id);
  const hint = hadPriorSessionId && !result.resumed
    ? 'started a new session — previous transcript not found'
    : null;
  session.attach(entry.mount, {
    hint,
    onExit: () => {
      record.status = 'ended';
      persistSessions();
    },
  });
}

// anchor: { id, edgeSide: 'top'|'right'|'bottom'|'left' } to insert next to
// an existing tile (used by the edge-affordance plus button), or omitted to
// append at the end. edgeSide drives both the flat tiles[] insert side (grid
// order) and, in split mode, the split direction/before-after via insertNode.
export async function addTerminal(anchor) {
  if (tiles.length >= MAX_TILES) return;

  const id = nextId++;
  const record = { id, type: 'terminal', label: `Terminal ${id}`, status: 'picking', cwd: null };

  let insertIndex = tiles.length;
  const anchorIndex = anchor ? tiles.findIndex((t) => t.id === anchor.id) : -1;
  if (anchor && anchorIndex !== -1) {
    const before = anchor.edgeSide === 'top' || anchor.edgeSide === 'left';
    insertIndex = before ? anchorIndex : anchorIndex + 1;
  }
  tiles.splice(insertIndex, 0, record);

  if (layoutMode === 'split') {
    // An edge insert can ask for a shape deeper than 2x2 (e.g. splitting a
    // pane that is already half of a split). Fall back to the deterministic
    // quadrant fold rather than honouring it.
    const next =
      anchor && anchorIndex !== -1 && splitRoot
        ? insertNode(splitRoot, anchor.id, anchor.edgeSide, record.id)
        : null;
    if (next && fitsQuadrantGrid(next)) {
      splitRoot = next;
    } else {
      foldSplitRoot();
    }
  }
  // Active immediately on creation, not just once the pty is running —
  // otherwise the new tile has no accent ring and forceRedrawConsole()
  // keeps focusing the previously-active session until the user clicks in.
  // If creation doesn't pan out (picker cancelled, closed mid-pick, or the
  // spawn fails), restore whichever tile was active before rather than
  // stranding the user with nothing focused.
  const previousActiveId = activeId;
  activeId = record.id;
  render();

  // Only restores if nothing else has claimed activeId in the meantime (the
  // user clicking into a different tile while the picker was open, or while
  // the pty was spawning, always wins).
  function restorePreviousActive() {
    if (activeId !== null && activeId !== record.id) return;
    activeId = tiles.some((t) => t.id === previousActiveId) ? previousActiveId : null;
    render();
  }

  const path = await window.orbit.pickDirectory();

  // Tile may have been closed while the dialog was open.
  if (!tiles.includes(record)) {
    restorePreviousActive();
    return;
  }

  if (!path) {
    removeTile(record.id);
    restorePreviousActive();
    return;
  }

  record.cwd = path;
  if (!record.labelCustomized) record.label = basename(path);
  record.status = 'starting';
  render();
  persistSessions();

  await spawnSession(record);
  if (record.status === 'failed') {
    restorePreviousActive();
  }
}

async function restoreTerminal(saved) {
  const record = {
    id: nextId++,
    type: 'terminal',
    label: saved.label,
    labelCustomized: true,
    status: 'starting',
    cwd: saved.cwd,
    claudeSessionId: saved.claudeSessionId,
  };
  tiles.push(record);
  // Split-mode restore folds via the same deterministic algorithm as a live
  // mode switch (#66 decision: derive, don't persist the tree shape) — kept
  // in sync with each tile as it's restored, not just once at the end, so a
  // mid-restore render never strands an already-mounted tile with nowhere
  // to be placed in the split DOM.
  if (layoutMode === 'split') foldSplitRoot();
  render();

  await spawnSession(record);
}

export async function restoreSessions() {
  const raw = (await window.orbit.getSessions()) || [];
  // Old saved sessions predate the `type` field — default them to 'terminal'.
  // Entries with type 'graph' (from before the graph became a full-window
  // backdrop instead of a tile) are dropped quietly — nothing about a graph
  // tile was ever worth resuming.
  const saved = raw.map((entry) => ({ type: 'terminal', ...entry })).filter((entry) => entry.type === 'terminal' && entry.cwd);
  if (!saved.length) return;

  unrestored = saved.map((entry) => ({
    type: 'terminal',
    cwd: entry.cwd,
    label: entry.label,
    claudeSessionId: entry.claudeSessionId,
  }));

  // One at a time. Each entry leaves `unrestored` only as it becomes a live
  // tile, so every write in between still covers the full set.
  while (unrestored.length && tiles.length < MAX_TILES) {
    await restoreTerminal(unrestored.shift());
  }

  const firstReady = tiles.find((t) => t.status === 'running');
  if (activeId === null && firstReady) setActive(firstReady.id);
  persistSessions();
}

// Switches between grid and split rendering without disposing/respawning
// any session (#66 hard requirement) — only ever reparents existing tile
// elements. Split mode's tree is (re)derived from current tile order rather
// than kept around stale from a previous stint in split mode.
export function setConsoleLayoutMode(mode) {
  if (mode !== 'grid' && mode !== 'split') return;
  if (mode === layoutMode) return;
  layoutMode = mode;
  // Whatever split DOM was last rendered no longer matches where tiles live.
  lastRenderedSplitRoot = undefined;
  if (mode === 'split') {
    foldSplitRoot();
  } else {
    splitRoot = null;
  }
  render();
}

export function renderConsolePanel(container, { layoutMode: initialMode } = {}) {
  container.innerHTML = '';
  for (const session of sessions.values()) session.dispose();
  sessions.clear();
  tileEls.clear();
  tiles = [];
  unrestored = [];
  nextId = 1;
  activeId = null;
  layoutMode = initialMode === 'split' ? 'split' : 'grid';
  splitRoot = null;
  lastRenderedSplitRoot = undefined;

  const panel = document.createElement('div');
  panel.className = 'console-panel-inner';

  gridEl = document.createElement('div');
  gridEl.className = 'tile-grid';

  splitEl = document.createElement('div');
  splitEl.className = 'split-container';

  emptyStateEl = document.createElement('div');
  emptyStateEl.className = 'tile-grid-empty';
  const emptyBtn = document.createElement('button');
  emptyBtn.type = 'button';
  emptyBtn.className = 'tile-grid-empty-btn';
  emptyBtn.textContent = '+ Add Terminal';
  emptyBtn.addEventListener('click', () => addTerminal());
  emptyStateEl.appendChild(emptyBtn);

  panel.appendChild(gridEl);
  panel.appendChild(splitEl);
  panel.appendChild(emptyStateEl);

  container.appendChild(panel);

  render();
}
