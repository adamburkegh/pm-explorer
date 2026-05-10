/**
 * Tests for layout/coordinates.js — assignCoordinates
 */

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Run the full pipeline up to coordinate assignment and return graph + layers. */
function pipelineFull(nodes, edges, opts) {
  const g = new LayoutGraph();
  for (const [id, w, h] of nodes) g.addNode(id, w, h);
  for (const [id, s, t] of edges) g.addEdge(id, s, t);
  removeCycles(g);
  assignRanks(g);
  const layers = buildLayers(g);
  insertDummyNodes(g, layers);
  minimizeCrossings(g, layers);
  assignCoordinates(g, layers, opts);
  return { g, layers };
}

/** True when no two nodes in the same layer overlap horizontally. */
function noHorizontalOverlaps(g, layers, gap) {
  const minGap = gap ?? 0;
  for (const layer of layers) {
    const sorted = [...layer].sort((a, b) => g.node(a)._x - g.node(b)._x);
    for (let i = 1; i < sorted.length; i++) {
      const left  = sorted[i - 1];
      const right = sorted[i];
      const leftEdge  = g.node(left)._x  + (g.node(left).width  ?? 0) / 2;
      const rightEdge = g.node(right)._x - (g.node(right).width ?? 0) / 2;
      if (rightEdge < leftEdge - minGap) return false;
    }
  }
  return true;
}


// ── Basic properties ──────────────────────────────────────────────────────────

describe('assignCoordinates — basic properties', () => {
  it('single node gets _x and _y', () => {
    const { g } = pipelineFull([['a', 0, 0]], []);
    assert.ok(typeof g.node('a')._x === 'number');
    assert.ok(typeof g.node('a')._y === 'number');
  });

  it('single node respects margin', () => {
    const { g } = pipelineFull([['a', 0, 0]], [], { marginX: 50, marginY: 40 });
    assert.ok(g.node('a')._x >= 50);
    assert.ok(g.node('a')._y >= 40);
  });

  it('every node receives _x and _y', () => {
    const { g } = pipelineFull(
      [['s',0,0],['a',0,0],['b',0,0],['t',0,0]],
      [['sa','s','a'],['sb','s','b'],['at','a','t'],['bt','b','t']]
    );
    for (const id of g.nodeIds) {
      assert.ok(typeof g.node(id)._x === 'number', `${id}._x missing`);
      assert.ok(typeof g.node(id)._y === 'number', `${id}._y missing`);
    }
  });
});


// ── y coordinates ─────────────────────────────────────────────────────────────

describe('assignCoordinates — y coordinates', () => {
  it('nodes at the same rank share the same _y', () => {
    const { g } = pipelineFull(
      [['s',0,0],['a',0,0],['b',0,0],['t',0,0]],
      [['sa','s','a'],['sb','s','b'],['at','a','t'],['bt','b','t']]
    );
    assert.equal(g.node('a')._y, g.node('b')._y);
  });

  it('successive layers have strictly increasing _y', () => {
    const { g } = pipelineFull(
      [['a',0,0],['b',0,0],['c',0,0]],
      [['ab','a','b'],['bc','b','c']]
    );
    assert.ok(g.node('b')._y > g.node('a')._y);
    assert.ok(g.node('c')._y > g.node('b')._y);
  });

  it('rankSepY option increases row spacing', () => {
    const { g: g1 } = pipelineFull(
      [['a',0,0],['b',0,0]], [['ab','a','b']], { rankSepY: 40 });
    const { g: g2 } = pipelineFull(
      [['a',0,0],['b',0,0]], [['ab','a','b']], { rankSepY: 120 });
    const gap1 = g1.node('b')._y - g1.node('a')._y;
    const gap2 = g2.node('b')._y - g2.node('a')._y;
    assert.ok(gap2 > gap1);
  });

  it('node height contributes to row spacing', () => {
    const { g: gTall  } = pipelineFull([['a',0,60],['b',0,60]], [['ab','a','b']], { rankSepY: 20 });
    const { g: gShort } = pipelineFull([['a',0,10],['b',0,10]], [['ab','a','b']], { rankSepY: 20 });
    const gapTall  = gTall.node('b')._y  - gTall.node('a')._y;
    const gapShort = gShort.node('b')._y - gShort.node('a')._y;
    assert.ok(gapTall > gapShort);
  });
});


// ── x coordinates ─────────────────────────────────────────────────────────────

describe('assignCoordinates — x coordinates', () => {
  it('nodes in the same layer have distinct _x when separated', () => {
    const { g } = pipelineFull(
      [['s',40,0],['a',40,0],['b',40,0],['t',40,0]],
      [['sa','s','a'],['sb','s','b'],['at','a','t'],['bt','b','t']],
      { nodeSepX: 10 }
    );
    assert.notEqual(g.node('a')._x, g.node('b')._x);
  });

  it('no horizontal overlaps in any layer', () => {
    const { g, layers } = pipelineFull(
      [['s',40,0],['a',40,0],['b',40,0],['c',40,0],['t',40,0]],
      [['sa','s','a'],['sb','s','b'],['sc','s','c'],
       ['at','a','t'],['bt','b','t'],['ct','c','t']],
      { nodeSepX: 10 }
    );
    assert.ok(noHorizontalOverlaps(g, layers, 10));
  });

  it('nodeSepX increases spacing between nodes', () => {
    const { g: g1 } = pipelineFull(
      [['a',0,0],['b',0,0],['c',0,0]],
      [['ab','a','b']],   // c is isolated at rank 0 alongside a
      { nodeSepX: 10 }
    );
    // With a wider sep the positions should be further apart
    // Use a simple two-node same-layer case
    const g3 = new LayoutGraph();
    g3.addNode('p', 0, 0); g3.addNode('q', 0, 0);
    g3.node('p')._rank = 0; g3.node('q')._rank = 0;
    const layers3 = [['p','q']];
    assignCoordinates(g3, layers3, { nodeSepX: 10 });
    const gap10 = Math.abs(g3.node('q')._x - g3.node('p')._x);

    const g4 = new LayoutGraph();
    g4.addNode('p', 0, 0); g4.addNode('q', 0, 0);
    g4.node('p')._rank = 0; g4.node('q')._rank = 0;
    const layers4 = [['p','q']];
    assignCoordinates(g4, layers4, { nodeSepX: 50 });
    const gap50 = Math.abs(g4.node('q')._x - g4.node('p')._x);

    assert.ok(gap50 > gap10, `nodeSepX=50 (${gap50}) should give wider spacing than nodeSepX=10 (${gap10})`);
  });

  it('chain: source x ≈ target x (single path, should align)', () => {
    const { g } = pipelineFull(
      [['a',0,0],['b',0,0],['c',0,0]],
      [['ab','a','b'],['bc','b','c']]
    );
    // With a single chain, all nodes should have roughly the same x
    assert.closeTo(g.node('a')._x, g.node('b')._x, 1);
    assert.closeTo(g.node('b')._x, g.node('c')._x, 1);
  });

  it('diamond source and sink are horizontally centred over middle nodes', () => {
    const { g } = pipelineFull(
      [['s',0,0],['l',0,0],['r',0,0],['t',0,0]],
      [['sl','s','l'],['sr','s','r'],['lt','l','t'],['rt','r','t']]
    );
    // s and t should be between l and r
    const midX = (g.node('l')._x + g.node('r')._x) / 2;
    assert.closeTo(g.node('s')._x, midX, 1);
    assert.closeTo(g.node('t')._x, midX, 1);
  });
});


// ── Edge cases ────────────────────────────────────────────────────────────────

describe('assignCoordinates — edge cases', () => {
  it('empty graph: no-op (does not throw)', () => {
    const g = new LayoutGraph();
    assignCoordinates(g, []);   // should not throw
  });

  it('disconnected graph: all nodes get coordinates', () => {
    const { g } = pipelineFull(
      [['a',0,0],['b',0,0],['c',0,0],['d',0,0]],
      [['ab','a','b'],['cd','c','d']]
    );
    for (const id of ['a','b','c','d']) {
      assert.ok(typeof g.node(id)._x === 'number');
      assert.ok(typeof g.node(id)._y === 'number');
    }
  });

  it('node widths affect horizontal placement', () => {
    const g1 = new LayoutGraph();
    g1.addNode('a', 10, 0); g1.addNode('b', 10, 0);
    g1.node('a')._rank = 0; g1.node('b')._rank = 0;
    assignCoordinates(g1, [['a','b']], { nodeSepX: 10 });
    const narrow = Math.abs(g1.node('b')._x - g1.node('a')._x);

    const g2 = new LayoutGraph();
    g2.addNode('a', 100, 0); g2.addNode('b', 100, 0);
    g2.node('a')._rank = 0; g2.node('b')._rank = 0;
    assignCoordinates(g2, [['a','b']], { nodeSepX: 10 });
    const wide = Math.abs(g2.node('b')._x - g2.node('a')._x);

    assert.ok(wide > narrow);
  });
});
