// Nav skeleton with click routing between views (Console/Settings).

const NAV_ITEMS = [
  { id: 'console', icon: '🖥', label: 'Console' },
  { id: 'settings', icon: '⚙', label: 'Settings' },
];

export function renderNavBar(container, { onNavigate, active = 'console' } = {}) {
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
