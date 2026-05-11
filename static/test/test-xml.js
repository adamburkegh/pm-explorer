/**
 * Tests for js/xml.js — xmlEscape()
 */

describe('xmlEscape', () => {
  it('passes through plain ASCII with no special characters', () => {
    assert.equal(xmlEscape('hello world'), 'hello world');
  });

  it('escapes ampersand', () => {
    assert.equal(xmlEscape('bread & butter'), 'bread &amp; butter');
  });

  it('escapes less-than', () => {
    assert.equal(xmlEscape('a < b'), 'a &lt; b');
  });

  it('escapes greater-than', () => {
    assert.equal(xmlEscape('a > b'), 'a &gt; b');
  });

  it('escapes double quote', () => {
    assert.equal(xmlEscape('say "hello"'), 'say &quot;hello&quot;');
  });

  it('escapes single quote / apostrophe', () => {
    assert.equal(xmlEscape("it's fine"), 'it&apos;s fine');
  });

  it('escapes all five special characters in one string', () => {
    assert.equal(xmlEscape(`<tag attr="it's a & b">`), '&lt;tag attr=&quot;it&apos;s a &amp; b&quot;&gt;');
  });

  it('escapes ampersand before other replacements (no double-encoding)', () => {
    // If & were escaped last, "&lt;" would become "&amp;lt;" — wrong.
    assert.equal(xmlEscape('&lt;'), '&amp;lt;');
  });

  it('converts null to empty string', () => {
    assert.equal(xmlEscape(null), '');
  });

  it('converts undefined to empty string', () => {
    assert.equal(xmlEscape(undefined), '');
  });

  it('converts numbers to their string representation', () => {
    assert.equal(xmlEscape(42), '42');
    assert.equal(xmlEscape(3.14), '3.14');
  });

  it('empty string returns empty string', () => {
    assert.equal(xmlEscape(''), '');
  });

  it('string with no special characters is returned unchanged', () => {
    const s = 'register request';
    assert.equal(xmlEscape(s), s);
  });
});
