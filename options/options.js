/* VelocityX v1.0.0 – options.js */
(function () {
  'use strict';

  let _toastTimer = null;
  let _contextFeedbackTimer = null;
  let _shareFeedbackTimer = null;
  function showToast(text, ms = 2200) {
    const el = document.getElementById('vx-toast');
    if (!el) return;
    clearTimeout(_toastTimer);
    el.textContent = text;
    el.classList.add('show');
    _toastTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  function getActiveTabPanel() {
    return document.querySelector('.tab-panel.active');
  }

  function inferMessageTone(id = '', text = '') {
    const lower = String(text || '').toLowerCase();
    if (lower.includes('invalid') || lower.includes('error') || lower.startsWith('✗')) return 'error';
    if (
      lower.includes('conflict') ||
      lower.includes('fix ') ||
      lower.startsWith('⚠') ||
      lower.startsWith('enter ') ||
      lower.startsWith('add ') ||
      lower.includes('required')
    ) return 'warn';
    if (lower.includes('export')) return 'info';
    return 'success';
  }

  function applyMessageTone(el, tone = 'success') {
    if (!el) return;
    el.classList.remove('is-success', 'is-info', 'is-warn', 'is-error');
    el.classList.add(`is-${tone}`);
  }

  function hideContextFeedback(source = '') {
    const el = document.getElementById('vx-context-feedback');
    if (!el) return;
    if (source && el.dataset.source !== source) return;
    clearTimeout(_contextFeedbackTimer);
    el.hidden = true;
    el.textContent = '';
    el.dataset.source = '';
    el.dataset.panelId = '';
    el.dataset.tone = '';
  }

  function showContextFeedback({ text = '', tone = 'success', panelId = '', source = 'message', ms = 2500 } = {}) {
    const el = document.getElementById('vx-context-feedback');
    if (!el) return;
    clearTimeout(_contextFeedbackTimer);
    if (!text) {
      hideContextFeedback(source);
      return;
    }
    el.textContent = text;
    el.dataset.source = source;
    el.dataset.panelId = panelId || '';
    el.dataset.tone = tone;
    el.hidden = false;
    syncContextFeedbackVisibility();
    if (ms > 0) {
      _contextFeedbackTimer = setTimeout(() => hideContextFeedback(source), ms);
    }
  }

  function setShareActionStatus(text = '', tone = 'success', ms = 4200) {
    const el = document.getElementById('shareActionStatus');
    if (!el) return;
    clearTimeout(_shareFeedbackTimer);
    if (!text) {
      el.hidden = true;
      el.textContent = '';
      el.dataset.tone = '';
      return;
    }
    el.textContent = text;
    el.dataset.tone = tone;
    el.hidden = false;
    if (ms > 0) {
      _shareFeedbackTimer = setTimeout(() => setShareActionStatus('', tone, 0), ms);
    }
  }

  function markCopyCaptionCopied(ms = 1400) {
    const button = document.getElementById('copyShareCaption');
    if (!button) return;
    const fallback = 'Copy Caption';
    const original = button.dataset.defaultLabel || button.textContent || fallback;
    button.dataset.defaultLabel = original;
    button.textContent = 'Copied';
    button.disabled = true;
    setTimeout(() => {
      button.textContent = button.dataset.defaultLabel || fallback;
      button.disabled = false;
    }, ms);
  }

  function syncContextFeedbackVisibility() {
    const el = document.getElementById('vx-context-feedback');
    if (!el || !el.textContent) return;
    const activePanel = getActiveTabPanel();
    const panelId = el.dataset.panelId || '';
    el.hidden = !!(panelId && activePanel && panelId !== activePanel.id);
  }

  const ShortcutUtils = globalThis.VelocityXShortcuts || {};
  const KEY_DEFAULTS = ShortcutUtils.LEGACY_KEY_DEFAULTS || {
    keyFaster:  'KeyD', keySlower: 'KeyS', keyReset:   'KeyR',
    keyForward: 'KeyX', keyRewind: 'KeyZ', keyToggle:  'KeyV',
    keyPiP:     'KeyP',
    keyPreset1: 'KeyG', keyPreset2: 'KeyH', keyPreset3: 'KeyN',
    keyLoop:    'KeyL', keyMark:   'KeyM', keyJump:    'KeyJ',
    keyVolumeDown: 'KeyI', keyVolumeUp: 'KeyU'
  };
  const DEFAULT_SHORTCUT_BINDINGS = (globalThis.VelocityXSettings?.DEFAULT_SHORTCUT_BINDINGS || []).map(binding => ({ ...binding }));
  const SHORTCUT_ACTIONS = [
    { value: 'increaseSpeed', label: 'Faster', desc: 'Increase speed by your step value' },
    { value: 'decreaseSpeed', label: 'Slower', desc: 'Decrease speed by your step value' },
    { value: 'resetSpeed', label: 'Reset to 1.0x', desc: 'Snap back to normal playback' },
    { value: 'skipForward', label: 'Forward Skip', desc: 'Jump ahead by Skip Seconds' },
    { value: 'skipBackward', label: 'Rewind Skip', desc: 'Jump back by Skip Seconds' },
    { value: 'toggleOverlay', label: 'Toggle Overlay', desc: 'Show or hide the overlay pill' },
    { value: 'toggleLoop', label: 'Loop Last N', desc: 'Toggle Loop Last N Seconds' },
    { value: 'setMark', label: 'Set Mark', desc: 'Remember the current timestamp' },
    { value: 'jumpToMark', label: 'Jump to Mark', desc: 'Jump to the saved mark' },
    { value: 'clearMark', label: 'Clear Mark', desc: 'Remove the saved mark' },
    { value: 'togglePiP', label: 'Picture-in-Picture', desc: 'Toggle PiP for the active video' },
    { value: 'volumeDown', label: 'Volume Down', desc: 'Lower active media volume' },
    { value: 'volumeUp', label: 'Volume Up', desc: 'Raise active media volume' },
    { value: 'preset1', label: 'Preset 1', desc: 'Toggle preset speed 1' },
    { value: 'preset2', label: 'Preset 2', desc: 'Toggle preset speed 2' },
    { value: 'preset3', label: 'Preset 3', desc: 'Toggle preset speed 3' },
    { value: 'setABStart', label: 'Set AB Start', desc: 'Set the A point for AB loop' },
    { value: 'setABEnd', label: 'Set AB End', desc: 'Set the B point for AB loop' },
    { value: 'clearABLoop', label: 'Clear AB Loop', desc: 'Clear any active AB loop points' },
    { value: 'togglePlayPause', label: 'Play / Pause', desc: 'Toggle playback on the active media' },
    { value: 'toggleMute', label: 'Mute / Unmute', desc: 'Toggle muted state for the active media' }
  ];
  const SHORTCUT_ACTION_SET = new Set(SHORTCUT_ACTIONS.map(action => action.value));

  let S = {};
  const messageTimers = new Map();
  const Settings = globalThis.VelocityXSettings || {};
  const OVERLAY_CONTROL_DEFAULTS = { ...(Settings.DEFAULT_OVERLAY_CONTROLS || {}) };
  const PREVIOUS_OVERLAY_CONTROLS_V3 = { ...(Settings.PREVIOUS_OVERLAY_CONTROLS_V3 || {}) };
  const PREVIOUS_OVERLAY_CONTROLS_V4 = { ...(Settings.PREVIOUS_OVERLAY_CONTROLS_V4 || {}) };
  const OVERLAY_DEFAULTS_VERSION = Settings.OVERLAY_DEFAULTS_VERSION || 6;
  const OVERLAY_DEFAULT_SETTINGS = {
    showOverlay: (Settings.SETTINGS_DEFAULTS || {}).showOverlay ?? true,
    overlayRestoreBadge: (Settings.SETTINGS_DEFAULTS || {}).overlayRestoreBadge ?? true,
    overlayOpacity: (Settings.SETTINGS_DEFAULTS || {}).overlayOpacity ?? 0.92,
    overlayButtonSize: (Settings.SETTINGS_DEFAULTS || {}).overlayButtonSize ?? 22,
    overlayPosition: (Settings.SETTINGS_DEFAULTS || {}).overlayPosition || 'top-left',
    overlayControls: { ...OVERLAY_CONTROL_DEFAULTS },
    overlayOffsets: {},
    overlayRestoreCorners: {},
    overlayHiddenStates: {},
    overlayDefaultsVersion: OVERLAY_DEFAULTS_VERSION
  };
  const SYNC_SETTINGS_DEFAULTS = {
    ...(Settings.SETTINGS_DEFAULTS || {}),
    overlayControls: { ...((Settings.SETTINGS_DEFAULTS || {}).overlayControls || OVERLAY_CONTROL_DEFAULTS) },
    overlayDefaultsVersion: OVERLAY_DEFAULTS_VERSION
  };
  const GENERAL_SETTINGS_DEFAULTS = {
    defaultSpeed: SYNC_SETTINGS_DEFAULTS.defaultSpeed ?? 1.0,
    step: SYNC_SETTINGS_DEFAULTS.step ?? 0.1,
    skipSeconds: SYNC_SETTINGS_DEFAULTS.skipSeconds ?? 10,
    loopSeconds: SYNC_SETTINGS_DEFAULTS.loopSeconds ?? 10,
    preset1Speed: SYNC_SETTINGS_DEFAULTS.preset1Speed ?? 1.8,
    preset2Speed: SYNC_SETTINGS_DEFAULTS.preset2Speed ?? 1.25,
    preset3Speed: SYNC_SETTINGS_DEFAULTS.preset3Speed ?? 2.5,
    wheelStep: SYNC_SETTINGS_DEFAULTS.wheelStep ?? 0.10,
    fightback: SYNC_SETTINGS_DEFAULTS.fightback ?? true,
    rememberSpeed: SYNC_SETTINGS_DEFAULTS.rememberSpeed ?? false,
    rememberPerUrl: SYNC_SETTINGS_DEFAULTS.rememberPerUrl ?? false,
    controlAudio: SYNC_SETTINGS_DEFAULTS.controlAudio ?? true,
    mouseWheel: SYNC_SETTINGS_DEFAULTS.mouseWheel ?? true,
    showOverlay: OVERLAY_DEFAULT_SETTINGS.showOverlay,
    overlayRestoreBadge: OVERLAY_DEFAULT_SETTINGS.overlayRestoreBadge,
    overlayOpacity: OVERLAY_DEFAULT_SETTINGS.overlayOpacity,
    overlayButtonSize: OVERLAY_DEFAULT_SETTINGS.overlayButtonSize,
    overlayPosition: OVERLAY_DEFAULT_SETTINGS.overlayPosition,
    overlayControls: { ...OVERLAY_DEFAULT_SETTINGS.overlayControls },
    overlayOffsets: {},
    overlayRestoreCorners: {},
    overlayHiddenStates: {},
    overlayDefaultsVersion: OVERLAY_DEFAULTS_VERSION
  };
  const SYNC_SETTING_KEYS = new Set(Settings.SYNC_SETTINGS_KEYS || Object.keys(SYNC_SETTINGS_DEFAULTS));
  const LOCAL_SETTING_KEYS = new Set(Settings.LOCAL_ONLY_STORAGE_KEYS || Object.keys(Settings.LOCAL_DEFAULTS || {}));
  const EXPORT_METADATA_KEY = '_velocityxExport';
  const EXPORT_SCHEMA_VERSION = 1;
  const IMPORT_SKIP_KEYS = new Set([
    EXPORT_METADATA_KEY,
    'totalTimeSaved',
    'weekTimeSaved',
    'weekStart',
    'installTime',
    'totalSessions',
    'speedDist'
  ]);
  const IMPORTABLE_SETTING_KEYS = new Set([
    ...SYNC_SETTING_KEYS,
    ...LOCAL_SETTING_KEYS,
    'weekStart',
    'installTime'
  ]);
  const IMPORT_SIGNATURE_KEYS = new Set([
    'defaultSpeed',
    'step',
    'skipSeconds',
    'loopSeconds',
    'preset1Speed',
    'preset2Speed',
    'preset3Speed',
    'wheelStep',
    'rememberSpeed',
    'rememberPerUrl',
    'controlAudio',
    'showOverlay',
    'overlayPosition',
    'overlayControls',
    'siteRules',
    'shortcutBindings',
    'keyFaster',
    'keySlower',
    'keyToggle',
    'keyLoop',
    'keyPreset1',
    'keyPreset2',
    'keyPreset3'
  ]);
  const IMPORT_LEGACY_MARKER_KEYS = new Set([
    'shortcutBindings',
    'overlayControls',
    'siteRules',
    'overlayDefaultsVersion',
    'rememberPerUrl',
    'controlAudio',
    'keyFaster',
    'keySlower',
    'keyToggle',
    'keyLoop',
    'keyPreset1',
    'keyPreset2',
    'keyPreset3'
  ]);
  const SiteRules = globalThis.VelocityXSiteRules;
  const t = (key, fallback = '') => globalThis.VelocityXI18n?.getMessage(key) || fallback;

  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function buildSettingsExportPayload(data = {}) {
    return {
      [EXPORT_METADATA_KEY]: {
        app: 'VelocityX',
        schema: EXPORT_SCHEMA_VERSION,
        version: '1.0.0',
        exportedAt: new Date().toISOString()
      },
      ...(data || {})
    };
  }

  function extractImportableSettings(data = {}) {
    if (!isPlainObject(data)) {
      throw new Error('VelocityX settings import expects a JSON object.');
    }

    const metadata = data[EXPORT_METADATA_KEY];
    const hasValidMetadata = isPlainObject(metadata) &&
      metadata.app === 'VelocityX' &&
      Number(metadata.schema) === EXPORT_SCHEMA_VERSION;

    const recognizedKeys = Object.keys(data).filter(key => IMPORTABLE_SETTING_KEYS.has(key));
    const signatureKeyCount = recognizedKeys.filter(key => IMPORT_SIGNATURE_KEYS.has(key)).length;
    const legacyMarkerCount = recognizedKeys.filter(key => IMPORT_LEGACY_MARKER_KEYS.has(key)).length;
    const looksLikeLegacyVelocityXExport = recognizedKeys.length >= 5 &&
      signatureKeyCount >= 3 &&
      legacyMarkerCount >= 1;

    if (!hasValidMetadata && !looksLikeLegacyVelocityXExport) {
      throw new Error('This JSON is not a VelocityX settings export.');
    }

    const safe = {};
    Object.entries(data).forEach(([key, value]) => {
      if (!IMPORTABLE_SETTING_KEYS.has(key) || IMPORT_SKIP_KEYS.has(key)) return;
      safe[key] = value;
    });

    if (!Object.keys(safe).length) {
      throw new Error('No importable VelocityX settings were found.');
    }

    return safe;
  }

  function getPrimaryShortcut(settings, action, fallback = 'Unset') {
    return ShortcutUtils.getPrimaryActionShortcut
      ? ShortcutUtils.getPrimaryActionShortcut(settings, action, fallback)
      : fallback;
  }

  function getShortcutList(settings, action, empty = 'Unassigned') {
    return ShortcutUtils.formatActionShortcuts
      ? ShortcutUtils.formatActionShortcuts(settings, action, { empty })
      : empty;
  }

  function getLegacyShortcutCode(settings = {}, key = '') {
    if (Object.prototype.hasOwnProperty.call(settings, key)) {
      return typeof settings[key] === 'string' ? settings[key] : '';
    }
    return KEY_DEFAULTS[key] || '';
  }

  /* ── Helpers ─────────────────────────────────────────────────── */
  function codeToLabel(code) {
    if (!code) return '—';
    if (code.startsWith('Key'))   return code.slice(3);
    if (code.startsWith('Digit')) return code.slice(5);
    const m = {
      Space:'Space', ArrowLeft:'←', ArrowRight:'→', ArrowUp:'↑', ArrowDown:'↓',
      Backspace:'⌫', Enter:'Enter', Escape:'Esc', Tab:'Tab',
      F1:'F1', F2:'F2', F3:'F3', F4:'F4', F5:'F5', F6:'F6',
      F7:'F7', F8:'F8', F9:'F9', F10:'F10', F11:'F11', F12:'F12'
    };
    return m[code] || code;
  }

  function fmt(sec) {
    sec = Math.floor(sec || 0);
    if (sec < 60)   return sec + 's';
    if (sec < 3600) return Math.floor(sec / 60) + 'm ' + (sec % 60) + 's';
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
    return h + 'h ' + m + 'm';
  }

  function showMsg(id, text, ms = 2500) {
    const el = document.getElementById(id);
    if (!el) return;
    const tone = inferMessageTone(id, text);
    const panelId = el.closest('.tab-panel')?.id || '';
    const prevTimer = messageTimers.get(el);
    if (prevTimer) clearTimeout(prevTimer);
    applyMessageTone(el, tone);
    el.textContent = text;
    el.style.opacity = '1';
    showContextFeedback({ text, tone, panelId, source: `msg:${id}`, ms });
    const timer = setTimeout(() => {
      if (messageTimers.get(el) === timer) {
        el.style.opacity = '0';
        el.classList.remove('is-success', 'is-info', 'is-warn', 'is-error');
        hideContextFeedback(`msg:${id}`);
      }
    }, ms);
    messageTimers.set(el, timer);
  }

  function sendToAllTabs(message) {
    chrome.tabs.query({}, tabs => {
      tabs.forEach(t => {
        if (t.id) chrome.tabs.sendMessage(t.id, message, () => { chrome.runtime.lastError; });
      });
    });
  }

  function syncToAllTabs(settings) {
    sendToAllTabs({ type: 'SETTINGS_UPDATE', settings });
  }

  function getSyncQuery(keys) {
    if (keys == null) return Object.keys(SYNC_SETTINGS_DEFAULTS);
    if (typeof keys === 'string') return SYNC_SETTING_KEYS.has(keys) ? keys : null;
    if (Array.isArray(keys)) {
      const syncKeys = keys.filter(key => SYNC_SETTING_KEYS.has(key));
      return syncKeys.length ? syncKeys : null;
    }
    if (typeof keys === 'object') {
      const syncDefaults = {};
      Object.keys(keys).forEach(key => {
        if (SYNC_SETTING_KEYS.has(key)) syncDefaults[key] = keys[key];
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
      if (SYNC_SETTING_KEYS.has(key)) syncSettings[key] = value;
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
          console.warn('[VelocityX] Failed to sync settings to chrome.storage.sync.', chrome.runtime.lastError.message);
        }
        done();
      });
    }
  }

  function normalizeOverlayControls(controls = {}) {
    const merged = Object.fromEntries(
      Object.keys(OVERLAY_CONTROL_DEFAULTS).map(key => [key, controls?.[key] ?? OVERLAY_CONTROL_DEFAULTS[key]])
    );
    if (!Object.values(merged).some(Boolean)) merged.speed = true;
    return merged;
  }

  function populateOverlayControls(controls = {}) {
    const merged = normalizeOverlayControls(controls);
    document.querySelectorAll('[data-overlay-part]').forEach(el => {
      el.checked = !!merged[el.dataset.overlayPart];
    });
  }

  function readOverlayControls() {
    const out = {};
    document.querySelectorAll('[data-overlay-part]').forEach(el => {
      out[el.dataset.overlayPart] = !!el.checked;
    });
    return normalizeOverlayControls(out);
  }

  function matchesOverlayControls(controls = {}, preset = {}) {
    const merged = { ...(preset || {}), ...(controls || {}) };
    return Object.keys(preset || {}).every(key => merged[key] === preset[key]);
  }

  function applyOverlayDefaultsToForm() {
    const showOverlay = document.getElementById('showOverlay');
    const overlayRestoreBadge = document.getElementById('overlayRestoreBadge');
    const overlayPosition = document.getElementById('overlayPosition');
    const overlayOpacity = document.getElementById('overlayOpacity');
    const overlayButtonSize = document.getElementById('overlayButtonSize');
    if (showOverlay) showOverlay.checked = OVERLAY_DEFAULT_SETTINGS.showOverlay;
    if (overlayRestoreBadge) overlayRestoreBadge.checked = OVERLAY_DEFAULT_SETTINGS.overlayRestoreBadge;
    if (overlayPosition) overlayPosition.value = OVERLAY_DEFAULT_SETTINGS.overlayPosition;
    if (overlayOpacity) overlayOpacity.value = OVERLAY_DEFAULT_SETTINGS.overlayOpacity;
    if (overlayButtonSize) overlayButtonSize.value = OVERLAY_DEFAULT_SETTINGS.overlayButtonSize;
    populateOverlayControls(OVERLAY_DEFAULT_SETTINGS.overlayControls);
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

  function rememberBaseText(el, fallback = '') {
    if (!el) return fallback;
    if (!el.dataset.baseText) el.dataset.baseText = fallback || el.textContent.trim();
    return el.dataset.baseText || fallback;
  }

  function setHelperCopy(el, baseText = '', extraText = '') {
    if (!el) return;
    if (baseText) el.dataset.baseText = baseText;
    const base = rememberBaseText(el, baseText);
    el.textContent = extraText ? `${base} ${extraText}` : base;
  }

  function setDisabledState(target, disabled, reason = '') {
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) return;
    const controls = [];
    if (el.matches && el.matches('input, select, textarea, button')) controls.push(el);
    el.querySelectorAll?.('input, select, textarea, button').forEach(ctrl => controls.push(ctrl));
    controls.forEach(ctrl => { ctrl.disabled = !!disabled; });
    el.classList.toggle('setting-disabled', !!disabled);
    if (disabled) {
      el.setAttribute('aria-disabled', 'true');
      if (reason) el.title = reason;
    } else {
      el.removeAttribute('aria-disabled');
      el.removeAttribute('title');
    }
  }

  function syncOptionDependencies(settings = readDraftShortcutSettings()) {
    const showOverlay = document.getElementById('showOverlay')?.checked !== false;
    const overlayControls = readOverlayControls();
    const closeButtonEnabled = !!overlayControls.close;
    const mouseWheelEnabled = !!document.getElementById('mouseWheel')?.checked;
    const silenceEnabled = !!document.getElementById('silenceSkipFull')?.checked;
    const hasShortcuts = (ShortcutUtils.getAllShortcutBindings?.(settings) || []).length > 0;
    const pattern = normalizeRulePattern(document.getElementById('newDomain')?.value || '');
    const speedInput = document.getElementById('newSpeed');
    const speedValue = speedInput?.value?.trim() || '';
    const hasRuleSpeed = speedValue !== '' && speedInput?.checkValidity() !== false && Number.isFinite(Number(speedValue));
    const hasRuleCss = !!document.getElementById('newRuleCSS')?.value?.trim();

    const overlayReason = 'Turn on Show Glassmorphism Overlay first.';
    const closeReason = 'Enable the Close Button below to use this setting.';
    const wheelReason = 'Turn on Mouse Wheel Speed first.';
    const silenceReason = 'Turn on Silence Skip first.';
    const shortcutReason = 'Assign at least one shortcut first.';

    setDisabledState(document.getElementById('overlayRestoreBadge')?.closest('.toggle-row'), !showOverlay || !closeButtonEnabled, !showOverlay ? overlayReason : closeReason);
    setDisabledState(document.getElementById('overlayPosition')?.closest('.form-field'), !showOverlay, overlayReason);
    setDisabledState(document.getElementById('overlayOpacity')?.closest('.form-field'), !showOverlay, overlayReason);
    setDisabledState(document.getElementById('overlayButtonSize')?.closest('.form-field'), !showOverlay, overlayReason);
    setDisabledState(document.querySelector('.overlay-note'), !showOverlay, overlayReason);
    setDisabledState(document.querySelector('.overlay-parts-grid'), !showOverlay, overlayReason);
    setDisabledState(document.getElementById('resetOverlayPositions')?.closest('.btn-row') || document.getElementById('resetOverlayPositions'), !showOverlay, overlayReason);

    setDisabledState(document.getElementById('wheelStep')?.closest('.form-field'), !mouseWheelEnabled, wheelReason);
    setDisabledState(document.getElementById('silenceSpeed')?.closest('.form-field'), !silenceEnabled, silenceReason);
    setDisabledState(document.getElementById('silenceDelay')?.closest('.form-field'), !silenceEnabled, silenceReason);
    setDisabledState(document.getElementById('silenceThreshold')?.closest('.form-field'), !silenceEnabled, silenceReason);
    setDisabledState(document.getElementById('exclusiveKeys')?.closest('.toggle-row'), !hasShortcuts, shortcutReason);

    const wheelHint = document.getElementById('wheelStep')?.closest('.form-field')?.querySelector('.hint');
    setHelperCopy(wheelHint, '', !mouseWheelEnabled ? 'Turn on Mouse Wheel Speed to use this.' : '');

    const exclusiveDesc = document.getElementById('exclusiveKeys')?.closest('.toggle-row')?.querySelector('.toggle-desc');
    setHelperCopy(exclusiveDesc, '', !hasShortcuts ? 'Assign at least one shortcut to use this.' : '');

    const addRuleBtn = document.getElementById('addRule');
    const addRuleReason = !pattern
      ? 'Enter a domain or regex first.'
      : (!hasRuleSpeed && !hasRuleCss ? 'Add a speed or controller CSS first.' : '');
    setDisabledState(addRuleBtn, !pattern || (!hasRuleSpeed && !hasRuleCss), addRuleReason);

    const disableRuleBtn = document.getElementById('addDisableRule');
    setDisabledState(disableRuleBtn, !pattern, 'Enter a domain or regex first.');
  }

  function readDraftShortcutSettings() {
    const draft = { ...S };
    document.querySelectorAll('.key-capture[data-key]').forEach(el => {
      draft[el.dataset.key] = el.dataset.code || '';
    });
    draft.shortcutBindings = readCustomShortcutBindings();
    return draft;
  }

  function setShortcutLabel(id, label, shortcut, title = '') {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = `${escapeHtml(label)} <kbd>${escapeHtml(shortcut)}</kbd>`;
    el.title = title;
  }

  function updateShortcutAwareCopy(settings = readDraftShortcutSettings()) {
    const fasterPrimary = getPrimaryShortcut(settings, 'increaseSpeed');
    const slowerPrimary = getPrimaryShortcut(settings, 'decreaseSpeed');
    const togglePrimary = getPrimaryShortcut(settings, 'toggleOverlay', '');
    const toggleAll = getShortcutList(settings, 'toggleOverlay');
    const showOverlay = document.getElementById('showOverlay')?.checked !== false;
    const closeButtonEnabled = !!document.querySelector('[data-overlay-part="close"]')?.checked;

    const speedStepHint = document.getElementById('speedStepHint');
    if (speedStepHint) {
      speedStepHint.textContent = `How much ${fasterPrimary}/${slowerPrimary} changes speed per press`;
      speedStepHint.title = `Faster: ${getShortcutList(settings, 'increaseSpeed')} | Slower: ${getShortcutList(settings, 'decreaseSpeed')}`;
    }

    setShortcutLabel(
      'skipSecondsLabel',
      'Skip Seconds',
      `${getPrimaryShortcut(settings, 'skipForward')} / ${getPrimaryShortcut(settings, 'skipBackward')}`,
      `Forward: ${getShortcutList(settings, 'skipForward')} | Rewind: ${getShortcutList(settings, 'skipBackward')}`
    );
    setShortcutLabel(
      'loopSecondsLabel',
      'Loop Last N Seconds',
      getPrimaryShortcut(settings, 'toggleLoop'),
      `Loop Last N shortcut: ${getShortcutList(settings, 'toggleLoop')}`
    );
    setShortcutLabel(
      'preset1SpeedLabel',
      'Preset 1 Speed',
      getPrimaryShortcut(settings, 'preset1'),
      `Preset 1 shortcuts: ${getShortcutList(settings, 'preset1')}`
    );
    setShortcutLabel(
      'preset2SpeedLabel',
      'Preset 2 Speed',
      getPrimaryShortcut(settings, 'preset2'),
      `Preset 2 shortcuts: ${getShortcutList(settings, 'preset2')}`
    );
    setShortcutLabel(
      'preset3SpeedLabel',
      'Preset 3 Speed',
      getPrimaryShortcut(settings, 'preset3'),
      `Preset 3 shortcuts: ${getShortcutList(settings, 'preset3')}`
    );

    const overlayRestoreBadgeDesc = document.getElementById('overlayRestoreBadgeDesc');
    if (overlayRestoreBadgeDesc) {
      const base = togglePrimary
        ? `Off = close hides the overlay for this page until refresh or ${togglePrimary}.`
        : 'Off = close hides the overlay for this page until refresh.';
      const extra = !showOverlay
        ? 'Unavailable while Show Glassmorphism Overlay is off.'
        : (!closeButtonEnabled ? 'Enable the Close Button below to use this setting.' : '');
      setHelperCopy(overlayRestoreBadgeDesc, base, extra);
      overlayRestoreBadgeDesc.title = !showOverlay
        ? 'Turn on Show Glassmorphism Overlay first.'
        : (!closeButtonEnabled
          ? 'Enable the Close Button below to use this setting.'
          : (togglePrimary ? `Overlay shortcut: ${toggleAll}` : 'No overlay shortcut is assigned right now.'));
    }

    const abLoopInfoNote = document.getElementById('abLoopInfoNote');
    if (abLoopInfoNote) {
      abLoopInfoNote.innerHTML = `<strong>AB Loop shortcuts:</strong> <kbd>${escapeHtml(getPrimaryShortcut(settings, 'setABStart'))}</kbd> sets A, <kbd>${escapeHtml(getPrimaryShortcut(settings, 'setABEnd'))}</kbd> sets B, and <kbd>${escapeHtml(getPrimaryShortcut(settings, 'clearABLoop'))}</kbd> clears. You can rebind them below.`;
      abLoopInfoNote.title = `Set A: ${getShortcutList(settings, 'setABStart')} | Set B: ${getShortcutList(settings, 'setABEnd')} | Clear: ${getShortcutList(settings, 'clearABLoop')}`;
    }

    syncOptionDependencies(settings);
  }

  function getShortcutActionMeta(action) {
    return SHORTCUT_ACTIONS.find(item => item.value === action) || null;
  }

  function formatShortcutCombo(binding = {}) {
    if (!binding.code) return 'Unassigned';
    const parts = [];
    if (binding.ctrlKey) parts.push('Ctrl');
    if (binding.altKey) parts.push('Alt');
    if (binding.shiftKey) parts.push('Shift');
    if (binding.metaKey) parts.push('Meta');
    parts.push(codeToLabel(binding.code));
    return parts.join(' + ');
  }

  function normalizeShortcutBinding(binding = {}) {
    const action = SHORTCUT_ACTION_SET.has(binding.action) ? binding.action : '';
    const code = typeof binding.code === 'string' ? binding.code : '';
    if (!action || !code) return null;
    return {
      action,
      code,
      ctrlKey: !!binding.ctrlKey,
      altKey: !!binding.altKey,
      shiftKey: !!binding.shiftKey,
      metaKey: !!binding.metaKey
    };
  }

  function normalizeShortcutBindings(bindings = DEFAULT_SHORTCUT_BINDINGS) {
    return (Array.isArray(bindings) ? bindings : [])
      .map(normalizeShortcutBinding)
      .filter(Boolean);
  }

  function readCustomShortcutBindings() {
    return Array.from(document.querySelectorAll('.custom-shortcut-row')).map(row => normalizeShortcutBinding({
      action: row.querySelector('.custom-shortcut-action')?.value,
      code: row.querySelector('.custom-shortcut-capture')?.dataset.code || '',
      ctrlKey: !!row.querySelector('[data-modifier="ctrlKey"]')?.checked,
      altKey: !!row.querySelector('[data-modifier="altKey"]')?.checked,
      shiftKey: !!row.querySelector('[data-modifier="shiftKey"]')?.checked,
      metaKey: !!row.querySelector('[data-modifier="metaKey"]')?.checked
    })).filter(Boolean);
  }

  function updateCustomShortcutRowLabel(row) {
    const capture = row?.querySelector('.custom-shortcut-capture');
    if (!capture) return;
    capture.textContent = formatShortcutCombo({
      code: capture.dataset.code || '',
      ctrlKey: !!row.querySelector('[data-modifier="ctrlKey"]')?.checked,
      altKey: !!row.querySelector('[data-modifier="altKey"]')?.checked,
      shiftKey: !!row.querySelector('[data-modifier="shiftKey"]')?.checked,
      metaKey: !!row.querySelector('[data-modifier="metaKey"]')?.checked
    });
  }

  function clearShortcutCapture(el) {
    if (!el) return;
    el.dataset.code = '';
    el.textContent = 'Unassigned';
    el.classList.remove('capturing');
  }

  function clearCustomShortcutRow(row) {
    if (!row) return;
    const capture = row.querySelector('.custom-shortcut-capture');
    if (!capture) return;
    capture.dataset.code = '';
    capture.classList.remove('capturing');
    updateCustomShortcutRowLabel(row);
  }

  function ensureShortcutClearButtons() {
    document.querySelectorAll('.shortcut-row').forEach(row => {
      const capture = row.querySelector('.key-capture[data-key]');
      if (!capture || row.querySelector('.shortcut-clear')) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'shortcut-clear';
      button.textContent = 'Off';
      button.title = 'Turn off this shortcut';
      button.addEventListener('click', () => {
        clearShortcutCapture(capture);
        checkDuplicateKeys();
        updateShortcutAwareCopy();
      });
      row.appendChild(button);
    });
  }

  function wireCustomShortcutCapture(el) {
    const IGNORE = ['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'Tab'];
    el.addEventListener('keydown', e => {
      const row = el.closest('.custom-shortcut-row');
      if (!row) return;
      if (e.key === 'Backspace' || e.key === 'Delete') {
        clearCustomShortcutRow(row);
        e.preventDefault();
        checkDuplicateKeys();
        updateShortcutAwareCopy();
        return;
      }
      if (IGNORE.includes(e.code)) return;
      el.dataset.code = e.code;
      row.querySelector('[data-modifier="ctrlKey"]').checked = !!e.ctrlKey;
      row.querySelector('[data-modifier="altKey"]').checked = !!e.altKey;
      row.querySelector('[data-modifier="shiftKey"]').checked = !!e.shiftKey;
      row.querySelector('[data-modifier="metaKey"]').checked = !!e.metaKey;
      updateCustomShortcutRowLabel(row);
      el.classList.remove('capturing');
      e.preventDefault();
      e.stopPropagation();
      checkDuplicateKeys();
      updateShortcutAwareCopy();
    });
    el.addEventListener('focus', () => {
      el.classList.add('capturing');
      el.textContent = 'Press combo...';
    });
    el.addEventListener('blur', () => {
      el.classList.remove('capturing');
      updateCustomShortcutRowLabel(el.closest('.custom-shortcut-row'));
    });
  }

  function renderCustomShortcutBindings(bindings = DEFAULT_SHORTCUT_BINDINGS) {
    const list = document.getElementById('customShortcutsList');
    if (!list) return;
    const rows = (Array.isArray(bindings) ? bindings : DEFAULT_SHORTCUT_BINDINGS)
      .map(binding => ({
        action: SHORTCUT_ACTION_SET.has(binding?.action) ? binding.action : 'togglePlayPause',
        code: typeof binding?.code === 'string' ? binding.code : '',
        ctrlKey: !!binding?.ctrlKey,
        altKey: !!binding?.altKey,
        shiftKey: !!binding?.shiftKey,
        metaKey: !!binding?.metaKey
      }));
    if (!rows.length) {
      list.innerHTML = '<div class="custom-shortcut-empty">No custom combos yet.</div>';
      checkDuplicateKeys();
      return;
    }
    list.innerHTML = rows.map((binding, index) => {
      const meta = getShortcutActionMeta(binding.action);
      return `
        <div class="custom-shortcut-row" data-custom-index="${index}">
          <div class="custom-shortcut-main">
            <select class="custom-shortcut-action">
              ${SHORTCUT_ACTIONS.map(action => `<option value="${action.value}"${action.value === binding.action ? ' selected' : ''}>${escapeHtml(action.label)}</option>`).join('')}
            </select>
            <div class="custom-shortcut-meta">
              <label class="modifier-chip"><input type="checkbox" data-modifier="ctrlKey"${binding.ctrlKey ? ' checked' : ''}> Ctrl</label>
              <label class="modifier-chip"><input type="checkbox" data-modifier="altKey"${binding.altKey ? ' checked' : ''}> Alt</label>
              <label class="modifier-chip"><input type="checkbox" data-modifier="shiftKey"${binding.shiftKey ? ' checked' : ''}> Shift</label>
              <label class="modifier-chip"><input type="checkbox" data-modifier="metaKey"${binding.metaKey ? ' checked' : ''}> Meta</label>
            </div>
          </div>
          <div class="key-capture shortcut-pill custom-shortcut-capture" tabindex="0" data-code="${escapeHtml(binding.code)}">${escapeHtml(formatShortcutCombo(binding))}</div>
          <div class="custom-shortcut-actions">
            <button class="shortcut-clear custom-shortcut-clear" type="button" title="Turn off this combo">Off</button>
            <button class="btn-icon custom-shortcut-remove" type="button" title="Remove shortcut">
              <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/>
              </svg>
            </button>
          </div>
        </div>
      `;
    }).join('');

    list.querySelectorAll('.custom-shortcut-capture').forEach(wireCustomShortcutCapture);
    list.querySelectorAll('.custom-shortcut-clear').forEach(btn => {
      btn.addEventListener('click', () => {
        clearCustomShortcutRow(btn.closest('.custom-shortcut-row'));
        checkDuplicateKeys();
        updateShortcutAwareCopy();
      });
    });
    list.querySelectorAll('.custom-shortcut-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        btn.closest('.custom-shortcut-row')?.remove();
        if (!document.querySelector('.custom-shortcut-row')) {
          renderCustomShortcutBindings([]);
          updateShortcutAwareCopy();
          return;
        }
        checkDuplicateKeys();
        updateShortcutAwareCopy();
      });
    });
    list.querySelectorAll('.custom-shortcut-action').forEach(select => {
      select.addEventListener('change', () => {
        checkDuplicateKeys();
        updateShortcutAwareCopy();
      });
    });
    list.querySelectorAll('[data-modifier]').forEach(input => {
      input.addEventListener('change', () => {
        updateCustomShortcutRowLabel(input.closest('.custom-shortcut-row'));
        checkDuplicateKeys();
        updateShortcutAwareCopy();
      });
    });
    list.querySelectorAll('.custom-shortcut-row').forEach(row => {
      const select = row.querySelector('.custom-shortcut-action');
      const meta = getShortcutActionMeta(select?.value);
      if (meta) select.title = meta.desc;
      updateCustomShortcutRowLabel(row);
    });
    checkDuplicateKeys();
    updateShortcutAwareCopy();
  }

  function normalizeRulePattern(pattern) {
    return SiteRules.normalizeRulePattern(pattern);
  }

  function isValidRulePattern(pattern) {
    return !!normalizeRulePattern(pattern);
  }

  function clampRuleSpeed(speed) {
    return SiteRules.clampRuleSpeed(speed, 1.5);
  }

  function clampOverlayOpacity(value) {
    const parsed = Math.round((parseFloat(value) || 0) * 100) / 100;
    return Math.max(0.15, Math.min(1, parsed || OVERLAY_DEFAULT_SETTINGS.overlayOpacity));
  }

  function clampOverlayButtonSize(value) {
    const parsed = Math.round(parseFloat(value) || 0);
    return Math.max(16, Math.min(34, parsed || OVERLAY_DEFAULT_SETTINGS.overlayButtonSize));
  }

  function normalizeSettings(data = {}) {
    const restData = Object.fromEntries(
      Object.entries(data || {}).filter(([key]) => key !== ('start' + 'Hidden'))
    );
    const siteRules = normalizeSiteRules(data.siteRules || {});
    return {
      ...restData,
      defaultSpeed: clampRuleSpeed(data.defaultSpeed ?? data.speed ?? 1.0),
      siteRules,
      shortcutBindings: normalizeShortcutBindings(data.shortcutBindings || DEFAULT_SHORTCUT_BINDINGS),
      controlAudio: data.controlAudio !== false,
      showOverlay: data.showOverlay ?? true,
      overlayRestoreBadge: data.overlayRestoreBadge ?? true,
      overlayOpacity: clampOverlayOpacity(data.overlayOpacity),
      overlayButtonSize: clampOverlayButtonSize(data.overlayButtonSize),
      overlayRestoreCorners: data.overlayRestoreCorners || {},
      overlayControls: normalizeOverlayControls(data.overlayControls),
      overlayHiddenStates: data.overlayHiddenStates || {},
      exclusiveKeys: !!data.exclusiveKeys,
      debugMode: !!data.debugMode,
      logLevel: ['silent', 'error', 'warn', 'info', 'debug'].includes(data.logLevel) ? data.logLevel : 'warn'
    };
  }

  function normalizeSiteRules(rules = {}) {
    return SiteRules.normalizeSiteRules(rules);
  }

  function getRuleRelations(pattern, rules = {}) {
    return SiteRules.getRuleRelations(pattern, rules);
  }

  function describeRule(rule = {}) {
    return SiteRules.describeRule(rule).replace('x', '×');
  }

  function buildRuleNote(pattern, rules = {}) {
    return SiteRules.buildRuleNote(pattern, rules);
  }

  function buildRuleSaveMessage(pattern, nextRule, rulesBeforeSave = {}) {
    const rel = getRuleRelations(pattern, rulesBeforeSave);
    const label = SiteRules.isRegexPattern(pattern) ? `Regex ${pattern}` : pattern;
    const parts = [
      rel.exact
        ? `Updated ${label} (${describeRule(rel.exact.rule)} -> ${describeRule(nextRule)}).`
        : (nextRule.disabled ? `VelocityX disabled for ${label}.` : `Rule saved for ${label}.`)
    ];
    if (rel.parents.length) {
      parts.push(`This rule overrides broader match${rel.parents.length > 1 ? 'es' : ''}.`);
    }
    if (rel.children.length) {
      parts.push(`More specific subdomain rule${rel.children.length > 1 ? 's' : ''} still win on their own hosts.`);
    }
    if (nextRule.controllerCSS) {
      parts.push('Controller CSS override saved too.');
    }
    return parts.join(' ');
  }

  /* ── Shortcut conflict detection ─────────────────────────────── */
  function checkDuplicateKeys(options = {}) {
    const entries = [];
    const warn = document.getElementById('shortcutConflict');
    const inlineWarn = document.getElementById('shortcutConflictInline');

    document.querySelectorAll('.key-capture').forEach(el => {
      el.classList.remove('is-conflict');
      el.closest('.shortcut-row, .custom-shortcut-row')?.classList.remove('is-conflict');

      const code = el.dataset.code;
      if (!code) return;

      if (el.classList.contains('custom-shortcut-capture')) {
        const row = el.closest('.custom-shortcut-row');
        const action = row?.querySelector('.custom-shortcut-action')?.value;
        const meta = getShortcutActionMeta(action);
        entries.push({
          combo: formatShortcutCombo({
            code,
            ctrlKey: !!row?.querySelector('[data-modifier="ctrlKey"]')?.checked,
            altKey: !!row?.querySelector('[data-modifier="altKey"]')?.checked,
            shiftKey: !!row?.querySelector('[data-modifier="shiftKey"]')?.checked,
            metaKey: !!row?.querySelector('[data-modifier="metaKey"]')?.checked
          }),
          label: meta?.label || action || 'Custom shortcut',
          el,
          row
        });
        return;
      }

      entries.push({
        combo: formatShortcutCombo({ code }),
        label: el.dataset.keyLabel || el.dataset.key,
        el,
        row: el.closest('.shortcut-row')
      });
    });

    const groups = new Map();
    entries.forEach(entry => {
      const group = groups.get(entry.combo) || [];
      group.push(entry);
      groups.set(entry.combo, group);
    });

    const dups = [];
    let firstConflictEl = null;
    groups.forEach((group, combo) => {
      if (group.length < 2) return;
      dups.push(`"${combo}" (${group.map(item => item.label).join(' & ')})`);
      group.forEach(item => {
        item.el.classList.add('is-conflict');
        item.row?.classList.add('is-conflict');
        if (!firstConflictEl) firstConflictEl = item.el;
      });
    });

    const message = dups.length
      ? 'Conflict: ' + dups.join(', ') + '. Change one of the highlighted shortcuts.'
      : '';

    [warn, inlineWarn].forEach(el => {
      if (!el) return;
      if (message) {
        el.textContent = message;
        el.style.display = 'block';
      } else {
        el.style.display = 'none';
      }
    });

    if (message) {
      showContextFeedback({
        text: message,
        tone: 'warn',
        panelId: 'tab-shortcuts',
        source: 'shortcut-conflict',
        ms: 0
      });
    } else {
      hideContextFeedback('shortcut-conflict');
    }

    if (dups.length && options.scrollToConflict && firstConflictEl) {
      firstConflictEl.scrollIntoView({ behavior: options.behavior || 'smooth', block: 'center' });
      if (options.focusFirst) {
        try { firstConflictEl.focus({ preventScroll: true }); } catch (_) { firstConflictEl.focus(); }
      }
    }

    return dups.length === 0;
  }

  /* ── Load all settings ───────────────────────────────────────── */
  function loadAll() {
    getMergedStorage(null, d => {
      const needsOverlayDefaultsMigration =
        (d.overlayDefaultsVersion ?? 0) < OVERLAY_DEFAULTS_VERSION &&
        (
          matchesOverlayControls(d.overlayControls, PREVIOUS_OVERLAY_CONTROLS_V4) ||
          matchesOverlayControls(d.overlayControls, PREVIOUS_OVERLAY_CONTROLS_V3)
        );
      if (needsOverlayDefaultsMigration) {
        persistState(OVERLAY_DEFAULT_SETTINGS, loadAll);
        return;
      }
      if ((d.overlayDefaultsVersion ?? 0) < OVERLAY_DEFAULTS_VERSION) {
        persistState({ overlayDefaultsVersion: OVERLAY_DEFAULTS_VERSION });
      }
      S = normalizeSettings(d);
      populateGeneral(S);
      populateShortcuts(S);
      populateSilence(S);
      populateAdvanced(S);
      renderSiteRules(S.siteRules);
      populateAnalytics(S);
      updateShortcutAwareCopy(S);
    });
  }

  /* ── General tab ─────────────────────────────────────────────── */
  function populateGeneral(d) {
    const num = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
    const chk = (id, v) => { const e = document.getElementById(id); if (e) e.checked = !!v; };
    num('defaultSpeed',  d.defaultSpeed   ?? d.speed ?? 1.0);
    num('speedStep',     d.step           ?? 0.1);
    num('skipSeconds',   d.skipSeconds    ?? 10);
    num('loopSeconds',   d.loopSeconds    ?? 10);
    num('preset1Speed',  d.preset1Speed   ?? 1.8);
    num('preset2Speed',  d.preset2Speed   ?? 1.25);
    num('preset3Speed',  d.preset3Speed   ?? 2.5);
    num('overlayOpacity', d.overlayOpacity ?? OVERLAY_DEFAULT_SETTINGS.overlayOpacity);
    num('overlayButtonSize', d.overlayButtonSize ?? OVERLAY_DEFAULT_SETTINGS.overlayButtonSize);
    const wheelStep = document.getElementById('wheelStep');
    if (wheelStep) wheelStep.value = Number(d.wheelStep ?? 0.10).toFixed(2);
    chk('fightback',     d.fightback      ?? true);
    chk('rememberSpeed', d.rememberSpeed);
    chk('rememberPerUrl',d.rememberPerUrl);
    chk('controlAudio',  d.controlAudio !== false);
    chk('mouseWheel',    d.mouseWheel     ?? true);
    chk('showOverlay',   d.showOverlay    ?? true);
    chk('overlayRestoreBadge', d.overlayRestoreBadge ?? true);
    const op = document.getElementById('overlayPosition');
    if (op) op.value = d.overlayPosition || 'top-left';
    populateOverlayControls(d.overlayControls || {});
    syncOptionDependencies();
  }

  /* ── Shortcuts tab ───────────────────────────────────────────── */
  function populateShortcuts(d) {
    document.querySelectorAll('.key-capture[data-key]').forEach(el => {
      const k = el.dataset.key;
      const code = getLegacyShortcutCode(d, k);
      el.textContent = code ? codeToLabel(code) : 'Unassigned';
      el.dataset.code = code;
    });
    const exclusiveKeys = document.getElementById('exclusiveKeys');
    if (exclusiveKeys) exclusiveKeys.checked = !!d.exclusiveKeys;
    renderCustomShortcutBindings(d.shortcutBindings || DEFAULT_SHORTCUT_BINDINGS);
    initKeyCapture();
    ensureShortcutClearButtons();
    updateShortcutAwareCopy(d);
  }

  function initKeyCapture() {
    const IGNORE = ['ShiftLeft','ShiftRight','ControlLeft','ControlRight',
                    'AltLeft','AltRight','MetaLeft','MetaRight','Tab'];
    document.querySelectorAll('.key-capture[data-key]').forEach(el => {
      if (el.dataset.captureBound === '1') {
        el.textContent = el.dataset.code ? codeToLabel(el.dataset.code) : 'Unassigned';
        return;
      }
      el.dataset.captureBound = '1';
      el.addEventListener('keydown', e => {
        if (e.key === 'Backspace' || e.key === 'Delete') {
          clearShortcutCapture(el);
          e.preventDefault();
          checkDuplicateKeys();
          updateShortcutAwareCopy();
          return;
        }
        if (IGNORE.includes(e.code)) return;
        el.dataset.code = e.code;
        el.textContent  = codeToLabel(e.code);
        el.classList.remove('capturing');
        e.preventDefault(); e.stopPropagation();
        checkDuplicateKeys();
        updateShortcutAwareCopy();
      });
      el.addEventListener('focus', () => {
        el.classList.add('capturing');
        el.textContent = 'Press key…';
      });
      el.addEventListener('blur', () => {
        el.classList.remove('capturing');
        el.textContent = el.dataset.code ? codeToLabel(el.dataset.code) : 'Unassigned';
        updateShortcutAwareCopy();
      });
    });
  }

  /* ── Silence tab ─────────────────────────────────────────────── */
  function populateSilence(d) {
    const chk = (id, v) => { const e = document.getElementById(id); if (e) e.checked = !!v; };
    const num = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
    chk('silenceSkipFull', d.silenceSkip);
    num('silenceSpeed',    d.silenceSpeed    ?? 2.0);
    num('silenceDelay',    d.silenceDelay    ?? 800);
    const thr  = document.getElementById('silenceThreshold');
    const thrV = document.getElementById('thresholdVal');
    if (thr) {
      thr.value = d.silenceThreshold ?? 0.02;
      if (thrV) thrV.textContent = parseFloat(thr.value).toFixed(3);
      thr.addEventListener('input', () => {
        if (thrV) thrV.textContent = parseFloat(thr.value).toFixed(3);
      });
    }
    syncOptionDependencies();
  }

  /* ── Advanced tab (Custom CSS, Import/Export) ─────────────────── */
  function populateAdvanced(d) {
    const el = document.getElementById('customCSS');
    if (el) el.value = d.customCSS || '';
    const debugMode = document.getElementById('debugMode');
    if (debugMode) debugMode.checked = !!d.debugMode;
    const logLevel = document.getElementById('logLevel');
    if (logLevel) logLevel.value = d.logLevel || 'warn';
  }

  /* ── Site Rules tab ──────────────────────────────────────────── */
  function renderSiteRules(rules) {
    const list = document.getElementById('rulesList');
    if (!list) return;
    const normalizedRules = normalizeSiteRules(rules);
    const entries = [...normalizedRules].sort((a, b) => a.pattern.localeCompare(b.pattern));
    if (!entries.length) {
      list.innerHTML = '<div class="no-rules">No rules yet. Add a domain, regex, or controller CSS override above.</div>';
      return;
    }
    list.innerHTML = entries.map(rule => `
      <div class="rule-item">
        <div class="rule-copy">
          <div class="rule-main">
            <span class="rule-domain">${escapeHtml(rule.pattern)}</span>
        ${rule.disabled
          ? '<span class="rule-badge disabled">⛔ Disabled</span>'
          : (typeof rule.speed === 'number'
            ? `<span class="rule-badge speed">${clampRuleSpeed(rule.speed || 1.0).toFixed(2)}&times;</span>`
            : '<span class="rule-badge scope">CSS only</span>')
            }
            ${rule.scope === 'regex' ? '<span class="rule-badge scope">Regex</span>' : ''}
            ${rule.controllerCSS ? '<span class="rule-badge css">Controller CSS</span>' : ''}
            ${getRuleRelations(rule.pattern, normalizedRules).parents.length ? '<span class="rule-badge scope">Exact override</span>' : ''}
            ${getRuleRelations(rule.pattern, normalizedRules).children.length ? '<span class="rule-badge scope">Fallback rule</span>' : ''}
          </div>
          ${buildRuleNote(rule.pattern, normalizedRules) ? `<div class="rule-note">${escapeHtml(buildRuleNote(rule.pattern, normalizedRules))}</div>` : ''}
        </div>
        <button class="rule-del btn-icon" data-pattern="${escapeHtml(rule.pattern)}" title="Remove rule">
          <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/>
          </svg>
        </button>
      </div>`).join('');

    list.querySelectorAll('.rule-del').forEach(btn => {
      btn.addEventListener('click', () => {
        getMergedStorage('siteRules', d => {
          const r = normalizeSiteRules(d.siteRules || {}).filter(rule => rule.pattern !== btn.dataset.pattern);
          persistState({ siteRules: r }, () => {
            S.siteRules = r;
            renderSiteRules(r);
            syncToAllTabs({ siteRules: r });
            showMsg('rulesMsg', 'Rule removed.');
          });
        });
      });
    });
  }

  function addRule(pattern, ruleObj) {
    if (!pattern) return;
    getMergedStorage('siteRules', d => {
      const existingRules = normalizeSiteRules(d.siteRules || {});
      const nextRule = {
        pattern,
        ...(ruleObj.disabled ? { disabled: true } : {}),
        ...(Number.isFinite(Number(ruleObj.speed)) ? { speed: clampRuleSpeed(ruleObj.speed) } : {}),
        ...(ruleObj.controllerCSS ? { controllerCSS: ruleObj.controllerCSS } : {})
      };
      const message = buildRuleSaveMessage(pattern, nextRule, existingRules);
      const r = existingRules.filter(rule => rule.pattern !== pattern);
      r.push(nextRule);
      persistState({ siteRules: r }, () => {
        S.siteRules = r;
        renderSiteRules(r);
        syncToAllTabs({ siteRules: r });
        showMsg('rulesMsg', message, 4200);
      });
    });
  }

  function cleanDomain(raw) {
    return SiteRules.cleanDomain(raw);
  }

  function localizeStaticText() {
    const navItems = document.querySelectorAll('.nav-item');
    const navKeys = [
      'optionsNavGeneral',
      'optionsNavShortcuts',
      'optionsNavSilence',
      'optionsNavSiteRules',
      'optionsNavAnalytics',
      'optionsNavAdvanced'
    ];
    navItems.forEach((btn, index) => {
      const textNode = Array.from(btn.childNodes).find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
      const message = t(navKeys[index]);
      if (textNode && message) textNode.textContent = '\n        ' + message + '\n      ';
    });

    const setText = (selector, key) => {
      const el = document.querySelector(selector);
      const message = t(key);
      if (el && message) el.textContent = message;
    };

    setText('#tab-general .page-title', 'optionsGeneralPageTitle');
    setText('#tab-shortcuts .page-title', 'optionsShortcutsPageTitle');
    setText('#tab-silence .page-title', 'optionsSilencePageTitle');
    setText('#tab-siterules .page-title', 'optionsRulesPageTitle');
    setText('#tab-analytics .page-title', 'optionsAnalyticsPageTitle');
    setText('#tab-advanced .page-title', 'optionsAdvancedPageTitle');
    setText('#saveGeneral', 'optionsGeneralSave');
    setText('#saveShortcuts', 'optionsShortcutsSave');
    setText('#saveSilence', 'optionsSilenceSave');
    setText('#saveAdvanced', 'optionsAdvancedSave');

    const domainInput = document.getElementById('newDomain');
    const speedInput = document.getElementById('newSpeed');
    if (domainInput) domainInput.placeholder = t('optionsDomainPlaceholder', domainInput.placeholder);
    if (speedInput) speedInput.placeholder = t('optionsSpeedPlaceholder', speedInput.placeholder);

    const storageLabel = Array.from(document.querySelectorAll('.meta-label')).find(el => el.textContent.trim() === 'Storage');
    if (storageLabel) storageLabel.textContent = t('optionsStorageLabel', storageLabel.textContent);
    const storageValue = storageLabel?.closest('.meta-row')?.querySelector('.meta-value');
    if (storageValue) storageValue.textContent = t('optionsStorageValue', storageValue.textContent);

    const debugTitle = Array.from(document.querySelectorAll('.card-title')).find(el => el.textContent.trim() === 'Debug Tools');
    if (debugTitle) debugTitle.textContent = t('optionsDebugTitle', debugTitle.textContent);

    const debugRow = document.getElementById('debugMode')?.closest('.toggle-row');
    if (debugRow) {
      const name = debugRow.querySelector('.toggle-name');
      const desc = debugRow.querySelector('.toggle-desc');
      if (name) name.textContent = t('optionsDebugLabel', name.textContent);
      if (desc) desc.textContent = t('optionsDebugDesc', desc.textContent);
    }

    const exclusiveRow = document.getElementById('exclusiveKeys')?.closest('.toggle-row');
    if (exclusiveRow) {
      const name = exclusiveRow.querySelector('.toggle-name');
      const desc = exclusiveRow.querySelector('.toggle-desc');
      if (name) name.textContent = t('optionsExclusiveLabel', name.textContent);
      if (desc) desc.textContent = t('optionsExclusiveDesc', desc.textContent);
    }
  }

  /* ── Analytics tab ───────────────────────────────────────────── */
  function populateAnalytics(d) {
    const total   = d.totalTimeSaved || 0;
    const week    = d.weekTimeSaved  || 0;
    const install = d.installTime    || Date.now();
    const sessions = d.totalSessions || 0;
    const days    = Math.max(1, Math.floor((Date.now() - install) / 86400000));

    const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    set('totalSavedOpt',  fmt(total));
    set('weekSavedOpt',   fmt(week));
    set('installDaysOpt', days + ' day' + (days !== 1 ? 's' : ''));
    set('totalSessionsOpt', sessions.toLocaleString());

    renderEquiv(total);
    renderSpeedChart(d.speedDist || {});
    renderSharePreview(d);
  }

  function renderEquiv(totalSec) {
    const c = document.getElementById('timeEquiv');
    if (!c) return;
    if (totalSec < 10) {
      c.innerHTML = '<p class="no-data">Start watching videos faster to see what you could do with that saved time!</p>';
      return;
    }
    const items = [
      { label: '📺 Netflix episodes (22 min)',    unit: 1320 },
      { label: '📚 Books read (5 hr avg)',         unit: 18000 },
      { label: '🎙 Podcast episodes (45 min)',     unit: 2700 },
      { label: '🧘 Meditation sessions (10 min)', unit: 600 },
      { label: '🏃 Morning runs (30 min)',         unit: 1800 },
    ];
    const maxVal = Math.max(1, ...items.map(i => totalSec / i.unit));
    c.innerHTML = items.map(i => {
      const count = totalSec / i.unit;
      const pct   = Math.min(100, (count / maxVal) * 100);
      return `<div class="equiv-item">
        <div class="equiv-label">${i.label}</div>
        <div class="equiv-bar-wrap"><div class="equiv-bar" style="width:${pct}%"></div></div>
        <div class="equiv-count">${count >= 1 ? count.toFixed(1) : '< 1'}</div>
      </div>`;
    }).join('');
  }

  function renderSpeedChart(dist) {
    const c = document.getElementById('speedChart');
    if (!c) return;
    const entries = Object.entries(dist || {})
      .map(([speed, seconds]) => ({ speed: parseFloat(speed), seconds: parseFloat(seconds) || 0 }))
      .filter(item => Number.isFinite(item.speed) && item.seconds > 0)
      .sort((a, b) => a.speed - b.speed);

    if (!entries.length) {
      c.innerHTML = '<p class="no-data">No data yet. Use VelocityX while watching videos to see your speed distribution.</p>';
      return;
    }
    const maxV = Math.max(1, ...entries.map(item => item.seconds));
    const total = entries.reduce((sum, item) => sum + item.seconds, 0);
    const favorite = entries.reduce((best, item) => item.seconds > best.seconds ? item : best, entries[0]);
    c.innerHTML = entries.map(item => {
      const width = (item.seconds / maxV) * 100;
      const pct = total > 0 ? (item.seconds / total) * 100 : 0;
      const speedLabel = Number.isInteger(item.speed)
        ? item.speed.toFixed(0)
        : ((item.speed * 10) % 1 === 0 ? item.speed.toFixed(1) : item.speed.toFixed(2));
      const favClass = item.speed === favorite.speed && item.seconds === favorite.seconds ? ' fav' : '';
      return `<div class="chart-bar-row${favClass}">
        <div class="chart-label">${speedLabel}&times;</div>
        <div class="chart-bar-wrap"><div class="chart-bar" style="width:${width.toFixed(1)}%"></div></div>
        <div class="chart-time">${fmt(item.seconds)} · ${pct.toFixed(0)}%</div>
      </div>`;
    }).join('');
  }

  /* ── Import / Export settings ────────────────────────────────── */
  function getSpeedEntries(dist) {
    return Object.entries(dist || {})
      .map(([speed, seconds]) => ({ speed: parseFloat(speed), seconds: parseFloat(seconds) || 0 }))
      .filter(item => Number.isFinite(item.speed) && item.seconds > 0)
      .sort((a, b) => b.seconds - a.seconds);
  }

  function getFavoriteSpeed(dist) {
    const entries = getSpeedEntries(dist);
    return entries.length ? entries[0].speed : Number(S.defaultSpeed || S.speed || 1);
  }

  function formatSpeedLabel(speed) {
    const value = Number(speed) || 1;
    if (Number.isInteger(value)) return value.toFixed(0) + 'x';
    return ((value * 10) % 1 === 0 ? value.toFixed(1) : value.toFixed(2)) + 'x';
  }

  function buildAnalyticsShareModel(d = {}) {
    const total = Number(d.totalTimeSaved || 0);
    const week = Number(d.weekTimeSaved || 0);
    const install = Number(d.installTime || Date.now());
    const sessions = Number(d.totalSessions || 0);
    const days = Math.max(1, Math.floor((Date.now() - install) / 86400000));
    const favoriteSpeed = getFavoriteSpeed(d.speedDist || {});
    const saved = fmt(total);
    const weekSaved = fmt(week);
    const insight = total >= 3600
      ? 'That is real focus time reclaimed from everyday watching.'
      : total >= 600
        ? 'A calm little pocket of time saved, one video at a time.'
        : 'Just getting started with faster, cleaner video control.';
    const caption = [
      `VelocityX helped me save ${saved} watching videos.`,
      `${weekSaved} saved this week, favorite speed ${formatSpeedLabel(favoriteSpeed)}.`,
      'Generated locally with VelocityX by Coreova.',
      'https://github.com/coreova/velocityx'
    ].join('\n');

    return {
      total,
      week,
      sessions,
      days,
      favoriteSpeed,
      saved,
      weekSaved,
      insight,
      caption,
      entries: getSpeedEntries(d.speedDist || {})
    };
  }

  function renderSharePreview(d = {}) {
    const model = buildAnalyticsShareModel(d);
    const totalEl = document.getElementById('sharePreviewTotal');
    const captionEl = document.getElementById('sharePreviewCaption');
    if (totalEl) totalEl.textContent = `${model.saved} saved`;
    if (captionEl) {
      captionEl.textContent = model.total > 0
        ? `${model.weekSaved} this week, ${formatSpeedLabel(model.favoriteSpeed)} favorite speed, ${model.sessions.toLocaleString()} sessions.`
        : 'Use VelocityX while watching videos to generate a share card.';
    }
  }

  function extensionAsset(path) {
    if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) return chrome.runtime.getURL(path);
    return `../${path}`;
  }

  function loadImage(src) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  function roundedPath(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  function fillRounded(ctx, x, y, w, h, r, fillStyle) {
    roundedPath(ctx, x, y, w, h, r);
    ctx.fillStyle = fillStyle;
    ctx.fill();
  }

  function strokeRounded(ctx, x, y, w, h, r, strokeStyle, lineWidth = 1) {
    roundedPath(ctx, x, y, w, h, r);
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }

  function fitText(ctx, text, maxWidth, fontSize, weight = 700) {
    let size = fontSize;
    do {
      ctx.font = `${weight} ${size}px Inter, Segoe UI, Arial, sans-serif`;
      if (ctx.measureText(text).width <= maxWidth) return size;
      size -= 2;
    } while (size >= 20);
    return size;
  }

  async function createAnalyticsShareCanvas(d = {}) {
    const model = buildAnalyticsShareModel(d);
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 630;
    const ctx = canvas.getContext('2d');

    const bg = ctx.createLinearGradient(0, 0, 1200, 630);
    bg.addColorStop(0, '#070a16');
    bg.addColorStop(0.52, '#0a0f1f');
    bg.addColorStop(1, '#101623');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 1200, 630);

    ctx.globalAlpha = 0.14;
    ctx.fillStyle = '#3a5bff';
    ctx.beginPath();
    ctx.arc(1060, 90, 210, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = '#22e6c8';
    ctx.beginPath();
    ctx.arc(1120, 560, 180, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    fillRounded(ctx, 48, 44, 1104, 542, 32, 'rgba(16,22,35,.94)');
    strokeRounded(ctx, 48, 44, 1104, 542, 32, 'rgba(248,250,252,.13)', 2);

    const icon = await loadImage(extensionAsset('icons/icon128.png'));
    fillRounded(ctx, 88, 86, 88, 88, 22, '#151c2b');
    if (icon) {
      ctx.drawImage(icon, 96, 94, 72, 72);
    } else {
      ctx.fillStyle = '#f8fafc';
      ctx.font = '800 46px Segoe UI, Arial, sans-serif';
      ctx.fillText('V', 116, 148);
    }

    ctx.fillStyle = '#c7d2e4';
    ctx.font = '600 24px Inter, Segoe UI, Arial, sans-serif';
    ctx.fillText('VelocityX Analytics', 202, 113);
    ctx.fillStyle = '#f8fafc';
    const savedSize = fitText(ctx, `${model.saved} saved`, 520, 78, 800);
    ctx.font = `800 ${savedSize}px Inter, Segoe UI, Arial, sans-serif`;
    ctx.fillText(`${model.saved} saved`, 202, 178);

    ctx.fillStyle = '#c7d2e4';
    const summary = 'Video speed controller with Silence Skip, AB Loop, PiP, keyboard shortcuts, site rules, custom overlay, and local analytics. Free.';
    const summarySize = fitText(ctx, summary, 900, 22, 500);
    ctx.font = `500 ${summarySize}px Inter, Segoe UI, Arial, sans-serif`;
    ctx.fillText(summary, 202, 220);

    const cardTop = 268;
    const statCards = [
      ['This week', model.weekSaved],
      ['Favorite speed', formatSpeedLabel(model.favoriteSpeed)],
      ['Sessions', model.sessions.toLocaleString()],
      ['Days active', model.days.toLocaleString()]
    ];
    statCards.forEach((item, index) => {
      const x = 88 + index * 246;
      fillRounded(ctx, x, cardTop, 218, 112, 20, 'rgba(248,250,252,.055)');
      strokeRounded(ctx, x, cardTop, 218, 112, 20, 'rgba(248,250,252,.1)');
      ctx.fillStyle = '#8fa1b8';
      ctx.font = '600 20px Inter, Segoe UI, Arial, sans-serif';
      ctx.fillText(item[0], x + 24, cardTop + 38);
      ctx.fillStyle = '#f8fafc';
      const statSize = fitText(ctx, item[1], 170, 34, 800);
      ctx.font = `800 ${statSize}px Inter, Segoe UI, Arial, sans-serif`;
      ctx.fillText(item[1], x + 24, cardTop + 82);
    });

    ctx.fillStyle = '#e2e8f0';
    ctx.font = '600 27px Inter, Segoe UI, Arial, sans-serif';
    ctx.fillText(model.insight, 88, 438);

    const chartX = 88;
    const chartY = 466;
    const entries = model.entries.slice(0, 5);
    const max = Math.max(1, ...entries.map(item => item.seconds));
    if (entries.length) {
      entries.forEach((item, index) => {
        const y = chartY + index * 24;
        const width = Math.max(24, (item.seconds / max) * 470);
        ctx.fillStyle = '#8fa1b8';
        ctx.font = '600 17px Inter, Segoe UI, Arial, sans-serif';
        ctx.fillText(formatSpeedLabel(item.speed), chartX, y + 16);
        fillRounded(ctx, chartX + 74, y, 500, 14, 7, 'rgba(248,250,252,.09)');
        const grad = ctx.createLinearGradient(chartX + 74, y, chartX + 74 + width, y);
        grad.addColorStop(0, '#3a5bff');
        grad.addColorStop(1, '#22e6c8');
        fillRounded(ctx, chartX + 74, y, width, 14, 7, grad);
      });
    } else {
      ctx.fillStyle = '#8fa1b8';
      ctx.font = '500 20px Inter, Segoe UI, Arial, sans-serif';
      ctx.fillText('No speed distribution yet. Watch a few videos to fill this in.', chartX, chartY + 24);
    }

    ctx.textAlign = 'right';
    ctx.fillStyle = '#f8fafc';
    ctx.font = '700 30px Inter, Segoe UI, Arial, sans-serif';
    ctx.fillText('VelocityX', 1112, 486);
    ctx.fillStyle = '#c7d2e4';
    ctx.font = '500 22px Inter, Segoe UI, Arial, sans-serif';
    ctx.fillText('by Coreova', 1112, 520);
    ctx.fillStyle = '#b8fff4';
    ctx.font = '600 20px Inter, Segoe UI, Arial, sans-serif';
    ctx.fillText('github.com/coreova/velocityx', 1112, 553);
    ctx.fillStyle = '#8fa1b8';
    ctx.font = '500 17px Inter, Segoe UI, Arial, sans-serif';
    ctx.fillText('Generated locally. No data uploaded.', 1112, 580);
    ctx.textAlign = 'left';

    return canvas;
  }

  function canvasToBlob(canvas) {
    return new Promise(resolve => canvas.toBlob(resolve, 'image/png', 0.96));
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  async function copyText(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }

  function getAllStorage() {
    return new Promise(resolve => getMergedStorage(null, resolve));
  }

  async function saveShareCard() {
    const data = await getAllStorage();
    const canvas = await createAnalyticsShareCanvas(data);
    const blob = await canvasToBlob(canvas);
    if (!blob) throw new Error('Share card export failed.');
    downloadBlob(blob, `velocityx-share-card-${new Date().toISOString().slice(0, 10)}.png`);
    setShareActionStatus('PNG saved locally. No analytics uploaded.', 'success', 4200);
    showMsg('analyticsMsg', 'Share card saved as PNG.', 3200);
  }

  async function copyShareCaption() {
    const data = await getAllStorage();
    await copyText(buildAnalyticsShareModel(data).caption);
    markCopyCaptionCopied();
    setShareActionStatus('Caption copied with the VelocityX GitHub link.', 'success', 4600);
    showMsg('analyticsMsg', 'Share caption copied.', 3000);
  }

  async function shareAnalyticsCard() {
    const data = await getAllStorage();
    const model = buildAnalyticsShareModel(data);
    const canvas = await createAnalyticsShareCanvas(data);
    const blob = await canvasToBlob(canvas);
    if (!blob) throw new Error('Share card export failed.');
    const filename = `velocityx-share-card-${new Date().toISOString().slice(0, 10)}.png`;
    const file = new File([blob], filename, { type: 'image/png' });

    if (navigator.canShare?.({ files: [file] }) && navigator.share) {
      try {
        await navigator.share({
          title: 'VelocityX Analytics',
          text: model.caption,
          files: [file]
        });
        setShareActionStatus('Share sheet opened with the PNG and caption.', 'success', 4200);
        showMsg('analyticsMsg', 'Share sheet opened.', 3000);
        return;
      } catch (err) {
        if (err?.name === 'AbortError') {
          setShareActionStatus('Share canceled. Nothing was posted.', 'success', 2800);
          showMsg('analyticsMsg', 'Share canceled.', 2500);
          return;
        }
      }
    }

    await copyText(model.caption).catch(() => {});
    downloadBlob(blob, filename);
    setShareActionStatus('PNG saved and caption copied for posting.', 'success', 4600);
    showMsg('analyticsMsg', 'PNG saved and caption copied for posting.', 3800);
  }

  function exportSettings() {
    getMergedStorage(null, d => {
      const exportData = JSON.stringify(buildSettingsExportPayload(d), null, 2);
      const blob = new Blob([exportData], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = 'velocityx-settings.json';
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  function importSettings(file) {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const data = JSON.parse(e.target.result);
        const safe = extractImportableSettings(data);
        if (!('defaultSpeed' in safe) && Number.isFinite(Number(safe.speed))) {
          safe.defaultSpeed = clampRuleSpeed(safe.speed);
        }
        if ('defaultSpeed' in safe) safe.defaultSpeed = clampRuleSpeed(safe.defaultSpeed);
        if ('siteRules' in safe) safe.siteRules = normalizeSiteRules(safe.siteRules);
        if ('shortcutBindings' in safe) safe.shortcutBindings = normalizeShortcutBindings(safe.shortcutBindings);
        if ('overlayControls' in safe) safe.overlayControls = normalizeOverlayControls(safe.overlayControls);
        if ('overlayOpacity' in safe) safe.overlayOpacity = clampOverlayOpacity(safe.overlayOpacity);
        if ('overlayButtonSize' in safe) safe.overlayButtonSize = clampOverlayButtonSize(safe.overlayButtonSize);
        if ('controlAudio' in safe) safe.controlAudio = safe.controlAudio !== false;
        if ('exclusiveKeys' in safe) safe.exclusiveKeys = !!safe.exclusiveKeys;
        if ('debugMode' in safe) safe.debugMode = !!safe.debugMode;
        if ('logLevel' in safe && !['silent', 'error', 'warn', 'info', 'debug'].includes(safe.logLevel)) {
          safe.logLevel = 'warn';
        }
        if ('overlayDefaultsVersion' in safe) safe.overlayDefaultsVersion = OVERLAY_DEFAULTS_VERSION;
        persistState(safe, () => {
          S = normalizeSettings({
            ...S,
            ...safe
          });
          syncToAllTabs(safe);
          loadAll();
          showToast('✓ Settings imported!');
        });
      } catch (_) {
        setTimeout(() => showMsg('advancedMsg', 'Invalid VelocityX settings file.'), 0);
        showMsg('advancedMsg', 'This JSON is not a valid VelocityX settings export.');
        showMsg('advancedMsg', '✗ Invalid file.');
      }
    };
    reader.readAsText(file);
  }

  /* ── DOM ready ───────────────────────────────────────────────── */
  document.addEventListener('DOMContentLoaded', () => {
    localizeStaticText();
    loadAll();

    ['showOverlay', 'mouseWheel', 'silenceSkipFull'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', () => updateShortcutAwareCopy());
    });
    document.querySelectorAll('[data-overlay-part]').forEach(el => {
      el.addEventListener('change', () => {
        updateShortcutAwareCopy();
      });
    });
    ['newDomain', 'newSpeed', 'newRuleCSS'].forEach(id => {
      document.getElementById(id)?.addEventListener('input', () => syncOptionDependencies());
    });

    /* Tab navigation */
    const activateTab = tabName => {
      const btn = document.querySelector(`.nav-item[data-tab="${tabName}"]`);
      const tab = document.getElementById('tab-' + tabName);
      if (!btn || !tab) return false;
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      tab.classList.add('active');
      syncContextFeedbackVisibility();
      return true;
    };

    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.addEventListener('click', () => {
        if (activateTab(btn.dataset.tab) && history.replaceState) {
          history.replaceState(null, '', btn.dataset.tab === 'general' ? location.pathname : `#${btn.dataset.tab}`);
        }
      });
    });

    const initialTab = location.hash.replace(/^#/, '');
    if (initialTab) activateTab(initialTab);

    /* ── Save General ── */
    document.getElementById('saveGeneral')?.addEventListener('click', () => {
      const num = id => parseFloat(document.getElementById(id)?.value) || 0;
      const chk = id => !!(document.getElementById(id)?.checked);
      const sel = id => document.getElementById(id)?.value || '';
      const nextOverlayPosition = sel('overlayPosition') || 'top-left';
      const overlayPositionChanged = (S.overlayPosition || 'top-left') !== nextOverlayPosition;
      const upd = {
        defaultSpeed:   clampRuleSpeed(num('defaultSpeed') || 1.0),
        step:           Math.max(0.05, Math.min(1, num('speedStep') || 0.1)),
        skipSeconds:    Math.max(1, Math.min(300, Math.round(num('skipSeconds') || 10))),
        loopSeconds:    Math.max(5, Math.min(300, num('loopSeconds') || 10)),
        preset1Speed:   clampRuleSpeed(num('preset1Speed') || 1.8),
        preset2Speed:   clampRuleSpeed(num('preset2Speed') || 1.25),
        preset3Speed:   clampRuleSpeed(num('preset3Speed') || 2.5),
        wheelStep:      parseFloat(document.getElementById('wheelStep')?.value) || 0.10,
        fightback:      chk('fightback'),
        rememberSpeed:  chk('rememberSpeed'),
        rememberPerUrl: chk('rememberPerUrl'),
        controlAudio:   chk('controlAudio'),
        mouseWheel:     chk('mouseWheel'),
        showOverlay:    chk('showOverlay'),
        overlayRestoreBadge: chk('overlayRestoreBadge'),
        overlayOpacity: clampOverlayOpacity(num('overlayOpacity') || OVERLAY_DEFAULT_SETTINGS.overlayOpacity),
        overlayButtonSize: clampOverlayButtonSize(num('overlayButtonSize') || OVERLAY_DEFAULT_SETTINGS.overlayButtonSize),
        overlayPosition: nextOverlayPosition,
        overlayControls: readOverlayControls()
      };
      if (overlayPositionChanged) {
        upd.overlayOffsets = {};
        upd.overlayRestoreCorners = {};
        upd.overlayHiddenStates = {};
      }
      persistState(upd, () => {
        S = normalizeSettings({ ...S, ...upd });
        populateGeneral(S);
        syncToAllTabs(upd);
        showToast(overlayPositionChanged
          ? '✓ General settings saved! Overlay position reset applied.'
          : '✓ General settings saved!');
      });
    });

    /* ── Save Shortcuts (with conflict check) ── */
    document.getElementById('resetOverlayPositions')?.addEventListener('click', () => {
      const clearedState = { overlayOffsets: {}, overlayHiddenStates: {}, overlayRestoreCorners: {} };
      persistState(clearedState, () => {
        S.overlayOffsets = {};
        S.overlayHiddenStates = {};
        S.overlayRestoreCorners = {};
        syncToAllTabs(clearedState);
        sendToAllTabs({ type: 'RESET_OVERLAY_STATE' });
        showToast('✓ Overlay state cleared!');
      });
    });


    document.getElementById('resetGeneral')?.addEventListener('click', () => {
      if (!confirm('Reset only General settings to their defaults? Shortcuts, Silence Skip, Site Rules, Analytics, and Advanced settings will stay as they are.')) return;
      const reset = {
        ...GENERAL_SETTINGS_DEFAULTS,
        overlayControls: { ...GENERAL_SETTINGS_DEFAULTS.overlayControls }
      };
      persistState(reset, () => {
        S = normalizeSettings({ ...S, ...reset });
        S.overlayOffsets = {};
        S.overlayHiddenStates = {};
        S.overlayRestoreCorners = {};
        populateGeneral(S);
        syncToAllTabs(reset);
        sendToAllTabs({ type: 'RESET_OVERLAY_STATE' });
        showToast('General settings reset!');
      });
    });

    document.getElementById('saveShortcuts')?.addEventListener('click', () => {
      if (!checkDuplicateKeys({ scrollToConflict: true, focusFirst: true })) {
        showMsg('shortcutsMsg', '⚠ Fix conflicts first!', 3000);
        return;
      }
      const upd = {
        exclusiveKeys: !!document.getElementById('exclusiveKeys')?.checked,
        shortcutBindings: readCustomShortcutBindings()
      };
      document.querySelectorAll('.key-capture[data-key]').forEach(el => {
        upd[el.dataset.key] = el.dataset.code;
      });
      persistState(upd, () => {
        S = normalizeSettings({ ...S, ...upd });
        populateShortcuts(S);
        syncToAllTabs(upd);
        showToast('✓ Shortcuts saved!');
      });
    });

    /* Reset shortcuts to default */
    document.getElementById('resetShortcuts')?.addEventListener('click', () => {
      document.querySelectorAll('.key-capture[data-key]').forEach(el => {
        const k    = el.dataset.key;
        const code = KEY_DEFAULTS[k] || '';
        el.dataset.code = code;
        el.textContent  = codeToLabel(code);
      });
      const exclusiveKeys = document.getElementById('exclusiveKeys');
      if (exclusiveKeys) exclusiveKeys.checked = false;
      renderCustomShortcutBindings(DEFAULT_SHORTCUT_BINDINGS);
      updateShortcutAwareCopy({
        ...S,
        ...KEY_DEFAULTS,
        exclusiveKeys: false,
        shortcutBindings: DEFAULT_SHORTCUT_BINDINGS.map(binding => ({ ...binding }))
      });
      checkDuplicateKeys();
      showToast('Defaults restored – click Save to apply.');
    });

    /* ── Save Silence ── */
    document.getElementById('disableAllShortcuts')?.addEventListener('click', () => {
      document.querySelectorAll('.key-capture[data-key]').forEach(clearShortcutCapture);
      const exclusiveKeys = document.getElementById('exclusiveKeys');
      if (exclusiveKeys) exclusiveKeys.checked = false;
      renderCustomShortcutBindings([]);
      checkDuplicateKeys();
      updateShortcutAwareCopy({
        ...S,
        keyFaster: '',
        keySlower: '',
        keyReset: '',
        keyForward: '',
        keyRewind: '',
        keyToggle: '',
        keyPiP: '',
        keyPreset1: '',
        keyPreset2: '',
        keyPreset3: '',
        keyLoop: '',
        keyVolumeDown: '',
        keyVolumeUp: '',
        keyMark: '',
        keyJump: '',
        exclusiveKeys: false,
        shortcutBindings: []
      });
      showToast('All shortcuts turned off - click Save to apply.');
    });

    document.getElementById('addCustomShortcut')?.addEventListener('click', () => {
      const next = readCustomShortcutBindings();
      next.push({
        action: 'togglePlayPause',
        code: '',
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        metaKey: false
      });
      renderCustomShortcutBindings(next);
      document.querySelector('.custom-shortcut-row:last-child .custom-shortcut-capture')?.focus();
    });

    document.getElementById('saveSilence')?.addEventListener('click', () => {
      const chk = id => !!(document.getElementById(id)?.checked);
      const num = id => parseFloat(document.getElementById(id)?.value) || 0;
      const upd = {
        silenceSkip: chk('silenceSkipFull'),
        silenceSpeed: clampRuleSpeed(num('silenceSpeed') || 2.0),
        silenceDelay: Math.max(100, Math.min(5000, Math.round(num('silenceDelay') || 800))),
        silenceThreshold: Math.max(0.001, Math.min(0.1, num('silenceThreshold') || 0.02))
      };
      persistState(upd, () => {
        S = normalizeSettings({ ...S, ...upd });
        populateSilence(S);
        syncToAllTabs(upd);
        showToast('✓ Silence settings saved!');
      });
    });

    /* ── Add Speed Rule ── */
    document.getElementById('addRule')?.addEventListener('click', () => {
      const pattern = normalizeRulePattern(document.getElementById('newDomain')?.value);
      const speed  = parseFloat(document.getElementById('newSpeed')?.value || '1.5');
      const controllerCSS = document.getElementById('newRuleCSS')?.value?.trim() || '';
      if (!pattern) {
        showMsg('rulesMsg', 'Enter a domain or regex first.', 3000);
        return;
      }
      if (!Number.isFinite(speed) && !controllerCSS) {
        showMsg('rulesMsg', 'Add a speed or controller CSS override for this rule.', 3500);
        return;
      }
      addRule(pattern, { speed: isNaN(speed) ? undefined : speed, controllerCSS });
      const domEl = document.getElementById('newDomain');
      if (domEl) domEl.value = '';
      const cssEl = document.getElementById('newRuleCSS');
      if (cssEl) cssEl.value = '';
      syncOptionDependencies();
    });

    document.getElementById('addDisableRule')?.addEventListener('click', () => {
      const pattern = normalizeRulePattern(document.getElementById('newDomain')?.value);
      const controllerCSS = document.getElementById('newRuleCSS')?.value?.trim() || '';
      if (!pattern) {
        showMsg('rulesMsg', 'Enter a domain or regex first.', 3000);
        return;
      }
      addRule(pattern, { disabled: true, controllerCSS });
      const domEl = document.getElementById('newDomain');
      if (domEl) domEl.value = '';
      const cssEl = document.getElementById('newRuleCSS');
      if (cssEl) cssEl.value = '';
      syncOptionDependencies();
    });

    document.getElementById('newDomain')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('addRule')?.click();
    });

    /* ── Advanced: Save Custom CSS ── */
    document.getElementById('saveAdvanced')?.addEventListener('click', () => {
      const upd = {
        customCSS: document.getElementById('customCSS')?.value || '',
        debugMode: !!document.getElementById('debugMode')?.checked,
        logLevel: document.getElementById('logLevel')?.value || 'warn'
      };
      persistState(upd, () => {
        S = normalizeSettings({ ...S, ...upd });
        populateAdvanced(S);
        syncToAllTabs(upd);
        showToast('✓ Advanced settings saved!');
      });
    });

    /* ── Export Settings ── */
    document.getElementById('exportSettings')?.addEventListener('click', () => {
      exportSettings();
      showMsg('advancedMsg', 'Settings exported.');
    });

    /* ── Import Settings ── */
    document.getElementById('importFile')?.addEventListener('change', e => {
      const file = e.target.files?.[0];
      if (file) importSettings(file);
      e.target.value = '';
    });

    document.getElementById('importSettings')?.addEventListener('click', () => {
      document.getElementById('importFile')?.click();
    });

    /* ── Reset to Factory Defaults ── */
    document.getElementById('saveShareCard')?.addEventListener('click', () => {
      saveShareCard().catch(() => {
        setShareActionStatus('Could not save the PNG. Try again from the share card.', 'error', 4600);
        showMsg('analyticsMsg', 'Could not save share card.', 3200);
      });
    });

    document.getElementById('copyShareCaption')?.addEventListener('click', () => {
      copyShareCaption().catch(() => {
        setShareActionStatus('Could not copy caption. Try Share / Post.', 'error', 4600);
        showMsg('analyticsMsg', 'Could not copy share caption.', 3200);
      });
    });

    document.getElementById('shareAnalyticsCard')?.addEventListener('click', () => {
      shareAnalyticsCard().catch(() => {
        setShareActionStatus('Could not create the share card. Try saving the PNG first.', 'error', 4600);
        showMsg('analyticsMsg', 'Could not create share card.', 3200);
      });
    });

    document.getElementById('resetAll')?.addEventListener('click', () => {
      if (!confirm('Reset ALL settings to factory defaults? Analytics will be kept.')) return;
      const DEFAULTS = {
        ...SYNC_SETTINGS_DEFAULTS,
        speed: 1.0,
        overlayOffsets: {},
        overlayRestoreCorners: {},
        overlayHiddenStates: {},
        overlayControls: { ...OVERLAY_CONTROL_DEFAULTS },
        overlayDefaultsVersion: OVERLAY_DEFAULTS_VERSION
      };
      persistState(DEFAULTS, () => {
        S = normalizeSettings({ ...S, ...DEFAULTS });
        syncToAllTabs(DEFAULTS);
        sendToAllTabs({ type: 'RESET_OVERLAY_STATE' });
        loadAll();
        showToast('✓ Reset to factory defaults!');
      });
    });

    /* ── Reset Stats ── */
    document.getElementById('resetStats')?.addEventListener('click', () => {
      if (!confirm('Reset all time-saved statistics? This cannot be undone.')) return;
      const reset = { totalTimeSaved: 0, weekTimeSaved: 0, weekStart: Date.now(), speedDist: {}, totalSessions: 0 };
      persistState(reset, () => {
        S = { ...S, ...reset };
        populateAnalytics(S);
        showToast('✓ Stats reset!');
      });
    });
  });
})();
