/**
 * PetriNetViewer — minimal read-only viewer for Petri nets.
 *
 * Wraps PetriNetRenderer with:
 *   - pan  (left-drag or middle-drag)
 *   - zoom (scroll wheel)
 *   - fit-to-view on load
 *   - canvas auto-resize via ResizeObserver
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
    this.options = { interactive: false, ...options };

    this.net = new PetriNet(PetriNet.generateId());
    this.renderer = new PetriNetRenderer(canvas, this.net);

    this._isPanning = false;
    this._lastPan = null;

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
      // Pan on middle-button or left-button without interactive mode
      if (e.button === 1 || (e.button === 0 && !this.options.interactive)) {
        this._isPanning = true;
        this._lastPan = { x: e.clientX, y: e.clientY };
        c.style.cursor = 'grabbing';
        e.preventDefault();
      } else if (e.button === 0 && this.options.interactive) {
        this._handleClick(e);
      }
    });

    window.addEventListener('mousemove', e => {
      if (!this._isPanning) return;
      const dx = e.clientX - this._lastPan.x;
      const dy = e.clientY - this._lastPan.y;
      this._lastPan = { x: e.clientX, y: e.clientY };
      this.renderer.adjustPan(dx, dy);
      this.render();
    });

    window.addEventListener('mouseup', e => {
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
