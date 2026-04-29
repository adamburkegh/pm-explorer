/**
 * Tests for Event, Trace, EventLog classes.
 * Translated from pm4py/objects/log/obj.py structure and pm4py test suite.
 */

describe('Event', () => {

  it('constructs empty', () => {
    const e = new Event();
    assert.equal(e.size, 0);
    assert.equal(e.length, undefined); // Map has no .length
  });

  it('constructs from plain object', () => {
    const e = new Event({ 'concept:name': 'A', cost: 100 });
    assert.equal(e.get('concept:name'), 'A');
    assert.equal(e.get('cost'), 100);
    assert.equal(e.size, 2);
  });

  it('constructs from Map', () => {
    const m = new Map([['concept:name', 'B'], ['org:resource', 'Pete']]);
    const e = new Event(m);
    assert.equal(e.get('concept:name'), 'B');
    assert.equal(e.get('org:resource'), 'Pete');
  });

  it('constructs from array of pairs', () => {
    const e = new Event([['concept:name', 'C'], ['cost', 50]]);
    assert.equal(e.get('concept:name'), 'C');
    assert.equal(e.get('cost'), 50);
  });

  it('set and get', () => {
    const e = new Event();
    e.set('concept:name', 'D');
    assert.equal(e.get('concept:name'), 'D');
  });

  it('has() returns correct boolean', () => {
    const e = new Event({ 'concept:name': 'E' });
    assert.ok(e.has('concept:name'));
    assert.ok(!e.has('org:resource'));
  });

  it('attr() returns value when key exists', () => {
    const e = new Event({ 'concept:name': 'F' });
    assert.equal(e.attr('concept:name'), 'F');
  });

  it('attr() returns fallback when key missing', () => {
    const e = new Event();
    assert.equal(e.attr('missing', 'default'), 'default');
    assert.equal(e.attr('missing'), undefined);
  });

  it('iterates keys', () => {
    const e = new Event({ a: 1, b: 2 });
    const keys = [...e.keys()];
    assert.equal(keys.length, 2);
    assert.ok(keys.includes('a'));
    assert.ok(keys.includes('b'));
  });

  it('toObject() roundtrip', () => {
    const e = new Event({ 'concept:name': 'G', cost: 99 });
    const obj = e.toObject();
    assert.equal(obj['concept:name'], 'G');
    assert.equal(obj.cost, 99);
  });

  it('is an instance of Map', () => {
    assert.instanceOf(new Event(), Map);
  });
});

describe('Trace', () => {

  function makeTrace(activities) {
    const t = new Trace();
    for (const act of activities) t.append(new Event({ 'concept:name': act }));
    return t;
  }

  it('constructs empty', () => {
    const t = new Trace();
    assert.equal(t.length, 0);
    assert.deepEqual(t.attributes, {});
    assert.deepEqual(t.properties, {});
  });

  it('append increases length', () => {
    const t = new Trace();
    t.append(new Event({ 'concept:name': 'A' }));
    assert.equal(t.length, 1);
    t.append(new Event({ 'concept:name': 'B' }));
    assert.equal(t.length, 2);
  });

  it('at() retrieves by index', () => {
    const t = makeTrace(['A', 'B', 'C']);
    assert.equal(t.at(0).get('concept:name'), 'A');
    assert.equal(t.at(2).get('concept:name'), 'C');
    assert.equal(t.at(-1).get('concept:name'), 'C');
  });

  it('is iterable', () => {
    const t = makeTrace(['A', 'B', 'C']);
    const names = [...t].map(e => e.get('concept:name'));
    assert.deepEqual(names, ['A', 'B', 'C']);
  });

  it('insert() places event at given index', () => {
    const t = makeTrace(['A', 'C']);
    t.insert(1, new Event({ 'concept:name': 'B' }));
    const names = [...t].map(e => e.get('concept:name'));
    assert.deepEqual(names, ['A', 'B', 'C']);
  });

  it('project() extracts attribute column', () => {
    const t = makeTrace(['X', 'Y', 'Z']);
    assert.deepEqual(t.project('concept:name'), ['X', 'Y', 'Z']);
  });

  it('project() yields undefined for missing key', () => {
    const t = makeTrace(['A']);
    const [val] = t.project('missing');
    assert.equal(val, undefined);
  });

  it('clone() produces independent copy', () => {
    const t = makeTrace(['A', 'B']);
    t.attributes['concept:name'] = 'case-1';
    const c = t.clone();
    assert.equal(c.length, 2);
    assert.equal(c.attributes['concept:name'], 'case-1');
    // Mutating clone does not affect original
    c.attributes['concept:name'] = 'case-2';
    assert.equal(t.attributes['concept:name'], 'case-1');
  });

  it('stores trace-level attributes', () => {
    const t = new Trace();
    t.attributes['concept:name'] = 'case-42';
    assert.equal(t.attributes['concept:name'], 'case-42');
  });
});

describe('EventLog', () => {

  function makeLog(cases) {
    // cases: [['A','B','C'], ['A','C'], ...]
    const log = new EventLog();
    for (const [i, acts] of cases.entries()) {
      const trace = new Trace();
      trace.attributes[DEFAULT_NAME_KEY] = `case-${i + 1}`;
      for (const act of acts) {
        trace.append(new Event({ [DEFAULT_NAME_KEY]: act }));
      }
      log.append(trace);
    }
    return log;
  }

  it('constructs with default properties', () => {
    const log = new EventLog();
    assert.equal(log.properties[PARAM_ACTIVITY_KEY], DEFAULT_NAME_KEY);
    assert.equal(log.properties[PARAM_TIMESTAMP_KEY], DEFAULT_TIMESTAMP_KEY);
    assert.equal(log.properties[PARAM_CASEID_KEY], DEFAULT_TRACEID_KEY);
  });

  it('length reflects trace count', () => {
    const log = makeLog([['A', 'B'], ['A', 'C']]);
    assert.equal(log.length, 2);
  });

  it('is iterable over traces', () => {
    const log = makeLog([['A'], ['B'], ['C']]);
    const caseIds = [...log].map(t => t.attributes[DEFAULT_NAME_KEY]);
    assert.deepEqual(caseIds, ['case-1', 'case-2', 'case-3']);
  });

  it('at() retrieves trace by index', () => {
    const log = makeLog([['A'], ['B']]);
    assert.equal(log.at(0).attributes[DEFAULT_NAME_KEY], 'case-1');
    assert.equal(log.at(-1).attributes[DEFAULT_NAME_KEY], 'case-2');
  });

  it('activityKey reflects properties', () => {
    const log = new EventLog();
    assert.equal(log.activityKey, DEFAULT_NAME_KEY);
    log.properties[PARAM_ACTIVITY_KEY] = 'Activity';
    assert.equal(log.activityKey, 'Activity');
  });

  it('filter() returns new log preserving metadata', () => {
    const log = makeLog([['A', 'B'], ['A'], ['A', 'B', 'C']]);
    log.classifiers['Activity'] = ['concept:name'];
    const filtered = log.filter(t => t.length >= 2);
    assert.equal(filtered.length, 2);
    assert.deepEqual(filtered.classifiers['Activity'], ['concept:name']);
    assert.equal(log.length, 3); // original unchanged
  });

  it('map() transforms traces', () => {
    const log = makeLog([['A', 'B', 'C'], ['A', 'C']]);
    const mapped = log.map(t => {
      const c = t.clone();
      c.attributes.length = t.length;
      return c;
    });
    assert.equal(mapped.at(0).attributes.length, 3);
    assert.equal(mapped.at(1).attributes.length, 2);
  });

  it('toJSON() / fromJSON() roundtrip preserves structure', () => {
    const log = makeLog([['A', 'B'], ['A', 'C']]);
    log.classifiers['Activity'] = ['concept:name'];
    log.extensions['concept'] = { name: 'Concept', uri: 'http://example.org' };

    const json = log.toJSON();
    const log2 = EventLog.fromJSON(json);

    assert.equal(log2.length, 2);
    assert.equal(log2.at(0).length, 2);
    assert.deepEqual(log2.classifiers['Activity'], ['concept:name']);
    assert.equal(log2.extensions['concept'].name, 'Concept');
  });

  it('toJSON() serializes Date as ISO string', () => {
    const log = new EventLog();
    const trace = new Trace();
    const event = new Event({ 'concept:name': 'A', 'time:timestamp': new Date('2024-01-01T00:00:00Z') });
    trace.append(event);
    log.append(trace);
    const json = log.toJSON();
    assert.equal(typeof json.traces[0].events[0]['time:timestamp'], 'string');
    assert.ok(json.traces[0].events[0]['time:timestamp'].startsWith('2024-01-01'));
  });

  it('fromJSON() parses timestamp strings back to Date', () => {
    const log = new EventLog();
    const trace = new Trace();
    trace.append(new Event({ 'time:timestamp': new Date('2024-06-15T08:00:00Z') }));
    log.append(trace);

    const log2 = EventLog.fromJSON(log.toJSON());
    assert.instanceOf(log2.at(0).at(0).get('time:timestamp'), Date);
  });
});
