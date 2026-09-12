// Static nav skeleton. Visual scaffold only — no click handlers, no routing.
// Tile/panel behavior comes in Epic 2.

const NAV_ITEMS = [
  { icon: '🗂', label: 'Tiles' },
  { icon: '⚙', label: 'Settings' },
];

export function renderNavBar(container) {
  container.innerHTML = '';

  for (const item of NAV_ITEMS) {
    const el = document.createElement('div');
    el.className = 'nav-item';
    el.innerHTML = `<span class="nav-icon">${item.icon}</span><span>${item.label}</span>`;
    container.appendChild(el);
  }
}
