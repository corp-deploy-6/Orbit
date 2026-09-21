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
// PULSE_MS also has to outlast a particle's flight (1/PARTICLE_SPEED frames,
// ~1.4s at 60fps) or an edge goes dark with its dot still travelling it.
const PULSE_MS = 1600;
const PULSE_TICK_MS = 66;
// Its own token, not --accent-strong: in the DOS theme --accent-strong and
// --accent are both #FFFF55, so a lit file node faded to exactly its own
// colour and the whole pulse was invisible.
const PULSE_COLOR_VAR = '--graph-pulse';
const LIT_LINK_WIDTH = 3.5;
// linkOpacity (0.35, below) is a global accessor — bumping it would also
// brighten every unlit edge. A lit edge instead gets its opacity set directly
// on its own material object (see setLinkLit), same trick as the emissive set.
const LIT_LINK_OPACITY = 0.95;
// See pulseTick: how many extra ticks to keep forcing linkColor/linkWidth
// reapplication after a link pulse expires, since the library doesn't
// reliably revert the link's mesh on the expiry tick itself.
const LINK_CLEANUP_GRACE_TICKS = 5;

// A travelling dot is emitted along every lit edge — the signal actually moves
// from parent to child, which reads at a glance where a colour fade on a small
// sphere does not. Speed is fraction-of-link-length per frame.
const PARTICLE_WIDTH = 10;
const PARTICLE_SPEED = 0.003;
// three-forcegraph derives photon opacity as linkOpacity * 3, so the library
// default 0.2 also caps a travelling dot at 0.6 — at 0.34+ the dot is fully
// opaque, which is what makes it read against the blue background.
const LINK_OPACITY = 0.35;
// A lit node swells as well as changing colour: at camDist ~1000 an unlit node
// is about 6px across, far too small for colour alone to register.
const LIT_NODE_VAL = 12;

// How far apart queued steps play, and how many can be queued at once (older
// ones dropped) so a burst of activity doesn't play back for minutes.
const STEP_INTERVAL_MS = 250;
const MAX_QUEUED_STEPS = 40;

// With no agent activity to show, the backdrop fires a signal from a root node
// (an entry point — no inbound edges) outward along directed edges to a random
// target this often, so it always reads as alive. Real activity wins: an idle
// firing is skipped whenever anything is already lit or queued.
const IDLE_TRACE_MS = 5000;
const IDLE_PATH_HOPS = 5;
const IDLE_PATH_ATTEMPTS = 6;

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
  // Every node and edge, not just the file ones: idle firings roam the whole
  // graph, where real activity only ever lights files it can resolve by path.
  // Outbound-only, so a signal travels the edge the way the particle does.
  let nodesById = new Map(); // node id -> node
  let outboundById = new Map(); // node id -> [{ node, link }]
  let rootNodes = []; // entry points: outbound edges, no inbound ones
  const pulses = new Map(); // node -> deadline (ms)
  const linkPulses = new Map(); // link -> deadline (ms)
  let pulseTimerId = null;
  let linkCleanupTicks = 0; // see pulseTick

  // Per-session last touched node, so a `touch` step can light the real edge
  // to the previous one. Query steps (graft/Grep/Glob results) never set or
  // read this — result order is relevance rank, not a walked path.
  const lastNodeBySession = new Map();
  let stepQueue = []; // { kind, files, sessionId } or { kind: 'idle', node, link }
  let stepTimerId = null;
  let idleTimerId = null;

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

  function nodeValFor(node) {
    return pulses.has(node) ? LIT_NODE_VAL : 1;
  }

  // Node and particle meshes use MeshLambertMaterial, so scene lighting drags a
  // white material down to roughly mid-grey on screen. Emissive is unlit, so a
  // lit node/dot renders at its full colour regardless of the lights.
  function setEmissive(obj, color) {
    const emissive = obj?.material?.emissive;
    if (emissive) emissive.set(color);
  }

  // Same trick as setEmissive, plus the opacity bump that only a lit link's
  // own material can carry (linkOpacity is a global accessor). Materials are
  // cached per colour string by the library and rebuilt every digest, so this
  // mutates whatever instance is currently assigned to the link's mesh —
  // matches setEmissive's one-tick lag, which is already how node pulses work.
  function setLinkLit(link, color) {
    const material = link.__lineObj?.material;
    if (!material?.emissive) return; // unlit links are a Line with no emissive
    material.emissive.set(color);
    material.opacity = LIT_LINK_OPACITY;
  }

  function clearLinkLit(link) {
    const material = link.__lineObj?.material;
    if (!material?.emissive) return;
    material.emissive.set('#000000');
    material.opacity = LINK_OPACITY;
    material.color?.set(linkColorValue());
  }

  // Lights an edge: the colour/width pulse plus a dot that travels it. The
  // particle animates itself frame by frame once emitted, independently of
  // the pulse tick's accessor re-application.
  function fireLink(link, deadline) {
    linkPulses.set(link, deadline);
    graphInstance?.emitParticle(link);
    const photons = link.__singleHopPhotonsObj?.children;
    if (photons?.length) setEmissive(photons[photons.length - 1], readToken(PULSE_COLOR_VAR, '#ffffff'));
  }

  function stopPulseTick() {
    if (pulseTimerId === null) return;
    clearInterval(pulseTimerId);
    pulseTimerId = null;
  }

  function pulseTick() {
    const now = Date.now();
    for (const [node, until] of pulses) {
      if (until <= now) {
        pulses.delete(node);
        setEmissive(node.__threeObj, '#000000');
      } else {
        setEmissive(node.__threeObj, nodeColorFor(node));
      }
    }
    // linkColor/linkWidth re-apply rebuilds every link's material — 336 edges
    // vs the small handful actually lit — so it's skipped on ticks where no
    // link pulse was live, and run once more on the tick a link's pulse
    // expires so it fades back to its base colour/width.
    const hadLinks = linkPulses.size > 0;
    let linkExpired = false;
    for (const [link, until] of linkPulses) {
      if (until <= now) {
        linkPulses.delete(link);
        clearLinkLit(link);
        linkExpired = true;
      } else {
        setLinkLit(link, linkColorFor(link));
      }
    }
    graphInstance?.nodeColor(nodeColorFor).nodeVal(nodeValFor);
    // three-forcegraph's own digest doesn't reliably swap a link's mesh back
    // to a thin unlit line on the exact tick its width returns to 0 (observed:
    // it can sit as a bright lambert-lit cylinder for several seconds, only
    // self-healing once a *later*, unrelated link pulse forces another
    // reapply) — so once a link expires, keep forcing the reapply for a few
    // extra ticks rather than trusting the very next one to land.
    if (linkExpired) linkCleanupTicks = LINK_CLEANUP_GRACE_TICKS;
    else if (linkCleanupTicks > 0) linkCleanupTicks--;
    if (hadLinks || linkCleanupTicks > 0) graphInstance?.linkColor(linkColorFor).linkWidth(linkWidthFor);
    if (!pulses.size && !linkPulses.size && linkCleanupTicks <= 0) stopPulseTick();
  }

  function startPulseTick() {
    if (pulseTimerId !== null) return;
    pulseTimerId = setInterval(pulseTick, PULSE_TICK_MS);
  }

  function resolveNode(file) {
    return nodesByPath.get(file) || nodesByLowerPath.get(file.toLowerCase());
  }

  function playStep(step) {
    if (disposed || paused || !graphInstance) return;
    const { sessionId, kind, files } = step;
    const deadline = Date.now() + PULSE_MS;

    if (kind === 'idle') {
      pulses.set(step.node, deadline);
      if (step.link) fireLink(step.link, deadline);
      setEmissive(step.node.__threeObj, readToken(PULSE_COLOR_VAR, '#ffffff'));
      startPulseTick();
      return;
    }

    if (kind === 'touch') {
      const node = files[0] && resolveNode(files[0]);
      if (!node) return; // no node lookup succeeded — lastNode stays as-is
      pulses.set(node, deadline);
      const lastNode = lastNodeBySession.get(sessionId);
      if (lastNode && lastNode !== node) {
        const link = linksByPair.get(`${lastNode.id}|${node.id}`);
        if (link) fireLink(link, deadline);
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
        if (link) fireLink(link, deadline);
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

  function randomFrom(list) {
    return list[Math.floor(Math.random() * list.length)];
  }

  // Fires from a random root outward along directed edges, up to IDLE_PATH_HOPS
  // of them, and queues the hops as ordinary steps so they pace, fade and clear
  // through exactly the same machinery as a real trace.
  function queueIdlePath() {
    if (disposed || paused || !graphInstance || !rootNodes.length) return;
    // Real activity owns the backdrop: anything lit or pending means skip.
    if (stepQueue.length || pulses.size || linkPulses.size) return;

    // Best of a few attempts: several roots (the vite configs) have one edge
    // to an external package and nothing beyond it, so an unfiltered pick
    // spends most firings on a single dull hop.
    let best = [];
    for (let attempt = 0; attempt < IDLE_PATH_ATTEMPTS; attempt++) {
      const steps = walkFromRoot();
      if (steps.length > best.length) best = steps;
      if (best.length >= IDLE_PATH_HOPS + 1) break;
    }
    if (best.length < 2) return; // a lone node with no outbound edge isn't a path

    stepQueue.push(...best);
    startStepTimer();
  }

  function walkFromRoot() {
    let current = randomFrom(rootNodes);
    if (!current) return [];

    const visited = new Set([current.id]);
    const steps = [{ kind: 'idle', node: current }];
    for (let hop = 0; hop < IDLE_PATH_HOPS; hop++) {
      const options = (outboundById.get(current.id) || []).filter((n) => !visited.has(n.node.id));
      if (!options.length) break; // dead end: the signal stops where the graph does
      const next = randomFrom(options);
      visited.add(next.node.id);
      steps.push({ kind: 'idle', node: next.node, link: next.link });
      current = next.node;
    }
    return steps;
  }

  function startIdleTimer() {
    if (idleTimerId !== null) return;
    idleTimerId = setInterval(queueIdlePath, IDLE_TRACE_MS);
  }

  function stopIdleTimer() {
    if (idleTimerId === null) return;
    clearInterval(idleTimerId);
    idleTimerId = null;
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
    stopIdleTimer();
    pulses.clear();
    linkPulses.clear();
    linkCleanupTicks = 0;
    stepQueue = [];
    lastNodeBySession.clear();
    nodesByPath = new Map();
    nodesByLowerPath = new Map();
    linksByPair = new Map();
    nodesById = new Map();
    outboundById = new Map();
    rootNodes = [];
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

    // Directed adjacency over the whole graph, read in the same pre-mutation
    // window as linksByPair above (source/target are still id strings here).
    for (const node of graphData.nodes) nodesById.set(node.id, node);
    const hasInbound = new Set();
    for (const link of graphData.links) {
      const source = nodesById.get(link.source);
      const target = nodesById.get(link.target);
      if (!source || !target || source === target) continue;
      if (!outboundById.has(source.id)) outboundById.set(source.id, []);
      outboundById.get(source.id).push({ node: target, link });
      hasInbound.add(target.id);
    }
    rootNodes = [...outboundById.keys()].filter((id) => !hasInbound.has(id)).map((id) => nodesById.get(id));
    // A fully cyclic graph has no inbound-free node; firing from any node with
    // outbound edges still reads as a signal, just not from an entry point.
    if (!rootNodes.length) rootNodes = [...outboundById.keys()].map((id) => nodesById.get(id));

    // 'orbit' (not the library default 'trackball'): autoRotate below only exists
    // on OrbitControls; TrackballControls silently ignores the flag.
    graphInstance = ForceGraph3D({ controlType: 'orbit' })(containerEl)
      .graphData(graphData)
      .nodeLabel((n) => `${n.kind}: ${n.name}`)
      .nodeColor(nodeColorFor)
      .nodeVal(nodeValFor)
      .linkColor(linkColorFor)
      .linkWidth(linkWidthFor)
      .linkOpacity(LINK_OPACITY)
      // No standing linkDirectionalParticles count — every dot on screen comes
      // from an explicit emitParticle(), so the graph is still when nothing fires.
      .linkDirectionalParticleWidth(PARTICLE_WIDTH)
      .linkDirectionalParticleSpeed(PARTICLE_SPEED)
      .linkDirectionalParticleColor(() => readToken(PULSE_COLOR_VAR, '#ffffff'))
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

    if (!paused) startIdleTimer();
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
      stopIdleTimer();
      pulses.clear();
      // Animation is about to freeze, so nothing will render this loop's
      // clearLinkLit/digest again to fade a live pulse out — reset any lit
      // link's material directly now, or it stays bright for the whole pause.
      for (const link of linkPulses.keys()) clearLinkLit(link);
      linkPulses.clear();
      linkCleanupTicks = 0;
      graphInstance?.linkColor(linkColorFor).linkWidth(linkWidthFor);
      stepQueue = [];
      graphInstance?.pauseAnimation();
    },

    resume() {
      paused = false;
      if (graphInstance) startIdleTimer();
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
