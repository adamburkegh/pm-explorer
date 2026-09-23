/**
 * dotted-chart.js
 *
 * Canvas dotted-chart renderer. X axis: calendar time (pannable/zoomable).
 * Y axis: case rank (integer, 0 = oldest case at the top).
 *
 * Usage:
 *   const chart = new DottedChart(canvasEl);
 *   chart.load(data, colours);   // data from logToDottedData()
 *   chart.fitView();
 *
 * data shape:
 *   {
 *     events:      [[case_rank, time_ms, activity_idx], ...],
 *     activities:  string[],
 *     n_cases:     number,
 *     n_events:    number,
 *     time_min_ms: number,
 *     time_max_ms: number,
 *   }
 *
 * colours: string[] parallel to data.activities.
 *
 * Ported from ninjer-lab/static/js/dotted-chart.js (ProM origin).
 * Wrapped in an IIFE so the private margin constants don't leak.
 */
'use strict';

const DottedChart = (() => {

// ── Axis helpers ─────────────────────────────────────────────────────────────

const _MS_DAY   = 86_400_000;
const _MS_WEEK  = _MS_DAY *   7;
const _MS_MONTH = _MS_DAY *  30;
const _MS_QTR   = _MS_DAY *  91;
const _MS_YEAR  = _MS_DAY * 365;

function _niceTimeTicks(minMs, maxMs, targetCount) {
  const range = maxMs - minMs;
  const steps = [_MS_DAY, _MS_WEEK, _MS_MONTH, _MS_QTR, _MS_YEAR];
  const iv    = steps.find(s => range / s <= targetCount * 1.5)
    || _MS_YEAR;
  const first = Math.ceil(minMs / iv) * iv;
  const ticks = [];
  for (let t = first; t <= maxMs; t += iv) ticks.push(t);
  return { ticks, iv };
}

function _fmtTick(ms, iv) {
  const d = new Date(ms);
  if (iv >= _MS_YEAR) return d.getUTCFullYear().toString();
  if (iv >= _MS_DAY * 28) {
    return d.toLocaleDateString('en-AU',
      { month: 'short', year: '2-digit', timeZone: 'UTC' });
  }
  return d.toLocaleDateString('en-AU',
    { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

// ── Layout constants ──────────────────────────────────────────────────────────

const _ML = 64;   // left  — y-axis labels
const _MR = 16;   // right
const _MT = 16;   // top
const _MB = 48;   // bottom — x-axis labels

// ── DottedChart ───────────────────────────────────────────────────────────────

class DottedChart {
  constructor(canvas) {
    this.canvas        = canvas;
    this.ctx           = canvas.getContext('2d');
    this.data          = null;
    this.colours       = [];
    this.showCaseLines = false;
    this.viewMinMs     = 0;
    this.viewMaxMs     = 1;
    this._dragX        = null;
    this._sortedEvents = [];
    this._bindEvents();
    this._bindResize();
  }

  /** Load data and render. */
  load(data, colours) {
    this.data    = data;
    this.colours = colours;
    this._sortedEvents = [...data.events].sort(
      (a, b) => a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1]);
    this.fitView();
  }

  /** Reset pan/zoom to show the full time range. */
  fitView() {
    if (!this.data || !this.data.n_cases) return;
    const pad = (this.data.time_max_ms - this.data.time_min_ms) * 0.02;
    this.viewMinMs = this.data.time_min_ms - pad;
    this.viewMaxMs = this.data.time_max_ms + pad;
    this.render();
  }

  render() {
    const { canvas, ctx, data } = this;
    const W     = canvas.width;
    const H     = canvas.height;
    const plotW = W - _ML - _MR;
    const plotH = H - _MT - _MB;
    ctx.clearRect(0, 0, W, H);
    if (plotW <= 0 || plotH <= 0) return;
    if (!data || !data.n_cases) return;

    const { events, n_cases } = data;
    const msRange = this.viewMaxMs - this.viewMinMs;
    const xScale  = plotW / msRange;
    const toPx    = ms => _ML + (ms - this.viewMinMs) * xScale;
    const yScale  = plotH / n_cases;

    // ── X axis ───────────────────────────────────────────────────────────
    ctx.strokeStyle = '#bbb';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(_ML,         _MT + plotH);
    ctx.lineTo(_ML + plotW, _MT + plotH);
    ctx.stroke();

    const { ticks, iv } = _niceTimeTicks(
      this.viewMinMs, this.viewMaxMs, 8);
    ctx.font        = '11px sans-serif';
    ctx.textAlign   = 'center';
    ctx.strokeStyle = '#ececec';
    ctx.lineWidth   = 1;
    for (const t of ticks) {
      const x = toPx(t);
      if (x < _ML || x > _ML + plotW) continue;
      ctx.beginPath();
      ctx.moveTo(x, _MT);
      ctx.lineTo(x, _MT + plotH);
      ctx.stroke();
      ctx.fillStyle = '#555';
      ctx.fillText(_fmtTick(t, iv), x, _MT + plotH + 18);
    }

    // ── Y axis ───────────────────────────────────────────────────────────
    ctx.textAlign = 'right';
    ctx.fillStyle = '#555';
    for (const frac of [0, 0.25, 0.5, 0.75, 1]) {
      const rank = Math.round(frac * (n_cases - 1));
      const y    = _MT + rank * yScale;
      ctx.fillText(rank.toLocaleString(), _ML - 6, y + 4);
    }
    ctx.save();
    ctx.translate(13, _MT + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#444';
    ctx.font      = '11px sans-serif';
    ctx.fillText('Cases (oldest → newest)', 0, 0);
    ctx.restore();

    // ── Case lines + dots ─────────────────────────────────────────────────
    ctx.save();
    ctx.beginPath();
    ctx.rect(_ML, _MT, plotW, plotH);
    ctx.clip();

    const dotH = Math.max(1, yScale * 0.9);

    if (this.showCaseLines && this._sortedEvents.length) {
      const byColour = new Map();
      const ev = this._sortedEvents;
      for (let i = 0; i < ev.length - 1; i++) {
        const [rank,  ms,  ai] = ev[i];
        const [rank2, ms2]     = ev[i + 1];
        if (rank !== rank2) continue;
        const x1 = toPx(ms);
        const x2 = toPx(ms2);
        if (x1 > _ML + plotW + 2 || x2 < _ML - 2) continue;
        const y      = _MT + rank * yScale + dotH * 0.5;
        const colour = this.colours[ai] ?? '#888';
        if (!byColour.has(colour)) byColour.set(colour, []);
        byColour.get(colour).push(x1, y, x2, y);
      }
      ctx.globalAlpha = 0.35;
      ctx.lineWidth   = 0.8;
      for (const [colour, pts] of byColour) {
        ctx.strokeStyle = colour;
        ctx.beginPath();
        for (let j = 0; j < pts.length; j += 4) {
          ctx.moveTo(pts[j],     pts[j + 1]);
          ctx.lineTo(pts[j + 2], pts[j + 3]);
        }
        ctx.stroke();
      }
    }

    ctx.globalAlpha = 0.65;
    for (const [rank, ms, ai] of events) {
      const x = toPx(ms);
      if (x < _ML - 2 || x > _ML + plotW + 2) continue;
      ctx.fillStyle = this.colours[ai] ?? '#888';
      ctx.fillRect(x - 1, _MT + rank * yScale, 2, dotH);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // ── Pan / zoom ────────────────────────────────────────────────────────────

  pan(dxPx) {
    const plotW = this.canvas.width - _ML - _MR;
    const dMs   = (dxPx / plotW) * (this.viewMaxMs - this.viewMinMs);
    this.viewMinMs -= dMs;
    this.viewMaxMs -= dMs;
    this.render();
  }

  zoom(factor, centerPx) {
    const plotW    = this.canvas.width - _ML - _MR;
    const msRange  = this.viewMaxMs - this.viewMinMs;
    const ratio    = (centerPx - _ML) / plotW;
    const cMs      = this.viewMinMs + ratio * msRange;
    const newRange = msRange * factor;
    this.viewMinMs = cMs - ratio * newRange;
    this.viewMaxMs = cMs + (1 - ratio) * newRange;
    this.render();
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  _bindEvents() {
    const c = this.canvas;
    c.style.cursor = 'grab';
    c.addEventListener('mousedown', e => {
      this._dragX    = e.clientX;
      c.style.cursor = 'grabbing';
    });
    c.addEventListener('mousemove', e => {
      if (this._dragX === null) return;
      this.pan(-(e.clientX - this._dragX));
      this._dragX = e.clientX;
    });
    const endDrag = () => {
      this._dragX    = null;
      c.style.cursor = 'grab';
    };
    c.addEventListener('mouseup',    endDrag);
    c.addEventListener('mouseleave', endDrag);
    c.addEventListener('wheel', e => {
      e.preventDefault();
      const rect   = c.getBoundingClientRect();
      const factor = e.deltaY > 0 ? 1.25 : 0.8;
      this.zoom(factor, e.clientX - rect.left);
    }, { passive: false });
  }

  _bindResize() {
    new ResizeObserver(() => {
      this.canvas.width  = this.canvas.offsetWidth;
      this.canvas.height = this.canvas.offsetHeight;
      this.render();
    }).observe(this.canvas);
  }
}

return DottedChart;
})();
