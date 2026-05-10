/**
 * Sugiyama Phase 4: coordinate assignment.
 *
 * Assigns x and y pixel coordinates to every node so that the graph
 * can be rendered without overlaps.
 *
 * y coordinates
 * ─────────────
 * Each layer r is placed at  y = sum of (maxNodeHeight[0..r-1] + rankSep).
 * Within a layer every node shares the same y (centre-of-node).
 *
 * x coordinates — barycenter + compact
 * ─────────────────────────────────────
 * 1. Initial placement: space nodes in each layer evenly (left-to-right).
 * 2. Multiple sweep passes (down then up):
 *      Down: for each node, set its x to the average x of its
 *            predecessors (already placed in the layer above).
 *            Then sweep left-to-right through the layer, pushing any
 *            node rightward to eliminate overlaps.
 *      Up:   same but using successors and sweeping the same way.
 * 3. Shift the whole layout so the leftmost node is at marginX.
 *
 * Result
 * ──────
 * Each LayoutNode gains two properties:
 *   _x  {number}  horizontal centre in pixels
 *   _y  {number}  vertical   centre in pixels
 *
 * Usage (browser + Node.js via vm.runInThisContext):
 *   var declarations hoist to global.
 *
 * Dependencies: layout/graph.js, ranking.js, crossing.js.
 */

// ── Public entry point ────────────────────────────────────────────────────────

/**
 * Assign _x and _y to every node in `graph`.
 *
 * @param {LayoutGraph} graph
 * @param {string[][]}  layers   layers[r] = ordered node ids at rank r
 * @param {object}      [opts]
 * @param {number}      [opts.nodeSepX=30]   minimum gap between node edges
 * @param {number}      [opts.rankSepY=60]   vertical gap between layer baselines
 * @param {number}      [opts.marginX=20]    left margin
 * @param {number}      [opts.marginY=20]    top margin
 * @param {number}      [opts.iterations=4]  barycenter sweep passes
 */
var assignCoordinates = function assignCoordinates(graph, layers, opts = {}) {
  const nodeSepX  = opts.nodeSepX  ?? 30;
  const rankSepY  = opts.rankSepY  ?? 60;
  const marginX   = opts.marginX   ?? 20;
  const marginY   = opts.marginY   ?? 20;
  const iterations = opts.iterations ?? 4;

  if (layers.length === 0) return;

  // ── y coordinates ─────────────────────────────────────────────────────────

  const layerH = layers.map(layer =>
    layer.reduce((h, id) => Math.max(h, graph.node(id).height ?? 0), 0)
  );

  let yOffset = marginY;
  for (let r = 0; r < layers.length; r++) {
    const cy = yOffset + layerH[r] / 2;
    for (const id of layers[r]) graph.node(id)._y = cy;
    yOffset += layerH[r] + rankSepY;
  }

  // ── x coordinates ─────────────────────────────────────────────────────────

  // Initial placement: equal spacing per layer
  for (const layer of layers) {
    _placeLayerLeft(graph, layer, 0, nodeSepX);
  }

  // Iterative barycenter sweeps
  for (let iter = 0; iter < iterations; iter++) {
    // Down sweep: align each node to average of predecessors above
    for (let r = 1; r < layers.length; r++) {
      const layer = layers[r];
      for (const id of layer) {
        const preds = graph.predecessors(id)
          .filter(p => graph.node(p)._rank === r - 1);
        if (preds.length > 0) {
          graph.node(id)._x = preds.reduce((s, p) => s + graph.node(p)._x, 0) / preds.length;
        }
      }
      _enforceMinSep(graph, layer, nodeSepX);
    }

    // Up sweep: align each node to average of successors below
    for (let r = layers.length - 2; r >= 0; r--) {
      const layer = layers[r];
      for (const id of layer) {
        const succs = graph.successors(id)
          .filter(s => graph.node(s)._rank === r + 1);
        if (succs.length > 0) {
          graph.node(id)._x = succs.reduce((s, c) => s + graph.node(c)._x, 0) / succs.length;
        }
      }
      _enforceMinSep(graph, layer, nodeSepX);
    }
  }

  // Shift so leftmost node edge is at marginX
  let minLeft = Infinity;
  for (const id of graph.nodeIds) {
    const left = graph.node(id)._x - (graph.node(id).width ?? 0) / 2;
    if (left < minLeft) minLeft = left;
  }
  const shift = marginX - minLeft;
  for (const id of graph.nodeIds) graph.node(id)._x += shift;
};


// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Place nodes in `layer` left-to-right starting from `startX`,
 * with `nodeSepX` gap between node edges.  Assigns _x on each node.
 *
 * @param {LayoutGraph} graph
 * @param {string[]}    layer
 * @param {number}      startX  left edge of the first node
 * @param {number}      nodeSepX
 */
function _placeLayerLeft(graph, layer, startX, nodeSepX) {
  let cursor = startX;
  for (const id of layer) {
    const w = graph.node(id).width ?? 0;
    graph.node(id)._x = cursor + w / 2;
    cursor += w + nodeSepX;
  }
}

/**
 * Sweep `layer` to enforce minimum horizontal separation between nodes.
 *
 * After a forward (push-right) pass, the block is re-centred at its
 * pre-enforcement centre of mass so that the barycenter iterations do
 * not drift monotonically in one direction.
 *
 * @param {LayoutGraph} graph
 * @param {string[]}    layer
 * @param {number}      nodeSepX
 */
function _enforceMinSep(graph, layer, nodeSepX) {
  if (layer.length < 2) return;

  const sorted = [...layer].sort((a, b) => graph.node(a)._x - graph.node(b)._x);

  // Remember centre of mass before enforcement
  const idealCentre = sorted.reduce((s, id) => s + graph.node(id)._x, 0) / sorted.length;

  // Forward pass: push right to enforce minimum separation
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur  = sorted[i];
    const minX = graph.node(prev)._x + (graph.node(prev).width ?? 0) / 2
               + nodeSepX
               + (graph.node(cur).width  ?? 0) / 2;
    if (graph.node(cur)._x < minX) graph.node(cur)._x = minX;
  }

  // Re-centre the block so its centre of mass stays at `idealCentre`
  const actualCentre = sorted.reduce((s, id) => s + graph.node(id)._x, 0) / sorted.length;
  const offset = idealCentre - actualCentre;
  if (offset !== 0) {
    for (const id of sorted) graph.node(id)._x += offset;
  }
}
