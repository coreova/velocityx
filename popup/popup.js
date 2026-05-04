/* VelocityX v1.0.0 - popup.js */
(function () {
  'use strict';

  let cur = 1.0;
  let extensionEnabled = true;
  const Settings = globalThis.VelocityXSettings || {};
  const ShortcutUtils = globalThis.VelocityXShortcuts || {};
  const SiteRules = globalThis.VelocityXSiteRules;
  const t = (key, fallback = '') => globalThis.VelocityXI18n?.getMessage(key) || fallback;
  const MAX_ARC = 264;
  const MIN_SPEED = 0.07;
  const MAX_SPEED = 16;
  const DEFAULT_SPEED_STEP = Number(Settings.DEFAULTS?.step) > 0 ? Number(Settings.DEFAULTS.step) : 0.1;
  const LOOP_MIN_SECONDS = 5;
  const LOOP_MAX_SECONDS = 300;
  const LOOP_DEFAULT_NOTICE = t('popupLoopNotice', 'Loop range: 5-300 seconds. If you click early, VelocityX uses the available watched portion.');
  const SYNC_SETTINGS_KEYS = new Set(Settings.SYNC_SETTINGS_KEYS || []);
  const POPUP_STORAGE_KEYS = Array.from(new Set([
    ...(Settings.SYNC_SETTINGS_KEYS || []),
    'speed',
    'weekTimeSaved',
    'totalTimeSaved'
  ]));
  const POPUP_STORAGE_KEY_SET = new Set(POPUP_STORAGE_KEYS);
  let activeHostname = '';
  let activeTabUrl = '';
  let fileSchemeAccessAllowed = true;
  let currentSettings = {};
  let lastState = null;
  let stateSyncTimer = 0;
  let stateSyncPending = false;

  function getUrlSpeedKey(url = activeTabUrl) {
    try {
      return url ? 'url_' + btoa(encodeURIComponent(url)).slice(0, 40) : null;
    } catch (_) {
      return null;
    }
  }

  function fmt(sec) {
    sec = Math.floor(sec || 0);
    if (sec < 60) return sec + 's';
    if (sec < 3600) return Math.floor(sec / 60) + 'm ' + (sec % 60) + 's';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return h + 'h ' + m + 'm';
  }

  function clampLoopSeconds(value) {
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed)) return 10;
    return Math.max(LOOP_MIN_SECONDS, Math.min(LOOP_MAX_SECONDS, parsed));
  }

  function getPopupSpeedStep() {
    const step = Number(currentSettings?.step);
    return Number.isFinite(step) && step > 0 ? step : DEFAULT_SPEED_STEP;
  }

  function getStoredDisplaySpeed(settings = currentSettings) {
    const source = settings || {};
    const defaultSpeed = source.defaultSpeed ?? source.speed ?? 1.0;
    const urlKey = source.rememberPerUrl ? getUrlSpeedKey() : null;
    if (urlKey && Number.isFinite(Number(source[urlKey]))) {
      return Number(source[urlKey]);
    }
    return source.rememberSpeed
      ? (source.speed ?? defaultSpeed)
      : defaultSpeed;
  }

  function normalizeSpeed(speed, fallback = cur) {
    const parsed = Math.round((parseFloat(speed) || 0) * 100) / 100;
    const base = Math.round((parseFloat(fallback) || 1) * 100) / 100;
    return Math.max(MIN_SPEED, Math.min(MAX_SPEED, parsed || base));
  }

  function buildRememberedSpeedPatch(speed, settings = currentSettings) {
    const patch = {};
    const normalizedSpeed = normalizeSpeed(speed);
    if (!Number.isFinite(normalizedSpeed)) return patch;
    if (settings?.rememberSpeed) patch.speed = normalizedSpeed;
    const urlKey = settings?.rememberPerUrl ? getUrlSpeedKey() : null;
    if (urlKey) patch[urlKey] = normalizedSpeed;
    return patch;
  }

  function persistRememberedSpeedSelection(speed, settings = currentSettings, callback) {
    const patch = buildRememberedSpeedPatch(speed, settings);
    if (!Object.keys(patch).length) {
      callback?.(patch);
      return;
    }
    currentSettings = { ...currentSettings, ...patch };
    persistState(patch, () => callback?.(patch));
  }

  function setControlValue(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    el[typeof value === 'boolean' ? 'checked' : 'value'] = value;
  }

  function getLoopSecondsInput() {
    return document.getElementById('loopSeconds');
  }

  function setLoopSecondsInputValue(value, { force = false } = {}) {
    const input = getLoopSecondsInput();
    if (!input) return;
    if (!force && document.activeElement === input) return;
    input.value = clampLoopSeconds(value || currentSettings.loopSeconds || 10);
  }

  function saveLoopSeconds(value, { refreshLoopState = true, sendSettingsUpdate = true } = {}) {
    const loopSeconds = clampLoopSeconds(value);
    currentSettings = { ...currentSettings, loopSeconds };
    setLoopSecondsInputValue(loopSeconds, { force: true });
    persistState({ loopSeconds }, () => {
      if (sendSettingsUpdate) {
        sendToTab({ type: 'SETTINGS_UPDATE', settings: { loopSeconds } }, () => {
          if (refreshLoopState) syncLoopState();
        });
      } else if (refreshLoopState) {
        syncLoopState();
      }
      syncToAllTabs({ loopSeconds });
    });
    setLoopNotice(`Loop window saved: ${loopSeconds}s. Range stays between ${LOOP_MIN_SECONDS}s and ${LOOP_MAX_SECONDS}s.`);
    return loopSeconds;
  }

  function commitLoopSecondsInput() {
    const input = getLoopSecondsInput();
    if (!input) return clampLoopSeconds(currentSettings.loopSeconds || 10);

    const rawValue = String(input.value ?? '').trim();
    const fallbackValue = clampLoopSeconds(currentSettings.loopSeconds || 10);
    if (!rawValue) {
      setLoopSecondsInputValue(fallbackValue, { force: true });
      return fallbackValue;
    }

    const parsed = parseInt(rawValue, 10);
    if (!Number.isFinite(parsed)) {
      setLoopSecondsInputValue(fallbackValue, { force: true });
      return fallbackValue;
    }

    const loopSeconds = clampLoopSeconds(parsed);
    if (loopSeconds === fallbackValue) {
      setLoopSecondsInputValue(loopSeconds, { force: true });
      return loopSeconds;
    }

    return saveLoopSeconds(loopSeconds);
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[ch]));
  }

  function primaryShortcut(action, fallback = 'Unset') {
    return ShortcutUtils.getPrimaryActionShortcut
      ? ShortcutUtils.getPrimaryActionShortcut(currentSettings, action, fallback)
      : fallback;
  }

  function shortcutList(action, empty = 'Unassigned') {
    return ShortcutUtils.formatActionShortcuts
      ? ShortcutUtils.formatActionShortcuts(currentSettings, action, { empty })
      : empty;
  }

  function withShortcut(label, action) {
    return ShortcutUtils.withShortcutLabel
      ? ShortcutUtils.withShortcutLabel(label, currentSettings, action)
      : label;
  }

  function renderShortcutSummary(id, items = []) {
    const el = document.getElementById(id);
    if (!el) return;
    const visibleParts = items.map(item => `<kbd>${escapeHtml(primaryShortcut(item.action))}</kbd> ${escapeHtml(item.label)}`);
    const titleParts = items.map(item => `${item.label}: ${shortcutList(item.action)}`);
    el.innerHTML = visibleParts.join(' &nbsp; ');
    el.title = titleParts.join(' | ');
  }

  function renderShortcutAwareUI(settings = {}) {
    currentSettings = { ...currentSettings, ...(settings || {}) };

    const decrease = document.getElementById('decrease');
    const increase = document.getElementById('increase');
    if (decrease) decrease.title = withShortcut('Decrease speed', 'decreaseSpeed');
    if (increase) increase.title = withShortcut('Increase speed', 'increaseSpeed');

    const loopFeatureDesc = document.getElementById('loopFeatureDesc');
    if (loopFeatureDesc) {
      loopFeatureDesc.innerHTML = `Loop backward from the point you click it <kbd>${escapeHtml(primaryShortcut('toggleLoop'))}</kbd>`;
      loopFeatureDesc.title = `Loop shortcut: ${shortcutList('toggleLoop')}`;
    }

    const loopToggle = document.getElementById('loopToggle');
    if (loopToggle) loopToggle.title = withShortcut('Toggle Loop Last N Seconds', 'toggleLoop');

    renderShortcutSummary('abShortcutSummary', [
      { action: 'setABStart', label: 'Set A' },
      { action: 'setABEnd', label: 'Set B' },
      { action: 'clearABLoop', label: 'Clear' }
    ]);
    renderShortcutSummary('markJumpShortcutSummary', [
      { action: 'setMark', label: 'Mark' },
      { action: 'jumpToMark', label: 'Jump/Return' }
    ]);
    renderShortcutSummary('presetShortcutSummary', [
      { action: 'preset1', label: 'P1' },
      { action: 'preset2', label: 'P2' },
      { action: 'preset3', label: 'P3' }
    ]);
    renderShortcutSummary('pipShortcutSummary', [
      { action: 'togglePiP', label: 'Toggle picture-in-picture' }
    ]);
  }

  function getActiveHostname(url = '') {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'file:') return 'Local File';
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
      return SiteRules?.cleanDomain(parsed.hostname) || parsed.hostname.toLowerCase();
    } catch (_) {
      return '';
    }
  }

  function isLocalFileUrl(url = activeTabUrl) {
    try {
      return new URL(url).protocol === 'file:';
    } catch (_) {
      return false;
    }
  }

  function refreshActiveTabContext(callback) {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      activeTabUrl = tabs[0]?.url || '';
      activeHostname = getActiveHostname(activeTabUrl);

      if (!isLocalFileUrl(activeTabUrl) || typeof chrome.extension?.isAllowedFileSchemeAccess !== 'function') {
        fileSchemeAccessAllowed = true;
        callback?.();
        return;
      }

      try {
        chrome.extension.isAllowedFileSchemeAccess(allowed => {
          fileSchemeAccessAllowed = !!allowed;
          callback?.();
        });
      } catch (_) {
        fileSchemeAccessAllowed = true;
        callback?.();
      }
    });
  }

  function loadActiveTabRememberedSpeed(callback) {
    const urlKey = getUrlSpeedKey();
    if (!urlKey) {
      callback?.();
      return;
    }

    chrome.storage.local.get([urlKey], data => {
      if (chrome.runtime.lastError) {
        callback?.();
        return;
      }
      if (Object.prototype.hasOwnProperty.call(data || {}, urlKey)) currentSettings[urlKey] = data[urlKey];
      else delete currentSettings[urlKey];
      callback?.();
    });
  }

  function getSyncQuery(keys) {
    if (keys == null) return Array.from(SYNC_SETTINGS_KEYS);
    if (typeof keys === 'string') return SYNC_SETTINGS_KEYS.has(keys) ? keys : null;
    if (Array.isArray(keys)) {
      const syncKeys = keys.filter(key => SYNC_SETTINGS_KEYS.has(key));
      return syncKeys.length ? syncKeys : null;
    }
    if (typeof keys === 'object') {
      const syncDefaults = {};
      Object.keys(keys).forEach(key => {
        if (SYNC_SETTINGS_KEYS.has(key)) syncDefaults[key] = keys[key];
      });
      return Object.keys(syncDefaults).length ? syncDefaults : null;
    }
    return null;
  }

  function getMergedStorage(keys, callback) {
    chrome.storage.local.get(keys, localData => {
      const syncQuery = getSyncQuery(keys);
      if (!syncQuery) {
        callback(localData || {});
        return;
      }
      chrome.storage.sync.get(syncQuery, syncData => {
        callback({ ...(localData || {}), ...(syncData || {}) });
      });
    });
  }

  function persistState(obj, callback) {
    const syncSettings = {};
    Object.entries(obj || {}).forEach(([key, value]) => {
      if (SYNC_SETTINGS_KEYS.has(key)) syncSettings[key] = value;
    });
    let pending = 1;
    const done = () => {
      pending--;
      if (pending <= 0) callback?.();
    };

    chrome.storage.local.set(obj, done);

    if (Object.keys(syncSettings).length) {
      pending++;
      chrome.storage.sync.set(syncSettings, () => {
        if (chrome.runtime.lastError) {
          console.warn('[VelocityX] Failed to sync popup settings to chrome.storage.sync.', chrome.runtime.lastError.message);
        }
        done();
      });
    }
  }

  function formatSpeedText(speed) {
    const rounded = Math.round((parseFloat(speed) || 0) * 100) / 100;
    return Number.isInteger(rounded)
      ? rounded.toFixed(0)
      : ((rounded * 10) % 1 === 0 ? rounded.toFixed(1) : rounded.toFixed(2));
  }

  function renderMediaState(state) {
    lastState = state || null;
    const card = document.getElementById('mediaCard');
    const site = document.getElementById('mediaSite');
    const title = document.getElementById('mediaTitle');
    const meta = document.getElementById('mediaMeta');
    const mediaState = document.getElementById('mediaState');
    if (!card || !site || !title || !meta || !mediaState) return;

    if (!state?.hasMedia) {
      card.hidden = true;
      site.textContent = activeHostname || 'No active media';
      title.textContent = 'Open a page with a video or audio player.';
      meta.textContent = 'VelocityX will show playback info here when it finds active media.';
      mediaState.textContent = state ? 'Waiting' : 'Idle';
      return;
    }

    card.hidden = false;
    site.textContent = state.hostname || activeHostname || 'This tab';
    mediaState.textContent = state.paused ? 'Paused' : 'Playing';
    title.textContent = state.title || 'Untitled page';

    const timeBits = [];
    if (Number.isFinite(state.currentTime)) timeBits.push(fmt(state.currentTime));
    if (Number.isFinite(state.duration)) timeBits.push(`of ${fmt(state.duration)}`);
    const statusBits = [
      state.mediaKind ? state.mediaKind.toUpperCase() : '',
      timeBits.join(' '),
      state.muted ? 'Muted' : `${Math.round((state.volume || 0) * 100)}% volume`
    ].filter(Boolean);
    meta.textContent = statusBits.join(' · ');
  }

  function renderUnavailableMediaState(titleText, metaText, statusText = 'Unavailable') {
    const card = document.getElementById('mediaCard');
    const site = document.getElementById('mediaSite');
    const title = document.getElementById('mediaTitle');
    const meta = document.getElementById('mediaMeta');
    const mediaState = document.getElementById('mediaState');
    if (!card || !site || !title || !meta || !mediaState) return;

    lastState = null;
    card.hidden = false;
    site.textContent = activeHostname || 'This tab';
    title.textContent = titleText;
    meta.textContent = metaText;
    mediaState.textContent = statusText;
  }

  function localizeStaticText() {
    const setText = (selector, key) => {
      const el = document.querySelector(selector);
      const message = t(key);
      if (el && message) el.textContent = message;
    };

    setText('.logo-text', 'extShortName');
    setText('#loopNotice', 'popupLoopNotice');

    const loopLabel = document.querySelector('.feature-label-wrap .feature-label');
    const loopLabelMessage = t('popupLoopTitle');
    if (loopLabel && loopLabelMessage) {
      const textNode = Array.from(loopLabel.childNodes).find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
      if (textNode) textNode.textContent = '\n        ' + loopLabelMessage + '\n      ';
    }

    const loopDesc = document.querySelector('.feature-label-wrap .feature-desc');
    const loopDescMessage = t('popupLoopDesc');
    if (loopDesc && loopDescMessage) {
      const textNode = Array.from(loopDesc.childNodes).find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
      if (textNode) textNode.textContent = loopDescMessage + ' ';
    }

    const shortcutTitles = document.querySelectorAll('.shortcut-title');
    const shortcutKeys = ['popupShortcutAB', 'popupShortcutMark', 'popupShortcutPresets', 'popupShortcutPip'];
    shortcutTitles.forEach((el, index) => {
      const message = t(shortcutKeys[index]);
      if (message) el.textContent = message;
    });

    const featureHintTitle = document.getElementById('featureHintTitle');
    if (featureHintTitle) {
      featureHintTitle.textContent = t('popupFeatureHintTitle', featureHintTitle.textContent);
    }

    const featureHintCopy = document.getElementById('featureHintCopy');
    if (featureHintCopy) {
      featureHintCopy.textContent = t(
        'popupFeatureHintCopy',
        featureHintCopy.textContent
      );
    }

    const toggleRows = document.querySelectorAll('.toggles .toggle-row');
    const toggleKeys = [
      ['popupSilenceLabel', 'popupSilenceDesc'],
      ['popupRememberLabel', 'popupRememberDesc'],
      ['popupRememberUrlLabel', 'popupRememberUrlDesc']
    ];
    toggleRows.forEach((row, index) => {
      const [labelKey, descKey] = toggleKeys[index] || [];
      const label = row.querySelector('.toggle-label');
      const desc = row.querySelector('.toggle-desc');
      const labelMessage = t(labelKey);
      const descMessage = t(descKey);
      if (label && labelMessage) {
        const textNode = Array.from(label.childNodes).find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
        if (textNode) textNode.textContent = '\n          ' + labelMessage + '\n        ';
      }
      if (desc && descMessage) desc.textContent = descMessage;
    });

    const statLabels = document.querySelectorAll('.stat-lbl');
    const statKeys = ['popupWeekSavedLabel', 'popupTotalSavedLabel'];
    statLabels.forEach((el, index) => {
      const message = t(statKeys[index]);
      if (message) el.textContent = message;
    });

    const fullStatsBtn = document.getElementById('viewStats');
    if (fullStatsBtn) fullStatsBtn.textContent = t('popupViewStats', fullStatsBtn.textContent);

    const footerCopy = document.querySelector('.popup-footer-copy');
    if (footerCopy) footerCopy.textContent = t('popupFooterBy', footerCopy.textContent);

    const toggleTitle = t('popupToggleTitle');
    const settingsTitle = t('popupSettingsTitle');
    const headerToggle = document.querySelector('.header-toggle');
    const openSettings = document.getElementById('openSettings');
    if (headerToggle && toggleTitle) headerToggle.title = toggleTitle;
    if (openSettings && settingsTitle) openSettings.title = settingsTitle;
  }

  function hydrateUserPresets(data = {}) {
    document.querySelectorAll('.user-preset').forEach(button => {
      const index = button.dataset.presetNum;
      const key = `preset${index}Speed`;
      const fallback = parseFloat(button.dataset.speed || '1');
      const speed = Number.isFinite(Number(data[key])) ? Number(data[key]) : fallback;
      button.dataset.speed = speed;
      button.textContent = `P${index} ${formatSpeedText(speed)}×`;
      const activeShortcut = shortcutList(`preset${index}`, '');
      button.title = activeShortcut
        ? `Apply preset ${index} (${formatSpeedText(speed)}×) - ${activeShortcut}`
        : `Apply preset ${index} (${formatSpeedText(speed)}×)`;
    });
  }

  function setArc(speed) {
    const arc = document.getElementById('speedArc');
    if (!arc) return;
    const clampedSpeed = Math.min(MAX_SPEED, Math.max(MIN_SPEED, Number(speed) || MIN_SPEED));
    const pct = Math.min(
      1,
      Math.max(0, (Math.log(clampedSpeed) - Math.log(MIN_SPEED)) / (Math.log(MAX_SPEED) - Math.log(MIN_SPEED)))
    );
    const offset = MAX_ARC - pct * MAX_ARC;
    arc.style.strokeDashoffset = offset;
    arc.style.stroke = speed <= 1 ? '#94a3b8' : '';
  }

  function updateUI(speed) {
    cur = speed;
    const el = document.getElementById('speedVal');
    if (el) el.textContent = speed.toFixed(2);
    setArc(speed);
    document.querySelectorAll('.preset').forEach(b => {
      b.classList.toggle('active', parseFloat(b.dataset.speed) === speed);
    });
  }

  function setLoopNotice(text, tone = 'muted') {
    const el = document.getElementById('loopNotice');
    if (!el) return;
    el.textContent = text || LOOP_DEFAULT_NOTICE;
    const colors = {
      muted: 'var(--text3)',
      ok: '#b8fff4',
      warn: '#fbbf24'
    };
    el.style.color = colors[tone] || colors.muted;
  }

  function setLoopToggle(active) {
    const el = document.getElementById('loopToggle');
    if (el) el.checked = !!active;
  }

  function updateStats(settings = currentSettings) {
    const tsEl = document.getElementById('timeSaved');
    const ttEl = document.getElementById('totalSaved');
    if (tsEl) tsEl.textContent = fmt(settings.weekTimeSaved || 0);
    if (ttEl) ttEl.textContent = fmt(settings.totalTimeSaved || 0);
  }

  function applyPopupSettings(settings = {}, { updateSpeedFromSettings = false } = {}) {
    currentSettings = { ...currentSettings, ...(settings || {}) };

    setControlValue('silenceSkip', !!currentSettings.silenceSkip);
    setControlValue('rememberSpeed', !!currentSettings.rememberSpeed);
    setControlValue('rememberPerUrl', !!currentSettings.rememberPerUrl);
    setControlValue('controlAudio', currentSettings.controlAudio !== false);
    setLoopSecondsInputValue(currentSettings.loopSeconds || 10);

    setPopupEnabledState(currentSettings.enabled !== false);
    renderShortcutAwareUI(currentSettings);
    hydrateUserPresets(currentSettings);
    updateStats(currentSettings);

    const speedKeys = ['speed', 'defaultSpeed', 'rememberSpeed', 'rememberPerUrl', getUrlSpeedKey()].filter(Boolean);
    const shouldRefreshSpeed = updateSpeedFromSettings ||
      (!lastState?.hasMedia && speedKeys.some(key => Object.prototype.hasOwnProperty.call(settings || {}, key)));
    if (shouldRefreshSpeed) updateUI(getStoredDisplaySpeed(currentSettings));
  }

  function buildSettingsPatch(changes = {}) {
    const activeUrlKey = getUrlSpeedKey();
    return Object.entries(changes).reduce((patch, [key, change]) => {
      const isActiveUrlSpeedKey = !!activeUrlKey && key === activeUrlKey;
      if ((!POPUP_STORAGE_KEY_SET.has(key) && !isActiveUrlSpeedKey) || typeof change?.newValue === 'undefined') return patch;
      patch[key] = change.newValue;
      return patch;
    }, {});
  }

  function handleStorageChange(changes, areaName) {
    if (areaName !== 'local' && areaName !== 'sync') return;
    const patch = buildSettingsPatch(changes);
    if (!Object.keys(patch).length) return;

    applyPopupSettings(patch);

    if (document.visibilityState !== 'visible') return;
    if ('enabled' in patch || 'controlAudio' in patch || 'loopSeconds' in patch) {
      syncLoopState();
    }
  }

  function sendToTab(msg, callback) {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      const tabId = tabs[0]?.id;
      if (!tabId) {
        callback?.(null, new Error('No active tab'));
        return;
      }
      chrome.tabs.sendMessage(tabId, msg, response => {
        if (chrome.runtime.lastError) {
          callback?.(null, chrome.runtime.lastError);
          return;
        }
        callback?.(response || null, null);
      });
    });
  }

  function syncToAllTabs(settings) {
    chrome.tabs.query({}, tabs => {
      tabs.forEach(tab => {
        if (!tab.id) return;
        chrome.tabs.sendMessage(tab.id, { type: 'SETTINGS_UPDATE', settings }, () => {
          chrome.runtime.lastError;
        });
      });
    });
  }

  function applyScopedSpeed(speed) {
    persistRememberedSpeedSelection(speed, currentSettings, patch => {
      const sendSpeed = () => {
        sendToTab({ type: 'SET_SPEED', speed }, () => {
          syncLoopState();
        });
      };

      if (!patch || !Object.keys(patch).length) {
        sendSpeed();
        return;
      }

      sendToTab({ type: 'SETTINGS_UPDATE', settings: patch }, () => {
        sendSpeed();
      });
    });
  }

  function syncRememberToggleToActiveTab(patch, broadcastSettings, callback) {
    const finish = () => {
      syncToAllTabs(broadcastSettings);
      callback?.();
    };

    if (!patch || !Object.keys(patch).length) {
      finish();
      return;
    }

    sendToTab({ type: 'SETTINGS_UPDATE', settings: patch }, () => {
      finish();
    });
  }

  function setPopupEnabledState(enabled) {
    extensionEnabled = enabled !== false;
    const app = document.querySelector('.app');
    if (app) app.classList.toggle('is-disabled', !extensionEnabled);

    const status = document.getElementById('extensionStatus');
    if (status) status.textContent = extensionEnabled ? t('statusOn', 'On') : t('statusOff', 'Off');

    const toggle = document.getElementById('extensionEnabled');
    if (toggle) toggle.checked = extensionEnabled;

    document.querySelectorAll('button, input').forEach(el => {
      if (el.id === 'extensionEnabled' || el.dataset.staysEnabled === '1') return;
      el.disabled = !extensionEnabled;
    });

    if (!extensionEnabled) {
      setLoopToggle(false);
      setLoopNotice('VelocityX is turned off. Turn it back on to control videos.', 'warn');
    } else {
      setLoopNotice(LOOP_DEFAULT_NOTICE);
    }
  }

  function syncLoopState() {
    if (stateSyncPending) return;
    stateSyncPending = true;
    const finish = () => {
      stateSyncPending = false;
    };

    refreshActiveTabContext(() => {
      if (!extensionEnabled) {
        setLoopToggle(false);
        setLoopNotice('VelocityX is turned off. Turn it back on to control videos.', 'warn');
        renderMediaState(lastState);
        finish();
        return;
      }

      sendToTab({ type: 'GET_STATE' }, (response, error) => {
        if (!response) {
          setLoopToggle(false);
          if (isLocalFileUrl(activeTabUrl) && !fileSchemeAccessAllowed) {
            renderUnavailableMediaState(
              'Turn on file URL access for VelocityX.',
              'Chrome blocks extensions on local videos until "Allow access to file URLs" is enabled in the extension details page.',
              'Permission needed'
            );
            setLoopNotice('Local files need "Allow access to file URLs" in Chrome extension details.', 'warn');
            finish();
            return;
          }

          if (isLocalFileUrl(activeTabUrl) && fileSchemeAccessAllowed) {
            renderUnavailableMediaState(
              'Reload this local file tab once.',
              'File access looks enabled, but this tab may need a refresh before VelocityX can attach to the local player.',
              'Reload needed'
            );
            setLoopNotice('Reload the local file tab, then try Silence Skip again.', 'warn');
            finish();
            return;
          }

          setLoopNotice(LOOP_DEFAULT_NOTICE);
          renderMediaState(null);
          if (error) lastState = null;
          finish();
          return;
        }

        renderMediaState(response);
        if (typeof response.speed === 'number') updateUI(response.speed);
        if (response.loopSeconds) setLoopSecondsInputValue(response.loopSeconds);
        setLoopToggle(!!response.loopActive);
        if (response.loopActive) {
          setLoopNotice(
            `Loop active: ${response.actualLoopSeconds || response.loopSeconds}s from ${fmt(response.loopStart)} to ${fmt(response.loopEnd)}.`,
            'ok'
          );
        } else {
          setLoopNotice(LOOP_DEFAULT_NOTICE);
        }
        finish();
      });
    });
  }

  function stopStateSyncTimer() {
    if (!stateSyncTimer) return;
    clearInterval(stateSyncTimer);
    stateSyncTimer = 0;
  }

  function startStateSyncTimer() {
    if (stateSyncTimer) return;
    stateSyncTimer = setInterval(() => {
      if (document.visibilityState === 'visible') syncLoopState();
    }, 1000);
  }

  document.addEventListener('DOMContentLoaded', () => {
    localizeStaticText();
    renderMediaState(null);
    chrome.storage.onChanged.addListener(handleStorageChange);
    getMergedStorage(POPUP_STORAGE_KEYS, d => {
      applyPopupSettings(d, { updateSpeedFromSettings: true });

      refreshActiveTabContext(() => {
        loadActiveTabRememberedSpeed(() => {
          applyPopupSettings({}, { updateSpeedFromSettings: true });
          setLoopNotice(LOOP_DEFAULT_NOTICE);
          syncLoopState();
          startStateSyncTimer();
        });
      });
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') syncLoopState();
    });
    window.addEventListener('unload', () => {
      stopStateSyncTimer();
      chrome.storage.onChanged.removeListener(handleStorageChange);
    });

    document.getElementById('decrease')?.addEventListener('click', () => {
      if (!extensionEnabled) return;
      dispatch(Math.round((cur - getPopupSpeedStep()) * 100) / 100);
    });

    document.getElementById('increase')?.addEventListener('click', () => {
      if (!extensionEnabled) return;
      dispatch(Math.round((cur + getPopupSpeedStep()) * 100) / 100);
    });

    document.querySelectorAll('.preset').forEach(b => {
      b.addEventListener('click', () => {
        if (!extensionEnabled) return;
        dispatch(parseFloat(b.dataset.speed));
      });
    });

    document.getElementById('silenceSkip')?.addEventListener('change', e => {
      const v = e.target.checked;
      persistState({ silenceSkip: v }, () => {
        syncToAllTabs({ silenceSkip: v });
      });
    });

    document.getElementById('rememberSpeed')?.addEventListener('change', e => {
      const rememberSpeed = e.target.checked;
      const nextSettings = { ...currentSettings, rememberSpeed };
      const patch = {
        rememberSpeed,
        ...(rememberSpeed ? buildRememberedSpeedPatch(cur, nextSettings) : {})
      };
      currentSettings = { ...currentSettings, ...patch };
      persistState(patch, () => {
        syncRememberToggleToActiveTab(patch, { rememberSpeed });
      });
    });

    document.getElementById('rememberPerUrl')?.addEventListener('change', e => {
      const rememberPerUrl = e.target.checked;
      const nextSettings = { ...currentSettings, rememberPerUrl };
      const patch = {
        rememberPerUrl,
        ...(rememberPerUrl ? buildRememberedSpeedPatch(cur, nextSettings) : {})
      };
      currentSettings = { ...currentSettings, ...patch };
      persistState(patch, () => {
        syncRememberToggleToActiveTab(patch, { rememberPerUrl });
      });
    });

    document.getElementById('controlAudio')?.addEventListener('change', e => {
      const controlAudio = e.target.checked;
      persistState({ controlAudio }, () => {
        syncToAllTabs({ controlAudio });
      });
    });

    document.getElementById('loopSeconds')?.addEventListener('change', () => {
      if (!extensionEnabled) return;
      commitLoopSecondsInput();
    });

    document.getElementById('loopSeconds')?.addEventListener('blur', () => {
      if (!extensionEnabled) return;
      commitLoopSecondsInput();
    });

    document.getElementById('loopSeconds')?.addEventListener('keydown', e => {
      if (!extensionEnabled) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        commitLoopSecondsInput();
        e.target.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setLoopSecondsInputValue(currentSettings.loopSeconds || 10, { force: true });
        e.target.blur();
      }
    });

    document.getElementById('loopToggle')?.addEventListener('change', e => {
      if (!extensionEnabled) {
        e.target.checked = false;
        return;
      }
      const loopSeconds = clampLoopSeconds(document.getElementById('loopSeconds')?.value || currentSettings.loopSeconds || 10);
      const applyToggle = () => {
        sendToTab({ type: 'TOGGLE_LOOP', loopSeconds }, response => {
          if (!response) {
            e.target.checked = false;
            setLoopNotice('Open a video first, then try Loop Last N Seconds.', 'warn');
            return;
          }
          setLoopToggle(!!response.loopActive);
          setLoopNotice(
            response.message || (response.loopActive ? 'Loop active.' : LOOP_DEFAULT_NOTICE),
            response.loopActive ? 'ok' : 'muted'
          );
        });
      };

      e.target.checked = !!e.target.checked;
      saveLoopSeconds(loopSeconds, { refreshLoopState: false, sendSettingsUpdate: false });
      sendToTab({ type: 'SETTINGS_UPDATE', settings: { loopSeconds } }, () => applyToggle());
    });

    document.getElementById('openSettings')?.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' });
      window.close();
    });

    document.getElementById('extensionEnabled')?.addEventListener('change', e => {
      const enabled = !!e.target.checked;
      persistState({ enabled }, () => {
        setPopupEnabledState(enabled);
        syncToAllTabs({ enabled });
        if (enabled) syncLoopState();
      });
    });

    document.getElementById('viewStats')?.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' });
      window.close();
    });

    document.addEventListener('keydown', e => {
      if (!extensionEnabled) return;
      if (e.key === 'ArrowUp' || e.key === '+') {
        e.preventDefault();
        dispatch(Math.round((cur + getPopupSpeedStep()) * 100) / 100);
      }
      if (e.key === 'ArrowDown' || e.key === '-') {
        e.preventDefault();
        dispatch(Math.round((cur - getPopupSpeedStep()) * 100) / 100);
      }
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        dispatch(1.0);
      }
    });
  });

  function dispatch(speed) {
    if (!extensionEnabled) return;
    speed = normalizeSpeed(speed, MIN_SPEED);
    updateUI(speed);
    applyScopedSpeed(speed);
  }
})();
