(function (global) {
  'use strict';

  function getMessage(key, substitutions) {
    if (!key) return '';
    try {
      return chrome?.i18n?.getMessage(key, substitutions) || '';
    } catch (_) {
      return '';
    }
  }

  function applyLocalization(root = document) {
    if (!root?.querySelectorAll) return;

    root.querySelectorAll('[data-i18n]').forEach(el => {
      const message = getMessage(el.dataset.i18n);
      if (message) el.textContent = message;
    });

    root.querySelectorAll('[data-i18n-html]').forEach(el => {
      const message = getMessage(el.dataset.i18nHtml);
      if (message) el.innerHTML = message;
    });

    root.querySelectorAll('[data-i18n-title]').forEach(el => {
      const message = getMessage(el.dataset.i18nTitle);
      if (message) el.title = message;
    });

    root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const message = getMessage(el.dataset.i18nPlaceholder);
      if (message) el.placeholder = message;
    });

    root.querySelectorAll('[data-i18n-label]').forEach(el => {
      const message = getMessage(el.dataset.i18nLabel);
      if (message) el.setAttribute('aria-label', message);
    });

    const titleKey = document.documentElement?.dataset?.i18nTitle;
    const title = getMessage(titleKey);
    if (title) document.title = title;
  }

  global.VelocityXI18n = {
    applyLocalization,
    getMessage
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => applyLocalization());
  } else {
    applyLocalization();
  }
})(globalThis);
