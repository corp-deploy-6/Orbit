// Tile grid mechanics: in-memory tile records, add/close/rename, auto-fit grid,
// and the folder-picker -> pty spawn lifecycle for each tile.

import { createTileElement, updateTileHeader, renderBody } from './tile.js';
import { createTerminalSession } from './terminal-view.js';

const MAX_TILES = 6;

let tiles = [];
let nextId = 1;
let activeId = null;
let gridEl = null;
let addBtn = null;

const tileEls = new Map(); // id -> entry from createTileElement
const sessions = new Map(); // id -> terminal session controller

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

function render() {
  // Drop DOM/session for any tile record no longer present.
  for (const id of [...tileEls.keys()]) {
    if (!tiles.find((t) => t.id === id)) {
      tileEls.get(id).el.remove();
      tileEls.delete(id);
      const session = sessions.get(id);
      if (session) {
        session.dispose();
        sessions.delete(id);
      }
    }
  }

  const handlers = {
    onRename: (id, value) => {
      const t = tiles.find((t) => t.id === id);
      if (t) t.label = value;
    },
    onClose: (id) => {
      removeTile(id);
      render();
    },
    onFocus: (id) => {
      activeId = id;
      render();
    },
  };

  for (const tile of tiles) {
    let entry = tileEls.get(tile.id);
    if (!entry) {
      entry = createTileElement({ ...tile, active: tile.id === activeId }, handlers);
      tileEls.set(tile.id, entry);
    } else {
      updateTileHeader(entry, { ...tile, active: tile.id === activeId });
      renderBody(entry, tile);
    }
    gridEl.appendChild(entry.el);
  }

  addBtn.disabled = tiles.length >= MAX_TILES;
}

async function addTile() {
  if (tiles.length >= MAX_TILES) return;

  const record = { id: nextId++, label: `Tile ${nextId - 1}`, status: 'picking', cwd: null };
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
  record.status = 'starting';
  render();

  const session = createTerminalSession({ id: record.id, cwd: path });
  sessions.set(record.id, session);

  const result = await session.ready;

  // Tile may have been closed while the pty was spawning.
  if (!tiles.includes(record)) {
    session.dispose();
    sessions.delete(record.id);
    return;
  }

  if (!result?.ok) {
    record.status = 'ended';
    session.dispose();
    sessions.delete(record.id);
    const entry = tileEls.get(record.id);
    if (entry) {
      entry.body.classList.add('tile-body-center');
      entry.body.textContent = `Failed to start: ${result?.error || 'unknown error'}`;
    }
    return;
  }

  record.status = 'running';
  render();

  const entry = tileEls.get(record.id);
  session.attach(entry.body, {
    onExit: () => {
      record.status = 'ended';
    },
  });
}

export function renderTilePanel(container) {
  container.innerHTML = '';
  for (const session of sessions.values()) session.dispose();
  sessions.clear();
  tileEls.clear();
  tiles = [];
  nextId = 1;
  activeId = null;

  const panel = document.createElement('div');
  panel.className = 'tile-panel-inner';

  const toolbar = document.createElement('div');
  toolbar.className = 'tile-toolbar';

  addBtn = document.createElement('button');
  addBtn.className = 'add-tile-btn';
  addBtn.textContent = '+ Add Tile';
  addBtn.addEventListener('click', addTile);

  toolbar.appendChild(addBtn);

  gridEl = document.createElement('div');
  gridEl.className = 'tile-grid';

  panel.appendChild(toolbar);
  panel.appendChild(gridEl);
  container.appendChild(panel);

  render();
}
