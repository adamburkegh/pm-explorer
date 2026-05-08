/**
 * Sugiyama hierarchical layout — orchestrator.
 *
 * Runs the four-phase pipeline on a LayoutGraph:
 *
 *   Phase 1  removeCycles      — DFS back-edge reversal (ranking.js)
 *   Phase 2  assignRanks       — longest-path layering  (ranking.js)
 *   Phase 3  buildLayers
 *            insertDummyNodes  — long-edge splitting     (crossing.js)
 *            minimizeCrossings — median + transpose      (crossing.js)
 *   Phase 4  assignCoordinates — barycenter + compact    (coordinates.js)
 *
 * After the pipeline every real LayoutNode (non-dummy) has:
 *   _x, _y   — centre coordinates in pixels
 *   _rank    — integer layer index
 *
 * Dummy nodes (inserted by Phase 3) are removed from the graph before
 * returning so callers only see the original nodes.  The dummy chains
 * are replaced by bend-point arrays stored on the original edges:
 *   edge._points = [ {x, y}, … ]   — intermediate waypoints, in order
 *                                     from source to target
 *
 * Usage (browser + Node.js via vm.runInThisContext):
 *   var declarations hoist to global.
 *
 * Dependencies: graph.js, ranking.js, crossing.js, coordinates.js
 *               must all be loaded before this file.
 *
 * ── Public API ────────────────────────────────────────────────────────────────
 *
 *   sugiyamaLayout(graph, opts)
 *     Run the full pipeline on `graph` (mutated in-place).
 *     Returns { layers, width, height } where:
 *       layers  — final layer arrays (real nodes only)
 *       width   — total layout width in pixels
 *       height  — total layout height in pixels
 *
 *   Options (all optional):
 *     nodeSepX  {number}  min gap between node edges      (default 30)
 *     rankSepY  {number}  vertical gap between layers     (default 60)
 *     marginX   {number}  left/right margin               (default 20)
 *     marginY   {number}  top/bottom margin               (default 20)
 *     iterations {number} crossing-minimisation rounds    (default 4)
 */

var sugiyamaLayout = function sugiyamaLayout(graph, opts = {}) {

  // ── Phase 1 & 2: cycle removal + rank assignment ──────────────────────────
  // Capture reversed edge ids before insertDummyNodes removes them.
  const reversedEdgeIds = removeCycles(graph);
  assignRanks(graph);

  // ── Phase 3: layer building, dummy nodes, crossing minimisation ───────────
  const layers = buildLayers(graph);
  insertDummyNodes(graph, layers);
  minimizeCrossings(graph, layers, opts.iterations);

  // ── Phase 4: coordinate assignment ────────────────────────────────────────
  assignCoordinates(graph, layers, opts);

  // ── Collect bend points from dummy chains, then remove dummy nodes ────────
  // Map originalEdgeId → ordered list of dummy node ids (source→target order)
  const dummyChains = new Map();   // originalEdgeId → string[]

  for (const id of [...graph.nodeIds]) {
    const node = graph.node(id);
    if (!node._dummy) continue;

    // All edges incident to a dummy node carry _originalEdge
    for (const eid of [...graph.outEdges(id), ...graph.inEdges(id)]) {
      const e = graph.edge(eid);
      if (!e) continue;
      const origId = e._originalEdge;
      if (!origId) continue;
      if (!dummyChains.has(origId)) dummyChains.set(origId, []);
      // Add this dummy if not already in the list
      const chain = dummyChains.get(origId);
      if (!chain.includes(id)) chain.push(id);
    }
  }

  // Sort each chain by _rank so waypoints are ordered source→target
  for (const [, chain] of dummyChains) {
    chain.sort((a, b) => graph.node(a)._rank - graph.node(b)._rank);
  }

  // Store bend points on… where?  We don't have the original edge any more
  // (it was removed by insertDummyNodes).  Store them in a side Map keyed by
  // original edge id and expose via the return value.
  const bendPoints = new Map();   // originalEdgeId → {x,y}[]
  for (const [origId, chain] of dummyChains) {
    bendPoints.set(origId, chain.map(id => ({
      x: graph.node(id)._x,
      y: graph.node(id)._y,
    })));
  }

  // Remove dummy nodes (and all their edges) from the graph
  for (const id of [...graph.nodeIds]) {
    if (graph.node(id)._dummy) graph.removeNode(id);
  }

  // Remove dummy layers from the layer arrays
  for (const layer of layers) {
    let i = layer.length - 1;
    while (i >= 0) {
      // After removal the node no longer exists in graph
      if (!graph.hasNode(layer[i])) layer.splice(i, 1);
      i--;
    }
  }
  // Drop empty layers
  const realLayers = layers.filter(l => l.length > 0);

  // ── Compute bounding box ──────────────────────────────────────────────────
  let maxX = 0, maxY = 0;
  const marginX = opts.marginX ?? 20;
  const marginY = opts.marginY ?? 20;

  for (const id of graph.nodeIds) {
    const n    = graph.node(id);
    const right  = n._x + (n.width  ?? 0) / 2 + marginX;
    const bottom = n._y + (n.height ?? 0) / 2 + marginY;
    if (right  > maxX) maxX = right;
    if (bottom > maxY) maxY = bottom;
  }

  return {
    layers:        realLayers,
    bendPoints,
    /** Set of original edge ids that were reversed by cycle removal. */
    reversedEdges: new Set(reversedEdgeIds),
    width:         maxX,
    height:        maxY,
  };
};
