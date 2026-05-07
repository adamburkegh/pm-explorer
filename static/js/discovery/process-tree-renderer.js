/**
 * Process tree visualiser — Tufte-style SVG rendering.
 *
 * Operator nodes are rendered as mathematical symbols with no border or
 * background; leaf nodes are plain text.  Thin grey lines connect levels
 * and are trimmed to stop short of each node's text.
 *
 * Van der Aalst operator notation:
 *   →  SEQUENCE
 *   ×  XOR  (exclusive choice)
 *   ∧  PARALLEL  (and)
 *   ↺  LOOP
 *   ∨  OR  (inclusive choice)
 */

const PT_SYMBOLS = {
  // lowercase — matches the JS inductive miner's operator names
  sequence: '→',
  xor:      '×',
  parallel: '∧',
  loop:     '↺',
  or:       '∨',
  // uppercase — matches pm4py's serialised operator names (server path)
  SEQUENCE: '→',
  XOR:      '×',
  PARALLEL: '∧',
  LOOP:     '↺',
  OR:       '∨',
};

// Layout constants
const PT_LEAF_WIDTH  = 90;   // minimum horizontal space per leaf
const PT_LEVEL_H     = 80;   // vertical distance between levels
const PT_PAD         = 32;   // canvas padding

// Style constants
const PT_OP_SIZE     = 20;   // operator symbol font size (px)
const PT_LEAF_SIZE   = 13;   // leaf label font size (px)
const PT_LINE_H      = Math.round(PT_LEAF_SIZE * 1.45);  // ~19px leading for wrapped lines
const PT_COLOR_OP    = '#333';
const PT_COLOR_LEAF  = '#111';
const PT_COLOR_TAU   = '#999';
const PT_COLOR_LINE  = '#ccc';
const PT_LINE_W      = 1.5;


// ── Layout ──────────────────────────────────────────────────────────────────

function ptLeaves(node) {
  if (!node.children || !node.children.length) return 1;
  return node.children.reduce((s, c) => s + ptLeaves(c), 0);
}

function ptDepth(node) {
  if (!node.children || !node.children.length) return 0;
  return 1 + Math.max(...node.children.map(ptDepth));
}

/**
 * Assign _x, _y, _w to every node.
 * @param {object} node
 * @param {number} cx   horizontal centre of the space allocated to this subtree
 * @param {number} y    vertical centre of this node
 * @param {number} w    horizontal space allocated to this subtree
 */
function ptLayout(node, cx, y, w) {
  node._x = cx;
  node._y = y;
  node._w = w;
  if (!node.children || !node.children.length) return;

  const leafCounts = node.children.map(ptLeaves);
  const total      = leafCounts.reduce((s, c) => s + c, 0);
  let x = cx - w / 2;
  node.children.forEach((child, i) => {
    const cw = (leafCounts[i] / total) * w;
    ptLayout(child, x + cw / 2, y + PT_LEVEL_H, cw);
    x += cw;
  });
}


// ── Text wrapping ────────────────────────────────────────────────────────────

/**
 * Wrap a label into lines that fit within maxWidth pixels.
 * Uses a rough character-width estimate (avoids needing a DOM pass).
 */
function ptWrapLabel(label, maxWidth) {
  // 13 px sans-serif ≈ 7 px average char width
  const charsPerLine = Math.max(5, Math.floor(maxWidth / 7));
  const words = label.split(' ');
  const lines = [];
  let cur = '';
  for (const word of words) {
    if (!cur) {
      cur = word;
    } else if ((cur + ' ' + word).length <= charsPerLine) {
      cur += ' ' + word;
    } else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}


// ── Prepare pass (annotates _lines, _textH, _gap on every node) ─────────────

/**
 * Must be called after ptLayout so that node._w is available.
 * Computes the text lines and the gap (half-text-height + margin) used to
 * trim connecting lines away from each node's label.
 */
function ptPrepare(node) {
  if (node.operator) {
    node._lines  = [PT_SYMBOLS[node.operator] ?? node.operator];
    node._isOp   = true;
    // Operator symbol rendered at PT_OP_SIZE; gap ≈ half that + margin
    node._gap    = Math.ceil(PT_OP_SIZE / 2) + 4;
  } else if (!node.label) {
    node._lines  = ['τ'];
    node._isTau  = true;
    node._gap    = Math.ceil(PT_LEAF_SIZE / 2) + 4;
  } else {
    node._lines  = ptWrapLabel(node.label, node._w - 6);
    node._isLeaf = true;
    // Gap = half the total text block height + margin
    node._gap    = Math.ceil((node._lines.length * PT_LINE_H) / 2) + 4;
  }
  node._textH = node._lines.length * PT_LINE_H;

  if (node.children) {
    for (const c of node.children) ptPrepare(c);
  }
}


// ── SVG helpers ──────────────────────────────────────────────────────────────

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}


// ── Render ───────────────────────────────────────────────────────────────────

/**
 * Draw edges trimmed so they stop short of each node's text.
 * ptPrepare must have been called first.
 */
function ptDrawEdges(node, svg) {
  if (!node.children) return;
  for (const child of node.children) {
    const dx  = child._x - node._x;
    const dy  = child._y - node._y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > 0) {
      const nx = dx / len;
      const ny = dy / len;
      svg.appendChild(svgEl('line', {
        x1: node._x  + nx * node._gap,
        y1: node._y  + ny * node._gap,
        x2: child._x - nx * child._gap,
        y2: child._y - ny * child._gap,
        stroke: PT_COLOR_LINE,
        'stroke-width': PT_LINE_W,
      }));
    }
    ptDrawEdges(child, svg);
  }
}

/**
 * Draw node labels.  Multi-line leaves use <tspan> elements; the whole
 * block is centred vertically on node._y.
 * ptPrepare must have been called first.
 */
function ptDrawNodes(node, svg) {
  // y of the first line's dominant-baseline midpoint, so the whole block
  // is vertically centred on node._y
  const firstLineY = node._y - (node._textH - PT_LINE_H) / 2;

  const text = svgEl('text', {
    x:                   node._x,
    y:                   firstLineY,
    'text-anchor':       'middle',
    'dominant-baseline': 'middle',
    'font-family':       'sans-serif',
    'font-size':         node._isOp ? PT_OP_SIZE : PT_LEAF_SIZE,
    'font-weight':       node._isOp ? 'bold' : 'normal',
    'font-style':        node._isTau ? 'italic' : 'normal',
    fill: node._isOp ? PT_COLOR_OP : (node._isTau ? PT_COLOR_TAU : PT_COLOR_LEAF),
  });

  node._lines.forEach((line, i) => {
    const tspan = document.createElementNS(SVG_NS, 'tspan');
    tspan.setAttribute('x', node._x);
    tspan.setAttribute('dy', i === 0 ? 0 : PT_LINE_H);
    tspan.textContent = line;
    text.appendChild(tspan);
  });

  svg.appendChild(text);

  if (node.children) {
    for (const c of node.children) ptDrawNodes(c, svg);
  }
}

/**
 * Render a process tree JSON object into a container element.
 * @param {object}  tree       Root node from /api/mine/inductive/tree
 * @param {Element} container  DOM element to render into (cleared first)
 */
function renderProcessTree(tree, container) {
  container.innerHTML = '';

  const leaves = ptLeaves(tree);
  const depth  = ptDepth(tree);
  const treeW  = leaves * PT_LEAF_WIDTH;
  const treeH  = depth  * PT_LEVEL_H;
  const svgW   = treeW + PT_PAD * 2;
  // Extra vertical room for wrapped labels at the bottom level
  const svgH   = treeH + PT_PAD * 2 + PT_LINE_H * 2;

  ptLayout(tree, PT_PAD + treeW / 2, PT_PAD, treeW);
  ptPrepare(tree);   // must follow ptLayout so _w is set

  const svg = svgEl('svg', {
    viewBox: `0 0 ${svgW} ${svgH}`,
    style: 'width:100%;height:100%;display:block;',
  });

  ptDrawEdges(tree, svg);   // edges behind nodes
  ptDrawNodes(tree, svg);

  container.appendChild(svg);
}
