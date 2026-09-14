// Nav skeleton with click routing between views (Terminals/Settings).

const NAV_ITEMS = [
  { id: 'terminals', icon: '🗂', label: 'Terminals' },
  { id: 'settings', icon: '⚙', label: 'Settings' },
];

export function renderNavBar(container, { onNavigate, active = 'terminals' } = {}) {
  container.innerHTML = '';

  for (const item of NAV_ITEMS) {
    const el = document.createElement('div');
    el.className = 'nav-item';
    el.classList.toggle('active', item.id === active);
    el.innerHTML = `<span class="nav-icon">${item.icon}</span><span>${item.label}</span>`;
    el.addEventListener('click', () => onNavigate?.(item.id));
    container.appendChild(el);
  }
}
