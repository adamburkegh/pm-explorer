/**
 * Tests for XesParser.
 * Translated from pm4py/tests/xes_impexp_test.py and iterparse.py logic.
 *
 * Uses inline XES fixtures so tests are sync and server-independent.
 * The functional tests at the bottom fetch actual files from static/data/.
 */

// ── Shared inline XES fixtures ────────────────────────────────────────────────

// Minimal log covering all primitive XES attribute types.
// 3 traces: case-1=[A,B,C], case-2=[A,C], case-3=[A,B,C]
const XES_BASIC = `<?xml version="1.0" encoding="UTF-8"?>
<log>
  <extension name="Concept" prefix="concept" uri="http://www.xes-standard.org/concept.xesext"/>
  <extension name="Time"    prefix="time"    uri="http://www.xes-standard.org/time.xesext"/>
  <global scope="trace">
    <string key="concept:name" value="UNKNOWN"/>
  </global>
  <global scope="event">
    <string key="concept:name" value="UNKNOWN"/>
    <date   key="time:timestamp" value="1970-01-01T00:00:00.000Z"/>
  </global>
  <classifier name="Activity" keys="concept:name"/>
  <trace>
    <string key="concept:name" value="case-1"/>
    <event>
      <string  key="concept:name"      value="A"/>
      <date    key="time:timestamp"    value="2024-01-01T10:00:00.000Z"/>
      <int     key="cost"              value="100"/>
      <float   key="score"             value="3.14"/>
      <boolean key="approved"          value="true"/>
      <id      key="uuid"              value="abc-123"/>
    </event>
    <event>
      <string key="concept:name"    value="B"/>
      <date   key="time:timestamp"  value="2024-01-01T11:00:00.000Z"/>
    </event>
    <event>
      <string key="concept:name"    value="C"/>
      <date   key="time:timestamp"  value="2024-01-01T12:00:00.000Z"/>
    </event>
  </trace>
  <trace>
    <string key="concept:name" value="case-2"/>
    <event>
      <string key="concept:name"    value="A"/>
      <date   key="time:timestamp"  value="2024-01-02T10:00:00.000Z"/>
    </event>
    <event>
      <string key="concept:name"    value="C"/>
      <date   key="time:timestamp"  value="2024-01-02T11:00:00.000Z"/>
    </event>
  </trace>
  <trace>
    <string key="concept:name" value="case-3"/>
    <event>
      <string key="concept:name"    value="A"/>
      <date   key="time:timestamp"  value="2024-01-03T10:00:00.000Z"/>
    </event>
    <event>
      <string key="concept:name"    value="B"/>
      <date   key="time:timestamp"  value="2024-01-03T11:00:00.000Z"/>
    </event>
    <event>
      <string key="concept:name"    value="C"/>
      <date   key="time:timestamp"  value="2024-01-03T12:00:00.000Z"/>
    </event>
  </trace>
</log>`;

// Log where events are out of timestamp order, to test sortByTimestamp.
const XES_UNSORTED = `<?xml version="1.0" encoding="UTF-8"?>
<log>
  <trace>
    <string key="concept:name" value="case-1"/>
    <event>
      <string key="concept:name"   value="B"/>
      <date   key="time:timestamp" value="2024-01-01T12:00:00.000Z"/>
    </event>
    <event>
      <string key="concept:name"   value="A"/>
      <date   key="time:timestamp" value="2024-01-01T08:00:00.000Z"/>
    </event>
    <event>
      <string key="concept:name"   value="C"/>
      <date   key="time:timestamp" value="2024-01-01T16:00:00.000Z"/>
    </event>
  </trace>
</log>`;

// Log with a list attribute.
const XES_LIST = `<?xml version="1.0" encoding="UTF-8"?>
<log>
  <trace>
    <string key="concept:name" value="case-1"/>
    <event>
      <string key="concept:name" value="A"/>
      <list key="tags">
        <values>
          <string key="tag" value="urgent"/>
          <string key="tag" value="review"/>
        </values>
      </list>
    </event>
  </trace>
</log>`;

// ── Parser tests ──────────────────────────────────────────────────────────────

describe('XesParser', () => {

  describe('basic structure', () => {
    const log = xesParser.parse(XES_BASIC);

    it('returns an EventLog', () => {
      assert.instanceOf(log, EventLog);
    });

    it('parses correct number of traces — mirrors pm4py len(log)==3 assertion', () => {
      assert.equal(log.length, 3);
    });

    it('parses correct number of events per trace', () => {
      assert.equal(log.at(0).length, 3);  // case-1: A,B,C
      assert.equal(log.at(1).length, 2);  // case-2: A,C
      assert.equal(log.at(2).length, 3);  // case-3: A,B,C
    });

    it('reads trace-level attributes', () => {
      assert.equal(log.at(0).attributes['concept:name'], 'case-1');
      assert.equal(log.at(1).attributes['concept:name'], 'case-2');
    });

    it('reads string event attributes', () => {
      assert.equal(log.at(0).at(0).get('concept:name'), 'A');
    });

    it('reads extension declarations', () => {
      assert.ok('concept' in log.extensions);
      assert.ok('time' in log.extensions);
      assert.equal(log.extensions.concept.name, 'Concept');
    });

    it('reads classifiers', () => {
      assert.ok('Activity' in log.classifiers);
      assert.deepEqual(log.classifiers.Activity, ['concept:name']);
    });

    it('reads global event defaults into omniPresent', () => {
      assert.ok('event' in log.omniPresent);
      assert.ok('concept:name' in log.omniPresent.event);
    });

    it('reads global trace defaults into omniPresent', () => {
      assert.ok('trace' in log.omniPresent);
    });

    it('sets default properties after import', () => {
      assert.equal(log.properties[PARAM_ACTIVITY_KEY],  DEFAULT_NAME_KEY);
      assert.equal(log.properties[PARAM_TIMESTAMP_KEY], DEFAULT_TIMESTAMP_KEY);
    });
  });

  describe('XES type parsing', () => {
    const event = xesParser.parse(XES_BASIC).at(0).at(0);

    it('string → string', () => {
      assert.equal(typeof event.get('concept:name'), 'string');
      assert.equal(event.get('concept:name'), 'A');
    });

    it('date → Date', () => {
      const ts = event.get('time:timestamp');
      assert.instanceOf(ts, Date);
      assert.equal(ts.getUTCFullYear(), 2024);
      assert.equal(ts.getUTCMonth(), 0);   // January
      assert.equal(ts.getUTCDate(), 1);
      assert.equal(ts.getUTCHours(), 10);
    });

    it('int → number (integer)', () => {
      const cost = event.get('cost');
      assert.equal(typeof cost, 'number');
      assert.equal(cost, 100);
      assert.equal(cost % 1, 0);
    });

    it('float → number', () => {
      const score = event.get('score');
      assert.equal(typeof score, 'number');
      assert.closeTo(score, 3.14, 1e-6);
    });

    it('boolean true → boolean', () => {
      const approved = event.get('approved');
      assert.equal(typeof approved, 'boolean');
      assert.equal(approved, true);
    });

    it('id → string', () => {
      const uuid = event.get('uuid');
      assert.equal(typeof uuid, 'string');
      assert.equal(uuid, 'abc-123');
    });
  });

  describe('list attribute', () => {
    const log = xesParser.parse(XES_LIST);
    const event = log.at(0).at(0);

    it('list → object with values array', () => {
      const tags = event.get('tags');
      assert.ok(tags !== null && typeof tags === 'object');
      assert.ok(Array.isArray(tags.values));
      assert.equal(tags.values.length, 2);
    });

    it('list values carry key and value', () => {
      const tags = event.get('tags');
      assert.equal(tags.values[0].key, 'tag');
      assert.equal(tags.values[0].value, 'urgent');
      assert.equal(tags.values[1].value, 'review');
    });
  });

  describe('sortByTimestamp', () => {
    it('default: sorts events in ascending timestamp order', () => {
      const log = xesParser.parse(XES_UNSORTED);
      const names = log.at(0).project('concept:name');
      assert.deepEqual(names, ['A', 'B', 'C']);
    });

    it('sortByTimestamp=false: preserves original event order', () => {
      const log = xesParser.parse(XES_UNSORTED, { sortByTimestamp: false });
      const names = log.at(0).project('concept:name');
      assert.deepEqual(names, ['B', 'A', 'C']);
    });
  });

  describe('maxTraces parameter', () => {
    it('limits the number of imported traces', () => {
      const log = xesParser.parse(XES_BASIC, { maxTraces: 2 });
      assert.equal(log.length, 2);
    });

    it('maxTraces=0 imports no traces', () => {
      const log = xesParser.parse(XES_BASIC, { maxTraces: 0 });
      assert.equal(log.length, 0);
    });
  });

  describe('global defaults applied to events', () => {
    it('missing event attribute is filled from global default', () => {
      // case-2 events have no explicit time:timestamp — global default should apply
      const log = xesParser.parse(XES_BASIC, { sortByTimestamp: false });
      // Actually case-2 events DO have timestamps in our fixture, so test concept:name default
      // Add a fixture where an event omits concept:name to verify default injection
      const xes = `<?xml version="1.0" encoding="UTF-8"?>
<log>
  <global scope="event">
    <string key="concept:name" value="DEFAULT_ACT"/>
  </global>
  <trace>
    <string key="concept:name" value="c1"/>
    <event><string key="other" value="x"/></event>
  </trace>
</log>`;
      const log2 = xesParser.parse(xes, { sortByTimestamp: false });
      assert.equal(log2.at(0).at(0).get('concept:name'), 'DEFAULT_ACT');
    });
  });

  describe('error handling', () => {
    it('throws on malformed XML', () => {
      assert.throws(() => xesParser.parse('<log><trace></log>'));
    });

    it('throws when root element is not <log>', () => {
      assert.throws(() => xesParser.parse('<foo/>'));
    });
  });

  // ── Functional test: running_example.xes (inline fixture, no fetch) ───────
  // Translated from pm4py xes_impexp_test.py: self.assertEqual(len(log), 6)
  describe('functional: running_example.xes', () => {
    const log = xesParser.parse(RUNNING_EXAMPLE_XES);

    it('has 6 traces — mirrors pm4py len(log)==6', () => {
      assert.instanceOf(log, EventLog);
      assert.equal(log.length, 6);
    });

    it('all traces start with register request', () => {
      for (const trace of log) {
        assert.equal(trace.at(0).get('concept:name'), 'register request');
      }
    });

    it('known activities are present', () => {
      const acts = getActivities(log);
      for (const act of ['register request', 'examine casually', 'check ticket',
                         'decide', 'reinitiate request', 'examine thoroughly',
                         'pay compensation', 'reject request']) {
        assert.includes(acts, act);
      }
    });

    it('has extensions and classifiers', () => {
      assert.ok(Object.keys(log.extensions).length > 0);
      assert.ok(Object.keys(log.classifiers).length > 0);
    });

    it('timestamps parsed as Date objects', () => {
      assert.instanceOf(log.at(0).at(0).get('time:timestamp'), Date);
    });
  });
});
