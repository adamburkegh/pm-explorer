/**
 * Tests for process-tree-renderer.js — pure layout/text functions only.
 *
 * DOM-dependent functions (svgEl, ptDrawEdges, ptDrawNodes, renderProcessTree)
 * are not tested here because they require a live SVG context.  The pure
 * functions cover the entire computational surface:
 *   ptLeaves   — leaf count
 *   ptDepth    — tree depth
 *   ptLayout   — coordinate assignment
 *   ptWrapLabel — line-wrapping heuristic
 *   ptPrepare  — annotation pass (_lines, _textH, _gap, _isOp / _isLeaf / _isTau)
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a leaf node. */
function leaf(label) { return { label }; }

/** Build an operator node. */
function op(operator, ...children) { return { operator, children }; }

/** Tau (silent) node — no label, no operator. */
function tau() { return {}; }

// Run ptLayout + ptPrepare together (ptPrepare requires _w set by ptLayout).
function layoutAndPrepare(tree, cx = 200, y = 40, w = 400) {
  ptLayout(tree, cx, y, w);
  ptPrepare(tree);
  return tree;
}


// ── ptLeaves ─────────────────────────────────────────────────────────────────

describe('ptLeaves', () => {
  it('single leaf node returns 1', () => {
    assert.equal(ptLeaves(leaf('A')), 1);
  });

  it('node with empty children array returns 1', () => {
    assert.equal(ptLeaves({ label: 'A', children: [] }), 1);
  });

  it('tau node (no label, no children) returns 1', () => {
    assert.equal(ptLeaves(tau()), 1);
  });

  it('operator with two leaves returns 2', () => {
    assert.equal(ptLeaves(op('sequence', leaf('A'), leaf('B'))), 2);
  });

  it('operator with three leaves returns 3', () => {
    assert.equal(ptLeaves(op('xor', leaf('A'), leaf('B'), leaf('C'))), 3);
  });

  it('nested tree sums leaf counts correctly', () => {
    // →(A, ×(B, C), D)  → 4 leaves
    const tree = op('sequence', leaf('A'), op('xor', leaf('B'), leaf('C')), leaf('D'));
    assert.equal(ptLeaves(tree), 4);
  });

  it('deeply nested single branch returns 1', () => {
    const tree = op('sequence', op('sequence', leaf('A')));
    assert.equal(ptLeaves(tree), 1);
  });
});


// ── ptDepth ──────────────────────────────────────────────────────────────────

describe('ptDepth', () => {
  it('single leaf returns depth 0', () => {
    assert.equal(ptDepth(leaf('A')), 0);
  });

  it('tau node returns depth 0', () => {
    assert.equal(ptDepth(tau()), 0);
  });

  it('single operator level returns depth 1', () => {
    assert.equal(ptDepth(op('sequence', leaf('A'), leaf('B'))), 1);
  });

  it('two operator levels returns depth 2', () => {
    const tree = op('sequence', leaf('A'), op('xor', leaf('B'), leaf('C')));
    assert.equal(ptDepth(tree), 2);
  });

  it('picks the longest branch', () => {
    // left branch: depth 1, right branch: depth 2 → overall 3
    const tree = op('sequence',
      op('xor', leaf('A'), leaf('B')),
      op('sequence', op('parallel', leaf('C'), leaf('D')), leaf('E'))
    );
    assert.equal(ptDepth(tree), 3);
  });

  it('node with empty children treated as leaf (depth 0)', () => {
    assert.equal(ptDepth({ label: 'A', children: [] }), 0);
  });
});


// ── ptLayout ─────────────────────────────────────────────────────────────────

describe('ptLayout', () => {
  it('assigns _x, _y, _w to a single node', () => {
    const node = leaf('A');
    ptLayout(node, 100, 50, 200);
    assert.equal(node._x, 100);
    assert.equal(node._y, 50);
    assert.equal(node._w, 200);
  });

  it('two equal-weight children split the width evenly', () => {
    const tree = op('sequence', leaf('A'), leaf('B'));
    ptLayout(tree, 200, 40, 400);
    const [a, b] = tree.children;
    // Left child centred in left half, right child in right half
    assert.closeTo(a._x, 100, 1e-9);
    assert.closeTo(b._x, 300, 1e-9);
    assert.equal(a._w, 200);
    assert.equal(b._w, 200);
  });

  it('children are placed one PT_LEVEL_H below the parent', () => {
    const tree = op('sequence', leaf('A'), leaf('B'));
    ptLayout(tree, 200, 40, 400);
    for (const child of tree.children) {
      assert.equal(child._y, 40 + PT_LEVEL_H);
    }
  });

  it('three equal-weight children divide width into thirds', () => {
    const tree = op('xor', leaf('A'), leaf('B'), leaf('C'));
    ptLayout(tree, 300, 40, 600);
    const [a, b, c] = tree.children;
    assert.closeTo(a._w, 200, 1e-9);
    assert.closeTo(b._w, 200, 1e-9);
    assert.closeTo(c._w, 200, 1e-9);
    assert.closeTo(a._x, 100, 1e-9);
    assert.closeTo(b._x, 300, 1e-9);
    assert.closeTo(c._x, 500, 1e-9);
  });

  it('unequal leaf counts produce proportional widths', () => {
    // left subtree has 1 leaf, right has 3 → widths 1:3
    const tree = op('sequence', leaf('A'), op('xor', leaf('B'), leaf('C'), leaf('D')));
    ptLayout(tree, 200, 40, 400);
    const [left, right] = tree.children;
    assert.closeTo(left._w,  100, 1e-9);
    assert.closeTo(right._w, 300, 1e-9);
  });

  it('nested layout recurses into grandchildren', () => {
    const tree = op('sequence', leaf('A'), op('xor', leaf('B'), leaf('C')));
    ptLayout(tree, 200, 40, 400);
    const [, right] = tree.children;
    assert.ok(right._w > 0, 'right subtree has width');
    for (const gc of right.children) {
      assert.equal(gc._y, 40 + PT_LEVEL_H * 2);
      assert.ok(Number.isFinite(gc._x), 'grandchild has finite _x');
    }
  });

  it('total child widths sum to parent width', () => {
    const tree = op('parallel', leaf('A'), leaf('B'), leaf('C'), leaf('D'));
    ptLayout(tree, 200, 40, 400);
    const total = tree.children.reduce((s, c) => s + c._w, 0);
    assert.closeTo(total, 400, 1e-9);
  });
});


// ── ptWrapLabel ──────────────────────────────────────────────────────────────

describe('ptWrapLabel', () => {
  it('short label fits on one line', () => {
    const lines = ptWrapLabel('Hello', 200);
    assert.equal(lines.length, 1);
    assert.equal(lines[0], 'Hello');
  });

  it('single long word stays on one line', () => {
    const lines = ptWrapLabel('Superlongactivityname', 50);
    assert.equal(lines.length, 1);
  });

  it('two words that fit on one line are not split', () => {
    const lines = ptWrapLabel('register request', 200);
    assert.equal(lines.length, 1);
    assert.equal(lines[0], 'register request');
  });

  it('wraps when combined length exceeds chars-per-line', () => {
    // 7px/char → 10 chars per 70px; "hello world" is 11 chars → should wrap
    const lines = ptWrapLabel('hello world', 70);
    assert.equal(lines.length, 2);
    assert.equal(lines[0], 'hello');
    assert.equal(lines[1], 'world');
  });

  it('respects minimum 5 chars per line even with tiny maxWidth', () => {
    const lines = ptWrapLabel('AB CD', 1);   // maxWidth=1 → floor(1/7)=0 → clamped to 5
    // "AB" (2) fits in 5, "AB CD" (5) also fits in 5 → single line
    assert.equal(lines.length, 1);
  });

  it('multi-word label wraps into multiple lines', () => {
    // 90px → ~12 chars per line; "examine thoroughly before deciding" > 12
    const lines = ptWrapLabel('examine thoroughly before deciding', 90);
    assert.ok(lines.length > 1);
    // All words accounted for
    assert.equal(lines.join(' '), 'examine thoroughly before deciding');
  });

  it('empty string returns an empty array (empty labels do not arise in practice)', () => {
    // The trailing `if (cur)` guard skips the empty string — zero lines returned.
    const lines = ptWrapLabel('', 200);
    assert.equal(lines.length, 0);
  });
});


// ── ptPrepare ────────────────────────────────────────────────────────────────

describe('ptPrepare', () => {
  it('operator node gets symbol line and _isOp flag', () => {
    const node = layoutAndPrepare(op('sequence', leaf('A'), leaf('B')));
    assert.equal(node._lines.length, 1);
    assert.equal(node._lines[0], PT_SYMBOLS.sequence);
    assert.equal(node._isOp, true);
    assert.ok(!node._isLeaf);
    assert.ok(!node._isTau);
  });

  it('all operator types map to their symbol', () => {
    for (const [type, sym] of Object.entries(PT_SYMBOLS)) {
      const node = layoutAndPrepare(op(type, leaf('A')));
      assert.equal(node._lines[0], sym, `${type} should map to ${sym}`);
    }
  });

  it('unknown operator falls back to the operator string itself', () => {
    const node = layoutAndPrepare(op('custom', leaf('A')));
    assert.equal(node._lines[0], 'custom');
  });

  it('tau node (no label) gets τ line and _isTau flag', () => {
    const node = layoutAndPrepare(tau());
    assert.equal(node._lines[0], 'τ');
    assert.equal(node._isTau, true);
    assert.ok(!node._isOp);
    assert.ok(!node._isLeaf);
  });

  it('leaf node gets _isLeaf flag and label lines', () => {
    const node = layoutAndPrepare(leaf('register request'));
    assert.equal(node._isLeaf, true);
    assert.ok(!node._isOp);
    assert.ok(!node._isTau);
    assert.equal(node._lines.join(' '), 'register request');
  });

  it('_textH equals lines.length × PT_LINE_H', () => {
    const node = layoutAndPrepare(leaf('A'));
    assert.equal(node._textH, node._lines.length * PT_LINE_H);
  });

  it('operator _gap is ceil(PT_OP_SIZE / 2) + 4', () => {
    const node = layoutAndPrepare(op('xor', leaf('A')));
    assert.equal(node._gap, Math.ceil(PT_OP_SIZE / 2) + 4);
  });

  it('tau/leaf _gap is ceil(PT_LEAF_SIZE / 2) + 4', () => {
    const tauNode = layoutAndPrepare(tau());
    assert.equal(tauNode._gap, Math.ceil(PT_LEAF_SIZE / 2) + 4);

    const leafNode = layoutAndPrepare(leaf('A'));
    // single-line leaf: same as tau gap base, but computed from line count
    assert.equal(leafNode._gap, Math.ceil((1 * PT_LINE_H) / 2) + 4);
  });

  it('recurses into children', () => {
    const tree = layoutAndPrepare(op('sequence', leaf('A'), op('xor', leaf('B'), leaf('C'))));
    const [a, right] = tree.children;
    assert.ok(a._lines, 'first child prepared');
    assert.ok(right._lines, 'second child prepared');
    for (const gc of right.children) {
      assert.ok(gc._lines, 'grandchild prepared');
    }
  });

  it('multi-line leaf _textH reflects wrapped line count', () => {
    // Force wrapping with a narrow node (_w set by ptLayout)
    const wide = leaf('examine thoroughly before deciding');
    ptLayout(wide, 45, 40, 90);   // 90px → wraps into multiple lines
    ptPrepare(wide);
    assert.ok(wide._lines.length > 1, 'label wraps');
    assert.equal(wide._textH, wide._lines.length * PT_LINE_H);
  });
});
