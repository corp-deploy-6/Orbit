// Norton Commander top menu bar and bottom F-key bar. Only rendered visibly
// under the dos-nc theme (dos-theme.css); F-key shortcuts are inert otherwise.

const MENU_ITEMS = [
  { id: 'console', label: 'Console' },
  { id: 'settings', label: 'Settings' },
];

const FKEYS = [
  { n: 1, label: 'Console', view: 'console' },
  { n: 2, label: 'Settings', view: 'settings' },
  { n: 3, label: '' },
  { n: 4, label: '' },
  { n: 5, label: 'NewTerm', action: 'newTerminal' },
  { n: 6, label: '' },
  { n: 7, label: '' },
  { n: 8, label: 'Close', action: 'closeTile' },
  { n: 9, label: '' },
  { n: 10, label: '' },
];

export function renderDosChrome(menuBarEl, fKeyBarEl, { active, onNavigate, onAction }) {
  menuBarEl.innerHTML = '';
  for (const item of MENU_ITEMS) {
    const el = document.createElement('span');
    el.className = 'dos-menu-item';
    el.classList.toggle('active', item.id === active);
    el.textContent = item.label;
    el.addEventListener('click', () => onNavigate(item.id));
    menuBarEl.appendChild(el);
  }
  const title = document.createElement('span');
  title.className = 'dos-menu-title';
  title.textContent = 'Orbit';
  menuBarEl.appendChild(title);

  fKeyBarEl.innerHTML = '';
  for (const key of FKEYS) {
    const live = Boolean(key.view || key.action);
    const el = document.createElement('span');
    el.className = 'dos-fkey';
    el.classList.toggle('inert', !live);
    el.innerHTML = `<span class="dos-fkey-num">${key.n}</span><span class="dos-fkey-label">${key.label}</span>`;
    if (live) el.addEventListener('click', () => runFKey(key, { onNavigate, onAction }));
    fKeyBarEl.appendChild(el);
  }
}

function runFKey(key, { onNavigate, onAction }) {
  if (key.view) onNavigate(key.view);
  else onAction(key.action);
}

// F-keys belong to terminal apps, so they're only claimed when focus is
// outside a terminal.
export function handleDosFKey(e, { onNavigate, onAction }) {
  if (document.documentElement.dataset.theme !== 'dos-nc') return;
  const m = /^F(\d{1,2})$/.exec(e.key);
  if (!m || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  if (e.target instanceof Element && e.target.closest('.xterm')) return;
  const key = FKEYS.find((k) => k.n === Number(m[1]));
  if (!key || !(key.view || key.action)) return;
  e.preventDefault();
  runFKey(key, { onNavigate, onAction });
}
