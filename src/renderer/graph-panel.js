// Knowledge-graph panel: DOM shell (header, community filter sidebar,
// empty/error states) around graph-view.js's canvas renderer. Mirrors the
// active terminal's cwd like file-tree-panel.js, but loads lazily -- only
// once the Graph view is actually shown -- since graph.json can be large and
// most cwd switches never visit this view.

import { createGraphView, communityColor } from './graph-view.js';

let containerEl = null;
let bodyEl = null;
let canvasEl = null;
let sidebarEl = null;
let currentCwd = null;
let view = null;
let communities = []; // [{ id, name, color }]
let activeCommunities = null; // null = all shown
// Bumped on every cwd switch so a slow readGraphData response from a stale
// cwd can tell it's stale even if the panel switched away and back.
let epoch = 0;
let isVisible = false;
let loadedForCwd = null; // cwd we've already successfully loaded, avoids refetch

function clearBody() {
  bodyEl.innerHTML = '';
  canvasEl = null;
  sidebarEl = null;
  if (view) {
    view.destroy();
    view = null;
  }
}

function renderMessage(text, variant) {
  clearBody();
  const msg = document.createElement('div');
  msg.className = 'graph-empty-state';
  if (variant === 'error') msg.classList.add('graph-empty-state-error');

  if (variant === 'loading') {
    msg.classList.add('graph-empty-state-loading');
    const spinner = document.createElement('span');
    spinner.className = 'spinner';
    const label = document.createElement('span');
    label.textContent = text;
    msg.appendChild(spinner);
    msg.appendChild(label);
  } else {
    msg.textContent = text;
  }
  bodyEl.appendChild(msg);
}

function renderGraph(nodes, links, warning) {
  clearBody();

  sidebarEl = document.createElement('div');
  sidebarEl.className = 'graph-sidebar';

  const canvasWrap = document.createElement('div');
  canvasWrap.className = 'graph-canvas-wrap';
  canvasEl = document.createElement('canvas');
  canvasEl.className = 'graph-canvas';
  canvasWrap.appendChild(canvasEl);

  if (warning) {
    const banner = document.createElement('div');
    banner.className = 'graph-perf-warning';
    banner.textContent = warning;
    canvasWrap.appendChild(banner);
  }

  bodyEl.appendChild(sidebarEl);
  bodyEl.appendChild(canvasWrap);

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Map(); // community id -> name
  for (const n of nodes) {
    if (!seen.has(n.community)) seen.set(n.community, n.community_name || String(n.community));
  }
  communities = [...seen.entries()].map(([id, name]) => ({ id, name }));
  activeCommunities = new Set(communities.map((c) => c.id));

  renderSidebar();

  // d3-force mutates link.source/target in place from string ids to node
  // objects; drop links pointing at nodes that don't exist so it doesn't throw.
  const validLinks = links.filter((l) => byId.has(l.source) && byId.has(l.target));

  view = createGraphView(canvasEl, {
    onNodeClick: async (node) => {
      if (!currentCwd || !node.source_file) return;
      const result = await window.orbit.openSourceFile(currentCwd, node.source_file);
      if (!result?.ok) {
        console.error('Failed to open source file', node.source_file, result?.error);
      }
    },
  });
  view.setData(nodes, validLinks);
  view.setCommunityFilter(activeCommunities);
}

function renderSidebar() {
  sidebarEl.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'graph-sidebar-header';
  header.textContent = 'Communities';
  sidebarEl.appendChild(header);

  const list = document.createElement('div');
  list.className = 'graph-community-list';
  for (const community of communities) {
    const row = document.createElement('label');
    row.className = 'graph-community-row';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = activeCommunities.has(community.id);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) activeCommunities.add(community.id);
      else activeCommunities.delete(community.id);
      row.classList.toggle('graph-community-row-off', !checkbox.checked);
      view?.setCommunityFilter(activeCommunities);
    });

    const swatch = document.createElement('span');
    swatch.className = 'graph-community-swatch';
    swatch.style.background = communityColor(community.id);

    const label = document.createElement('span');
    label.className = 'graph-community-label';
    label.textContent = community.name;

    row.appendChild(checkbox);
    row.appendChild(swatch);
    row.appendChild(label);
    list.appendChild(row);
  }
  sidebarEl.appendChild(list);
}

async function load(cwd) {
  const myEpoch = epoch;
  const result = await window.orbit.readGraphData(cwd);
  if (myEpoch !== epoch) return; // cwd switched again before this resolved

  if (!result?.ok) {
    if (result?.reason === 'not-found') {
      renderMessage('No graph built yet — run `graphify update .` or `/graphify .` to build one.');
    } else {
      renderMessage(`Could not read the knowledge graph: ${result?.error || 'unknown error'}`, 'error');
    }
    loadedForCwd = null;
    return;
  }

  loadedForCwd = cwd;
  const warning = result.nodes.length > 1500
    ? `Graph is large (${result.nodes.length} nodes) — layout may be slow.`
    : null;
  renderGraph(result.nodes, result.links, warning);
}

function ensureLoaded() {
  if (!isVisible) return;
  if (!currentCwd) {
    renderMessage('No folder selected');
    return;
  }
  if (loadedForCwd === currentCwd) return;
  renderMessage('Loading graph…', 'loading');
  load(currentCwd);
}

export function setActiveGraphCwd(cwd) {
  epoch++;
  currentCwd = cwd;
  loadedForCwd = null;
  if (!cwd) {
    renderMessage('No folder selected');
    return;
  }
  ensureLoaded();
}

export function showGraphPanel() {
  isVisible = true;
  ensureLoaded();
}

export function hideGraphPanel() {
  isVisible = false;
}

export function renderGraphPanel(container) {
  containerEl = container;
  containerEl.innerHTML = '';
  containerEl.className = 'graph-panel';

  const header = document.createElement('div');
  header.className = 'graph-panel-header';
  header.textContent = 'Knowledge Graph';

  bodyEl = document.createElement('div');
  bodyEl.className = 'graph-panel-body';

  containerEl.appendChild(header);
  containerEl.appendChild(bodyEl);

  renderMessage('No folder selected');
}
