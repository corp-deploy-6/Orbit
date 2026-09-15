// Renders a single terminal's shell: header (label + close) + a body that
// branches on terminal.status. Once a terminal reaches 'running' its body becomes
// owned by terminal-view.js (the live xterm DOM) and is never rebuilt again
// here, even if the terminal later ends — terminal-view freezes it in place.

export function createTerminalElement(terminal, { onRename, onClose, onFocus } = {}) {
  const el = document.createElement('div');
  el.className = 'terminal';
  el.dataset.terminalId = terminal.id;

  el.addEventListener('mousedown', () => onFocus?.(terminal.id));

  const header = document.createElement('div');
  header.className = 'terminal-header';

  const label = document.createElement('span');
  label.className = 'terminal-label';
  label.textContent = terminal.label;
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
    onRename?.(terminal.id, value);
  });

  const usageBadge = document.createElement('span');
  usageBadge.className = 'terminal-usage';
  usageBadge.hidden = true;

  const closeBtn = document.createElement('button');
  closeBtn.className = 'terminal-close';
  closeBtn.textContent = '×';
  closeBtn.title = 'Close terminal';
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    onClose?.(terminal.id);
  });

  header.appendChild(label);
  header.appendChild(usageBadge);
  header.appendChild(closeBtn);

  const body = document.createElement('div');
  body.className = 'terminal-body';

  el.appendChild(header);
  el.appendChild(body);

  const entry = { el, body, label, usageBadge, terminalMounted: false };
  renderBody(entry, terminal);
  return entry;
}

function formatCost(usd) {
  if (usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

// Shows/hides the per-pane usage indicator. `usage` is whatever
// window.orbit.getUsage() resolved to: null when no matching transcript
// could be found/parsed for this pane (indicator stays hidden), or
// { costUSD } otherwise.
export function setUsageBadge(entry, usage) {
  if (!usage || typeof usage.costUSD !== 'number') {
    entry.usageBadge.hidden = true;
    return;
  }
  entry.usageBadge.textContent = formatCost(usage.costUSD);
  entry.usageBadge.hidden = false;
}

export function updateTerminalHeader(entry, terminal) {
  entry.el.classList.toggle('active', !!terminal.active);
  if (document.activeElement !== entry.label) {
    entry.label.textContent = terminal.label;
  }
}

// Only pre-terminal states (picking/starting/failed) rebuild the body, and only
// when the status changed. Once a terminal has been mounted (status flipped to
// 'running'), this is a no-op forever for that terminal — terminal-view.js owns
// the body's contents from then on, including freezing it in place on 'ended'.
export function renderBody(entry, terminal) {
  if (entry.terminalMounted || entry.renderedStatus === terminal.status) return;
  entry.renderedStatus = terminal.status;

  entry.body.innerHTML = '';
  switch (terminal.status) {
    case 'picking':
      entry.body.classList.add('terminal-body-center');
      entry.body.textContent = 'Choosing folder…';
      break;
    case 'starting':
      entry.body.classList.add('terminal-body-center');
      entry.body.innerHTML = '<span class="spinner"></span><span>Starting session…</span>';
      break;
    case 'running': {
      entry.body.classList.remove('terminal-body-center');
      entry.body.classList.add('terminal-body-active');
      const mount = document.createElement('div');
      mount.className = 'terminal-mount';
      entry.body.appendChild(mount);
      entry.mount = mount;
      entry.terminalMounted = true;
      break;
    }
    case 'failed':
      entry.body.classList.add('terminal-body-center');
      entry.body.textContent = `Failed to start: ${terminal.error}`;
      break;
    default:
      entry.body.classList.add('terminal-body-center');
      entry.body.textContent = terminal.status;
  }
}
