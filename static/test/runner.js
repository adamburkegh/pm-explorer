/**
 * Minimal browser test runner.
 * API: describe(), it(), assert.*
 * Supports sync and async test functions.
 */

(function (global) {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────────────
  let _suites  = [];
  let _current = null;  // current suite being collected

  // ── Public API ─────────────────────────────────────────────────────────────
  global.describe = function describe(name, fn) {
    const suite = { name, tests: [], children: [] };
    const parent = _current;
    if (parent) parent.children.push(suite);
    else _suites.push(suite);
    _current = suite;
    fn();
    _current = parent;
  };

  global.it = function it(name, fn) {
    if (!_current) throw new Error('it() called outside describe()');
    _current.tests.push({ name, fn });
  };

  // ── Assertions ─────────────────────────────────────────────────────────────
  global.assert = {
    ok(value, msg) {
      if (!value) throw new AssertionError(msg || `Expected truthy, got ${value}`);
    },
    equal(actual, expected, msg) {
      if (actual !== expected)
        throw new AssertionError(msg || `Expected ${fmt(expected)}, got ${fmt(actual)}`);
    },
    notEqual(actual, expected, msg) {
      if (actual === expected)
        throw new AssertionError(msg || `Expected not ${fmt(expected)}`);
    },
    deepEqual(actual, expected, msg) {
      const a = JSON.stringify(normalise(actual));
      const e = JSON.stringify(normalise(expected));
      if (a !== e)
        throw new AssertionError(msg || `Deep equal failed:\n  expected: ${e}\n  actual:   ${a}`);
    },
    throws(fn, msg) {
      let threw = false;
      try { fn(); } catch { threw = true; }
      if (!threw) throw new AssertionError(msg || 'Expected function to throw');
    },
    async rejects(promise, msg) {
      try {
        await promise;
        throw new AssertionError(msg || 'Expected promise to reject');
      } catch (e) {
        if (e instanceof AssertionError) throw e;
      }
    },
    includes(haystack, needle, msg) {
      if (typeof haystack === 'string') {
        if (!haystack.includes(needle))
          throw new AssertionError(msg || `Expected string to include ${fmt(needle)}`);
      } else if (haystack instanceof Set || haystack instanceof Map) {
        if (!haystack.has(needle))
          throw new AssertionError(msg || `Expected collection to include ${fmt(needle)}`);
      } else {
        if (!Array.from(haystack).includes(needle))
          throw new AssertionError(msg || `Expected collection to include ${fmt(needle)}`);
      }
    },
    instanceOf(actual, Ctor, msg) {
      if (!(actual instanceof Ctor))
        throw new AssertionError(msg || `Expected instance of ${Ctor.name}, got ${actual}`);
    },
    isNull(actual, msg) {
      if (actual !== null)
        throw new AssertionError(msg || `Expected null, got ${fmt(actual)}`);
    },
    isUndefined(actual, msg) {
      if (actual !== undefined)
        throw new AssertionError(msg || `Expected undefined, got ${fmt(actual)}`);
    },
    isNaN(actual, msg) {
      if (!Number.isNaN(actual))
        throw new AssertionError(msg || `Expected NaN, got ${fmt(actual)}`);
    },
    closeTo(actual, expected, delta = 1e-9, msg) {
      if (Math.abs(actual - expected) > delta)
        throw new AssertionError(msg || `Expected ${actual} ≈ ${expected} (±${delta})`);
    },
  };

  class AssertionError extends Error {
    constructor(msg) { super(msg); this.name = 'AssertionError'; }
  }

  function fmt(v) {
    if (v === null) return 'null';
    if (v === undefined) return 'undefined';
    if (typeof v === 'string') return `"${v}"`;
    return String(v);
  }

  function normalise(v) {
    if (v instanceof Map)  return Object.fromEntries([...v.entries()].map(([k,vv]) => [k, normalise(vv)]));
    if (v instanceof Set)  return [...v].sort();
    if (Array.isArray(v))  return v.map(normalise);
    if (v && typeof v === 'object' && !(v instanceof Date))
      return Object.fromEntries(Object.entries(v).sort().map(([k,vv]) => [k, normalise(vv)]));
    return v;
  }

  // ── Runner ─────────────────────────────────────────────────────────────────
  global.runTests = async function runTests(outputEl) {
    const root = outputEl || document.getElementById('test-output');
    let passed = 0, failed = 0;

    async function runSuite(suite, depth = 0) {
      const suiteEl = el('div', { class: 'suite' });
      suiteEl.append(el('div', { class: 'suite-name', style: `padding-left:${depth*16}px` }, suite.name));

      for (const test of suite.tests) {
        const row = el('div', { class: 'test-row', style: `padding-left:${(depth+1)*16}px` });
        try {
          const result = test.fn();
          if (result && typeof result.then === 'function') await result;
          row.append(
            el('span', { class: 'badge pass' }, '✓'),
            el('span', { class: 'test-name' }, test.name)
          );
          passed++;
        } catch (e) {
          row.append(
            el('span', { class: 'badge fail' }, '✗'),
            el('span', { class: 'test-name' }, test.name),
            el('div',  { class: 'error-msg', style: `padding-left:${(depth+2)*16}px` }, e.message)
          );
          failed++;
        }
        suiteEl.append(row);
      }

      for (const child of suite.children) {
        suiteEl.append(await runSuite(child, depth + 1));
      }
      return suiteEl;
    }

    for (const suite of _suites) {
      root.append(await runSuite(suite));
    }

    const summary = el('div', { class: `summary ${failed ? 'fail' : 'pass'}` },
      `${passed + failed} tests — ${passed} passed, ${failed} failed`
    );
    root.prepend(summary);
  };

  function el(tag, attrs, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
    for (const c of children) {
      if (typeof c === 'string') e.appendChild(document.createTextNode(c));
      else if (c) e.appendChild(c);
    }
    return e;
  }

})(window);
