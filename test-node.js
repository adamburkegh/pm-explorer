/**
 * Node.js test harness — mirrors static/test/discovery/test-inductive-miner.js.
 * Provides minimal browser-global stubs then executes the test suite.
 */

// ── Browser-global stubs ──────────────────────────────────────────────────────

global.DFG_EDGE_SEP      = '\x1f';
global.DEFAULT_NAME_KEY  = 'concept:name';
global.DEFAULT_TIMESTAMP_KEY = 'time:timestamp';

global.dfgKey      = (a, b) => a + '\x1f' + b;
global.dfgKeyParts = k => { const i = k.indexOf('\x1f'); return [k.slice(0, i), k.slice(i + 1)]; };
global.variantKeyToArray = k => JSON.parse(k);
global.arrayToVariantKey = a => JSON.stringify(a);

let _idSeq = 0;
global.PetriNet = class {
  constructor(id, n) {
    this.id = id; this.name = n;
    this.places = new Map(); this.transitions = new Map(); this.arcs = new Map();
  }
  addPlace(p)      { this.places.set(p.id, p); }
  addTransition(t) { this.transitions.set(t.id, t); }
  addArc(a) {
    const sp = this.places.has(a.source) || this.transitions.has(a.source);
    const tp = this.places.has(a.target) || this.transitions.has(a.target);
    if (!sp || !tp) return false;
    if (this.places.has(a.source) === this.places.has(a.target)) return false;
    this.arcs.set(a.id, a); return true;
  }
  updateEnabledTransitions() {
    for (const [tid, t] of this.transitions) {
      let ok = true;
      for (const arc of this.arcs.values()) {
        if (arc.target !== tid) continue;
        const p = this.places.get(arc.source);
        if (p && p.tokens < 1) { ok = false; break; }
      }
      t.isEnabled = ok;
    }
  }
  static generateId() { return 'id-' + (++_idSeq); }
};
global.Place = class {
  constructor(id, pos, lbl = '', tok = 0, cap = null, fm = null) {
    this.id = id; this.label = lbl; this.tokens = tok; this.finalMarking = fm;
  }
};
global.Transition = class {
  constructor(id, pos, lbl = '', pr = 1, d = 0, sil = false) {
    this.id = id; this.label = lbl; this.silent = sil; this.isEnabled = false;
  }
};
global.Arc = class {
  constructor(id, s, t) { this.id = id; this.source = s; this.target = t; }
};

// ── Minimal DOMParser for Node (subset needed by xes-parser.js) ──────────────

global.DOMParser = class {
  parseFromString(xml) {
    // Tokenise: extract tags and text runs
    const tokens = [];
    const re = /<(!--|\/)?([^\s\/>!][^\s\/>]*)([^>]*)(\/)?>|([^<]+)/gs;
    let m;
    while ((m = re.exec(xml)) !== null) {
      if (m[1] === '--') continue; // comment
      if (m[5] !== undefined) { tokens.push({ t: 'text', v: m[5] }); continue; }
      const closing = m[1] === '/';
      // m[0].endsWith('/>') is reliable — ([^>]*) greedily eats the '/' before '>'
      // so m[4] is never captured for self-closing tags
      const selfClose = m[0].endsWith('/>');
      const name = m[2];
      if (name && name.startsWith('?')) continue; // skip processing instructions
      // parse attributes — strip trailing '/' from the captured attr string
      const attrStr = m[3].endsWith('/') ? m[3].slice(0, -1) : m[3];
      const attrs = {};
      const ar = /(\w[\w:-]*)="([^"]*)"/g;
      let am;
      while ((am = ar.exec(attrStr)) !== null) attrs[am[1]] = am[2];
      if (closing) { tokens.push({ t: 'close', name }); }
      else { tokens.push({ t: 'open', name, attrs, selfClose }); }
    }

    // Build tree
    class El {
      constructor(name, attrs) {
        this.tagName = name; this.localName = name;
        this.nodeType = 1; this._attrs = attrs;
        this._children = []; this._text = '';
      }
      get children() { return this._children; }
      get textContent() {
        return this._text + this._children.map(c => c.textContent).join('');
      }
      getAttribute(k) {
        const v = this._attrs[k];
        if (v == null) return null;
        return v.replace(/&quot;/g, '"').replace(/&apos;/g, "'")
                .replace(/&lt;/g,   '<').replace(/&gt;/g,   '>')
                .replace(/&amp;/g,  '&');
      }
      querySelector(sel) {
        if (sel === 'parsererror') return null; // XES has no parse errors
        return null;
      }
    }

    const root = { _children: [] };
    const stack = [root];
    for (const tok of tokens) {
      const top = stack[stack.length - 1];
      if (tok.t === 'open') {
        const el = new El(tok.name, tok.attrs);
        if (top._children) top._children.push(el);
        if (!tok.selfClose) stack.push(el);
      } else if (tok.t === 'close') {
        if (stack.length > 1) stack.pop();
      } else if (tok.t === 'text' && top.tagName) {
        top._text += tok.v;
      }
    }

    const docEl = root._children[0];
    return { documentElement: docEl, querySelector: () => null };
  }
};

const vm = require('vm');
const fs = require('fs');

// Load source files in dependency order
vm.runInThisContext(fs.readFileSync('./static/js/eventlog/constants.js',    'utf8'));
vm.runInThisContext(fs.readFileSync('./static/js/eventlog/event-log.js',    'utf8'));
vm.runInThisContext(fs.readFileSync('./static/js/eventlog/xes-parser.js',   'utf8'));
vm.runInThisContext(fs.readFileSync('./static/js/eventlog/log-util.js',     'utf8'));
vm.runInThisContext(fs.readFileSync('./static/js/pnv/model.js',             'utf8'));
vm.runInThisContext(fs.readFileSync('./static/js/discovery/alpha-miner.js', 'utf8'));
vm.runInThisContext(fs.readFileSync('./static/js/discovery/inductive-miner.js', 'utf8'));
vm.runInThisContext(fs.readFileSync('./static/js/eventlog/dtlog.js',          'utf8'));
vm.runInThisContext(fs.readFileSync('./static/js/conformance/footprint.js',     'utf8'));
vm.runInThisContext(fs.readFileSync('./static/test/fixtures/running-example-xes.js', 'utf8'));
// xesParser is the real parser exported by xes-parser.js (loaded above).

// ── Tiny test framework ───────────────────────────────────────────────────────

let _suite = '', _passed = 0, _failed = 0;

global.describe = (name, fn) => {
  _suite = name;
  console.log(`\n${name}`);
  fn();
};

global.it = (name, fn) => {
  try {
    fn();
    console.log(`  ✓  ${name}`);
    _passed++;
  } catch (e) {
    console.error(`  ✗  ${name}\n     ${e.message}`);
    _failed++;
  }
};

global.assert = {
  ok:        (v, m)       => { if (!v) throw new Error(m ?? 'expected truthy'); },
  equal:     (a, b, m)    => { if (a !== b) throw new Error(m ?? `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); },
  notEqual:  (a, b, m)    => { if (a === b) throw new Error(m ?? `expected not ${JSON.stringify(b)}`); },
  deepEqual: (a, b, m)    => {
    const sa = JSON.stringify(a), sb = JSON.stringify(b);
    if (sa !== sb) throw new Error(m ?? `expected ${sb}, got ${sa}`);
  },
  closeTo:   (a, b, d=1e-9, m) => {
    if (Math.abs(a - b) > d) throw new Error(m ?? `expected ${a} ≈ ${b} (±${d})`);
  },
  includes:  (h, n, m)    => {
    const has = h instanceof Set || h instanceof Map ? h.has(n) : Array.from(h).includes(n);
    if (!has) throw new Error(m ?? `expected collection to include ${JSON.stringify(n)}`);
  },
  instanceOf:(a, C, m)    => { if (!(a instanceof C)) throw new Error(m ?? `expected instance of ${C.name}`); },
};

// ── Run the browser test files in this context ───────────────────────────────

vm.runInThisContext(fs.readFileSync('./static/test/discovery/test-alpha-miner.js',        'utf8'));
vm.runInThisContext(fs.readFileSync('./static/test/discovery/test-inductive-miner.js',    'utf8'));
vm.runInThisContext(fs.readFileSync('./static/test/conformance/test-footprint.js',        'utf8'));
vm.runInThisContext(fs.readFileSync('./static/test/eventlog/test-dtlog.js',              'utf8'));

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`${_passed + _failed} tests: ${_passed} passed, ${_failed} failed`);
process.exit(_failed > 0 ? 1 : 0);
