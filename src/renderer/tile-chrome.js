// Tile chrome shared by both console tile types: header (label + optional
// type-specific action + close) and a body container. Terminal-specific body
// states (picking/starting/running/failed) render as before; graph tiles just
// get a persistent mount div that graph-view.js attaches into once, on creation.

export function createTileElement(tile, { onRename, onClose, onFocus, onReload } = {}) {
  const el = document.createElement('div');
  el.className = 'tile';
  el.dataset.tileId = tile.id;

  el.addEventListener('mousedown', () => onFocus?.(tile.id));

  const header = document.createElement('div');
  header.className = 'tile-header';

  const label = document.createElement('span');
  label.className = 'tile-label';
  label.textContent = tile.label;
  label.contentEditable = 'true';
  label.spellcheck = false;

  label.addEventListener('click', (e) => e.stopPropagation());
  label.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      label.blur();
    }
  });
  label.addEventListener('blur', () => {
    const value = label.textContent.trim() || 'Untitled';
    label.textContent = value;
    onRename?.(tile.id, value);
  });

  const usageBadge = document.createElement('span');
  usageBadge.className = 'tile-usage';
  usageBadge.hidden = true;

  header.appendChild(label);
  header.appendChild(usageBadge);

  if (tile.type === 'graph') {
    const reloadBtn = document.createElement('button');
    reloadBtn.className = 'tile-action';
    reloadBtn.textContent = 'Reload';
    reloadBtn.title = 'Reload graph';
    reloadBtn.addEventListener('mousedown', (e) => e.stopPropagation());
    reloadBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onReload?.(tile.id);
    });
    header.appendChild(reloadBtn);
  }

  const closeBtn = document.createElement('button');
  closeBtn.className = 'tile-close';
  closeBtn.textContent = '×';
  closeBtn.title = 'Close tile';
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    onClose?.(tile.id);
  });

  header.appendChild(closeBtn);

  const body = document.createElement('div');
  body.className = 'tile-body';

  el.appendChild(header);
  el.appendChild(body);

  const entry = { el, body, label, usageBadge, terminalMounted: false, graphMounted: false };
  renderBody(entry, tile);
  return entry;
}

function formatCost(usd) {
  if (usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

// Shows/hides the per-pane usage indicator. `usage` is whatever
// window.orbit.getUsage() resolved to: null when no matching transcript
// could be found/parsed for this pane (indicator stays hidden), or
// { costUSD } otherwise. Terminal tiles only.
export function setUsageBadge(entry, usage) {
  if (!usage || typeof usage.costUSD !== 'number') {
    entry.usageBadge.hidden = true;
    return;
  }
  entry.usageBadge.textContent = formatCost(usage.costUSD);
  entry.usageBadge.hidden = false;
}

export function updateTileHeader(entry, tile) {
  entry.el.classList.toggle('active', !!tile.active);
  if (document.activeElement !== entry.label) {
    entry.label.textContent = tile.label;
  }
}

// Only pre-terminal states (picking/starting/failed) rebuild the terminal body,
// and only when the status changed. Once a terminal has been mounted (status
// flipped to 'running'), this is a no-op forever for that tile — terminal-view.js
// owns the body's contents from then on, including freezing it in place on 'ended'.
// Graph tiles mount their body div exactly once, on tile creation; graph-view.js
// owns everything inside it after that.
export function renderBody(entry, tile) {
  if (tile.type === 'graph') {
    if (entry.graphMounted) return;
    entry.graphMounted = true;
    entry.body.classList.add('tile-body-active');
    const mount = document.createElement('div');
    mount.className = 'graph-area';
    entry.body.appendChild(mount);
    entry.mount = mount;
    return;
  }

  if (entry.terminalMounted || entry.renderedStatus === tile.status) return;
  entry.renderedStatus = tile.status;

  entry.body.innerHTML = '';
  switch (tile.status) {
    case 'picking':
      entry.body.classList.add('tile-body-center');
      entry.body.textContent = 'Choosing folder…';
      break;
    case 'starting':
      entry.body.classList.add('tile-body-center');
      entry.body.innerHTML = '<span class="spinner"></span><span>Starting session…</span>';
      break;
    case 'running': {
      entry.body.classList.remove('tile-body-center');
      entry.body.classList.add('tile-body-active');
      const mount = document.createElement('div');
      mount.className = 'terminal-mount';
      entry.body.appendChild(mount);
      entry.mount = mount;
      entry.terminalMounted = true;
      break;
    }
    case 'failed':
      entry.body.classList.add('tile-body-center');
      entry.body.textContent = `Failed to start: ${tile.error}`;
      break;
    default:
      entry.body.classList.add('tile-body-center');
      entry.body.textContent = tile.status;
  }
}
