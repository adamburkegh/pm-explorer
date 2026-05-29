/**
 * Tests for js/discovery/variants-viz.js — pure functions only.
 *
 * DOM-dependent VariantsViewer class is not tested here.
 */

describe('variantTextColor', () => {
  it('returns dark text on a light background', () => {
    assert.equal(variantTextColor('#ffffff'), '#1a1a1a');
  });

  it('returns light text on a dark background', () => {
    assert.equal(variantTextColor('#000000'), '#ffffff');
  });

  it('returns dark text on the first palette blue (#378ADD)', () => {
    // R=55 G=138 B=221 → luminance ≈ 0.48 — above threshold of 0.45
    assert.equal(variantTextColor('#378ADD'), '#1a1a1a');
  });

  it('returns light text on the dark green (#0F6E56)', () => {
    assert.equal(variantTextColor('#0F6E56'), '#ffffff');
  });

  it('returns light text on the dark indigo (#533AB7)', () => {
    assert.equal(variantTextColor('#533AB7'), '#ffffff');
  });

  it('threshold: luminance exactly 0.45 returns dark text', () => {
    // Construct a grey where (0.299r + 0.587g + 0.114b)/255 == 0.45
    // All channels equal → each = round(0.45 * 255) = 115 → 0x73
    assert.equal(variantTextColor('#737373'), '#1a1a1a');
  });

  it('all 15 palette colours produce a valid contrast colour', () => {
    for (const col of VARIANT_PALETTE) {
      const result = variantTextColor(col);
      assert.ok(result === '#ffffff' || result === '#1a1a1a',
        `${col} → unexpected result: ${result}`);
    }
  });
});

describe('VARIANT_PALETTE', () => {
  it('has 15 entries', () => {
    assert.equal(VARIANT_PALETTE.length, 15);
  });

  it('all entries are valid 6-digit hex colours', () => {
    for (const col of VARIANT_PALETTE) {
      assert.ok(/^#[0-9A-Fa-f]{6}$/.test(col), `invalid colour: ${col}`);
    }
  });

  it('all entries are distinct', () => {
    const unique = new Set(VARIANT_PALETTE);
    assert.equal(unique.size, VARIANT_PALETTE.length);
  });
});
