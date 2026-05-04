/* VelocityX v1.0.0 - content-bridge.js */
(function () {
  'use strict';

  const Settings = globalThis.VelocityXSettings || {};
  const SiteRules = globalThis.VelocityXSiteRules;
  const root = document.documentElement;
  const REQUEST_EVENT = 'VX_EARLY_REQUEST_SETTINGS';
  const SETTINGS_EVENT = 'VX_EARLY_SETTINGS';
  const MIN_SPEED = 0.07;
  const MAX_SPEED = 16;
  const SYNC_KEYS = Array.from(Settings.SYNC_SETTINGS_KEYS || []);
  let cachedDetail = null;
  let refreshPending = false;

  if (!root || !SiteRules || window.__velocityxBridgeLoaded) return;
  window.__velocityxBridgeLoaded = true;

  function clampSpeed(value, fallback = 1.0) {
    const parsed = Math.round((parseFloat(value) || 0) * 100) / 100;
    return Math.max(MIN_SPEED, Math.min(MAX_SPEED, parsed || fallback));
  }

  function getUrlSpeedKey() {
    try {
      return 'url_' + btoa(encodeURIComponent(location.href)).slice(0, 40);
    } catch (_) {
      return null;
    }
  }

  function getDefaultSpeedValue(data = {}) {
    const configured = Number(data.defaultSpeed);
    if (Number.isFinite(configured) && configured > 0) return clampSpeed(configured, 1.0);
    const legacy = Number(data.speed);
    return Number.isFinite(legacy) && legacy > 0 ? clampSpeed(legacy, 1.0) : 1.0;
  }

  function buildPayload(data = {}) {
    const match = SiteRules.getSiteRuleMatch(data.siteRules || {}, location.hostname);
    if (data.enabled === false || match?.rule?.disabled) {
      return { abort: true, enabled: false };
    }

    const defaultSpeed = getDefaultSpeedValue(data);
    let speed = defaultSpeed;

    if (typeof match?.rule?.speed === 'number') {
      speed = match.rule.speed;
    } else {
      const urlKey = data.rememberPerUrl ? getUrlSpeedKey() : null;
      if (urlKey && Number.isFinite(Number(data[urlKey]))) {
        speed = Number(data[urlKey]);
      } else if (data.rememberSpeed && Number.isFinite(Number(data.speed))) {
        speed = Number(data.speed);
      }
    }

    return {
      abort: false,
      enabled: true,
      speed: clampSpeed(speed, defaultSpeed),
      controlAudio: data.controlAudio !== false
    };
  }

  function dispatch(detail) {
    cachedDetail = detail;
    try {
      root.dispatchEvent(new CustomEvent(SETTINGS_EVENT, { detail }));
    } catch (_) {}
  }

  function detailChanged(nextDetail, prevDetail = cachedDetail) {
    return JSON.stringify(nextDetail || {}) !== JSON.stringify(prevDetail || {});
  }

  function loadSettings() {
    if (refreshPending) return;
    refreshPending = true;

    const urlKey = getUrlSpeedKey();
    const localKeys = [...SYNC_KEYS, 'speed'];
    if (urlKey) localKeys.push(urlKey);

    chrome.storage.local.get(localKeys, localData => {
      const mergedLocal = localData || {};
      const localPayload = buildPayload(mergedLocal);
      if (detailChanged(localPayload)) dispatch(localPayload);

      if (chrome.runtime.lastError) {
        refreshPending = false;
        return;
      }

      chrome.storage.sync.get(SYNC_KEYS, syncData => {
        refreshPending = false;
        if (chrome.runtime.lastError) return;
        const mergedPayload = buildPayload({ ...mergedLocal, ...(syncData || {}) });
        if (detailChanged(mergedPayload)) dispatch(mergedPayload);
      });
    });
  }

  root.addEventListener(REQUEST_EVENT, () => {
    if (cachedDetail) {
      dispatch(cachedDetail);
      return;
    }
    loadSettings();
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' && areaName !== 'sync') return;

    const urlKey = getUrlSpeedKey();
    const relevantKeys = new Set([...(Settings.SYNC_SETTINGS_KEYS || []), 'speed']);
    if (urlKey) relevantKeys.add(urlKey);

    if (Object.keys(changes || {}).some(key => relevantKeys.has(key))) loadSettings();
  });

  loadSettings();
})();
