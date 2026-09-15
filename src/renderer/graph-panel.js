// Graph view: renders Orbit's own graft repo graph (graft/.graph/wiring.json)
// as a 3D force-directed graph. 3d-force-graph is lazy-imported on first
// activation so it never costs startup time for users who don't open the tab.
// v1 scope: Orbit's own repo only, manual reload (no file watcher), hover
// tooltip only (no click-to-open-in-file-tree).

const KIND_COLOR_VARS = {
  file: '--accent',
  function: '--accent-secondary',
  method: '--text-secondary',
  external: '--text-muted',
};

function readToken(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function colorForKind(kind) {
  const varName = KIND_COLOR_VARS[kind] || KIND_COLOR_VARS.method;
  return readToken(varName, '#888888');
}

function linkColorValue() {
  return readToken('--border-strong', '#555555');
}

// Transforms wiring.json's {nodes, edges} into 3d-force-graph's {nodes, links}
// shape. Edge targets with no matching node (e.g. bare package imports like
// "electron") are synthesized as kind:'external' nodes so every link resolves.
function toGraphData({ nodes, edges }) {
  const known = new Map(nodes.map((n) => [n.id, { id: n.id, name: n.name, kind: n.kind, path: n.path }]));
  const links = [];
  for (const e of edges || []) {
    if (!known.has(e.target)) {
      known.set(e.target, { id: e.target, name: e.target, kind: 'external' });
    }
    links.push({ source: e.source, target: e.target, relation: e.relation });
  }
  return { nodes: [...known.values()], links };
}

let graphInstance = null;
let resizeObserver = null;

function showMessage(graphAreaEl, text) {
  graphAreaEl.innerHTML = '';
  const msg = document.createElement('div');
  msg.className = 'graph-panel-message';
  msg.textContent = text;
  graphAreaEl.appendChild(msg);
}

function disposeGraph() {
  resizeObserver?.disconnect();
  resizeObserver = null;
  graphInstance?._destructor();
  graphInstance = null;
}

async function loadGraph(graphAreaEl) {
  disposeGraph();
  showMessage(graphAreaEl, 'Loading graph...');

  const res = await window.orbit.getGraftGraph();
  if (!res?.ok) {
    showMessage(graphAreaEl, 'Run `graft build` to generate the graph.');
    return;
  }

  graphAreaEl.innerHTML = '';

  const { default: ForceGraph3D } = await import('3d-force-graph');

  // 'orbit' (not the library default 'trackball'): autoRotate below only exists
  // on OrbitControls; TrackballControls silently ignores the flag.
  graphInstance = ForceGraph3D({ controlType: 'orbit' })(graphAreaEl)
    .graphData(toGraphData(res))
    .nodeLabel((n) => `${n.kind}: ${n.name}`)
    .nodeColor((n) => colorForKind(n.kind))
    .linkColor(() => linkColorValue())
    .width(graphAreaEl.clientWidth)
    .height(graphAreaEl.clientHeight)
    .onEngineStop(() => {
      const controls = graphInstance?.controls();
      if (!controls) return;
      controls.autoRotate = true;
      controls.autoRotateSpeed = 0.5;
    });

  resizeObserver = new ResizeObserver(() => {
    if (!graphInstance) return;
    graphInstance.width(graphAreaEl.clientWidth).height(graphAreaEl.clientHeight);
  });
  resizeObserver.observe(graphAreaEl);
}

export function pauseGraph() {
  graphInstance?.pauseAnimation();
}

export function resumeGraph() {
  graphInstance?.resumeAnimation();
}

export function renderGraphPanel(container) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'graph-panel-inner';

  const graphAreaEl = document.createElement('div');
  graphAreaEl.className = 'graph-area';

  const toolbar = document.createElement('div');
  toolbar.className = 'graph-toolbar';

  const reloadBtn = document.createElement('button');
  reloadBtn.className = 'add-terminal-btn';
  reloadBtn.textContent = 'Reload graph';
  reloadBtn.addEventListener('click', () => loadGraph(graphAreaEl));

  toolbar.appendChild(reloadBtn);
  wrapper.appendChild(toolbar);
  wrapper.appendChild(graphAreaEl);
  container.appendChild(wrapper);

  loadGraph(graphAreaEl);
}

// Called from the theme-switch handler so the graph recolors live, without a
// re-layout (only the color accessors are re-applied).
export function refreshGraphTheme() {
  if (!graphInstance) return;
  graphInstance.nodeColor((n) => colorForKind(n.kind)).linkColor(() => linkColorValue());
}
