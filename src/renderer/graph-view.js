// Full-window graph backdrop: renders Orbit's own graft repo graph
// (graft/.graph/wiring.json) as a 3D force-directed graph. 3d-force-graph is
// lazy-imported on first attach() so it never costs startup time before the
// first frame. renderer.js owns exactly one instance for the app's lifetime,
// mounted once into #graph-backdrop and never recreated.
// v1 scope: Orbit's own repo only, manual reload (no file watcher), hover
// tooltip only (no click-to-open).

const KIND_COLOR_VARS = {
  file: '--accent',
  function: '--accent-secondary',
  method: '--text-secondary',
  external: '--text-muted',
};

// How long a node/link stays lit after a step touches it, and how often the
// colour accessor is re-applied while any pulse is live. Deliberately well
// under 60fps: re-applying nodeColor rebuilds every node's material. Raised
// from the original 700ms — a colour-only fade on small spheres in a
// translucent full-window backdrop is easy to miss (#100).
const PULSE_MS = 1200;
const PULSE_TICK_MS = 66;
const PULSE_COLOR_VAR = '--accent-strong';
const LIT_LINK_WIDTH = 1.8;

// How far apart queued steps play, and how many can be queued at once (older
// ones dropped) so a burst of activity doesn't play back for minutes.
const STEP_INTERVAL_MS = 250;
const MAX_QUEUED_STEPS = 40;

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
  // cooldownTime is wall-clock, so a pause spanning it makes the engine stop
  // on the first resumed tick with the layout unsettled; resume() reheats then.
  let settled = false;
  // Bumped on every load() call; a stale call (superseded by a later reload()
  // or attach() before its awaits resolved) checks this and bails instead of
  // mutating graphInstance/containerEl out from under the newer call (#48).
  let loadSeq = 0;
  // Only kind:'file' nodes — every function/method node repeats its parent
  // file's path, so indexing them all would make the lookup ambiguous.
  let nodesByPath = new Map(); // repo-relative POSIX path -> node
  let nodesByLowerPath = new Map(); // same, lowercased (Windows drive/case quirks)
  // Real file->file links only (wiring.json has very few — most consecutive
  // touches have no direct edge, and that's left as node-only pulses rather
  // than inventing one). Keyed both directions so lookup doesn't care which
  // file came first.
  let linksByPair = new Map(); // "aId|bId" -> link object
  const pulses = new Map(); // node -> deadline (ms)
  const linkPulses = new Map(); // link -> deadline (ms)
  let pulseTimerId = null;

  // Per-session last touched node, so a `touch` step can light the real edge
  // to the previous one. Query steps (graft/Grep/Glob results) never set or
  // read this — result order is relevance rank, not a walked path.
  const lastNodeBySession = new Map();
  let stepQueue = []; // { sessionId, kind, files }
  let stepTimerId = null;

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

  // Same fade as nodeColorFor. 0 width (the library's "thin line" default)
  // when unlit, so only lit links pay for the thicker tube geometry.
  function linkColorFor(link) {
    const base = linkColorValue();
    const until = linkPulses.get(link);
    if (!until) return base;
    const remaining = until - Date.now();
    if (remaining <= 0) return base;
    return mixColors(readToken(PULSE_COLOR_VAR, '#ffb347'), base, remaining / PULSE_MS);
  }

  function linkWidthFor(link) {
    return linkPulses.has(link) ? LIT_LINK_WIDTH : 0;
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
    // linkColor/linkWidth re-apply rebuilds every link's material — 336 edges
    // vs the small handful actually lit — so it's skipped on ticks where no
    // link pulse was live, and run once more on the tick a link's pulse
    // expires so it fades back to its base colour/width.
    const hadLinks = linkPulses.size > 0;
    for (const [link, until] of linkPulses) {
      if (until <= now) linkPulses.delete(link);
    }
    graphInstance?.nodeColor(nodeColorFor);
    if (hadLinks) graphInstance?.linkColor(linkColorFor).linkWidth(linkWidthFor);
    if (!pulses.size && !linkPulses.size) stopPulseTick();
  }

  function startPulseTick() {
    if (pulseTimerId !== null) return;
    pulseTimerId = setInterval(pulseTick, PULSE_TICK_MS);
  }

  function resolveNode(file) {
    return nodesByPath.get(file) || nodesByLowerPath.get(file.toLowerCase());
  }

  function playStep({ sessionId, kind, files }) {
    if (disposed || paused || !graphInstance) return;
    const deadline = Date.now() + PULSE_MS;

    if (kind === 'touch') {
      const node = files[0] && resolveNode(files[0]);
      if (!node) return; // no node lookup succeeded — lastNode stays as-is
      pulses.set(node, deadline);
      const lastNode = lastNodeBySession.get(sessionId);
      if (lastNode && lastNode !== node) {
        const link = linksByPair.get(`${lastNode.id}|${node.id}`);
        if (link) linkPulses.set(link, deadline);
      }
      lastNodeBySession.set(sessionId, node);
      startPulseTick();
      return;
    }

    // 'query': light every matched node and the real edges among them, with
    // no chaining and no effect on lastNode (see trace()'s doc comment).
    const matched = files.map(resolveNode).filter(Boolean);
    if (!matched.length) return;
    for (const node of matched) pulses.set(node, deadline);
    for (let i = 0; i < matched.length; i++) {
      for (let j = i + 1; j < matched.length; j++) {
        const link = linksByPair.get(`${matched[i].id}|${matched[j].id}`);
        if (link) linkPulses.set(link, deadline);
      }
    }
    startPulseTick();
  }

  function pumpStepQueue() {
    const step = stepQueue.shift();
    if (step) playStep(step);
    if (!stepQueue.length) stopStepTimer();
  }

  function startStepTimer() {
    if (stepTimerId !== null) return;
    stepTimerId = setInterval(pumpStepQueue, STEP_INTERVAL_MS);
  }

  function showMessage(text) {
    if (!containerEl) return;
    containerEl.innerHTML = '';
    const msg = document.createElement('div');
    msg.className = 'graph-panel-message';
    msg.textContent = text;
    containerEl.appendChild(msg);
  }

  function stopStepTimer() {
    if (stepTimerId === null) return;
    clearInterval(stepTimerId);
    stepTimerId = null;
  }

  function teardownInstance() {
    stopPulseTick();
    stopStepTimer();
    pulses.clear();
    linkPulses.clear();
    stepQueue = [];
    lastNodeBySession.clear();
    nodesByPath = new Map();
    nodesByLowerPath = new Map();
    linksByPair = new Map();
    resizeObserver?.disconnect();
    resizeObserver = null;
    graphInstance?._destructor();
    graphInstance = null;
  }

  async function load() {
    if (disposed || !containerEl) return;
    const seq = ++loadSeq;
    teardownInstance();
    settled = false;
    showMessage('Loading graph...');

    const res = await window.orbit.getGraftGraph();
    if (disposed || seq !== loadSeq) return;
    if (!res?.ok) {
      showMessage('Run `graft build` to generate the graph.');
      return;
    }

    containerEl.innerHTML = '';

    const { default: ForceGraph3D } = await import('3d-force-graph');
    if (disposed || seq !== loadSeq) return;

    // Indexed off the same objects the graph renders, so a pulse can never
    // point at a node from a previous load().
    const graphData = toGraphData(res);
    for (const node of graphData.nodes) {
      if (node.kind !== 'file' || !node.path) continue;
      nodesByPath.set(node.path, node);
      nodesByLowerPath.set(node.path.toLowerCase(), node);
    }

    // File node ids are their repo-relative path (see toGraphData), so this
    // reads straight off graphData.links before 3d-force-graph mutates
    // source/target from id strings into node object references — the Map
    // keeps pointing at the same (later-mutated) link object either way.
    for (const link of graphData.links) {
      if (!nodesByPath.has(link.source) || !nodesByPath.has(link.target)) continue;
      linksByPair.set(`${link.source}|${link.target}`, link);
      linksByPair.set(`${link.target}|${link.source}`, link);
    }

    // 'orbit' (not the library default 'trackball'): autoRotate below only exists
    // on OrbitControls; TrackballControls silently ignores the flag.
    graphInstance = ForceGraph3D({ controlType: 'orbit' })(containerEl)
      .graphData(graphData)
      .nodeLabel((n) => `${n.kind}: ${n.name}`)
      .nodeColor(nodeColorFor)
      .linkColor(linkColorFor)
      .linkWidth(linkWidthFor)
      .width(containerEl.clientWidth)
      .height(containerEl.clientHeight)
      .cooldownTime(4000)
      .onEngineStop(() => {
        settled = true;
        const controls = graphInstance?.controls();
        if (!controls) return;
        controls.autoRotate = true;
        controls.autoRotateSpeed = 0.5;
      });
    // pause() may have landed while this load was awaiting; it only reaches the
    // instance that existed at the time.
    if (paused) graphInstance.pauseAnimation();

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
      stopStepTimer();
      pulses.clear();
      linkPulses.clear();
      stepQueue = [];
      graphInstance?.pauseAnimation();
    },

    resume() {
      paused = false;
      if (graphInstance && !settled) {
        graphInstance.controls().autoRotate = false;
        graphInstance.d3ReheatSimulation();
      }
      graphInstance?.resumeAnimation();
    },

    // Queues `steps` (as emitted by the main process, in transcript order)
    // to play out ~STEP_INTERVAL_MS apart so a path visibly travels rather
    // than flashing all at once. A `touch` step lights its file node and,
    // if the session's previous touch has a real edge to it in wiring.json,
    // that edge too — files with no direct edge (most consecutive touches;
    // wiring.json has very few file->file edges) just get the node pulse,
    // never an invented link. A `query` step (a graft/Grep/Glob result)
    // lights every matched node plus the real edges among them, but never
    // chains them in sequence or touches `lastNode` — result order is
    // relevance rank, not a walked path.
    trace(sessionId, steps) {
      if (disposed || paused || !graphInstance || !steps?.length) return;
      for (const step of steps) {
        stepQueue.push({ sessionId, kind: step.kind, files: step.files });
      }
      while (stepQueue.length > MAX_QUEUED_STEPS) stepQueue.shift();
      startStepTimer();
    },

    forceRedraw() {
      if (!graphInstance || !containerEl) return;
      graphInstance.width(containerEl.clientWidth).height(containerEl.clientHeight);
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      teardownInstance();
      containerEl = null;
    },
  };
}
