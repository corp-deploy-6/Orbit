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

  const closeBtn = document.createElement('button');
  closeBtn.className = 'terminal-close';
  closeBtn.textContent = '×';
  closeBtn.title = 'Close terminal';
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    onClose?.(terminal.id);
  });

  header.appendChild(label);
  header.appendChild(closeBtn);

  const body = document.createElement('div');
  body.className = 'terminal-body';

  el.appendChild(header);
  el.appendChild(body);

  const entry = { el, body, label, terminalMounted: false };
  renderBody(entry, terminal);
  return entry;
}

export function updateTerminalHeader(entry, terminal) {
  entry.el.classList.toggle('active', !!terminal.active);
  if (document.activeElement !== entry.label) {
    entry.label.textContent = terminal.label;
  }
}

// Only pre-terminal states (picking/starting) rebuild the body. Once a
// terminal has been mounted (status flipped to 'running'), this is a no-op
// forever for that terminal — terminal-view.js owns the body's contents from
// then on, including freezing it in place on 'ended'.
export function renderBody(entry, terminal) {
  if (entry.terminalMounted) return;

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
    case 'running':
      entry.body.classList.remove('terminal-body-center');
      entry.body.classList.add('terminal-body-active');
      entry.terminalMounted = true;
      break;
    default:
      entry.body.classList.add('terminal-body-center');
      entry.body.textContent = terminal.status;
  }
}
