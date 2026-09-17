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
let addTerminalBtn = null;
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
};

function render() {
  for (const tile of tiles) {
    let entry = tileEls.get(tile.id);
    if (!entry) {
      entry = createTileElement({ ...tile, active: tile.id === activeId }, handlers);
      tileEls.set(tile.id, entry);
      // Only insert on first mount. Tiles are only ever appended (never
      // reordered), so re-appending an already-placed node on every render
      // (e.g. on the mousedown->onFocus render triggered by clicking into a
      // tile to type) would detach and reattach it — appendChild always does
      // remove-then-insert, which drops xterm's just-set input focus.
      gridEl.appendChild(entry.el);
    } else {
      updateTileHeader(entry, { ...tile, active: tile.id === activeId });
      renderBody(entry, tile);
    }
  }

  addTerminalBtn.disabled = tiles.length >= MAX_TILES;
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

async function addTerminal() {
  if (tiles.length >= MAX_TILES) return;

  const id = nextId++;
  const record = { id, type: 'terminal', label: `Terminal ${id}`, status: 'picking', cwd: null };
  tiles.push(record);
  render();

  const path = await window.orbit.pickDirectory();

  // Tile may have been closed while the dialog was open.
  if (!tiles.includes(record)) return;

  if (!path) {
    removeTile(record.id);
    render();
    return;
  }

  record.cwd = path;
  if (!record.labelCustomized) record.label = basename(path);
  record.status = 'starting';
  render();
  persistSessions();

  await spawnSession(record);
  if (record.status === 'running') setActive(record.id);
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

  const toolbar = document.createElement('div');
  toolbar.className = 'console-toolbar';

  addTerminalBtn = document.createElement('button');
  addTerminalBtn.className = 'add-tile-btn';
  addTerminalBtn.textContent = '+ Add Terminal';
  addTerminalBtn.addEventListener('click', addTerminal);

  toolbar.appendChild(addTerminalBtn);

  gridEl = document.createElement('div');
  gridEl.className = 'tile-grid';

  panel.appendChild(toolbar);
  panel.appendChild(gridEl);

  container.appendChild(panel);

  render();
}
