// Canvas rendering for the knowledge graph: d3-force physics + a plain
// <canvas> draw loop, pan/zoom, and click hit-testing. Mirrors terminal.js in
// shape (a focused render module owned/mounted by graph-panel.js), not a
// full app framework.

import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide } from 'd3-force';

const NODE_RADIUS = 5;
const HIT_RADIUS = 8;
// Deterministic palette, cycled by community index — no theme-token equivalent
// exists for "N distinct categorical colors", so this is the one hardcoded
// palette in the panel; everything else (bg/text/link colors) reads CSS vars.
const COMMUNITY_COLORS = [
  '#d9a24b', '#5c8a5c', '#a24bd9', '#4ba2d9', '#d94b6a',
  '#d9c14b', '#4bd9a2', '#8a6ad9', '#d97a4b', '#6ad94b',
];

function cssVar(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function communityColor(community) {
  const idx = ((community % COMMUNITY_COLORS.length) + COMMUNITY_COLORS.length) % COMMUNITY_COLORS.length;
  return COMMUNITY_COLORS[idx];
}

export function createGraphView(canvasEl, { onNodeClick } = {}) {
  const ctx = canvasEl.getContext('2d');

  let nodes = [];
  let links = [];
  let communityFilter = null; // null = show all; Set of community ids otherwise
  let simulation = null;
  let width = 0;
  let height = 0;
  let dpr = window.devicePixelRatio || 1;

  let transform = { x: 0, y: 0, k: 1 };
  let dragNode = null;
  let panState = null;
  let pointerMoved = false;

  function visibleNodes() {
    if (!communityFilter) return nodes;
    return nodes.filter((n) => communityFilter.has(n.community));
  }

  function toWorld(clientX, clientY) {
    const rect = canvasEl.getBoundingClientRect();
    const x = (clientX - rect.left - transform.x) / transform.k;
    const y = (clientY - rect.top - transform.y) / transform.k;
    return { x, y };
  }

  function resize() {
    const rect = canvasEl.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    dpr = window.devicePixelRatio || 1;
    canvasEl.width = Math.max(1, Math.round(width * dpr));
    canvasEl.height = Math.max(1, Math.round(height * dpr));
    draw();
  }

  function nodeAt(worldX, worldY) {
    const visible = visibleNodes();
    // Iterate reverse so nodes drawn last (on top) hit-test first.
    for (let i = visible.length - 1; i >= 0; i--) {
      const n = visible[i];
      if (n.x == null || n.y == null) continue;
      const dx = n.x - worldX;
      const dy = n.y - worldY;
      const r = (HIT_RADIUS / transform.k);
      if (dx * dx + dy * dy <= r * r) return n;
    }
    return null;
  }

  function draw() {
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const bg = cssVar('--bg-sunken', '#0f0d0a');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.k, transform.k);

    const visibleSet = communityFilter ? new Set(visibleNodes().map((n) => n.id)) : null;
    const linkColor = cssVar('--border-strong', '#4a4130');
    ctx.strokeStyle = linkColor;
    ctx.lineWidth = 1 / transform.k;
    ctx.globalAlpha = 0.6;
    for (const link of links) {
      const s = link.source;
      const t = link.target;
      if (!s || !t || s.x == null || t.x == null) continue;
      if (visibleSet && (!visibleSet.has(s.id) || !visibleSet.has(t.id))) continue;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(t.x, t.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    const textColor = cssVar('--text-primary', '#f0e6d2');
    ctx.font = `${11 / transform.k}px sans-serif`;
    for (const n of visibleNodes()) {
      if (n.x == null || n.y == null) continue;
      ctx.beginPath();
      ctx.arc(n.x, n.y, NODE_RADIUS / transform.k, 0, Math.PI * 2);
      ctx.fillStyle = communityColor(n.community);
      ctx.fill();

      if (transform.k > 1.2) {
        ctx.fillStyle = textColor;
        ctx.fillText(n.label || n.id, n.x + NODE_RADIUS / transform.k + 2, n.y + 3 / transform.k);
      }
    }

    ctx.restore();
  }

  function tick() {
    draw();
  }

  function startSimulation() {
    if (simulation) simulation.stop();
    simulation = forceSimulation(nodes)
      .force('link', forceLink(links).id((d) => d.id).distance(40).strength(0.3))
      .force('charge', forceManyBody().strength(-80))
      .force('center', forceCenter(width / 2, height / 2))
      .force('collide', forceCollide(NODE_RADIUS + 2))
      .on('tick', tick);
  }

  function onPointerDown(e) {
    pointerMoved = false;
    const world = toWorld(e.clientX, e.clientY);
    const hit = nodeAt(world.x, world.y);
    if (hit) {
      dragNode = hit;
      dragNode.fx = dragNode.x;
      dragNode.fy = dragNode.y;
      simulation?.alphaTarget(0.3).restart();
    } else {
      panState = { startX: e.clientX, startY: e.clientY, origX: transform.x, origY: transform.y };
    }
    canvasEl.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e) {
    if (dragNode) {
      pointerMoved = true;
      const world = toWorld(e.clientX, e.clientY);
      dragNode.fx = world.x;
      dragNode.fy = world.y;
    } else if (panState) {
      pointerMoved = true;
      transform.x = panState.origX + (e.clientX - panState.startX);
      transform.y = panState.origY + (e.clientY - panState.startY);
      draw();
    }
  }

  function onPointerUp(e) {
    if (dragNode) {
      dragNode.fx = null;
      dragNode.fy = null;
      simulation?.alphaTarget(0);
      if (!pointerMoved) onNodeClick?.(dragNode);
      dragNode = null;
    } else if (panState) {
      panState = null;
    }
    canvasEl.releasePointerCapture(e.pointerId);
  }

  function onWheel(e) {
    e.preventDefault();
    const rect = canvasEl.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const factor = Math.exp(-e.deltaY * 0.001);
    const newK = Math.min(4, Math.max(0.2, transform.k * factor));

    // Zoom toward the pointer.
    transform.x = mouseX - ((mouseX - transform.x) / transform.k) * newK;
    transform.y = mouseY - ((mouseY - transform.y) / transform.k) * newK;
    transform.k = newK;
    draw();
  }

  canvasEl.addEventListener('pointerdown', onPointerDown);
  canvasEl.addEventListener('pointermove', onPointerMove);
  canvasEl.addEventListener('pointerup', onPointerUp);
  canvasEl.addEventListener('wheel', onWheel, { passive: false });

  const resizeObserver = new ResizeObserver(() => resize());
  resizeObserver.observe(canvasEl);
  resize();

  return {
    setData(newNodes, newLinks) {
      nodes = newNodes;
      links = newLinks;
      transform = { x: 0, y: 0, k: 1 };
      startSimulation();
      draw();
    },
    setCommunityFilter(set) {
      communityFilter = set;
      draw();
    },
    destroy() {
      simulation?.stop();
      simulation = null;
      resizeObserver.disconnect();
      canvasEl.removeEventListener('pointerdown', onPointerDown);
      canvasEl.removeEventListener('pointermove', onPointerMove);
      canvasEl.removeEventListener('pointerup', onPointerUp);
      canvasEl.removeEventListener('wheel', onWheel);
    },
  };
}
