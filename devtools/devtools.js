(function () {
  'use strict';

  const getMessage = key => globalThis.VelocityXI18n?.getMessage(key) || '';
  const panelTitle = getMessage('devtoolsPanelTitle') || 'VelocityX';

  chrome.devtools.panels.create(panelTitle, '', 'devtools/panel.html', () => {});
})();
