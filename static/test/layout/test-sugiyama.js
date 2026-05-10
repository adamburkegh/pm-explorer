/**
 * Tests for layout/sugiyama.js — sugiyamaLayout
 */

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a graph from compact spec and run sugiyamaLayout. */
function layout(nodes, edges, opts) {
  const g = new LayoutGraph();
  for (const [id, w, h] of nodes) g.addNode(id, w ?? 0, h ?? 0);
  for (const [id, s, t] of edges) g.addEdge(id, s, t);
  const result = sugiyamaLayout(g, opts);
  return { g, ...result };
}

/** True when rank(u) < rank(v) for all edges u→v in graph. */
function ranksRespected(g) {
  for (const eid of g.edgeIds) {
    const e = g.edge(eid);
    if ((g.node(e.source)._rank ?? -1) >= (g.node(e.target)._rank ?? -1)) return false;
  }
  return true;
}

/** True when no two real nodes in the same layer overlap horizontally. */
function noOverlaps(g, layers, nodeSepX) {
  const sep = nodeSepX ?? 0;
  for (const layer of layers) {
    const sorted = [...layer].sort((a, b) => g.node(a)._x - g.node(b)._x);
    for (let i = 1; i < sorted.length; i++) {
      const l = sorted[i - 1], r = sorted[i];
      const lRight = g.node(l)._x + (g.node(l).width ?? 0) / 2;
      const rLeft  = g.node(r)._x - (g.node(r).width ?? 0) / 2;
      if (rLeft < lRight - sep) return false;
    }
  }
  return true;
}


// ── End-to-end: structural correctness ────────────────────────────────────────

describe('sugiyamaLayout — structural correctness', () => {
  it('single node: gets coordinates', () => {
    const { g } = layout([['a', 0, 0]], []);
    assert.ok(typeof g.node('a')._x === 'number');
    assert.ok(typeof g.node('a')._y === 'number');
  });

  it('no dummy nodes remain in graph after layout', () => {
    // s→t is a skip edge that forces a dummy
    const g = new LayoutGraph();
    g.addNode('s',0,0); g.addNode('m',0,0); g.addNode('t',0,0);
    g.node('s')._rank = 0; g.node('m')._rank = 1; g.node('t')._rank = 2;
    // Build without pipeline to set ranks manually, then add skip edge
    // Actually let's use the full pipeline by constructing a graph that
    // produces a skip edge naturally: s→m→t and s→t (span 2)
    const g2 = new LayoutGraph();
    ['s','m','t'].forEach(id => g2.addNode(id, 0, 0));
    g2.addEdge('sm','s','m'); g2.addEdge('mt','m','t'); g2.addEdge('st','s','t');
    sugiyamaLayout(g2);
    for (const id of g2.nodeIds) {
      assert.ok(!g2.node(id)._dummy, `node ${id} should not be dummy`);
    }
  });

  it('chain: all real nodes present', () => {
    const { g } = layout(
      [['a',0,0],['b',0,0],['c',0,0]],
      [['ab','a','b'],['bc','b','c']]
    );
    assert.ok(g.hasNode('a'));
    assert.ok(g.hasNode('b'));
    assert.ok(g.hasNode('c'));
    assert.equal(g.nodeCount, 3);
  });

  it('rank constraints respected for all remaining edges', () => {
    const { g } = layout(
      [['s',0,0],['a',0,0],['b',0,0],['t',0,0]],
      [['sa','s','a'],['sb','s','b'],['at','a','t'],['bt','b','t']]
    );
    assert.ok(ranksRespected(g));
  });

  it('no horizontal overlaps in any layer', () => {
    const { g, layers } = layout(
      [['s',40,0],['a',40,0],['b',40,0],['c',40,0],['t',40,0]],
      [['sa','s','a'],['sb','s','b'],['sc','s','c'],
       ['at','a','t'],['bt','b','t'],['ct','c','t']],
      { nodeSepX: 10 }
    );
    assert.ok(noOverlaps(g, layers, 10));
  });

  it('cyclic graph: still produces valid layout', () => {
    const { g } = layout(
      [['a',0,0],['b',0,0],['c',0,0]],
      [['ab','a','b'],['bc','b','c'],['ca','c','a']]
    );
    // After cycle removal: 3 nodes, valid coords
    assert.equal(g.nodeCount, 3);
    for (const id of ['a','b','c']) {
      assert.ok(typeof g.node(id)._x === 'number');
    }
  });
});


// ── Bend points ───────────────────────────────────────────────────────────────

describe('sugiyamaLayout — bend points', () => {
  it('unit edges produce no bend points', () => {
    const { bendPoints } = layout(
      [['a',0,0],['b',0,0]],
      [['ab','a','b']]
    );
    assert.equal(bendPoints.size, 0);
  });

  it('skip edge produces bend points', () => {
    // s→m→t (unit edges) + s→t (skip, span 2) → one dummy chain
    const g = new LayoutGraph();
    ['s','m','t'].forEach(id => g.addNode(id, 0, 0));
    g.addEdge('sm','s','m'); g.addEdge('mt','m','t'); g.addEdge('st','s','t');
    const { bendPoints } = sugiyamaLayout(g);
    assert.ok(bendPoints.has('st'), 'skip edge st should have bend points');
    const pts = bendPoints.get('st');
    assert.ok(Array.isArray(pts));
    assert.equal(pts.length, 1);       // one intermediate rank between 0 and 2
  });

  it('bend points have numeric x and y', () => {
    const g = new LayoutGraph();
    ['s','m','t'].forEach(id => g.addNode(id, 0, 0));
    g.addEdge('sm','s','m'); g.addEdge('mt','m','t'); g.addEdge('st','s','t');
    const { bendPoints } = sugiyamaLayout(g);
    for (const pts of bendPoints.values()) {
      for (const pt of pts) {
        assert.ok(typeof pt.x === 'number');
        assert.ok(typeof pt.y === 'number');
      }
    }
  });
});


// ── Bounding box ──────────────────────────────────────────────────────────────

describe('sugiyamaLayout — bounding box', () => {
  it('width and height are positive numbers', () => {
    const { width, height } = layout(
      [['a',40,20],['b',40,20]],
      [['ab','a','b']]
    );
    assert.ok(width > 0);
    assert.ok(height > 0);
  });

  it('width and height at least cover all node extents', () => {
    const { g, width, height } = layout(
      [['a',40,30],['b',40,30],['c',40,30]],
      [['ab','a','b'],['bc','b','c']]
    );
    for (const id of g.nodeIds) {
      assert.ok(g.node(id)._x + (g.node(id).width  ?? 0) / 2 <= width  + 1);
      assert.ok(g.node(id)._y + (g.node(id).height ?? 0) / 2 <= height + 1);
    }
  });

  it('wider nodes produce greater width', () => {
    const { width: w1 } = layout([['a',10,0],['b',10,0]], [['ab','a','b']]);
    const { width: w2 } = layout([['a',100,0],['b',100,0]], [['ab','a','b']]);
    assert.ok(w2 > w1);
  });

  it('more layers produce greater height', () => {
    const { height: h1 } = layout(
      [['a',0,0],['b',0,0]], [['ab','a','b']]);
    const { height: h2 } = layout(
      [['a',0,0],['b',0,0],['c',0,0]], [['ab','a','b'],['bc','b','c']]);
    assert.ok(h2 > h1);
  });
});


// ── layers array ──────────────────────────────────────────────────────────────

describe('sugiyamaLayout — layers array', () => {
  it('every real node appears in exactly one layer', () => {
    const { g, layers } = layout(
      [['s',0,0],['a',0,0],['b',0,0],['t',0,0]],
      [['sa','s','a'],['sb','s','b'],['at','a','t'],['bt','b','t']]
    );
    const all = layers.flat();
    assert.equal(all.length, g.nodeCount);
    assert.equal(new Set(all).size, g.nodeCount);
  });

  it('no empty layers in the returned array', () => {
    const { layers } = layout(
      [['a',0,0],['b',0,0],['c',0,0]],
      [['ab','a','b'],['bc','b','c']]
    );
    for (const layer of layers) {
      assert.ok(layer.length > 0, 'no empty layers');
    }
  });
});
