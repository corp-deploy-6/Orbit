// Per-tile graph view: renders Orbit's own graft repo graph (graft/.graph/wiring.json)
// as a 3D force-directed graph. 3d-force-graph is lazy-imported on first
// activation so it never costs startup time for users who don't open a graph tile.
// Instance-based (mirrors terminal-view.js's createTerminalSession) so multiple
// graph tiles can coexist without clobbering each other's renderer/resizeObserver.
// v1 scope: Orbit's own repo only, manual reload (no file watcher), hover
// tooltip only (no click-to-open-in-file-tree).

const KIND_COLOR_VARS = {
  file: '--accent',
  function: '--accent-secondary',
  method: '--text-secondary',
  external: '--text-muted',
};

// How long a node stays lit after a tool touches its file, and how often the
// colour accessor is re-applied while any pulse is live. Deliberately well
// under 60fps: re-applying nodeColor rebuilds every node's material.
const PULSE_MS = 700;
const PULSE_TICK_MS = 66;
const PULSE_COLOR_VAR = '--accent-strong';

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

function parseHex(color) {
  const hex = color.replace('#', '');
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
  if (full.length !== 6) return null;
  const value = Number.parseInt(full, 16);
  return Number.isNaN(value) ? null : [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

// amount 1 = fully `from`, 0 = fully `to`. Falls back to the lit colour if
// either token isn't plain hex — the pulse then blinks instead of fading.
function mixColors(from, to, amount) {
  const a = parseHex(from);
  const b = parseHex(to);
  if (!a || !b) return from;
  const channel = (i) => Math.round(b[i] + (a[i] - b[i]) * amount);
  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
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

export function createGraphView() {
  let graphInstance = null;
  let resizeObserver = null;
  let containerEl = null;
  let disposed = false;
  let paused = false;
  // Only kind:'file' nodes — every function/method node repeats its parent
  // file's path, so indexing them all would make the lookup ambiguous.
  let nodesByPath = new Map(); // repo-relative POSIX path -> node
  let nodesByLowerPath = new Map(); // same, lowercased (Windows drive/case quirks)
  const pulses = new Map(); // node -> deadline (ms)
  let pulseTimerId = null;

  // Re-derives the base colour every call rather than caching it, so a theme
  // switch mid-pulse doesn't fade back to the old theme's colour.
  function nodeColorFor(node) {
    const base = colorForKind(node.kind);
    const until = pulses.get(node);
    if (!until) return base;
    const remaining = until - Date.now();
    if (remaining <= 0) return base;
    return mixColors(readToken(PULSE_COLOR_VAR, '#ffb347'), base, remaining / PULSE_MS);
  }

  function stopPulseTick() {
    if (pulseTimerId === null) return;
    clearInterval(pulseTimerId);
    pulseTimerId = null;
  }

  function pulseTick() {
    const now = Date.now();
    for (const [node, until] of pulses) {
      if (until <= now) pulses.delete(node);
    }
    graphInstance?.nodeColor(nodeColorFor);
    if (!pulses.size) stopPulseTick();
  }

  function startPulseTick() {
    if (pulseTimerId !== null) return;
    pulseTimerId = setInterval(pulseTick, PULSE_TICK_MS);
  }

  function showMessage(text) {
    if (!containerEl) return;
    containerEl.innerHTML = '';
    const msg = document.createElement('div');
    msg.className = 'graph-panel-message';
    msg.textContent = text;
    containerEl.appendChild(msg);
  }

  function teardownInstance() {
    stopPulseTick();
    pulses.clear();
    nodesByPath = new Map();
    nodesByLowerPath = new Map();
    resizeObserver?.disconnect();
    resizeObserver = null;
    graphInstance?._destructor();
    graphInstance = null;
  }

  async function load() {
    if (disposed || !containerEl) return;
    teardownInstance();
    showMessage('Loading graph...');

    const res = await window.orbit.getGraftGraph();
    if (disposed) return;
    if (!res?.ok) {
      showMessage('Run `graft build` to generate the graph.');
      return;
    }

    containerEl.innerHTML = '';

    const { default: ForceGraph3D } = await import('3d-force-graph');
    if (disposed) return;

    // Indexed off the same objects the graph renders, so a pulse can never
    // point at a node from a previous load().
    const graphData = toGraphData(res);
    for (const node of graphData.nodes) {
      if (node.kind !== 'file' || !node.path) continue;
      nodesByPath.set(node.path, node);
      nodesByLowerPath.set(node.path.toLowerCase(), node);
    }

    // 'orbit' (not the library default 'trackball'): autoRotate below only exists
    // on OrbitControls; TrackballControls silently ignores the flag.
    graphInstance = ForceGraph3D({ controlType: 'orbit' })(containerEl)
      .graphData(graphData)
      .nodeLabel((n) => `${n.kind}: ${n.name}`)
      .nodeColor(nodeColorFor)
      .linkColor(() => linkColorValue())
      .width(containerEl.clientWidth)
      .height(containerEl.clientHeight)
      .onEngineStop(() => {
        const controls = graphInstance?.controls();
        if (!controls) return;
        controls.autoRotate = true;
        controls.autoRotateSpeed = 0.5;
      });

    resizeObserver = new ResizeObserver(() => {
      if (!graphInstance) return;
      graphInstance.width(containerEl.clientWidth).height(containerEl.clientHeight);
    });
    resizeObserver.observe(containerEl);
  }

  return {
    attach(container) {
      if (disposed) return;
      containerEl = container;
      load();
    },

    reload() {
      load();
    },

    pause() {
      paused = true;
      stopPulseTick();
      pulses.clear();
      graphInstance?.pauseAnimation();
    },

    resume() {
      paused = false;
      graphInstance?.resumeAnimation();
    },

    // Lights the file nodes for `paths` (repo-relative POSIX, as emitted by the
    // main process) and fades them back. Paths with no node — docs,
    // node_modules, anything added since the last `graft build` — are the
    // common case and are ignored silently.
    pulse(paths) {
      if (disposed || paused || !graphInstance || !paths?.length) return;
      const deadline = Date.now() + PULSE_MS;
      let matched = false;
      for (const p of paths) {
        const node = nodesByPath.get(p) || nodesByLowerPath.get(p.toLowerCase());
        if (!node) continue;
        pulses.set(node, deadline);
        matched = true;
      }
      if (matched) startPulseTick();
    },

    forceRedraw() {
      if (!graphInstance || !containerEl) return;
      graphInstance.width(containerEl.clientWidth).height(containerEl.clientHeight);
    },

    // Called from the theme-switch handler so the graph recolors live, without
    // a re-layout (only the color accessors are re-applied).
    refreshTheme() {
      if (!graphInstance) return;
      graphInstance.nodeColor(nodeColorFor).linkColor(() => linkColorValue());
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      teardownInstance();
      containerEl = null;
    },
  };
}
