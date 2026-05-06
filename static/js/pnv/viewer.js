/**
 * PetriNetViewer — minimal read-only viewer for Petri nets.
 *
 * Wraps PetriNetRenderer with:
 *   - pan  (left-drag or middle-drag)
 *   - zoom (scroll wheel)
 *   - fit-to-view on load
 *   - canvas auto-resize via ResizeObserver
 *   - drag-to-move nodes (places and transitions)
 *   - optional click-to-fire for interactive simulation
 *
 * Usage:
 *   const viewer = new PetriNetViewer(canvasElement);
 *   viewer.load(petriNet);            // accepts a PetriNet instance or JSON
 *   viewer.fitView();
 */
class PetriNetViewer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} [options]
   * @param {boolean} [options.interactive=false] - enable click-to-fire transitions
   * @param {function} [options.onFire]           - callback(transitionId) after firing
   * @param {function} [options.onStep]           - callback(net) after any state change
   */
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.options = { interactive: false, showTokens: false, showFinalMarking: false, ...options };

    this.net = new PetriNet(PetriNet.generateId());
    this.renderer = new PetriNetRenderer(canvas, this.net);
    this.renderer.showTokens = this.options.showTokens;
    this.renderer.showFinalMarking = this.options.showFinalMarking;

    this._isPanning = false;
    this._lastPan   = null;

    // Drag-to-move state
    this._dragNode   = null;  // { node, offsetX, offsetY }
    this._dragMoved  = false;

    this._bindEvents();
    this._bindResize();
    this._syncSize();
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Load a PetriNet instance or plain JSON object/string.
   * @param {PetriNet|object|string} net
   */
  load(net) {
    if (net instanceof PetriNet) {
      this.net = net;
    } else {
      this.net = PetriNet.fromJSON(net);
    }
    this.renderer.petriNet = this.net;
    this.net.updateEnabledTransitions();
    this.fitView();
  }

  /** Pan/zoom so all nodes fill the canvas. */
  fitView(padding = 40) {
    this._syncSize();
    this.renderer.fitView(padding);
    this.render();
  }

  /** Redraw the canvas. */
  render() {
    this.renderer.render();
  }

  /** Apply a partial theme object. */
  setTheme(theme) {
    this.renderer.setTheme(theme);
    this.render();
  }

  /** Show or hide token counts on places. */
  setShowTokens(show) {
    this.renderer.showTokens = show;
    this.render();
  }

  // ── Hit-testing ─────────────────────────────────────────────────────────────

  /**
   * Returns the first net node (place or transition) under the world-space point,
   * or null if nothing is hit.
   */
  _hitNode(world) {
    // Check transitions (rectangles)
    for (const [, t] of this.net.transitions) {
      if (world.x >= t.position.x - t.width  / 2 &&
          world.x <= t.position.x + t.width  / 2 &&
          world.y >= t.position.y - t.height / 2 &&
          world.y <= t.position.y + t.height / 2) {
        return t;
      }
    }
    // Check places (circles — radius lives on the place object)
    for (const [, p] of this.net.places) {
      const r  = p.radius ?? 20;
      const dx = world.x - p.position.x;
      const dy = world.y - p.position.y;
      if (dx * dx + dy * dy <= r * r) return p;
    }
    return null;
  }

  // ── Event wiring ────────────────────────────────────────────────────────────

  _bindEvents() {
    const c = this.canvas;

    c.addEventListener('wheel', e => {
      e.preventDefault();
      const rect = c.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      this.renderer.adjustZoom(factor, cx * (c.width / rect.width), cy * (c.height / rect.height));
      this.render();
    }, { passive: false });

    c.addEventListener('mousedown', e => {
      if (e.button === 1) {
        // Middle-button: always pan
        this._isPanning = true;
        this._lastPan   = { x: e.clientX, y: e.clientY };
        c.style.cursor  = 'grabbing';
        e.preventDefault();
        return;
      }

      if (e.button === 0) {
        const rect  = c.getBoundingClientRect();
        const sx    = e.clientX - rect.left;
        const sy    = e.clientY - rect.top;
        const world = this.renderer.screenToWorld(sx, sy);
        const node  = this._hitNode(world);

        if (node) {
          // Drag the node
          this._dragNode  = {
            node,
            offsetX: world.x - node.position.x,
            offsetY: world.y - node.position.y,
          };
          this._dragMoved = false;
          c.style.cursor  = 'grab';
          e.preventDefault();
        } else if (this.options.interactive) {
          // Interactive mode with no node hit — pass to click handler (may fire or pan)
          this._handleClick(e);
        } else {
          // Non-interactive: pan
          this._isPanning = true;
          this._lastPan   = { x: e.clientX, y: e.clientY };
          c.style.cursor  = 'grabbing';
          e.preventDefault();
        }
      }
    });

    window.addEventListener('mousemove', e => {
      if (this._dragNode) {
        const rect  = this.canvas.getBoundingClientRect();
        const sx    = e.clientX - rect.left;
        const sy    = e.clientY - rect.top;
        const world = this.renderer.screenToWorld(sx, sy);
        this._dragNode.node.position.x = world.x - this._dragNode.offsetX;
        this._dragNode.node.position.y = world.y - this._dragNode.offsetY;
        this._dragMoved = true;
        this.render();
        return;
      }

      if (!this._isPanning) return;
      const dx = e.clientX - this._lastPan.x;
      const dy = e.clientY - this._lastPan.y;
      this._lastPan = { x: e.clientX, y: e.clientY };
      this.renderer.adjustPan(dx, dy);
      this.render();
    });

    window.addEventListener('mouseup', e => {
      if (this._dragNode) {
        // Short tap with no movement in interactive mode → fire transition
        if (!this._dragMoved && this.options.interactive) {
          const node = this._dragNode.node;
          // Only transitions are fireable — check by presence in net.transitions
          for (const [id, t] of this.net.transitions) {
            if (t === node) {
              if (this.net.fireTransition(id)) {
                this.net.updateEnabledTransitions();
                this.render();
                if (this.options.onFire) this.options.onFire(id, t, this.net);
                if (this.options.onStep) this.options.onStep(this.net);
              }
              break;
            }
          }
        }
        this._dragNode  = null;
        this._dragMoved = false;
        this.canvas.style.cursor = this.options.interactive ? 'pointer' : '';
        return;
      }

      if (this._isPanning) {
        this._isPanning = false;
        this.canvas.style.cursor = this.options.interactive ? 'pointer' : 'grab';
      }
    });

    // Touch pan (single finger)
    let lastTouch = null;
    c.addEventListener('touchstart', e => {
      if (e.touches.length === 1) {
        lastTouch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        e.preventDefault();
      }
    }, { passive: false });

    c.addEventListener('touchmove', e => {
      if (e.touches.length === 1 && lastTouch) {
        const dx = e.touches[0].clientX - lastTouch.x;
        const dy = e.touches[0].clientY - lastTouch.y;
        lastTouch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        this.renderer.adjustPan(dx, dy);
        this.render();
        e.preventDefault();
      }
    }, { passive: false });

    c.addEventListener('touchend', () => { lastTouch = null; });
  }

  _bindResize() {
    if (typeof ResizeObserver === 'undefined') return;
    this._ro = new ResizeObserver(() => {
      this._syncSize();
      this.render();
    });
    this._ro.observe(this.canvas);
  }

  _syncSize() {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width && rect.height) {
      this.canvas.width  = rect.width;
      this.canvas.height = rect.height;
    }
  }

  // ── Interactive simulation ──────────────────────────────────────────────────

  _handleClick(e) {
    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const world = this.renderer.screenToWorld(sx, sy);

    for (const [id, t] of this.net.transitions) {
      if (this._hitTransition(t, world)) {
        if (this.net.fireTransition(id)) {
          this.net.updateEnabledTransitions();
          this.render();
          if (this.options.onFire) this.options.onFire(id, t, this.net);
          if (this.options.onStep) this.options.onStep(this.net);
        }
        return;
      }
    }

    // No transition hit — start pan on empty click
    this._isPanning = true;
    this._lastPan = { x: e.clientX, y: e.clientY };
    this.canvas.style.cursor = 'grabbing';
  }

  _hitTransition(t, world) {
    return (
      world.x >= t.position.x - t.width  / 2 &&
      world.x <= t.position.x + t.width  / 2 &&
      world.y >= t.position.y - t.height / 2 &&
      world.y <= t.position.y + t.height / 2
    );
  }
}
