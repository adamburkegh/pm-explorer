/**
 * Petri Net canvas renderer.
 * Extracted from YAPNE (Yet Another Petri Net Editor) — editor-specific ghost/drag helpers removed.
 */

class PetriNetRenderer {
  constructor(canvas, petriNet) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.petriNet = petriNet;

    this.panOffset = { x: 0, y: 0 };
    this.zoomFactor = 1.0;
    this.minZoom = 0.1;
    this.maxZoom = 3.0;

    this.theme = {
      placeColor: '#ffffff',
      placeStroke: '#000000',
      tokenColor: '#000000',
      transitionColor: '#d3d3d3',
      transitionStroke: '#000000',
      enabledTransitionColor: '#90ee90',
      silentTransitionColor: '#808080',
      arcColor: '#000000',
      selectedColor: '#4682b4',
      textColor: '#000000',
      backgroundColor: '#ffffff',
    };
  }

  setTheme(theme) {
    this.theme = { ...this.theme, ...theme };
  }

  // ── Coordinate transforms ───────────────────────────────────────────────────

  screenToWorld(screenX, screenY) {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    return {
      x: (screenX * scaleX - this.panOffset.x) / this.zoomFactor,
      y: (screenY * scaleY - this.panOffset.y) / this.zoomFactor,
    };
  }

  worldToScreen(worldX, worldY) {
    return {
      x: worldX * this.zoomFactor + this.panOffset.x,
      y: worldY * this.zoomFactor + this.panOffset.y,
    };
  }

  // ── Pan / zoom ──────────────────────────────────────────────────────────────

  setPan(x, y) {
    this.panOffset.x = x;
    this.panOffset.y = y;
  }

  adjustPan(dx, dy) {
    this.panOffset.x += dx;
    this.panOffset.y += dy;
  }

  setZoom(zoom, centerX = 0, centerY = 0) {
    const oldZoom = this.zoomFactor;
    const wx = (centerX - this.panOffset.x) / oldZoom;
    const wy = (centerY - this.panOffset.y) / oldZoom;
    this.zoomFactor = Math.max(this.minZoom, Math.min(this.maxZoom, zoom));
    this.panOffset.x = centerX - wx * this.zoomFactor;
    this.panOffset.y = centerY - wy * this.zoomFactor;
  }

  adjustZoom(factor, centerX, centerY) {
    this.setZoom(this.zoomFactor * factor, centerX, centerY);
  }

  resetView() {
    this.panOffset = { x: 0, y: 0 };
    this.zoomFactor = 1.0;
  }

  /** Fit all elements into the canvas viewport with padding. */
  fitView(padding = 40) {
    const places = Array.from(this.petriNet.places.values());
    const transitions = Array.from(this.petriNet.transitions.values());
    const all = [...places, ...transitions];
    if (all.length === 0) { this.resetView(); return; }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const el of all) {
      const hw = el.radius ?? el.width / 2;
      const hh = el.radius ?? el.height / 2;
      minX = Math.min(minX, el.position.x - hw);
      minY = Math.min(minY, el.position.y - hh);
      maxX = Math.max(maxX, el.position.x + hw);
      maxY = Math.max(maxY, el.position.y + hh);
    }

    const netW = maxX - minX || 1;
    const netH = maxY - minY || 1;
    const zoom = Math.min(
      (this.canvas.width  - padding * 2) / netW,
      (this.canvas.height - padding * 2) / netH,
      this.maxZoom
    );
    this.zoomFactor = Math.max(this.minZoom, zoom);
    this.panOffset.x = padding - minX * this.zoomFactor;
    this.panOffset.y = padding - minY * this.zoomFactor;
  }

  // ── Main render ─────────────────────────────────────────────────────────────

  render() {
    this.clear();
    this.ctx.save();
    this.ctx.translate(this.panOffset.x, this.panOffset.y);
    this.ctx.scale(this.zoomFactor, this.zoomFactor);
    this.drawArcs();
    this.drawPlaces();
    this.drawTransitions();
    this.ctx.restore();
  }

  clear() {
    this.ctx.fillStyle = this.theme.backgroundColor;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  // ── Places ──────────────────────────────────────────────────────────────────

  drawPlaces() {
    for (const place of this.petriNet.places.values()) {
      this.ctx.beginPath();
      this.ctx.arc(place.position.x, place.position.y, place.radius, 0, Math.PI * 2);
      this.ctx.fillStyle = this.theme.placeColor;
      this.ctx.fill();
      this.ctx.strokeStyle = this.theme.placeStroke;
      this.ctx.lineWidth = 2;
      this.ctx.stroke();

      if (place.hasFinalMarking()) {
        this.ctx.beginPath();
        this.ctx.arc(place.position.x, place.position.y, place.radius + 3, 0, Math.PI * 2);
        this.ctx.strokeStyle = place.hasReachedFinalMarking() ? '#A3BE8C' : '#EBCB8B';
        this.ctx.lineWidth = 2;
        this.ctx.stroke();

        const fmX = place.position.x + place.radius * 0.7;
        const fmY = place.position.y - place.radius * 0.7;
        this.ctx.fillStyle = place.hasReachedFinalMarking() ? '#A3BE8C' : '#EBCB8B';
        this.ctx.beginPath();
        this.ctx.arc(fmX, fmY, 8, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.fillStyle = this.theme.backgroundColor;
        this.ctx.font = 'bold 12px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText(place.finalMarking.toString(), fmX, fmY);
      }

      this.drawTokens(place);

      this.ctx.fillStyle = this.theme.textColor;
      this.ctx.font = '12px Arial';
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'alphabetic';
      this.ctx.fillText(place.label, place.position.x, place.position.y + place.radius + 15);
    }
  }

  drawTokens(place) {
    const { x, y } = place.position;
    this.ctx.fillStyle = this.theme.tokenColor;
    if (place.tokens <= 3) {
      const r = 4;
      for (let i = 0; i < place.tokens; i++) {
        let tx = x, ty = y;
        if (place.tokens === 2) tx = i === 0 ? x - 5 : x + 5;
        else if (place.tokens === 3) {
          if (i === 0) { tx = x; ty = y - 5; }
          else { tx = i === 1 ? x - 5 : x + 5; ty = y + 5; }
        }
        this.ctx.beginPath();
        this.ctx.arc(tx, ty, r, 0, Math.PI * 2);
        this.ctx.fill();
      }
    } else {
      this.ctx.font = '14px Arial';
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      this.ctx.fillText(place.tokens.toString(), x, y);
    }
  }

  // ── Transitions ─────────────────────────────────────────────────────────────

  drawTransitions() {
    for (const t of this.petriNet.transitions.values()) {
      this.ctx.beginPath();
      this.ctx.rect(t.position.x - t.width / 2, t.position.y - t.height / 2, t.width, t.height);
      if (t.silent) {
        this.ctx.fillStyle = this.theme.silentTransitionColor;
      } else {
        this.ctx.fillStyle = t.isEnabled ? this.theme.enabledTransitionColor : this.theme.transitionColor;
      }
      this.ctx.fill();
      this.ctx.strokeStyle = this.theme.transitionStroke;
      this.ctx.lineWidth = 2;
      this.ctx.stroke();

      if (!t.silent) {
        this.ctx.fillStyle = this.theme.textColor;
        this.ctx.font = '12px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'alphabetic';
        this.ctx.fillText(t.label, t.position.x, t.position.y + t.height / 2 + 15);
      }
    }
  }

  // ── Arcs ────────────────────────────────────────────────────────────────────

  drawArcs() {
    for (const arc of this.petriNet.arcs.values()) {
      const src = this.petriNet.places.get(arc.source) || this.petriNet.transitions.get(arc.source);
      const tgt = this.petriNet.places.get(arc.target) || this.petriNet.transitions.get(arc.target);
      if (!src || !tgt) continue;

      const firstWpt = arc.points.length > 0 ? arc.points[0] : null;
      const lastWpt  = arc.points.length > 0 ? arc.points[arc.points.length - 1] : null;
      const { start, end } = this.calculateArcEndpoints(src, tgt, firstWpt, lastWpt);

      this.ctx.save();
      this.ctx.setLineDash(arc.type === "modifier" ? [5, 5] : []);
      this.ctx.beginPath();
      this.ctx.moveTo(start.x, start.y);
      for (const pt of arc.points) this.ctx.lineTo(pt.x, pt.y);
      this.ctx.lineTo(end.x, end.y);
      this.ctx.strokeStyle = this.theme.arcColor;
      this.ctx.lineWidth = 1.5;
      this.ctx.stroke();

      const lastPt = arc.points.length > 0 ? arc.points[arc.points.length - 1] : start;
      const dir = this.calculateArcDirection(lastPt, end);

      switch (arc.type) {
        case "inhibitor": this.drawInhibitorEnding(end, dir); break;
        case "read":      this.drawReadArcEnding(end, dir);   break;
        case "reset":     this.drawResetArcEnding(end, dir);  break;
        default:          this.drawArrowhead(end, dir);       break;
      }
      this.ctx.restore();

      if (arc.weight > 1 || arc.label) {
        const mid = this.calculateArcMidpoint(arc, start, end);
        const label = arc.label || arc.weight.toString();
        this.ctx.font = '12px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        const metrics = this.ctx.measureText(label);
        const pad = 3;
        this.ctx.fillStyle = this.theme.backgroundColor;
        this.ctx.fillRect(mid.x - metrics.width / 2 - pad, mid.y - 7 - pad, metrics.width + pad * 2, 14 + pad * 2);
        this.ctx.fillStyle = this.theme.textColor;
        this.ctx.fillText(label, mid.x, mid.y);
      }
    }
  }

  drawArrowhead(position, angle) {
    const size = 10, spread = Math.PI / 6;
    this.ctx.beginPath();
    this.ctx.moveTo(position.x, position.y);
    this.ctx.lineTo(position.x - size * Math.cos(angle - spread), position.y - size * Math.sin(angle - spread));
    this.ctx.lineTo(position.x - size * Math.cos(angle + spread), position.y - size * Math.sin(angle + spread));
    this.ctx.closePath();
    this.ctx.fillStyle = this.theme.arcColor;
    this.ctx.fill();
  }

  drawInhibitorEnding(position, angle) {
    const r = 6, offset = 10;
    const cx = position.x - Math.cos(angle) * offset;
    const cy = position.y - Math.sin(angle) * offset;
    this.ctx.beginPath();
    this.ctx.arc(cx, cy, r, 0, Math.PI * 2);
    this.ctx.fillStyle = this.theme.backgroundColor;
    this.ctx.fill();
    this.ctx.strokeStyle = this.theme.arcColor;
    this.ctx.lineWidth = 1.5;
    this.ctx.stroke();
  }

  drawReadArcEnding(position, angle) {
    this.drawArrowhead(position, angle);
    const cx = position.x - Math.cos(angle) * 15;
    const cy = position.y - Math.sin(angle) * 15;
    this.ctx.beginPath();
    this.ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    this.ctx.fillStyle = this.theme.arcColor;
    this.ctx.fill();
  }

  drawResetArcEnding(position, angle) {
    this.drawArrowhead(position, angle);
    this.drawArrowhead(
      { x: position.x - Math.cos(angle) * 8, y: position.y - Math.sin(angle) * 8 },
      angle
    );
  }

  // firstWpt / lastWpt: first and last waypoints of the arc, if any.
  // When present, the source clips toward firstWpt (not target) and the target
  // clips from lastWpt (not source), so routed polylines exit/enter nodes cleanly.
  calculateArcEndpoints(source, target, firstWpt = null, lastWpt = null) {
    const aimForStart = firstWpt ?? target.position;
    const aimForEnd   = lastWpt  ?? source.position;

    let start = { ...source.position };
    let end   = { ...target.position };

    if (source instanceof Place) {
      const a = Math.atan2(aimForStart.y - source.position.y, aimForStart.x - source.position.x);
      start.x = source.position.x + Math.cos(a) * source.radius;
      start.y = source.position.y + Math.sin(a) * source.radius;
    } else {
      const dx = aimForStart.x - source.position.x;
      const dy = aimForStart.y - source.position.y;
      if (Math.abs(dx) * source.height > Math.abs(dy) * source.width) {
        const side = dx > 0 ? 1 : -1;
        start.x = source.position.x + side * source.width / 2;
        start.y = source.position.y + dy * (source.width / 2) / Math.abs(dx);
      } else {
        const side = dy > 0 ? 1 : -1;
        start.y = source.position.y + side * source.height / 2;
        start.x = source.position.x + dx * (source.height / 2) / Math.abs(dy);
      }
    }

    if (target instanceof Place) {
      const a = Math.atan2(target.position.y - aimForEnd.y, target.position.x - aimForEnd.x);
      end.x = target.position.x - Math.cos(a) * target.radius;
      end.y = target.position.y - Math.sin(a) * target.radius;
    } else {
      const dx = target.position.x - aimForEnd.x;
      const dy = target.position.y - aimForEnd.y;
      if (Math.abs(dx) * target.height > Math.abs(dy) * target.width) {
        const side = dx > 0 ? 1 : -1;
        end.x = target.position.x - side * target.width / 2;
        end.y = target.position.y - dy * (target.width / 2) / Math.abs(dx);
      } else {
        const side = dy > 0 ? 1 : -1;
        end.y = target.position.y - side * target.height / 2;
        end.x = target.position.x - dx * (target.height / 2) / Math.abs(dy);
      }
    }

    return { start, end };
  }

  calculateArcDirection(from, to) {
    return Math.atan2(to.y - from.y, to.x - from.x);
  }

  calculateArcMidpoint(arc, start, end) {
    if (arc.points.length > 0) return arc.points[Math.floor(arc.points.length / 2)];
    return { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  }
}
