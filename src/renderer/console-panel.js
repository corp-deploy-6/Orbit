// Console tile grid mechanics: in-memory terminal tile records, add/close/
// rename, auto-fit grid, and the per-tile lifecycle (folder-picker -> pty
// spawn). The graph is no longer a tile type — it's a single full-window
// backdrop instance owned by renderer.js (see graph-view.js).

import { createTileElement, updateTileHeader, renderBody, setUsageBadge } from './tile-chrome.js';
import { createTerminalSession } from './terminal-view.js';
import { insertNode, removeNode, buildFromOrder } from './split-layout.js';

const MAX_TILES = 6;
const USAGE_POLL_MS = 15000;
const SPLIT_MIN_RATIO = 0.15;
const SPLIT_MAX_RATIO = 0.85;

let tiles = [];
let nextId = 1;
let activeId = null;
let gridEl = null;
let splitEl = null;
let emptyStateEl = null;
let terminalTheme = null;
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
let usageIntervalId = null;

// Reads the pane's own transcript-derived usage (main process, read-only) and
// updates its header badge. Silently leaves the badge hidden on any failure —
// a missing/unparseable transcript is expected for non-Claude commands.
async function refreshUsage(record) {
  if (record.type !== 'terminal' || record.status !== 'running' || !record.cwd) return;
  const entry = tileEls.get(record.id);
  if (!entry) return;
  let usage = null;
  try {
    usage = await window.orbit.getUsage(record.id, record.cwd);
  } catch {
    usage = null;
  }
  // Tile may have closed while the lookup was in flight.
  if (tileEls.get(record.id) === entry) setUsageBadge(entry, usage);
}

function refreshAllUsage() {
  for (const tile of tiles) refreshUsage(tile);
}

export function setTerminalTheme(theme) {
  terminalTheme = theme;
  for (const session of sessions.values()) session.setTheme(theme);
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
  const record = tiles.find((t) => t.id === id);
  if (record) refreshUsage(record);
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

// Recursively places tile elements (existing DOM nodes, reused as-is) into
// nested .split-node/.split-pane wrappers per the split tree. Only called
// when splitRoot's identity has actually changed (see render()) — never on
// an ordinary cosmetic render — so a focus change never reparents a tile.
function buildSplitDom(node) {
  if (node.type === 'leaf') return tileEls.get(node.tileId).el;

  const container = document.createElement('div');
  container.className = `split-node split-${node.direction}`;

  const [childA, childB] = node.children;
  const sizes = node.sizes || [0.5, 0.5];

  const paneA = document.createElement('div');
  paneA.className = 'split-pane';
  paneA.style.flex = `${sizes[0]} 1 0%`;
  paneA.appendChild(buildSplitDom(childA));

  const paneB = document.createElement('div');
  paneB.className = 'split-pane';
  paneB.style.flex = `${sizes[1]} 1 0%`;
  paneB.appendChild(buildSplitDom(childB));

  const divider = document.createElement('div');
  divider.className = `split-divider split-divider-${node.direction}`;
  attachDividerDrag(divider, container, node, paneA, paneB);

  container.appendChild(paneA);
  container.appendChild(divider);
  container.appendChild(paneB);
  return container;
}

// Drags the divider between two panes. Style writes (and therefore the
// terminals' ResizeObserver-driven pty resize, terminal-view.js) are
// throttled to one per animation frame rather than firing on every
// pointermove, so a fast drag can't spam pty resize calls (#66 risk note).
function attachDividerDrag(dividerEl, containerEl, node, paneA, paneB) {
  const isRow = node.direction === 'row';

  function apply(ratio) {
    node.sizes = [ratio, 1 - ratio];
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
    splitEl.innerHTML = '';
    if (splitRoot) splitEl.appendChild(buildSplitDom(splitRoot));
    lastRenderedSplitRoot = splitRoot;
  }
}

async function spawnSession(record) {
  const hadPriorSessionId = !!record.claudeSessionId;

  // A fresh pty is about to be created for this pane id. Drop any stale
  // usage-tracker claim first, since the id is a renderer-local counter that
  // resets on reload/restore and could otherwise be reused onto an old,
  // unrelated transcript file.
  try {
    await window.orbit.resetUsage(record.id, record.cwd);
  } catch {
    // best-effort; usage badge just stays uncached
  }

  const session = createTerminalSession({
    id: record.id,
    cwd: record.cwd,
    theme: terminalTheme,
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
  refreshUsage(record);

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
    if (anchor && anchorIndex !== -1 && splitRoot) {
      splitRoot = insertNode(splitRoot, anchor.id, anchor.edgeSide, record.id);
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
  if (record.status === 'running') {
    refreshUsage(record);
  } else if (record.status === 'failed') {
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

  if (usageIntervalId) clearInterval(usageIntervalId);
  usageIntervalId = setInterval(refreshAllUsage, USAGE_POLL_MS);

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
