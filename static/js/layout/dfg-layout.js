/**
 * DFG layout adapter — wraps the Sugiyama pipeline for directly-follows graphs.
 *
 * Inputs match the DFG data structures used throughout pm-explorer:
 *   graph           — Map<dfgKey, count>     (edges, dfgKey = "A\x1fB")
 *   startActivities — Map<actName, count>
 *   endActivities   — Map<actName, count>
 *
 * Returns:
 *   nodes  — Map<actName, {x, y, width, height}>  (pixel centres, LR layout)
 *   ranks  — Map<actName, number>                  (column index; used by
 *                                                   DfgViewer to detect back-edges)
 *
 * The Sugiyama pipeline runs top-to-bottom internally; x↔y are swapped at the
 * end so rank increases rightward (same convention as pn-layout.js).
 *
 * End activities are pinned to the rightmost column regardless of their
 * topological rank.  This matters for DFGs with loops, where the shortest path
 * from a start activity to an end activity may be shorter than the longest
 * path to an internal activity.
 *
 * Self-loop edges (a → a) in the DFG are ignored for layout purposes.
 *
 * Dependencies: graph.js, ranking.js, crossing.js, coordinates.js must all
 * be loaded before this file.
 */

/* global LayoutGraph, removeCycles, assignRanks, buildLayers, insertDummyNodes,
          minimizeCrossings, assignCoordinates, dfgKeyParts */

var layoutDfg = function layoutDfg(graph, startActivities, endActivities, opts) {
  opts = opts || {};

  var NODE_H   = 40;   // visual node height (px)
  var CHAR_W   = 7.2;  // approx px per character at 12px Arial
  var NODE_PAD = 28;   // total horizontal label padding (both sides)

  // ── Collect all activities ────────────────────────────────────────────────

  var acts = new Set();
  for (var _a = 0, _entries = graph.entries ? [...graph.entries()] : []; _a < _entries.length; _a++) {
    var _ref = _entries[_a], key = _ref[0];
    var parts = dfgKeyParts(key);
    if (parts[0] !== parts[1]) { acts.add(parts[0]); acts.add(parts[1]); }
  }
  for (var a of startActivities.keys()) acts.add(a);
  for (var b of endActivities.keys())   acts.add(b);

  // Pre-compute visual widths
  var nodeWidth = new Map();
  for (var act of acts) {
    nodeWidth.set(act, Math.max(100, Math.ceil(act.length * CHAR_W) + NODE_PAD));
  }

  // ── Build LayoutGraph ─────────────────────────────────────────────────────

  var g = new LayoutGraph();

  for (var act of acts) {
    // Pipeline is top-to-bottom; after x↔y swap:
    //   pipeline width  → visual height  (NODE_H)
    //   pipeline height → visual width   (nodeWidth)
    g.addNode(act, NODE_H, nodeWidth.get(act));
  }

  for (var [edgeKey] of graph) {
    var pair = dfgKeyParts(edgeKey);
    var src = pair[0], tgt = pair[1];
    if (src !== tgt && g.hasNode(src) && g.hasNode(tgt)) {
      try { g.addEdge(edgeKey, src, tgt); } catch (_) { /* duplicate — skip */ }
    }
  }

  // ── Phase 1 & 2: cycle removal + rank assignment ──────────────────────────

  removeCycles(g);
  assignRanks(g);

  // ── Pin end activities to the rightmost column ────────────────────────────
  // In DFGs with loops the topological rank of an end activity may be lower
  // than that of internal activities.  Force every end activity one step
  // beyond the maximum rank of all non-end activities.

  var innerMax = 0;
  for (var id of g.nodeIds) {
    if (!endActivities.has(id)) {
      var r = g.node(id)._rank || 0;
      if (r > innerMax) innerMax = r;
    }
  }
  var endRank = innerMax + 1;
  for (var endAct of endActivities.keys()) {
    var en = g.node(endAct);
    if (en) en._rank = Math.max(en._rank || 0, endRank);
  }

  // ── Phase 3: layers, dummy nodes, crossing minimisation ──────────────────

  var layers = buildLayers(g);
  insertDummyNodes(g, layers);
  minimizeCrossings(g, layers, opts.iterations != null ? opts.iterations : 4);

  // ── Phase 4: coordinate assignment ───────────────────────────────────────
  // Pipeline option names map to LR output as follows:
  //   rankSepY (pipeline vertical layer gap) ← rankSepX (LR column gap)
  //   nodeSepX (pipeline horizontal gap)     ← nodeSepY (LR row gap)
  //   marginY  (pipeline top/bottom)         ← marginX  (LR left/right)
  //   marginX  (pipeline left/right)         ← marginY  (LR top/bottom)

  assignCoordinates(g, layers, {
    rankSepY:   opts.rankSepX  != null ? opts.rankSepX  : 110,
    nodeSepX:   opts.nodeSepY  != null ? opts.nodeSepY  : 50,
    marginY:    opts.marginX   != null ? opts.marginX   : 60,
    marginX:    opts.marginY   != null ? opts.marginY   : 30,
    iterations: opts.iterations != null ? opts.iterations : 4,
  });

  // ── Collect ranks from real nodes before dummy cleanup ────────────────────

  var ranks = new Map();
  for (var act of acts) {
    var rn = g.node(act);
    if (rn) ranks.set(act, rn._rank || 0);
  }

  // ── Remove dummy nodes ────────────────────────────────────────────────────

  for (var nid of [...g.nodeIds]) {
    if (g.node(nid)._dummy) g.removeNode(nid);
  }

  // ── Swap x↔y for left-to-right orientation ───────────────────────────────

  for (var nid of g.nodeIds) {
    var n = g.node(nid);
    var tmp = n._x; n._x = n._y; n._y = tmp;
  }

  // ── Build output ──────────────────────────────────────────────────────────

  var nodes = new Map();
  for (var act of acts) {
    var on = g.node(act);
    if (on) {
      nodes.set(act, {
        x:      on._x,
        y:      on._y,
        width:  nodeWidth.get(act),
        height: NODE_H,
      });
    }
  }

  return { nodes: nodes, ranks: ranks };
};
