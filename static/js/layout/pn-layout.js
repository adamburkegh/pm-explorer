/**
 * Petri net layout adapter — left-to-right Sugiyama.
 *
 * Converts a PetriNet model into a LayoutGraph, runs the Sugiyama
 * pipeline (which produces a top-to-bottom layout), then swaps x↔y
 * so the result reads left-to-right (rank increases rightward).
 *
 * After applyPetriNetLayout(net):
 *   place.position.{x, y}       updated to LR Sugiyama centre coords
 *   transition.position.{x, y}  updated to LR Sugiyama centre coords
 *   arc.points                  bend-point waypoints (may be [])
 *
 * Back-arcs (arcs that were reversed by cycle removal) are routed as a
 * U-shape below the layout rather than as jagged waypoints.
 *
 * Dependencies: graph.js, ranking.js, crossing.js, coordinates.js,
 *               sugiyama.js must all be loaded first.
 */

/**
 * Lay out a PetriNet left-to-right using the Sugiyama algorithm.
 *
 * Options (all optional, oriented for LR output):
 *   rankSepX  {number}  horizontal gap between rank columns  (default 100)
 *   nodeSepY  {number}  vertical gap between nodes in a rank (default 25)
 *   marginX   {number}  left/right margin                    (default 40)
 *   marginY   {number}  top/bottom margin                    (default 40)
 *   iterations {number} crossing-minimisation passes         (default 4)
 *
 * @param {PetriNet} net
 * @param {object}   [opts]
 * @returns {{ width: number, height: number }}
 */
var applyPetriNetLayout = function applyPetriNetLayout(net, opts = {}) {
  // The Sugiyama pipeline is top-to-bottom internally; we swap x↔y at the
  // end.  So the pipeline option names map as:
  //   rankSepY  (pipeline vertical)  ↔  rankSepX  (LR horizontal gap)
  //   nodeSepX  (pipeline horizontal) ↔  nodeSepY  (LR vertical gap)
  const pipelineOpts = {
    rankSepY:   opts.rankSepX   ?? 100,
    nodeSepX:   opts.nodeSepY   ?? 25,
    marginX:    opts.marginY    ?? 40,   // pipeline x → LR y
    marginY:    opts.marginX    ?? 40,   // pipeline y → LR x
    iterations: opts.iterations ?? 4,
  };

  // ── Build LayoutGraph ─────────────────────────────────────────────────────

  const g = new LayoutGraph();

  for (const [id, place] of net.places) {
    const d = (place.radius ?? 20) * 2;
    // In LR the node's "width" (pipeline horizontal, becomes LR vertical)
    // should reflect the node's visual height, and "height" (pipeline
    // vertical, becomes LR horizontal) should reflect the visual width.
    // Places are circular so both dimensions equal the diameter.
    g.addNode(id, d, d);
  }

  for (const [id, t] of net.transitions) {
    // Transition in screen space: visually w=20 (narrow), h=50 (tall).
    // After swap: pipeline width (→ LR y-separation) = visual width = 20
    //             pipeline height (→ LR x-separation) = visual height = 50
    // But for column spacing we care most about the visual height (50) in
    // the rank direction (LR x), so swap them here to match the pipeline.
    g.addNode(id, t.height ?? 50, t.width ?? 20);
  }

  for (const [id, arc] of net.arcs) {
    if (g.hasNode(arc.source) && g.hasNode(arc.target)) {
      try { g.addEdge(id, arc.source, arc.target); }
      catch (_) { /* duplicate id — skip */ }
    }
  }

  // ── Run pipeline ──────────────────────────────────────────────────────────

  const { bendPoints, reversedEdges, width, height } =
    sugiyamaLayout(g, pipelineOpts);

  // ── Swap x↔y for left-to-right orientation ───────────────────────────────

  for (const id of g.nodeIds) {
    const n = g.node(id);
    const tmp = n._x; n._x = n._y; n._y = tmp;
  }

  for (const [, pts] of bendPoints) {
    for (const pt of pts) {
      const tmp = pt.x; pt.x = pt.y; pt.y = tmp;
    }
  }

  // ── Write positions back ──────────────────────────────────────────────────

  for (const [id, place] of net.places) {
    const n = g.node(id);
    if (n) { place.position.x = n._x; place.position.y = n._y; }
  }

  for (const [id, t] of net.transitions) {
    const n = g.node(id);
    if (n) { t.position.x = n._x; t.position.y = n._y; }
  }

  // ── Arc waypoints ─────────────────────────────────────────────────────────

  // Find layout bottom for back-arc U-routing (after swap, y = visual vertical)
  let maxBottom = 0;
  for (const id of g.nodeIds) {
    const n   = g.node(id);
    // After swap, n.height is the visual width (small for transitions).
    // Use n.width (was pipeline height, now visual height) for bottom calc.
    const bot = n._y + (n.width ?? 0) / 2;
    if (bot > maxBottom) maxBottom = bot;
  }
  const backArcY = maxBottom + (opts.marginY ?? 40);

  for (const [id, arc] of net.arcs) {
    if (reversedEdges.has(id)) {
      // Route back-arc as a U-shape below the diagram
      const src = net.places.get(arc.source) ?? net.transitions.get(arc.source);
      const tgt = net.places.get(arc.target) ?? net.transitions.get(arc.target);
      if (src && tgt) {
        arc.points = [
          { x: src.position.x, y: backArcY },
          { x: tgt.position.x, y: backArcY },
        ];
      } else {
        arc.points = bendPoints.get(id) ?? [];
      }
    } else {
      arc.points = bendPoints.get(id) ?? [];
    }
  }

  // After swap the bounding box dimensions are also swapped
  return { width: height, height: width };
};
