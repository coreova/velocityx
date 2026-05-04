(function () {
  'use strict';

  const t = (key, fallback = '') => globalThis.VelocityXI18n?.getMessage(key) || fallback;
  const tabId = chrome.devtools.inspectedWindow.tabId;

  function setJson(id, value, fallback = '{}') {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = typeof value === 'string'
      ? value
      : JSON.stringify(value ?? JSON.parse(fallback), null, 2);
  }

  function renderSnapshot(snapshot = {}) {
    const settings = snapshot.settings || {};
    const page = snapshot.page;
    const mediaCount = Array.isArray(page?.media) ? page.media.length : 0;
    const controllerCount = Array.isArray(page?.controllers) ? page.controllers.length : 0;

    document.getElementById('summarySettings').textContent = Object.keys(settings).length;
    document.getElementById('summaryMedia').textContent = mediaCount;
    document.getElementById('summaryControllers').textContent = controllerCount;

    setJson('snapshotMeta', {
      capturedAt: snapshot.capturedAt || null,
      tabId: snapshot.tabId || tabId,
      error: snapshot.error || null,
      pageAvailable: !!page
    });
    setJson('settingsDump', settings);

    if (page) {
      setJson('pageDump', page);
    } else {
      document.getElementById('pageDump').textContent = t('devtoolsNoData', 'No content-script snapshot is available for this tab yet.');
    }
  }

  function refreshSnapshot() {
    chrome.runtime.sendMessage({ type: 'DEVTOOLS_GET_SNAPSHOT', tabId }, snapshot => {
      if (chrome.runtime.lastError) {
        renderSnapshot({
          capturedAt: new Date().toISOString(),
          tabId,
          error: chrome.runtime.lastError.message,
          settings: {},
          page: null
        });
        return;
      }
      renderSnapshot(snapshot || {});
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('refreshSnapshot')?.addEventListener('click', refreshSnapshot);
    document.getElementById('openOptions')?.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' });
    });
    refreshSnapshot();
    setInterval(refreshSnapshot, 2500);
  });
})();
