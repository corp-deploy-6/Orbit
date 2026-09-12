// Terminal grid mechanics: in-memory terminal records, add/close/rename, auto-fit grid,
// and the folder-picker -> pty spawn lifecycle for each terminal.

import { createTerminalElement, updateTerminalHeader, renderBody } from './terminal.js';
import { createTerminalSession } from './terminal-view.js';
import { renderFileTreePanel, setActiveCwd } from './file-tree-panel.js';

const MAX_TERMINALS = 6;

let terminals = [];
let nextId = 1;
let activeId = null;
let gridEl = null;
let addBtn = null;
let terminalTheme = null;

export function setTerminalTheme(theme) {
  terminalTheme = theme;
  for (const session of sessions.values()) session.setTheme(theme);
}

const terminalEls = new Map(); // id -> entry from createTerminalElement
const sessions = new Map(); // id -> terminal session controller

function basename(p) {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

function removeTerminal(id) {
  terminals = terminals.filter((t) => t.id !== id);
  if (activeId === id) activeId = null;

  const entry = terminalEls.get(id);
  if (entry) {
    entry.el.remove();
    terminalEls.delete(id);
  }

  const session = sessions.get(id);
  if (session) {
    session.dispose();
    sessions.delete(id);
  }
}

function render() {
  // Drop DOM/session for any terminal record no longer present.
  for (const id of [...terminalEls.keys()]) {
    if (!terminals.find((t) => t.id === id)) {
      terminalEls.get(id).el.remove();
      terminalEls.delete(id);
      const session = sessions.get(id);
      if (session) {
        session.dispose();
        sessions.delete(id);
      }
    }
  }

  const handlers = {
    onRename: (id, value) => {
      const t = terminals.find((t) => t.id === id);
      if (t) {
        t.label = value;
        t.labelCustomized = true;
      }
    },
    onClose: (id) => {
      const wasActive = activeId === id;
      removeTerminal(id);
      render();
      if (wasActive) setActiveCwd(null);
    },
    onFocus: (id) => {
      activeId = id;
      render();
      const t = terminals.find((t) => t.id === id);
      setActiveCwd(t?.cwd ?? null);
    },
  };

  for (const terminal of terminals) {
    let entry = terminalEls.get(terminal.id);
    if (!entry) {
      entry = createTerminalElement({ ...terminal, active: terminal.id === activeId }, handlers);
      terminalEls.set(terminal.id, entry);
      // Only insert on first mount. Terminals are only ever appended (never
      // reordered), so re-appending an already-placed node on every render
      // (e.g. on the mousedown->onFocus render triggered by clicking into a
      // terminal to type) would detach and reattach it — appendChild always
      // does remove-then-insert, which drops xterm's just-set input focus.
      gridEl.appendChild(entry.el);
    } else {
      updateTerminalHeader(entry, { ...terminal, active: terminal.id === activeId });
      renderBody(entry, terminal);
    }
  }

  addBtn.disabled = terminals.length >= MAX_TERMINALS;
}

async function addTerminal() {
  if (terminals.length >= MAX_TERMINALS) return;

  const record = { id: nextId++, label: `Terminal ${nextId - 1}`, status: 'picking', cwd: null };
  terminals.push(record);
  render();

  const path = await window.orbit.pickDirectory();

  // Terminal may have been closed while the dialog was open.
  if (!terminals.includes(record)) return;

  if (!path) {
    removeTerminal(record.id);
    render();
    return;
  }

  record.cwd = path;
  if (!record.labelCustomized) record.label = basename(path);
  record.status = 'starting';
  render();
  if (record.id === activeId) setActiveCwd(record.cwd);

  const session = createTerminalSession({ id: record.id, cwd: path, theme: terminalTheme });
  sessions.set(record.id, session);

  const result = await session.ready;

  // Terminal may have been closed while the pty was spawning.
  if (!terminals.includes(record)) {
    session.dispose();
    sessions.delete(record.id);
    return;
  }

  if (!result?.ok) {
    record.status = 'ended';
    session.dispose();
    sessions.delete(record.id);
    const entry = terminalEls.get(record.id);
    if (entry) {
      entry.body.classList.add('terminal-body-center');
      entry.body.textContent = `Failed to start: ${result?.error || 'unknown error'}`;
    }
    return;
  }

  record.status = 'running';
  render();

  const entry = terminalEls.get(record.id);
  session.attach(entry.mount, {
    onExit: () => {
      record.status = 'ended';
    },
  });
}

export function renderTerminalPanel(container) {
  container.innerHTML = '';
  for (const session of sessions.values()) session.dispose();
  sessions.clear();
  terminalEls.clear();
  terminals = [];
  nextId = 1;
  activeId = null;

  const panel = document.createElement('div');
  panel.className = 'terminal-panel-inner';

  const toolbar = document.createElement('div');
  toolbar.className = 'terminal-toolbar';

  addBtn = document.createElement('button');
  addBtn.className = 'add-terminal-btn';
  addBtn.textContent = '+ Add Terminal';
  addBtn.addEventListener('click', addTerminal);

  toolbar.appendChild(addBtn);

  gridEl = document.createElement('div');
  gridEl.className = 'terminal-grid';

  panel.appendChild(toolbar);
  panel.appendChild(gridEl);

  const row = document.createElement('div');
  row.className = 'terminal-panel-row';

  const treeContainer = document.createElement('div');

  row.appendChild(panel);
  row.appendChild(treeContainer);
  container.appendChild(row);

  renderFileTreePanel(treeContainer);

  render();
}
