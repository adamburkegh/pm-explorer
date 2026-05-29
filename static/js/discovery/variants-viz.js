/**
 * Trace variant visualiser — chevron-based SVG-free renderer.
 *
 * Each variant is a row: rank badge · scrollable chevron track · frequency
 * bar · count.  Activity tokens use a stable colour palette with luminance-
 * based contrast (white or near-black text on each swatch).
 *
 * Usage:
 *   const viewer = new VariantsViewer(containerEl);
 *   viewer.load(log);          // EventLog from log-util.js / xes-parser.js
 *
 * Depends on (must be loaded first):
 *   js/xml.js                  — xmlEscape
 *   js/eventlog/constants.js   — DEFAULT_NAME_KEY
 *   js/eventlog/log-util.js    — getUVCL, getVariantsSortedByCount, variantKeyToArray
 */

const VARIANT_PALETTE = [
  '#378ADD','#1D9E75','#D85A30','#7F77DD','#BA7517',
  '#D4537E','#639922','#E24B4A','#0F6E56','#533AB7',
  '#993C1D','#185FA5','#3B6D11','#993556','#854F0B',
];

/**
 * Return '#ffffff' or '#1a1a1a' depending on which gives better contrast
 * against the given hex background colour.
 * @param {string} hex  e.g. '#378ADD'
 * @returns {string}
 */
function variantTextColor(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.45 ? '#1a1a1a' : '#ffffff';
}

class VariantsViewer {
  /**
   * @param {Element} container  DOM element to render into
   */
  constructor(container) {
    this._el       = container;
    this._data     = [];   // [{rank, count, activities:[string]}]
    this._max      = 1;
    this._actColor = {};   // activity name → hex colour
    this._topN     = 20;
    this._minPct   = 0;    // 0–100, percentage of maxFreq

    this._el.innerHTML =
      '<div class="vv-empty">Load a log and switch to this tab to view variants.</div>';
  }

  /**
   * Compute variants from log and render.
   * @param {EventLog} log
   */
  load(log) {
    const uvcl   = getUVCL(log, log.activityKey);
    const sorted = getVariantsSortedByCount(uvcl);

    this._max  = sorted[0]?.[1] ?? 1;
    this._data = sorted.map(([key, count], i) => ({
      rank:       i + 1,
      count,
      activities: variantKeyToArray(key),
    }));

    // Stable colour assignment: activities ordered by first appearance
    const seen = new Set();
    const acts = [];
    for (const v of this._data) {
      for (const a of v.activities) {
        if (!seen.has(a)) { seen.add(a); acts.push(a); }
      }
    }
    this._actColor = Object.fromEntries(
      acts.map((a, i) => [a, VARIANT_PALETTE[i % VARIANT_PALETTE.length]])
    );

    this._topN   = Math.min(20, this._data.length);
    this._minPct = 0;
    this._buildUI();
  }

  // ── Private ────────────────────────────────────────────────────────────────

  _buildUI() {
    this._el.innerHTML = '';

    const topNMax = Math.min(50, this._data.length);

    // Controls row
    const ctrl = document.createElement('div');
    ctrl.className = 'vv-controls';
    ctrl.innerHTML = `
      <label>Top variants</label>
      <input type="range" class="vv-top-n" min="1" max="${topNMax}"
             value="${Math.min(this._topN, topNMax)}" step="1">
      <span class="vv-top-n-out">${Math.min(this._topN, topNMax)}</span>
      <label style="margin-left:14px">Min frequency</label>
      <input type="range" class="vv-min-freq" min="0" max="100"
             value="${this._minPct}" step="1">
      <span class="vv-min-freq-out">0</span>
    `;
    this._el.appendChild(ctrl);

    // Legend
    const legend = document.createElement('div');
    legend.className = 'vv-legend';
    legend.innerHTML = Object.entries(this._actColor).map(([a, col]) =>
      `<span class="vv-legend-item">`
      + `<span class="vv-swatch" style="background:${col}"></span>`
      + `${xmlEscape(a)}</span>`
    ).join('');
    this._el.appendChild(legend);

    // Rows container
    const rows = document.createElement('div');
    rows.className = 'vv-rows';
    this._el.appendChild(rows);

    // Wire sliders
    const topNEl    = ctrl.querySelector('.vv-top-n');
    const topNOut   = ctrl.querySelector('.vv-top-n-out');
    const minFEl    = ctrl.querySelector('.vv-min-freq');
    const minFOut   = ctrl.querySelector('.vv-min-freq-out');

    topNEl.addEventListener('input', () => {
      this._topN = parseInt(topNEl.value);
      topNOut.textContent = this._topN;
      this._renderRows(rows);
    });

    minFEl.addEventListener('input', () => {
      this._minPct = parseInt(minFEl.value);
      const abs = Math.round(this._minPct / 100 * this._max);
      minFOut.textContent = abs.toLocaleString();
      this._renderRows(rows);
    });

    this._renderRows(rows);
  }

  _renderRows(rowsEl) {
    const minCount = Math.round(this._minPct / 100 * this._max);
    const visible  = this._data
      .filter(v => v.count >= minCount)
      .slice(0, this._topN);

    if (!visible.length) {
      rowsEl.innerHTML = '<div class="vv-empty">No variants match the current filters.</div>';
      return;
    }

    rowsEl.innerHTML = visible.map(v => {
      const barPct = Math.round((v.count / this._max) * 100);
      const chevrons = v.activities.map((act, i) => {
        const bg = this._actColor[act] ?? '#555';
        const fg = variantTextColor(bg);
        const cls = 'vv-chevron' + (i === 0 ? ' vv-chevron--first' : '');
        return `<div class="${cls}" style="background:${bg};color:${fg}" `
          + `title="${xmlEscape(act)}">${xmlEscape(act)}</div>`;
      }).join('');

      return `<div class="vv-row">
        <span class="vv-rank">#${v.rank}</span>
        <div class="vv-track"><div class="vv-wrap">${chevrons}</div></div>
        <div class="vv-bar-wrap"><div class="vv-bar" style="width:${barPct}%"></div></div>
        <span class="vv-count">${v.count.toLocaleString()}</span>
      </div>`;
    }).join('');
  }
}
