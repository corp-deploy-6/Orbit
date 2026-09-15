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

export function createGraphView() {
  let graphInstance = null;
  let resizeObserver = null;
  let containerEl = null;
  let disposed = false;

  function showMessage(text) {
    if (!containerEl) return;
    containerEl.innerHTML = '';
    const msg = document.createElement('div');
    msg.className = 'graph-panel-message';
    msg.textContent = text;
    containerEl.appendChild(msg);
  }

  function teardownInstance() {
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

    // 'orbit' (not the library default 'trackball'): autoRotate below only exists
    // on OrbitControls; TrackballControls silently ignores the flag.
    graphInstance = ForceGraph3D({ controlType: 'orbit' })(containerEl)
      .graphData(toGraphData(res))
      .nodeLabel((n) => `${n.kind}: ${n.name}`)
      .nodeColor((n) => colorForKind(n.kind))
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
      graphInstance?.pauseAnimation();
    },

    resume() {
      graphInstance?.resumeAnimation();
    },

    forceRedraw() {
      if (!graphInstance || !containerEl) return;
      graphInstance.width(containerEl.clientWidth).height(containerEl.clientHeight);
    },

    // Called from the theme-switch handler so the graph recolors live, without
    // a re-layout (only the color accessors are re-applied).
    refreshTheme() {
      if (!graphInstance) return;
      graphInstance.nodeColor((n) => colorForKind(n.kind)).linkColor(() => linkColorValue());
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      teardownInstance();
      containerEl = null;
    },
  };
}
