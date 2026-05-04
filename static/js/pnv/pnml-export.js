/**
 * Serialise a PetriNet JS model to PNML (ISO/IEC 15909-2).
 *
 * @param {PetriNet} net
 * @param {Map<string,number>} initialTokens  placeId → token count at t=0
 * @param {string} name  human-readable net name (used in <name>)
 * @returns {string} PNML XML
 */
function toPNML(net, initialTokens, name = 'model') {
  const esc = s => String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const graphics = pos =>
    pos ? `<graphics><position x="${Math.round(pos.x)}" y="${Math.round(pos.y)}"/></graphics>` : '';

  const places = Array.from(net.places.values()).map(p => {
    const init = initialTokens?.get(p.id) ?? p.tokens;
    return [
      `      <place id="${esc(p.id)}">`,
      `        <name><text>${esc(p.label ?? p.id)}</text></name>`,
      init > 0 ? `        <initialMarking><text>${init}</text></initialMarking>` : null,
      p.position ? `        ${graphics(p.position)}` : null,
      `      </place>`,
    ].filter(l => l !== null).join('\n');
  });

  const transitions = Array.from(net.transitions.values()).map(t => [
    `      <transition id="${esc(t.id)}">`,
    `        <name><text>${esc(t.silent ? '' : (t.label ?? ''))}</text></name>`,
    t.position ? `        ${graphics(t.position)}` : null,
    `      </transition>`,
  ].filter(l => l !== null).join('\n'));

  const arcs = Array.from(net.arcs.values()).map(a => [
    `      <arc id="${esc(a.id)}" source="${esc(a.source)}" target="${esc(a.target)}">`,
    `        <inscription><text>${a.weight ?? 1}</text></inscription>`,
    `      </arc>`,
  ].join('\n'));

  const finalPlaces = Array.from(net.places.values())
    .filter(p => p.finalMarking !== null && p.finalMarking > 0);
  const finalMarkings = finalPlaces.length > 0 ? [
    `  <finalmarkings>`,
    `    <marking>`,
    ...finalPlaces.map(p => `      <place idref="${esc(p.id)}"><text>${p.finalMarking}</text></place>`),
    `    </marking>`,
    `  </finalmarkings>`,
  ].join('\n') : '';

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<pnml xmlns="http://www.pnml.org/version-2009/grammar/pnml">`,
    `  <net id="net" type="http://www.pnml.org/version-2009/grammar/ptnet">`,
    `    <name><text>${esc(name)}</text></name>`,
    `    <page id="page">`,
    ...places,
    ...transitions,
    ...arcs,
    `    </page>`,
    finalMarkings,
    `  </net>`,
    `</pnml>`,
  ].filter(l => l !== '').join('\n');
}
