// Console tile grid mechanics: in-memory terminal tile records, add/close/
// rename, auto-fit grid, and the per-tile lifecycle (folder-picker -> pty
// spawn). The graph is no longer a tile type — it's a single full-window
// backdrop instance owned by renderer.js (see graph-view.js).

import { createTileElement, updateTileHeader, renderBody, setUsageBadge } from './tile-chrome.js';
import { createTerminalSession } from './terminal-view.js';

const MAX_TILES = 6;
const USAGE_POLL_MS = 15000;

let tiles = [];
let nextId = 1;
let activeId = null;
let gridEl = null;
let emptyStateEl = null;
let terminalTheme = null;
let terminalOpacity = 1;
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
  onAddSide: (id, side) => {
    addTerminal({ id, side: side === 'top' || side === 'left' ? 'before' : 'after' });
  },
};

// DOM element of the next tile (in `tiles` order) that's already mounted, or
// null if this tile is last. Lets a newly-created tile be inserted at its
// correct grid position without ever touching an already-mounted sibling's
// node.
function nextMountedEl(tileId) {
  const idx = tiles.findIndex((t) => t.id === tileId);
  for (let i = idx + 1; i < tiles.length; i++) {
    const entry = tileEls.get(tiles[i].id);
    if (entry) return entry.el;
  }
  return null;
}

function render() {
  // The edge affordance only exists on a tile, so it can't create the very
  // first terminal after a fresh install or the last tile being closed —
  // fall back to a plain centered button for that one case.
  const isEmpty = tiles.length === 0;
  emptyStateEl.hidden = !isEmpty;
  gridEl.hidden = isEmpty;

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
      gridEl.insertBefore(entry.el, nextMountedEl(tile.id));
    } else {
      updateTileHeader(entry, { ...tile, active: tile.id === activeId });
      renderBody(entry, tile);
    }
    entry.setAddDisabled?.(disabled, disabledTitle);
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

// anchor: { id, side: 'before'|'after' } to insert next to an existing tile
// (used by the edge-affordance plus button), or omitted to append at the end.
export async function addTerminal(anchor) {
  if (tiles.length >= MAX_TILES) return;

  const id = nextId++;
  const record = { id, type: 'terminal', label: `Terminal ${id}`, status: 'picking', cwd: null };

  let insertIndex = tiles.length;
  if (anchor) {
    const anchorIndex = tiles.findIndex((t) => t.id === anchor.id);
    if (anchorIndex !== -1) insertIndex = anchor.side === 'before' ? anchorIndex : anchorIndex + 1;
  }
  tiles.splice(insertIndex, 0, record);
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

export function renderConsolePanel(container) {
  container.innerHTML = '';
  for (const session of sessions.values()) session.dispose();
  sessions.clear();
  tileEls.clear();
  tiles = [];
  unrestored = [];
  nextId = 1;
  activeId = null;

  if (usageIntervalId) clearInterval(usageIntervalId);
  usageIntervalId = setInterval(refreshAllUsage, USAGE_POLL_MS);

  const panel = document.createElement('div');
  panel.className = 'console-panel-inner';

  gridEl = document.createElement('div');
  gridEl.className = 'tile-grid';

  emptyStateEl = document.createElement('div');
  emptyStateEl.className = 'tile-grid-empty';
  const emptyBtn = document.createElement('button');
  emptyBtn.type = 'button';
  emptyBtn.className = 'tile-grid-empty-btn';
  emptyBtn.textContent = '+ Add Terminal';
  emptyBtn.addEventListener('click', () => addTerminal());
  emptyStateEl.appendChild(emptyBtn);

  panel.appendChild(gridEl);
  panel.appendChild(emptyStateEl);

  container.appendChild(panel);

  render();
}
