// Terminal tile chrome: header (label + close) and a body container whose
// contents depend on the terminal's status (picking/starting/running/failed).

import { attachEdgeAffordance } from './edge-affordance.js';

export function createTileElement(tile, { onRename, onClose, onFocus, onAddSide } = {}) {
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

  header.appendChild(label);

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

  const affordance = attachEdgeAffordance(el, (side) => onAddSide?.(tile.id, side));

  const entry = {
    el,
    body,
    label,
    terminalMounted: false,
    setAddDisabled: (disabled, title) => affordance.setDisabled(disabled, title),
  };
  renderBody(entry, tile);
  return entry;
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
export function renderBody(entry, tile) {
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
