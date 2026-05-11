/**
 * Shared XML / HTML escaping utility.
 *
 * Escapes the five characters that are special in XML attribute values and
 * element content: & < > " '
 *
 * Handles null / undefined by converting to an empty string first.
 *
 * @param {*} s
 * @returns {string}
 */
function xmlEscape(s) {
  return String(s ?? '')
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&apos;');
}
