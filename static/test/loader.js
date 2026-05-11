/**
 * Test loader — browser side.
 *
 * Reads test/manifest.json synchronously (XMLHttpRequest) and loads all
 * scripts in order:
 *   1. source dependencies
 *   2. test/runner.js  (the browser test framework)
 *   3. fixtures and test suites
 *
 * Enables the Run button and updates status text when all scripts are loaded.
 *
 * All src paths in the manifest are relative to the static root,
 * which matches the document base when test-runner.html is served from there.
 */
(function () {
  function get(url) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, false);  // synchronous
    xhr.send(null);
    if (xhr.status < 200 || xhr.status >= 300)
      throw new Error('HTTP ' + xhr.status + ' — ' + url);
    return xhr.responseText;
  }

  function loadScript(src) {
    console.log('[loader] loading:', src);
    var s = document.createElement('script');
    s.textContent = get(src);
    document.head.appendChild(s);  // executes synchronously
  }

  try {
    console.log('[loader] fetching manifest');
    var manifest = JSON.parse(get('test/manifest.json'));
    console.log('[loader] manifest ok —', manifest.sources.length, 'sources,', manifest.tests.length, 'tests');

    manifest.sources.forEach(loadScript);
    console.log('[loader] loading runner');
    loadScript('test/runner.js');
    manifest.tests.forEach(loadScript);
    console.log('[loader] all loaded');

    document.getElementById('btn-run').disabled = false;
    document.getElementById('test-output').innerHTML =
      '<div id="loading">Click "Run all" to execute tests.</div>';
  } catch (err) {
    console.error('[loader] error:', err);
    document.getElementById('test-output').innerHTML =
      '<div style="color:#f47c7c;padding:12px">Failed to load test suite: ' + err.message + '</div>';
  }
})();
