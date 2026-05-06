/**
 * DfgRenderer — canvas renderer for Directly Follows Graphs.
 *
 * Handles pan/zoom internally.  Layout is supplied externally via setData()
 * (call layoutDfg() in the page, then pass the result here).
 *
 * Visual conventions:
 *   - Edge thickness ∝ frequency (1 px … 7 px)
 *   - Edge count label drawn at midpoint on a white pill
 *   - Unidirectional forward edges:    dark grey straight arrow
 *   - Bidirectional pairs (A↔B):       blue arrows, clearly paired
 *   - Back-edges (rank loops):         Bézier arc bowing above
 *   - Same-rank back-edges (bidi):     one bows left, one bows right
 *   - Self-loops:                      circle off right side of node
 *   - Green left stripe  → start activity
 *   - Red   right stripe → end activity
 */
class DfgRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');

    // Data (populated by setData)
    this.graph           = new Map();  // dfgKey  → count
    this.startActivities = new Map();  // label   → count
    this.endActivities   = new Map();  // label   → count
    this.nodes           = new Map();  // label   → {x, y, width, height}
    this.ranks           = new Map();  // label   → rank  (back-edge detection)
    this._maxCount       = 1;

    // Viewport
    this.panOffset  = { x: 0, y: 0 };
    this.zoomFactor = 1.0;
    this.minZoom    = 0.1;
    this.maxZoom    = 3.0;

    this.theme = {
      background:  '#ffffff',
      nodeFill:    '#f8f9fa',
      nodeStroke:  '#495057',
      startColor:  '#2e7d32',   // green left accent
      endColor:    '#c62828',   // red   right accent
      edgeColor:   '#555555',
      edgeLabelBg: '#ffffff',
      labelColor:  '#212529',
    };
  }

  // ── Data ─────────────────────────────────────────────────────────────────────

  /**
   * @param {Map<string,number>} graph           dfgKey → count
   * @param {Map<string,number>} startActivities
   * @param {Map<string,number>} endActivities
   * @param {Map<string,{x,y,width,height}>} nodes
   * @param {Map<string,number>} ranks
   */
  setData(graph, startActivities, endActivities, nodes, ranks) {
    this.graph           = graph;
    this.startActivities = startActivities;
    this.endActivities   = endActivities;
    this.nodes           = nodes;
    this.ranks           = ranks;
    this._maxCount       = graph.size ? Math.max(...graph.values()) : 1;
  }

  // ── Viewport ──────────────────────────────────────────────────────────────────

  adjustPan(dx, dy) {
    this.panOffset.x += dx;
    this.panOffset.y += dy;
  }

  setZoom(zoom, cx = 0, cy = 0) {
    const old = this.zoomFactor;
    const wx  = (cx - this.panOffset.x) / old;
    const wy  = (cy - this.panOffset.y) / old;
    this.zoomFactor  = Math.max(this.minZoom, Math.min(this.maxZoom, zoom));
    this.panOffset.x = cx - wx * this.zoomFactor;
    this.panOffset.y = cy - wy * this.zoomFactor;
  }

  adjustZoom(factor, cx, cy) { this.setZoom(this.zoomFactor * factor, cx, cy); }
  resetView()                 { this.panOffset = { x: 0, y: 0 }; this.zoomFactor = 1.0; }

  fitView(padding = 40) {
    const nodes = [...this.nodes.values()];
    if (!nodes.length) { this.resetView(); return; }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.x - n.width  / 2);
      minY = Math.min(minY, n.y - n.height / 2);
      maxX = Math.max(maxX, n.x + n.width  / 2);
      maxY = Math.max(maxY, n.y + n.height / 2);
    }
    const netW = maxX - minX || 1;
    const netH = maxY - minY || 1;
    const zoom = Math.min(
      (this.canvas.width  - padding * 2) / netW,
      (this.canvas.height - padding * 2) / netH,
      this.maxZoom
    );
    this.zoomFactor  = Math.max(this.minZoom, zoom);
    this.panOffset.x = padding - minX * this.zoomFactor;
    this.panOffset.y = padding - minY * this.zoomFactor;
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  render() {
    const { ctx, canvas, theme } = this;
    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(this.panOffset.x, this.panOffset.y);
    ctx.scale(this.zoomFactor, this.zoomFactor);
    this._drawEdges();
    this._drawNodes();
    ctx.restore();
  }

  // ── Edge helpers ──────────────────────────────────────────────────────────────

  /** Edge pixel thickness for a given frequency. */
  _thickness(count) { return 1 + (count / this._maxCount) * 6; }

  /**
   * Point on the rectangular border of `node` aimed toward (aimX, aimY).
   * Used to clip line/curve endpoints cleanly to node edges.
   */
  _border(node, aimX, aimY) {
    const dx = aimX - node.x;
    const dy = aimY - node.y;
    if (!dx && !dy) return { x: node.x, y: node.y };
    const hw = node.width  / 2;
    const hh = node.height / 2;
    if (Math.abs(dx) * hh > Math.abs(dy) * hw) {
      const s = dx > 0 ? 1 : -1;
      return { x: node.x + s * hw, y: node.y + dy * hw / Math.abs(dx) };
    }
    const s = dy > 0 ? 1 : -1;
    return { x: node.x + dx * hh / Math.abs(dy), y: node.y + s * hh };
  }

  _arrowhead(x, y, angle, size = 9) {
    const sp  = Math.PI / 6;
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - size * Math.cos(angle - sp), y - size * Math.sin(angle - sp));
    ctx.lineTo(x - size * Math.cos(angle + sp), y - size * Math.sin(angle + sp));
    ctx.closePath();
    ctx.fill();
  }

  _edgeLabel(count, x, y) {
    const ctx  = this.ctx;
    const text = count.toLocaleString();
    ctx.font = '10px Arial';
    const tw  = ctx.measureText(text).width;
    const pad = 2;
    ctx.fillStyle = this.theme.edgeLabelBg;
    ctx.fillRect(x - tw / 2 - pad, y - 6 - pad, tw + pad * 2, 12 + pad * 2);
    ctx.fillStyle    = '#333';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
  }

  // ── Edge drawing ──────────────────────────────────────────────────────────────

  _drawEdges() {
    for (const [key, count] of this.graph) {
      const [fl, tl] = dfgKeyParts(key);
      const from = this.nodes.get(fl);
      const to   = this.nodes.get(tl);
      if (!from || !to) continue;

      const isSelf = fl === tl;
      const fromRk = this.ranks.get(fl) ?? 0;
      const toRk   = this.ranks.get(tl) ?? 0;
      const isBack = !isSelf && toRk <= fromRk;

      this.ctx.strokeStyle = this.theme.edgeColor;
      this.ctx.fillStyle   = this.theme.edgeColor;
      this.ctx.lineWidth   = this._thickness(count);

      if (isSelf)      { this._drawSelfLoop(from, count); }
      else if (isBack) { this._drawBackEdge(from, to, fl, tl, count); }
      else             { this._drawForwardEdge(from, to, count); }
    }
  }

  _drawForwardEdge(from, to, count) {
    const ctx   = this.ctx;
    const start = this._border(from, to.x,   to.y);
    const end   = this._border(to,   from.x, from.y);

    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x,   end.y);
    ctx.stroke();

    this._arrowhead(end.x, end.y, Math.atan2(end.y - start.y, end.x - start.x));
    this._edgeLabel(count, (start.x + end.x) / 2, (start.y + end.y) / 2);
  }

  _drawBackEdge(from, to, fl, tl, count) {
    const ctx    = this.ctx;
    const fromRk = this.ranks.get(fl) ?? 0;
    const toRk   = this.ranks.get(tl) ?? 0;

    let cpX, cpY;

    if (fromRk === toRk) {
      // ── Same-rank edge: nodes are stacked vertically in the same column.
      // Bow horizontally so bidirectional pairs don't overlap.
      // Stable rule: "lower" label (lexicographic) bows LEFT, "upper" bows RIGHT.
      const bowLeft = fl < tl;
      const bowDist = Math.max(70, Math.abs(from.y - to.y) * 0.7);
      cpX = from.x + (bowLeft ? -bowDist : bowDist);
      cpY = (from.y + to.y) / 2;
    } else {
      // ── Cross-rank back-edge: bow upward above both nodes.
      // Height scales with horizontal span to avoid clipping.
      cpX = (from.x + to.x) / 2;
      cpY = Math.min(from.y, to.y) - Math.max(70, Math.abs(from.x - to.x) * 0.45);
    }

    const start = this._border(from, cpX, cpY);
    const end   = this._border(to,   cpX, cpY);

    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.quadraticCurveTo(cpX, cpY, end.x, end.y);
    ctx.stroke();

    // Tangent at t=1 of quadratic Bézier: direction from CP → end
    this._arrowhead(end.x, end.y, Math.atan2(end.y - cpY, end.x - cpX));

    // Label at Bézier midpoint t=0.5: 0.25·P0 + 0.5·CP + 0.25·P1
    this._edgeLabel(count,
      0.25 * start.x + 0.5 * cpX + 0.25 * end.x,
      0.25 * start.y + 0.5 * cpY + 0.25 * end.y);
  }

  _drawSelfLoop(node, count) {
    const ctx = this.ctx;
    const r   = 15;
    const cx  = node.x + node.width / 2 + r;
    const cy  = node.y;

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    this._arrowhead(cx - r, cy, Math.PI / 2, 8);
    this._edgeLabel(count, cx, cy - r - 7);
  }

  // ── Node drawing ──────────────────────────────────────────────────────────────

  _drawNodes() {
    const ctx = this.ctx;
    for (const [label, node] of this.nodes) {
      const { x, y, width, height } = node;
      const isStart = this.startActivities.has(label);
      const isEnd   = this.endActivities.has(label);
      const cr      = 5; // corner radius

      // Background fill
      ctx.beginPath();
      ctx.roundRect(x - width / 2, y - height / 2, width, height, cr);
      ctx.fillStyle   = this.theme.nodeFill;
      ctx.fill();
      ctx.strokeStyle = this.theme.nodeStroke;
      ctx.lineWidth   = 1.5;
      ctx.stroke();

      // Green left stripe — start activity
      if (isStart) {
        ctx.beginPath();
        ctx.roundRect(x - width / 2, y - height / 2, 5, height, [cr, 0, 0, cr]);
        ctx.fillStyle = this.theme.startColor;
        ctx.fill();
      }

      // Red right stripe — end activity
      if (isEnd) {
        ctx.beginPath();
        ctx.roundRect(x + width / 2 - 5, y - height / 2, 5, height, [0, cr, cr, 0]);
        ctx.fillStyle = this.theme.endColor;
        ctx.fill();
      }

      // Label — centred, clipped to available width inside accent stripes
      const inset  = (isStart ? 5 : 0) + (isEnd ? 5 : 0) + 8;
      const shiftX = (isStart ? 2.5 : 0) - (isEnd ? 2.5 : 0);
      ctx.fillStyle    = this.theme.labelColor;
      ctx.font         = '12px Arial';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x + shiftX, y, width - inset);
    }
  }
}

// ── DfgViewer ─────────────────────────────────────────────────────────────────
//
// Thin shell: pan/zoom event wiring + ResizeObserver, mirroring the
// PetriNetViewer pattern so the DFG tab behaves identically to Alpha / IM tabs.

class DfgViewer {
  constructor(canvas) {
    this.canvas   = canvas;
    this.renderer = new DfgRenderer(canvas);

    this._isPanning = false;
    this._lastPan   = null;

    this._bindEvents();
    this._bindResize();
    this._syncSize();
  }

  /** Load layout data and fit the view. */
  load(graph, startActivities, endActivities, nodes, ranks) {
    this.renderer.setData(graph, startActivities, endActivities, nodes, ranks);
    this.fitView();
  }

  fitView(padding = 40) {
    this._syncSize();
    this.renderer.fitView(padding);
    this.render();
  }

  render() { this.renderer.render(); }

  _syncSize() {
    const c    = this.canvas;
    const rect = c.getBoundingClientRect();
    if (rect.width && rect.height) {
      c.width  = rect.width;
      c.height = rect.height;
    }
  }

  _bindEvents() {
    const c = this.canvas;

    c.addEventListener('wheel', e => {
      e.preventDefault();
      const rect   = c.getBoundingClientRect();
      const cx     = (e.clientX - rect.left)  * (c.width  / rect.width);
      const cy     = (e.clientY - rect.top)   * (c.height / rect.height);
      this.renderer.adjustZoom(e.deltaY < 0 ? 1.1 : 1 / 1.1, cx, cy);
      this.render();
    }, { passive: false });

    c.addEventListener('mousedown', e => {
      if (e.button === 0 || e.button === 1) {
        this._isPanning = true;
        this._lastPan   = { x: e.clientX, y: e.clientY };
        c.style.cursor  = 'grabbing';
        e.preventDefault();
      }
    });

    window.addEventListener('mousemove', e => {
      if (!this._isPanning) return;
      this.renderer.adjustPan(e.clientX - this._lastPan.x, e.clientY - this._lastPan.y);
      this._lastPan = { x: e.clientX, y: e.clientY };
      this.render();
    });

    window.addEventListener('mouseup', () => {
      if (this._isPanning) { this._isPanning = false; this.canvas.style.cursor = ''; }
    });
  }

  _bindResize() {
    new ResizeObserver(() => { this._syncSize(); this.render(); }).observe(this.canvas);
  }
}
