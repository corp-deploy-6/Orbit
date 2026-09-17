// Shared hover/hit-zone/circled-plus affordance for adding a terminal from a
// tile's edge. Mode-agnostic: it only reports which side was activated via
// onAddSide(side) — grid vs. split insertion semantics live in the caller.
//
// Four thin absolutely-positioned strips sit inside a pointer-events:none
// wrapper, so only the strips (and the shared plus button) capture pointer
// input — the tile's header/body, including xterm's own mouse handling in
// .terminal-mount, are never intercepted. Top/bottom strips run full width;
// left/right strips are inset top/bottom by the strip thickness, so every
// point on the tile border belongs to exactly one zone by construction —
// corners never need runtime disambiguation.

const SIDES = ['top', 'right', 'bottom', 'left'];
const HIDE_DELAY_MS = 60;

export function attachEdgeAffordance(tileEl, onAddSide) {
  const wrapper = document.createElement('div');
  wrapper.className = 'edge-affordance';

  const zones = {};
  for (const side of SIDES) {
    const zone = document.createElement('div');
    zone.className = `edge-zone edge-zone-${side}`;
    wrapper.appendChild(zone);
    zones[side] = zone;
  }

  const plusBtn = document.createElement('button');
  plusBtn.type = 'button';
  plusBtn.className = 'edge-plus-btn';
  plusBtn.textContent = '+';
  plusBtn.title = 'Add terminal';
  wrapper.appendChild(plusBtn);

  let activeSide = null;
  let hideTimer = null;

  function cancelHide() {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  }

  // Composite hover: leaving a zone doesn't hide the button immediately,
  // since the pointer is usually headed straight at it. Only hide once the
  // pointer has left both the zone and the button.
  function scheduleHide() {
    cancelHide();
    hideTimer = setTimeout(() => {
      hideTimer = null;
      activeSide = null;
      plusBtn.classList.remove('visible');
      for (const side of SIDES) zones[side].classList.remove('hovered');
    }, HIDE_DELAY_MS);
  }

  function showSide(side) {
    cancelHide();
    if (activeSide === side) return;
    activeSide = side;
    for (const s of SIDES) zones[s].classList.toggle('hovered', s === side);
    plusBtn.className = `edge-plus-btn edge-plus-${side} visible`;
  }

  for (const side of SIDES) {
    zones[side].addEventListener('pointerenter', () => showSide(side));
    zones[side].addEventListener('pointerleave', scheduleHide);
  }
  plusBtn.addEventListener('pointerenter', cancelHide);
  plusBtn.addEventListener('pointerleave', scheduleHide);

  plusBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (activeSide && !plusBtn.disabled) onAddSide?.(activeSide);
  });

  tileEl.appendChild(wrapper);

  return {
    setDisabled(disabled, title) {
      plusBtn.disabled = disabled;
      plusBtn.title = title || (disabled ? 'Maximum terminals reached' : 'Add terminal');
    },
    destroy() {
      wrapper.remove();
    },
  };
}
