/**
 * Tests for dfg-layout.js — layoutDfg.
 *
 * Helpers build minimal DFG structures:
 *   mkGraph(pairs)  — Map<dfgKey, count>  from [[a,b,count], ...]
 *   mkSA(acts)      — startActivities Map (all count=1)
 *   mkEA(acts)      — endActivities Map   (all count=1)
 */

function mkGraph(pairs) {
  const m = new Map();
  for (const [a, b, c = 1] of pairs) m.set(dfgKey(a, b), c);
  return m;
}
function mkSA(acts) { const m = new Map(); for (const a of acts) m.set(a, 1); return m; }
function mkEA(acts) { const m = new Map(); for (const a of acts) m.set(a, 1); return m; }

// ── Return shape ──────────────────────────────────────────────────────────────

describe('layoutDfg — return shape', () => {
  it('returns nodes and ranks Maps', () => {
    const { nodes, ranks } = layoutDfg(mkGraph([['A','B']]), mkSA(['A']), mkEA(['B']));
    assert.ok(nodes instanceof Map, 'nodes is a Map');
    assert.ok(ranks instanceof Map, 'ranks is a Map');
  });

  it('every activity appears in nodes', () => {
    const { nodes } = layoutDfg(mkGraph([['A','B'],['B','C']]), mkSA(['A']), mkEA(['C']));
    assert.ok(nodes.has('A'));
    assert.ok(nodes.has('B'));
    assert.ok(nodes.has('C'));
  });

  it('every activity appears in ranks', () => {
    const { ranks } = layoutDfg(mkGraph([['A','B'],['B','C']]), mkSA(['A']), mkEA(['C']));
    assert.ok(ranks.has('A'));
    assert.ok(ranks.has('B'));
    assert.ok(ranks.has('C'));
  });

  it('node entries have x, y, width, height', () => {
    const { nodes } = layoutDfg(mkGraph([['A','B']]), mkSA(['A']), mkEA(['B']));
    const n = nodes.get('A');
    assert.ok(typeof n.x === 'number');
    assert.ok(typeof n.y === 'number');
    assert.ok(typeof n.width === 'number');
    assert.ok(typeof n.height === 'number');
  });

  it('node height is always 40', () => {
    const { nodes } = layoutDfg(mkGraph([['A','B'],['B','C']]), mkSA(['A']), mkEA(['C']));
    for (const [, n] of nodes) assert.equal(n.height, 40);
  });

  it('node width is at least 100', () => {
    const { nodes } = layoutDfg(mkGraph([['A','B']]), mkSA(['A']), mkEA(['B']));
    for (const [, n] of nodes) assert.ok(n.width >= 100);
  });
});

// ── Single activity ───────────────────────────────────────────────────────────

describe('layoutDfg — single activity', () => {
  it('single node with no edges gets positioned', () => {
    const { nodes } = layoutDfg(new Map(), mkSA(['A']), mkEA(['A']));
    assert.ok(nodes.has('A'));
    const n = nodes.get('A');
    assert.ok(typeof n.x === 'number');
    assert.ok(typeof n.y === 'number');
  });

  it('single node rank is a non-negative integer', () => {
    const { ranks } = layoutDfg(new Map(), mkSA(['A']), mkEA(['A']));
    assert.ok(Number.isInteger(ranks.get('A')) && ranks.get('A') >= 0);
  });
});

// ── Chain layout ──────────────────────────────────────────────────────────────

describe('layoutDfg — chain A→B→C', () => {
  function chain() {
    return layoutDfg(mkGraph([['A','B'],['B','C']]), mkSA(['A']), mkEA(['C']));
  }

  it('rank(A) < rank(B) < rank(C)', () => {
    const { ranks } = chain();
    assert.ok(ranks.get('A') < ranks.get('B'), 'A rank < B rank');
    assert.ok(ranks.get('B') < ranks.get('C'), 'B rank < C rank');
  });

  it('x(A) < x(B) < x(C) — left-to-right layout', () => {
    const { nodes } = chain();
    assert.ok(nodes.get('A').x < nodes.get('B').x, 'A x < B x');
    assert.ok(nodes.get('B').x < nodes.get('C').x, 'B x < C x');
  });
});

// ── End-activity pinning ──────────────────────────────────────────────────────

describe('layoutDfg — end-activity rank pinning', () => {
  it('end activity rank > all non-end ranks', () => {
    // Loop: A→B→C→A. Without pinning, 'C' might get a low rank.
    const graph = mkGraph([['A','B'],['B','C'],['C','A']]);
    const { ranks } = layoutDfg(graph, mkSA(['A']), mkEA(['C']));
    const cRank = ranks.get('C');
    for (const [act, r] of ranks) {
      if (act !== 'C') assert.ok(r <= cRank, `${act} rank (${r}) should be ≤ C rank (${cRank})`);
    }
  });

  it('two end activities both pinned beyond non-end activities', () => {
    const graph = mkGraph([['A','B'],['A','C'],['B','D'],['C','D']]);
    const { ranks } = layoutDfg(graph, mkSA(['A']), mkEA(['B','C']));
    const dRank = ranks.get('D');
    const bRank = ranks.get('B');
    const cRank = ranks.get('C');
    assert.ok(bRank > dRank, `B rank (${bRank}) > D rank (${dRank})`);
    assert.ok(cRank > dRank, `C rank (${cRank}) > D rank (${dRank})`);
  });
});

// ── Self-loops ────────────────────────────────────────────────────────────────

describe('layoutDfg — self-loop edges ignored', () => {
  it('self-loop A→A does not crash', () => {
    const graph = mkGraph([['A','A'],['A','B']]);
    const { nodes } = layoutDfg(graph, mkSA(['A']), mkEA(['B']));
    assert.ok(nodes.has('A'));
    assert.ok(nodes.has('B'));
  });

  it('self-loop activity still appears in output', () => {
    const graph = mkGraph([['A','A']]);
    const { nodes, ranks } = layoutDfg(graph, mkSA(['A']), mkEA(['A']));
    assert.ok(nodes.has('A'));
    assert.ok(ranks.has('A'));
  });
});

// ── Activities only in start/end maps ────────────────────────────────────────

describe('layoutDfg — activities from start/end maps only', () => {
  it('start activity with no outgoing edges appears in nodes', () => {
    const { nodes } = layoutDfg(new Map(), mkSA(['A']), mkEA(['B']));
    assert.ok(nodes.has('A'));
    assert.ok(nodes.has('B'));
  });
});

// ── Longer labels produce wider nodes ────────────────────────────────────────

describe('layoutDfg — node width from label', () => {
  it('longer activity name → wider node', () => {
    const graph = mkGraph([['A', 'register request and validate']]);
    const { nodes } = layoutDfg(graph, mkSA(['A']), mkEA(['register request and validate']));
    const short = nodes.get('A').width;
    const long  = nodes.get('register request and validate').width;
    assert.ok(long > short, `long label width (${long}) > short (${short})`);
  });
});

// ── Cyclic DFG ───────────────────────────────────────────────────────────────

describe('layoutDfg — cyclic DFG', () => {
  it('cycle A→B→A does not crash', () => {
    const graph = mkGraph([['A','B'],['B','A']]);
    const { nodes, ranks } = layoutDfg(graph, mkSA(['A']), mkEA(['B']));
    assert.ok(nodes.has('A'));
    assert.ok(nodes.has('B'));
    assert.ok(typeof ranks.get('A') === 'number');
    assert.ok(typeof ranks.get('B') === 'number');
  });

  it('running-example-like DFG with re-work loop does not crash', () => {
    const graph = mkGraph([
      ['register request', 'examine casually'],
      ['register request', 'examine thoroughly'],
      ['examine casually', 'check ticket'],
      ['examine thoroughly', 'check ticket'],
      ['check ticket', 'decide'],
      ['decide', 'pay compensation'],
      ['decide', 'reject request'],
      ['decide', 'reinitiate request'],
      ['reinitiate request', 'examine casually'],
      ['reinitiate request', 'examine thoroughly'],
    ]);
    const { nodes, ranks } = layoutDfg(
      graph,
      mkSA(['register request']),
      mkEA(['pay compensation', 'reject request']),
    );
    assert.ok(nodes.has('register request'));
    assert.ok(nodes.has('pay compensation'));
    assert.ok(nodes.has('reject request'));
    // End activities must have the highest rank
    const endRank = Math.max(ranks.get('pay compensation'), ranks.get('reject request'));
    for (const [act, r] of ranks) {
      if (act !== 'pay compensation' && act !== 'reject request') {
        assert.ok(r <= endRank, `${act} rank ${r} should be ≤ end rank ${endRank}`);
      }
    }
  });
});

// ── No overlapping x positions within any rank ────────────────────────────────

describe('layoutDfg — no overlapping nodes', () => {
  it('nodes at the same rank have distinct y positions', () => {
    // Diamond: A → B, A → C, B → D, C → D  (B and C share rank)
    const graph = mkGraph([['A','B'],['A','C'],['B','D'],['C','D']]);
    const { nodes, ranks } = layoutDfg(graph, mkSA(['A']), mkEA(['D']));
    // Collect y positions per rank
    const byRank = new Map();
    for (const [act, n] of nodes) {
      const r = ranks.get(act);
      if (!byRank.has(r)) byRank.set(r, []);
      byRank.get(r).push(n.y);
    }
    for (const [, ys] of byRank) {
      if (ys.length < 2) continue;
      const sorted = [...ys].sort((a, b) => a - b);
      for (let i = 1; i < sorted.length; i++) {
        assert.ok(sorted[i] > sorted[i - 1], `y positions not distinct: ${sorted}`);
      }
    }
  });
});
