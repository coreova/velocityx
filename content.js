/* VelocityX v1.0.0 – content.js
   ═══════════════════════════════════════════════════════════════════
   First public release baseline:
   ✔ Shadow DOM overlay — page CSS cannot break the overlay anymore
   ✔ Pointer Capture drag — reliable drag on YouTube, Netflix, all sites
   ✔ Overlay drag stays on the current page only; refresh/new video restores the saved preset
   ✔ Site-specific container logic (YouTube, Netflix, Facebook, Amazon)
   ✔ Late-loading video detection via loadedmetadata + play events
   ✔ gif-video filter (loop+muted+no-controls ignored automatically)
   ✔ Advanced fightback — exponential cooldown + fight counter
   ✔ AudioContext resume() for Silence Skip after user gesture
   • VelocityX analytics, multi-preset speeds, safe storage sync
   • Site-aware container handling and resilient speed fightback
*/
(function () {
  'use strict';

  const VX_VERSION = '1.0.0';
  const CROSS_FRAME_RESPONSE_GRACE_MS = 80;

  if (typeof window._vxDestroy === 'function') {
    try { window._vxDestroy(); } catch (_) {}
  }
  if (window._vxLoaded) return;
  window._vxLoaded  = true;
  window._vxVersion = VX_VERSION;

  let contextActive = true;
  const Settings = globalThis.VelocityXSettings || {};
  const ShortcutUtils = globalThis.VelocityXShortcuts || {};
  const SiteRules = globalThis.VelocityXSiteRules;
  const EARLY_CONTROL_EVENT = 'VX_EARLY_CONTROL';
  const LOCAL_ONLY_STORAGE_KEYS = new Set([
    ...(Settings.LOCAL_ONLY_STORAGE_KEYS || [
      'speed',
      'popupSpeedScope',
      'overlayOffsets',
      'overlayRestoreCorners',
      'overlayHiddenStates',
      'totalTimeSaved',
      'weekTimeSaved',
      'totalSessions',
      'speedDist'
    ]),
    'weekStart',
    'installTime'
  ]);

  function isUrlScopedSpeedKey(key = '') {
    return typeof key === 'string' && key.startsWith('url_');
  }

  function isLocalOnlyStorageKey(key = '') {
    return LOCAL_ONLY_STORAGE_KEYS.has(key) || isUrlScopedSpeedKey(key);
  }

  function getUrlSpeedKey(href = location.href) {
    try {
      return 'url_' + btoa(encodeURIComponent(href)).slice(0, 40);
    } catch (_) {
      return null;
    }
  }

  function isInvalidatedError(err) {
    if (!err) return false;
    const msg = err.message || '';
    return msg.includes('Extension context invalidated') ||
           msg.includes('Could not establish connection') ||
           msg.includes('Extension context was invalidated');
  }

  function getSyncQuery(keys) {
    if (keys == null) return null;
    if (typeof keys === 'string') return isLocalOnlyStorageKey(keys) ? null : keys;
    if (Array.isArray(keys)) {
      const syncKeys = keys.filter(key => !isLocalOnlyStorageKey(key));
      return syncKeys.length ? syncKeys : null;
    }
    if (typeof keys === 'object') {
      const syncDefaults = {};
      Object.keys(keys).forEach(key => {
        if (!isLocalOnlyStorageKey(key)) syncDefaults[key] = keys[key];
      });
      return Object.keys(syncDefaults).length ? syncDefaults : null;
    }
    return null;
  }

  function safeStorageGet(keys, callback) {
    if (!contextActive) return;
    const syncQuery = getSyncQuery(keys);
    let localResult = {};
    let syncResult = {};
    let localReady = false;
    let syncReady = !syncQuery;

    const maybeFinish = () => {
      if (!contextActive || !localReady || !syncReady) return;
      callback({ ...(localResult || {}), ...(syncResult || {}) });
    };

    try {
      // Fetch local + sync in parallel so controller bootstrap doesn't wait on
      // one storage area before starting the other.
      chrome.storage.local.get(keys, result => {
        if (chrome.runtime.lastError) {
          if (isInvalidatedError(chrome.runtime.lastError)) deactivateContext();
          return;
        }
        localResult = result || {};
        localReady = true;
        maybeFinish();
      });

      if (!syncQuery) return;

      chrome.storage.sync.get(syncQuery, result => {
        if (chrome.runtime.lastError) {
          if (isInvalidatedError(chrome.runtime.lastError)) deactivateContext();
          syncReady = true;
          maybeFinish();
          return;
        }
        syncResult = result || {};
        syncReady = true;
        maybeFinish();
      });
    } catch (err) {
      if (isInvalidatedError(err)) deactivateContext();
    }
  }

  function safeStorageSet(obj) {
    if (!contextActive) return;
    try {
      chrome.storage.local.set(obj, () => {
        if (chrome.runtime.lastError && isInvalidatedError(chrome.runtime.lastError)) {
          deactivateContext();
        }
      });
    } catch (err) {
      if (isInvalidatedError(err)) deactivateContext();
    }
  }

  function reportSpeedDistSample(speed, seconds) {
    if (!contextActive) return;
    const duration = Number(seconds);
    if (!speed || !Number.isFinite(duration) || duration <= 0) return;
    try {
      chrome.runtime.sendMessage({ type: 'RECORD_SPEED_DIST', speed, seconds: duration });
    } catch (err) {
      if (isInvalidatedError(err)) deactivateContext();
    }
  }

  function updateBadge(speed) {
    if (!contextActive) return;
    try {
      chrome.runtime.sendMessage({ type: 'UPDATE_BADGE', speed });
    } catch (err) {
      if (isInvalidatedError(err)) deactivateContext();
    }
  }

  function clearBadge() {
    if (!contextActive) return;
    try {
      chrome.runtime.sendMessage({ type: 'CLEAR_BADGE' });
    } catch (err) {
      if (isInvalidatedError(err)) deactivateContext();
    }
  }

  function restoreMediaPlaybackRate(media) {
    if (!media) return;
    try {
      media.preservesPitch = true;
      media.mozPreservesPitch = true;
      media.playbackRate = 1.0;
    } catch (_) {}
  }

  function dispatchEarlyControl(detail) {
    const root = document.documentElement;
    if (!root) return;
    try {
      root.dispatchEvent(new CustomEvent(EARLY_CONTROL_EVENT, { detail }));
    } catch (_) {}
  }

  let _mutationObs    = null;
  let _keydownHandler = null;
  let _wheelHandler   = null;
  let _mediaDiscoveryHandler = null;
  let _pageGestureHandler = null;
  let _lastPageGestureAt = Number.NEGATIVE_INFINITY;
  const requestIdleTask = typeof window.requestIdleCallback === 'function'
    ? (cb, timeout = 150) => window.requestIdleCallback(cb, { timeout })
    : (cb, timeout = 150) => window.setTimeout(() => cb({
      didTimeout: true,
      timeRemaining: () => 0
    }), timeout);
  const cancelIdleTask = typeof window.cancelIdleCallback === 'function'
    ? handle => window.cancelIdleCallback(handle)
    : handle => clearTimeout(handle);
  let _overlaySyncHandle = 0;
  let _overlaySyncMode = '';
  let _overlaySyncForceRebuild = false;
  let _pendingMutationFlushHandle = 0;
  let _pendingMutationFlushMode = '';
  let _pendingMutationAdded = [];
  let _pendingMutationRemoved = [];
  let _pendingMutationNeedsShadowScan = false;

  const MEDIA_DISCOVERY_EVENTS = ['play', 'playing', 'loadedmetadata', 'loadeddata', 'canplay', 'ratechange'];
  const PAGE_GESTURE_EVENTS = ['pointerdown', 'touchstart', 'click', 'keydown', 'wheel'];
  const USER_GESTURE_WINDOW_MS = 1500;

  function deactivateContext() {
    if (!contextActive) return;
    contextActive = false;
    [...ctrlList].forEach(c => { try { c.destroy(); } catch (_) {} });
    ctrlList.length = 0;
    if (_keydownHandler) {
      try { document.removeEventListener('keydown', _keydownHandler, true); } catch (_) {}
      _keydownHandler = null;
    }
    if (_wheelHandler) {
      try { document.removeEventListener('wheel', _wheelHandler, { passive: false }); } catch (_) {}
      _wheelHandler = null;
    }
    if (_pageGestureHandler) {
      PAGE_GESTURE_EVENTS.forEach(type => {
        try { document.removeEventListener(type, _pageGestureHandler, true); } catch (_) {}
      });
      _pageGestureHandler = null;
    }
    try { document.getElementById('_vxCustomCSS')?.remove(); } catch (_) {}
    try { document.getElementById('_vxSiteControllerCSS')?.remove(); } catch (_) {}
    if (_mutationObs) {
      try { _mutationObs.disconnect(); } catch (_) {}
      _mutationObs = null;
    }
    cancelPendingMutationFlush();
    cancelOverlayOwnershipSync();
    if (_mediaDiscoveryHandler) {
      MEDIA_DISCOVERY_EVENTS.forEach(ev => {
        try { document.removeEventListener(ev, _mediaDiscoveryHandler, true); } catch (_) {}
      });
      _mediaDiscoveryHandler = null;
    }
    window._vxLoaded  = false;
    window._vxVersion = null;
    window._vxDestroy = null;
  }

  window._vxDestroy = deactivateContext;

  /* ── Default settings ────────────────────────────────────────────── */
  const SharedDefaults = Settings.DEFAULTS || {};
  const D = {
    ...SharedDefaults,
    siteRules: Array.isArray(SharedDefaults.siteRules) ? SharedDefaults.siteRules.map(rule => ({ ...rule })) : [],
    shortcutBindings: Array.isArray(SharedDefaults.shortcutBindings) ? SharedDefaults.shortcutBindings.map(binding => ({ ...binding })) : [],
    overlayOffsets: { ...(SharedDefaults.overlayOffsets || {}) },
    overlayRestoreCorners: { ...(SharedDefaults.overlayRestoreCorners || {}) },
    overlayHiddenStates: { ...(SharedDefaults.overlayHiddenStates || {}) },
    overlayControls: { ...(SharedDefaults.overlayControls || {}) },
    speedDist: { ...(SharedDefaults.speedDist || {}) },
    weekStart: 0,
    installTime: 0
  };

  function normalizeOverlayControls(controls = {}) {
    const merged = Object.fromEntries(
      Object.keys(D.overlayControls || {}).map(key => [key, controls?.[key] ?? D.overlayControls[key]])
    );
    if (!Object.values(merged).some(Boolean)) merged.speed = true;
    return merged;
  }

  function normalizeShortcutBinding(binding = {}) {
    if (!binding || typeof binding !== 'object' || !binding.action || !binding.code) return null;
    return {
      action: binding.action,
      code: binding.code,
      ctrlKey: !!binding.ctrlKey,
      altKey: !!binding.altKey,
      shiftKey: !!binding.shiftKey,
      metaKey: !!binding.metaKey
    };
  }

  function normalizeShortcutBindings(bindings = D.shortcutBindings) {
    return (Array.isArray(bindings) ? bindings : [])
      .map(normalizeShortcutBinding)
      .filter(Boolean);
  }

  function getLegacyShortcutCode(settings = {}, key = '') {
    if (Object.prototype.hasOwnProperty.call(settings, key)) {
      return typeof settings[key] === 'string' ? settings[key] : '';
    }
    return D[key] || '';
  }

  function legacyShortcutBindings(settings = {}) {
    const map = [
      ['increaseSpeed', getLegacyShortcutCode(settings, 'keyFaster')],
      ['decreaseSpeed', getLegacyShortcutCode(settings, 'keySlower')],
      ['resetSpeed', getLegacyShortcutCode(settings, 'keyReset')],
      ['skipForward', getLegacyShortcutCode(settings, 'keyForward')],
      ['skipBackward', getLegacyShortcutCode(settings, 'keyRewind')],
      ['toggleOverlay', getLegacyShortcutCode(settings, 'keyToggle')],
      ['volumeUp', getLegacyShortcutCode(settings, 'keyVolumeUp')],
      ['volumeDown', getLegacyShortcutCode(settings, 'keyVolumeDown')],
      ['togglePiP', getLegacyShortcutCode(settings, 'keyPiP')],
      ['preset1', getLegacyShortcutCode(settings, 'keyPreset1')],
      ['preset2', getLegacyShortcutCode(settings, 'keyPreset2')],
      ['preset3', getLegacyShortcutCode(settings, 'keyPreset3')],
      ['toggleLoop', getLegacyShortcutCode(settings, 'keyLoop')],
      ['setMark', getLegacyShortcutCode(settings, 'keyMark')],
      ['jumpToMark', getLegacyShortcutCode(settings, 'keyJump')]
    ];
    return map
      .filter(([, code]) => typeof code === 'string' && code)
      .map(([action, code]) => ({ action, code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false }));
  }

  function allShortcutBindings(settings = S) {
    return [...legacyShortcutBindings(settings), ...normalizeShortcutBindings(settings.shortcutBindings || [])];
  }

  function mergeSettings(current = D, patch = {}) {
    const next = Object.assign({}, current, patch);
    next.siteRules = SiteRules.normalizeSiteRules(patch.siteRules ?? current.siteRules ?? []);
    next.shortcutBindings = normalizeShortcutBindings(patch.shortcutBindings ?? current.shortcutBindings ?? []);
    next.overlayControls = normalizeOverlayControls(
      Object.assign({}, current.overlayControls || {}, patch.overlayControls || {})
    );
    next.logLevel = ['silent', 'error', 'warn', 'info', 'debug'].includes(next.logLevel) ? next.logLevel : 'warn';
    return next;
  }

  let S = mergeSettings(D);

  const ctrlMap  = new WeakMap();
  const ctrlList = [];
  const audioMap = new WeakMap();
  const mediaElementAudioGraphCache = new WeakMap();
  const pendingAttach = new WeakSet();
  const LOOP_MIN_SECONDS = 5;
  const LOOP_MAX_SECONDS = 300;

  function getVisibilitySnapshot(el) {
    if (!el) return null;
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return {
      connected: !!el.isConnected,
      display: style.display,
      visibility: style.visibility,
      opacity: style.opacity,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      top: Math.round(rect.top),
      left: Math.round(rect.left)
    };
  }

  const LOG_LEVEL_RANK = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };

  function shouldLog(level = 'warn') {
    return (LOG_LEVEL_RANK[S.logLevel] ?? LOG_LEVEL_RANK.warn) >= (LOG_LEVEL_RANK[level] ?? LOG_LEVEL_RANK.warn);
  }

  function logMessage(level, ...args) {
    if (!shouldLog(level)) return;
    const method = level === 'debug' ? 'info' : level;
    console[method]?.(...args);
  }

  const TYPING_CONTEXT_SELECTOR = [
    'input',
    'textarea',
    '[contenteditable]:not([contenteditable="false"])',
    '[role="textbox"]',
    '[role="searchbox"]',
    '[data-lexical-editor="true"]',
    '.ProseMirror',
    '.ql-editor',
    '.public-DraftEditor-content'
  ].join(',');

  function toDomElement(target) {
    if (!target || typeof target !== 'object') return null;
    if (target.nodeType === 1) return target;
    if (target.nodeType === 3) return target.parentElement || null;
    if (target.nodeType === 11 && target.host) return target.host;
    return null;
  }

  function getDeepActiveElement(root = document) {
    let active = root?.activeElement || null;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    return active;
  }

  function isTypingTarget(target) {
    const element = toDomElement(target);
    if (!element) return false;
    if (element.matches?.(TYPING_CONTEXT_SELECTOR)) return true;
    if (element.closest?.(TYPING_CONTEXT_SELECTOR)) return true;
    if (element.isContentEditable) return true;
    const contentEditable = element.getAttribute?.('contenteditable');
    return typeof contentEditable === 'string' && contentEditable.trim().toLowerCase() !== 'false';
  }

  function eventHasTypingContext(event) {
    const path = typeof event?.composedPath === 'function' ? event.composedPath() : [event?.target];
    if (path.some(node => isTypingTarget(node))) return true;
    if (isTypingTarget(getDeepActiveElement(document))) return true;
    return isTypingTarget(document.getSelection?.()?.anchorNode || null);
  }

  function eventComesFromVelocityX(event) {
    const path = typeof event?.composedPath === 'function' ? event.composedPath() : [event?.target];
    return path.some(node => {
      if (!node || typeof node !== 'object') return false;
      if (node.dataset?.vx === '1') return true;
      if (node.host?.dataset?.vx === '1') return true;
      return false;
    });
  }

  function notePageGesture(event) {
    if (!contextActive || eventComesFromVelocityX(event)) return;
    if (event?.isTrusted === false) return;
    if (event?.type === 'keydown' && eventHasTypingContext(event)) return;
    const stamp = Number(event?.timeStamp);
    _lastPageGestureAt = Number.isFinite(stamp) ? stamp : performance.now();
  }

  function hadRecentPageGesture(event) {
    const stamp = Number(event?.timeStamp);
    const now = Number.isFinite(stamp) ? stamp : performance.now();
    const delta = now - _lastPageGestureAt;
    return delta >= 0 && delta <= USER_GESTURE_WINDOW_MS;
  }

  function flushOverlayOwnershipSync() {
    if (!contextActive) return null;
    const forceRebuild = _overlaySyncForceRebuild;
    if (_overlaySyncHandle) {
      if (_overlaySyncMode === 'animation') cancelAnimationFrame(_overlaySyncHandle);
      else cancelIdleTask(_overlaySyncHandle);
    }
    _overlaySyncHandle = 0;
    _overlaySyncMode = '';
    _overlaySyncForceRebuild = false;
    return syncOverlayOwnership(forceRebuild);
  }

  function cancelOverlayOwnershipSync() {
    if (!_overlaySyncHandle) {
      _overlaySyncForceRebuild = false;
      _overlaySyncMode = '';
      return;
    }
    if (_overlaySyncMode === 'animation') cancelAnimationFrame(_overlaySyncHandle);
    else cancelIdleTask(_overlaySyncHandle);
    _overlaySyncHandle = 0;
    _overlaySyncMode = '';
    _overlaySyncForceRebuild = false;
  }

  function scheduleOverlayOwnershipSync(forceRebuild = false, mode = 'animation') {
    if (!contextActive) return;
    if (forceRebuild) _overlaySyncForceRebuild = true;

    if (mode === 'immediate') {
      flushOverlayOwnershipSync();
      return;
    }

    if (mode !== 'idle') {
      if (_overlaySyncMode === 'idle' && _overlaySyncHandle) {
        cancelIdleTask(_overlaySyncHandle);
        _overlaySyncHandle = 0;
      }
      if (_overlaySyncMode === 'animation' && _overlaySyncHandle) return;
      _overlaySyncMode = 'animation';
      _overlaySyncHandle = requestAnimationFrame(() => {
        flushOverlayOwnershipSync();
      });
      return;
    }

    if (_overlaySyncHandle) return;
    _overlaySyncMode = 'idle';
    _overlaySyncHandle = requestIdleTask(() => {
      flushOverlayOwnershipSync();
    }, 180);
  }

  function cancelPendingMutationFlush() {
    if (_pendingMutationFlushHandle) {
      if (_pendingMutationFlushMode === 'animation') cancelAnimationFrame(_pendingMutationFlushHandle);
      else cancelIdleTask(_pendingMutationFlushHandle);
      _pendingMutationFlushHandle = 0;
    }
    _pendingMutationFlushMode = '';
    _pendingMutationAdded = [];
    _pendingMutationRemoved = [];
    _pendingMutationNeedsShadowScan = false;
  }

  function preferredMutationFlushMode() {
    // Shorts swaps active videos while the page is still busy, so waiting for idle makes
    // the overlay feel late compared to the video becoming ready.
    return isYouTubeShortsPage() ? 'animation' : 'idle';
  }

  function schedulePendingMutationFlush(mode = preferredMutationFlushMode()) {
    if (_pendingMutationFlushHandle) {
      if (_pendingMutationFlushMode === mode) return;
      if (_pendingMutationFlushMode === 'idle' && mode === 'animation') {
        cancelIdleTask(_pendingMutationFlushHandle);
        _pendingMutationFlushHandle = 0;
      } else {
        return;
      }
    }

    _pendingMutationFlushMode = mode;
    if (mode === 'animation') {
      _pendingMutationFlushHandle = requestAnimationFrame(() => {
        flushPendingMutations();
      });
      return;
    }

    _pendingMutationFlushHandle = requestIdleTask(() => {
      flushPendingMutations();
    }, 140);
  }

  function queuePendingMutations(records = []) {
    if (!contextActive || !records.length) return;
    let hasElementWork = false;
    records.forEach(record => {
      record.removedNodes.forEach(node => {
        if (node?.nodeType !== 1) return;
        _pendingMutationRemoved.push(node);
        hasElementWork = true;
      });
      record.addedNodes.forEach(node => {
        if (node?.nodeType !== 1) return;
        _pendingMutationAdded.push(node);
        if (node.shadowRoot) _pendingMutationNeedsShadowScan = true;
        hasElementWork = true;
      });
    });
    if (!hasElementWork) return;
    schedulePendingMutationFlush(preferredMutationFlushMode());
  }

  function flushPendingMutations() {
    _pendingMutationFlushHandle = 0;
    _pendingMutationFlushMode = '';
    if (!contextActive) {
      cancelPendingMutationFlush();
      return;
    }

    const removedRoots = Array.from(new Set(_pendingMutationRemoved));
    const addedRoots = Array.from(new Set(_pendingMutationAdded));
    const needsShadowScan = _pendingMutationNeedsShadowScan;
    _pendingMutationRemoved = [];
    _pendingMutationAdded = [];
    _pendingMutationNeedsShadowScan = false;

    removedRoots.forEach(node => {
      if (node.tagName === 'VIDEO' || node.tagName === 'AUDIO') detach(node, { scheduleSync: false });
      node.querySelectorAll?.('video,audio').forEach(media => detach(media, { scheduleSync: false }));
    });

    addedRoots.forEach(node => {
      if (node.tagName === 'VIDEO' || node.tagName === 'AUDIO') attach(node, { scheduleSync: false });
      node.querySelectorAll?.('video,audio').forEach(media => attach(media, { scheduleSync: false }));
    });

    if (needsShadowScan) scanShadowDOM({ scheduleSync: false });
    scheduleOverlayOwnershipSync(false, isYouTubeShortsPage() ? 'immediate' : 'animation');

    if (_pendingMutationAdded.length || _pendingMutationRemoved.length || _pendingMutationNeedsShadowScan) {
      schedulePendingMutationFlush(preferredMutationFlushMode());
    }
  }

  function getMediaCaptureFactory(media) {
    if (!media) return null;
    if (typeof media.captureStream === 'function') return () => media.captureStream();
    if (typeof media.mozCaptureStream === 'function') return () => media.mozCaptureStream();
    return null;
  }

  function createSilenceAudioContext(AudioContextCtor = window.AudioContext || window.webkitAudioContext) {
    if (!AudioContextCtor) return null;
    try { return new AudioContextCtor({ latencyHint: 'playback' }); }
    catch (_) {
      try { return new AudioContextCtor(); }
      catch (_) { return null; }
    }
  }

  function getOrCreateMediaElementAudioGraph(media, AudioContextCtor = window.AudioContext || window.webkitAudioContext) {
    if (!media) return null;
    const cached = mediaElementAudioGraphCache.get(media);
    if (cached && cached.ctx?.state !== 'closed' && cached.source && cached.gain) return cached;
    if (cached) mediaElementAudioGraphCache.delete(media);

    const ctx = createSilenceAudioContext(AudioContextCtor);
    if (!ctx || typeof ctx.createMediaElementSource !== 'function') return null;

    try {
      const source = ctx.createMediaElementSource(media);
      const gain = ctx.createGain();
      gain.gain.value = 1;
      source.connect(gain);
      gain.connect(ctx.destination);

      const graph = { ctx, source, gain };
      mediaElementAudioGraphCache.set(media, graph);
      return graph;
    } catch (err) {
      try { ctx.close(); } catch (_) {}
      logMessage('debug', '[VelocityX] Silence skip could not create media-element audio graph.', err);
      return null;
    }
  }

  function getLiveAudioTrackCount(stream) {
    if (!stream || typeof stream.getAudioTracks !== 'function') return 0;
    return stream.getAudioTracks().filter(track => track?.readyState !== 'ended').length;
  }

  function isStaleSilenceEntry(entry) {
    if (!entry) return false;
    if (entry.ctx?.state === 'closed') return true;
    return !!entry.stream && getLiveAudioTrackCount(entry.stream) <= 0;
  }

  function startPendingSilenceSkip(event) {
    if (!contextActive || !S.enabled || !S.silenceSkip) return;
    if (event?.isTrusted === false) return;
    ctrlList.forEach(ctrl => {
      if (!ctrl) return;
      try {
        ctrl.initSilence({
          fromGesture: true,
          event,
          forceRebuild: isStaleSilenceEntry(audioMap.get(ctrl.video))
        });
      } catch (_) {}
    });
  }

  function getPopupMediaState(ctrl = activeCtrl()) {
    const media = ctrl?.video || null;
    return {
      title: document.title,
      hostname: location.hostname,
      href: location.href,
      hasMedia: !!media,
      mediaKind: media ? media.tagName.toLowerCase() : '',
      paused: media ? !!media.paused : true,
      muted: media ? !!media.muted : false,
      volume: media ? r2(media.volume || 0) : 0,
      currentTime: media ? r2(media.currentTime || 0) : 0,
      duration: media && Number.isFinite(media.duration) ? r2(media.duration) : null
    };
  }

  function setDebugToolsEnabled(enabled = S.debugMode) {
    if (!enabled) {
      try { delete window.vxDebug; } catch (_) { window.vxDebug = undefined; }
      try { delete window.vscDebug; } catch (_) { window.vscDebug = undefined; }
      return;
    }
    window.vxDebug = {
      checkMedia() {
        const media = Array.from(document.querySelectorAll('video, audio')).map((el, index) => ({
          index,
          tag: el.tagName,
          hasController: !!ctrlMap.get(el),
          playbackRate: el.playbackRate,
          paused: el.paused,
          readyState: el.readyState,
          src: el.currentSrc || el.src || '',
          visibility: getVisibilitySnapshot(el)
        }));
        console.table(media);
        return media;
      },
      checkControllers() {
        const controllers = ctrlList.map((ctrl, index) => ({
          index,
          tag: ctrl.video?.tagName,
          speed: ctrl.userSpeed,
          hasOverlay: !!ctrl.overlay,
          dismissed: !!ctrl._overlayDismissed,
          sessionHidden: !!ctrl._overlaySessionHidden,
          toggleHidden: !!ctrl._overlayToggleHidden,
          overlayVisibility: getVisibilitySnapshot(ctrl._pill?.() || ctrl.overlay)
        }));
        console.table(controllers);
        return controllers;
      },
      forceShow() {
        ctrlList.forEach(ctrl => {
          try {
            ctrl._setOverlayDismissed?.(false);
            ctrl._setOverlayToggleHidden?.(false);
            ctrl._pill?.().classList.remove('vh');
          } catch (_) {}
        });
        return ctrlList.length;
      },
      getSettings() {
        return JSON.parse(JSON.stringify(S));
      },
      getVisibility(target) {
        const el = typeof target === 'string' ? document.querySelector(target) : target;
        return getVisibilitySnapshot(el);
      }
    };
    window.vscDebug = window.vxDebug;
    logMessage('info', '[VelocityX] Debug mode enabled. Use vxDebug.checkMedia(), vxDebug.checkControllers(), vxDebug.forceShow(), vxDebug.getSettings().');
  }

  function collectMediaDebugSnapshot() {
    return Array.from(document.querySelectorAll('video, audio')).map((el, index) => ({
      index,
      tag: el.tagName,
      currentTime: Math.round((el.currentTime || 0) * 100) / 100,
      duration: Number.isFinite(el.duration) ? Math.round(el.duration * 100) / 100 : null,
      playbackRate: el.playbackRate,
      paused: el.paused,
      muted: el.muted,
      volume: Math.round((el.volume || 0) * 100) / 100,
      readyState: el.readyState,
      src: el.currentSrc || el.src || '',
      hasController: !!ctrlMap.get(el),
      visibility: getVisibilitySnapshot(el)
    }));
  }

  function collectControllerDebugSnapshot() {
    return ctrlList.map((ctrl, index) => ({
      index,
      tag: ctrl.video?.tagName,
      speed: ctrl.userSpeed,
      loopActive: !!ctrl.loopActive,
      loopLength: Math.round((ctrl._loopLen || 0) * 100) / 100,
      markTime: Math.round((ctrl.markTime || 0) * 100) / 100,
      abLoop: {
        a: Math.round((ctrl.abLoop?.a || 0) * 100) / 100,
        b: Math.round((ctrl.abLoop?.b || 0) * 100) / 100,
        enabled: !!ctrl.abLoop?.enabled
      },
      hasOverlay: !!ctrl.overlay,
      dismissed: !!ctrl._overlayDismissed,
      toggleHidden: !!ctrl._overlayToggleHidden,
      overlayVisibility: getVisibilitySnapshot(ctrl._pill?.() || ctrl.overlay)
    }));
  }

  function getDebugSnapshot() {
    const matchedRule = getSiteRuleMatch();
    return {
      href: location.href,
      hostname: location.hostname,
      title: document.title,
      readyState: document.readyState,
      activeRule: matchedRule ? { domain: matchedRule.domain, rule: matchedRule.rule } : null,
      media: collectMediaDebugSnapshot(),
      controllers: collectControllerDebugSnapshot()
    };
  }

  const MIN_SPEED = 0.07;
  const MAX_SPEED = 16;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const r2    = v => Math.round(v * 100) / 100;
  const settingStep = (value, fallback) => {
    const step = Number(value);
    return Number.isFinite(step) && step > 0 ? step : fallback;
  };
  const getSpeedStep = () => settingStep(S.step, D.step);
  const getWheelStep = () => settingStep(S.wheelStep, D.wheelStep);
  const getOverlayOpacity = () => clamp(settingStep(S.overlayOpacity, D.overlayOpacity), 0.15, 1);
  const getOverlayButtonSize = () => clamp(Math.round(settingStep(S.overlayButtonSize, D.overlayButtonSize)), 16, 34);
  const clampLoopSeconds = v => clamp(Math.round(v || D.loopSeconds || 10), LOOP_MIN_SECONDS, LOOP_MAX_SECONDS);
  const keyLabel = (code, fallback = '') => {
    if (ShortcutUtils.codeToLabel) return ShortcutUtils.codeToLabel(code, fallback);
    if (!code) return fallback;
    if (code.startsWith('Key')) return code.slice(3);
    if (code.startsWith('Digit')) return code.slice(5);
    const labels = {
      Space: 'Space',
      ArrowLeft: 'Left',
      ArrowRight: 'Right',
      ArrowUp: 'Up',
      ArrowDown: 'Down',
      Enter: 'Enter',
      Escape: 'Esc',
      Tab: 'Tab'
    };
    return labels[code] || fallback || code;
  };

  function actionShortcutText(action, empty = '') {
    return ShortcutUtils.formatActionShortcuts
      ? ShortcutUtils.formatActionShortcuts(S, action, { empty })
      : empty;
  }

  function actionLabel(label, action) {
    const shortcuts = actionShortcutText(action, '');
    return shortcuts ? `${label} (${shortcuts})` : label;
  }

  function setButtonTitle(button, title) {
    if (!button || !title) return;
    button.title = title;
    button.setAttribute('aria-label', title);
  }

  function getABLoopTitle(ctrl) {
    if (ctrl?.abActive && ctrl.abA !== null && ctrl.abB !== null) {
      const clearHint = actionShortcutText('clearABLoop', '');
      return `AB: ${ctrl.abA.toFixed(1)}s->${ctrl.abB.toFixed(1)}s - click${clearHint ? ` or ${clearHint}` : ''} to clear`;
    }
    if (ctrl?.abA !== null) {
      const endHint = actionShortcutText('setABEnd', '');
      return `A=${ctrl.abA.toFixed(1)}s - click${endHint ? ` or ${endHint}` : ''} to set B`;
    }
    const startHint = actionShortcutText('setABStart', 'Unassigned');
    const endHint = actionShortcutText('setABEnd', 'Unassigned');
    const clearHint = actionShortcutText('clearABLoop', 'Unassigned');
    return `AB Loop (${startHint} set A; ${endHint} set B; ${clearHint} clear)`;
  }
  function hostCandidates(hostname = location.hostname) {
    return SiteRules.hostCandidates(hostname);
  }

  function getSiteRuleMatch(hostname = location.hostname, href = location.href) {
    return SiteRules.getSiteRuleMatch(S.siteRules || {}, hostname, href);
  }

  function getDefaultSpeedValue(settings = S) {
    const configured = Number(settings.defaultSpeed);
    if (Number.isFinite(configured) && configured > 0) return configured;
    const legacy = Number(settings.speed);
    return Number.isFinite(legacy) && legacy > 0 ? legacy : 1.0;
  }

  function snapSpeed(current, delta) {
    const EPS = 0.0001;
    const next = r2(current + delta);
    if ((current < 1.0 - EPS && next >= 1.0 - EPS) || (current > 1.0 + EPS && next <= 1.0 + EPS)) return 1.0;
    return next;
  }

  function resolveContextSpeed(settings = S, { href = location.href, hostname = location.hostname } = {}) {
    const rule = SiteRules.getSiteRuleMatch(settings.siteRules || {}, hostname, href)?.rule;
    if (rule?.disabled) return null;
    if (typeof rule?.speed === 'number') return rule.speed;
    const defaultSpeed = getDefaultSpeedValue(settings);
    if (settings.rememberPerUrl) {
      const urlKey = getUrlSpeedKey(href);
      const rememberedSpeed = urlKey ? Number(settings[urlKey]) : NaN;
      if (Number.isFinite(rememberedSpeed) && rememberedSpeed > 0) return rememberedSpeed;
    }
    return settings.rememberSpeed ? (settings.speed ?? defaultSpeed) : defaultSpeed;
  }

  function contextSpeedDiffers(prevSpeed, nextSpeed) {
    if (prevSpeed == null || nextSpeed == null) return prevSpeed !== nextSpeed;
    return Math.abs(prevSpeed - nextSpeed) > 0.001;
  }

  function ctxSpeed() {
    return resolveContextSpeed(S);
  }

  const DETACHED_SPEED_HINT_TTL_MS = 2500;
  const detachedSpeedByMedia = new WeakMap();
  let recentDetachedSpeedHint = null;

  function normalizeSpeedHint(value) {
    const speed = Number(value);
    return Number.isFinite(speed) && speed > 0 ? clamp(r2(speed), MIN_SPEED, MAX_SPEED) : null;
  }

  function rememberDetachedSpeed(media, speed) {
    const normalized = normalizeSpeedHint(speed);
    if (!media || normalized == null) return;
    detachedSpeedByMedia.set(media, normalized);
    recentDetachedSpeedHint = {
      at: Date.now(),
      currentTime: Number(media.currentTime) || 0,
      speed: normalized,
      src: media.currentSrc || media.src || '',
      tagName: media.tagName || ''
    };
  }

  function takeDetachedSpeed(media) {
    if (!media) return null;
    const direct = detachedSpeedByMedia.get(media);
    if (direct != null) {
      detachedSpeedByMedia.delete(media);
      recentDetachedSpeedHint = null;
      return direct;
    }

    const hint = recentDetachedSpeedHint;
    if (!hint) return null;
    if ((Date.now() - hint.at) > DETACHED_SPEED_HINT_TTL_MS) {
      recentDetachedSpeedHint = null;
      return null;
    }
    if ((media.tagName || '') !== hint.tagName) return null;

    const mediaSrc = media.currentSrc || media.src || '';
    const currentTime = Number(media.currentTime) || 0;
    const sameSrc = !!(hint.src && mediaSrc && hint.src === mediaSrc);
    const hasMeaningfulTime = hint.currentTime > 0.5 || currentTime > 0.5;
    const closeTime = hasMeaningfulTime && Math.abs(currentTime - hint.currentTime) <= 3;
    if (!sameSrc && !closeTime) return null;

    recentDetachedSpeedHint = null;
    return hint.speed;
  }

  function resolveInitialControllerSpeed(media) {
    const inherited = takeDetachedSpeed(media);
    if (inherited != null) return inherited;
    const configured = ctxSpeed();
    return configured == null ? 1.0 : configured;
  }

  /* ── Media qualification ─────────────────────────────────────────── */
  const MIN_W = 40, MIN_H = 30;

  function isRenderableElement(el) {
    if (!el || !el.isConnected || el.hidden) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none') return false;
    if (style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    if (Number(style.opacity || 1) <= 0.05) return false;
    const rect = el.getBoundingClientRect();
    return rect.width >= 1 && rect.height >= 1;
  }

  function getVisibleViewportArea(rect) {
    if (!rect) return 0;
    const width = Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0));
    const height = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
    return width * height;
  }

  function isQualifiedVideo(el) {
    if (!el || !el.isConnected) return false;
    if (el.tagName !== 'VIDEO') return false;
    // Must have a source
    if (!el.src && !el.currentSrc && el.readyState < 1) return false;
    if (!isRenderableElement(el)) return false;
    const r = el.getBoundingClientRect();
    return r.width >= MIN_W && r.height >= MIN_H;
  }

  function isNativeFileMediaPage(media) {
    if (!media || location.protocol !== 'file:') return false;
    const body = document.body;
    if (!body) return false;

    const contentChildren = Array.from(body.children).filter(el => {
      const tag = el.tagName;
      return tag !== 'SCRIPT' && tag !== 'STYLE';
    });
    if (contentChildren.length !== 1 || contentChildren[0] !== media) return false;

    const rect = media.getBoundingClientRect();
    return rect.width >= window.innerWidth * 0.6 && rect.height >= window.innerHeight * 0.6;
  }

  /* ── Shadow DOM video scan ───────────────────────────────────────── */
  function findInShadow(root, selector) {
    const found = [];
    const roots = [root];
    const seen  = new Set();

    while (roots.length) {
      const current = roots.pop();
      if (!current || seen.has(current)) continue;
      seen.add(current);

      current.querySelectorAll?.(selector).forEach(el => found.push(el));
      current.querySelectorAll?.('*').forEach(el => {
        if (el.shadowRoot && !seen.has(el.shadowRoot)) roots.push(el.shadowRoot);
      });
    }

    return found;
  }

  /* ── Site-specific container selection ───────────────────────────── */
  function findVideoContainer(video) {
    let el = video.parentElement;
    if (!el) return video.parentElement;
    const videoArea = video.offsetWidth * video.offsetHeight;
    while (el.parentElement) {
      const p = el.parentElement;
      if (Math.abs(p.offsetWidth  - el.offsetWidth)  > 4) break;
      if (Math.abs(p.offsetHeight - el.offsetHeight) > 4) break;
      if (videoArea > 0 && (p.offsetWidth * p.offsetHeight) > videoArea * 4) break;
      // Safety: don't go above body or html
      if (p === document.body || p === document.documentElement) break;
      el = p;
    }
    return el;
  }

  function isYouTubeShortsPage() {
    return location.hostname === 'www.youtube.com' && location.pathname.startsWith('/shorts/');
  }

  const FACEBOOK_HOSTS = new Set(['facebook.com', 'www.facebook.com', 'm.facebook.com', 'web.facebook.com']);
  const INSTAGRAM_HOSTS = new Set(['instagram.com', 'www.instagram.com']);
  const TIKTOK_HOSTS = new Set(['www.tiktok.com', 'tiktok.com', 'm.tiktok.com']);
  const TWITTER_HOSTS = new Set(['twitter.com', 'x.com', 'mobile.twitter.com', 'mobile.x.com']);
  const REDDIT_HOSTS = new Set(['www.reddit.com', 'reddit.com', 'old.reddit.com']);
  const LINKEDIN_HOSTS = new Set(['www.linkedin.com', 'linkedin.com']);

  function isFacebookHost(hostname = location.hostname) {
    return FACEBOOK_HOSTS.has(hostname);
  }

  function isInstagramHost(hostname = location.hostname) {
    return INSTAGRAM_HOSTS.has(hostname);
  }

  function isTikTokHost(hostname = location.hostname) {
    return TIKTOK_HOSTS.has(hostname);
  }

  function isTwitterHost(hostname = location.hostname) {
    return TWITTER_HOSTS.has(hostname);
  }

  function isRedditHost(hostname = location.hostname) {
    return REDDIT_HOSTS.has(hostname);
  }

  function isInstagramReelsRoute() {
    if (!isInstagramHost()) return false;
    return location.pathname.startsWith('/reels/') ||
      location.pathname.startsWith('/reel/') ||
      location.pathname.startsWith('/stories/');
  }

  function isFacebookReelsRoute() {
    return isFacebookHost() && /^\/reel\//.test(location.pathname);
  }

  function rectContainsViewportCenter(rect) {
    if (!rect || rect.width <= 0 || rect.height <= 0) return false;
    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;
    return rect.left <= centerX &&
      rect.right >= centerX &&
      rect.top <= centerY &&
      rect.bottom >= centerY;
  }

  function isActiveShortsVideo(video) {
    if (!isYouTubeShortsPage() || !video) return true;

    // Check the ytd-reel-video-renderer ancestor
    const reel = video.closest('ytd-reel-video-renderer, ytd-reel-item-renderer');
    if (!reel) {
      // Not in a reel — check if video itself is in viewport
      return rectContainsViewportCenter(video.getBoundingClientRect());
    }

    // Check is-active attribute (most reliable)
    const activeAttr = reel.getAttribute('is-active');
    if (activeAttr !== null && activeAttr !== 'false') return true;

    // Fallback: check if reel container is substantially visible in viewport
    const rect = reel.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;

    // Consider active if more than 50% of the video is visible in the viewport
    const visibleTop    = Math.max(rect.top, 0);
    const visibleBottom = Math.min(rect.bottom, window.innerHeight);
    const visibleLeft   = Math.max(rect.left, 0);
    const visibleRight  = Math.min(rect.right, window.innerWidth);
    const visibleArea   = Math.max(0, visibleBottom - visibleTop) * Math.max(0, visibleRight - visibleLeft);
    const totalArea     = rect.width * rect.height;
    if (totalArea <= 0) return false;

    return (visibleArea / totalArea) > 0.5;
  }

  function isLikelyActiveShortsVideo(video, rect = video?.getBoundingClientRect?.()) {
    if (!video) return false;
    if (!isYouTubeShortsPage()) return true;
    if (!rect || rect.width <= 0 || rect.height <= 0) return false;
    if (isActiveShortsVideo(video)) return true;
    if (video.paused || video.ended) return false;
    const visibleArea = getVisibleViewportArea(rect);
    const totalArea = rect.width * rect.height;
    if (visibleArea <= 0 || totalArea <= 0) return false;
    return rectContainsViewportCenter(rect) && (visibleArea / totalArea) >= 0.25;
  }

  function isReasonableVideoContainer(candidate, video, { maxAreaMultiplier = 7, maxOffset = 28 } = {}) {
    if (!candidate || !video || !candidate.isConnected || candidate === video) return false;
    const videoRect = video.getBoundingClientRect();
    const containerRect = candidate.getBoundingClientRect();
    if (videoRect.width <= 0 || videoRect.height <= 0) return false;
    if (containerRect.width < videoRect.width - 4 || containerRect.height < videoRect.height - 4) return false;

    const videoArea = Math.max(1, videoRect.width * videoRect.height);
    const containerArea = Math.max(1, containerRect.width * containerRect.height);
    if (containerArea > videoArea * maxAreaMultiplier) return false;

    const allowedX = Math.max(maxOffset, videoRect.width * 0.08);
    const allowedY = Math.max(maxOffset, videoRect.height * 0.08);
    if (Math.abs(containerRect.left - videoRect.left) > allowedX) return false;
    if (Math.abs(containerRect.top - videoRect.top) > allowedY) return false;

    return true;
  }

  function pickSiteContainer(video, selectors = [], options = {}) {
    for (const selector of selectors) {
      const candidate = video.closest(selector);
      if (isReasonableVideoContainer(candidate, video, options)) return candidate;
    }
    return findVideoContainer(video);
  }

  function findFacebookContainer(video) {
    return pickSiteContainer(video, [
      '[data-video-id]',
      '[data-instancekey]',
      '[data-pagelet*="Video"]',
      '[data-pagelet*="Reels"]',
      '.video-container',
      '[role="article"]'
    ], { maxAreaMultiplier: 7, maxOffset: 32 });
  }

  function findInstagramContainer(video) {
    return pickSiteContainer(video, [
      'article',
      '[role="dialog"]'
    ], { maxAreaMultiplier: 4.5, maxOffset: 24 });
  }

  function isViewportManagedSocialVideo(video, rect = video?.getBoundingClientRect?.()) {
    if (!video || !rect || rect.width <= 0 || rect.height <= 0) return false;
    const tallVideo = rect.height >= window.innerHeight * 0.4;
    const portraitVideo = rect.height > rect.width * 1.2;
    if (isInstagramHost()) return isInstagramReelsRoute() || tallVideo;
    if (isFacebookHost()) return isFacebookReelsRoute() || tallVideo;
    if (isTikTokHost()) return true;
    if (isTwitterHost()) return tallVideo || portraitVideo;
    if (isRedditHost()) return tallVideo;
    return false;
  }

  function isPrimaryViewportVideo(video, rect = video?.getBoundingClientRect?.()) {
    if (!video || !rect || rect.width <= 0 || rect.height <= 0) return false;
    if (isYouTubeShortsPage()) return isLikelyActiveShortsVideo(video, rect);
    if (!isViewportManagedSocialVideo(video, rect)) return true;

    const visibleArea = getVisibleViewportArea(rect);
    const totalArea = rect.width * rect.height;
    if (visibleArea <= 0 || totalArea <= 0) return false;

    return rectContainsViewportCenter(rect) && (visibleArea / totalArea) >= 0.35;
  }

  const facebookSiteConfig = {
    container: v => findFacebookContainer(v),
    ignore: v => {
      const rect = v.getBoundingClientRect();
      const isLikelySeekPreview =
        rect.width > 0 &&
        rect.height > 0 &&
        rect.width < 140 &&
        rect.height < 140 &&
        !rectContainsViewportCenter(rect);
      return v.closest('[data-story-id]') !== null ||
        v.closest('.story-bucket-container') !== null ||
        v.getAttribute('data-video-width') === '0' ||
        isLikelySeekPreview;
    }
  };

  const instagramSiteConfig = {
    container: v => findInstagramContainer(v),
    ignore: () => false
  };

  const tiktokSiteConfig = {
    container: v => pickSiteContainer(v, [
      '[data-e2e="browse-video"]',
      '[class*="DivVideoContainer"]',
      '[class*="video-player"]',
      '[class*="VideoPlayer"]'
    ], { maxAreaMultiplier: 5, maxOffset: 32 }),
    ignore: () => false
  };

  const twitterSiteConfig = {
    container: v => pickSiteContainer(v, [
      '[data-testid="videoComponent"]',
      '[data-testid="videoPlayer"]',
      'article'
    ], { maxAreaMultiplier: 6, maxOffset: 32 }),
    ignore: v => v.getBoundingClientRect().width < 40
  };

  const redditSiteConfig = {
    container: v => pickSiteContainer(v, [
      '[data-testid="post-container"]',
      'shreddit-player',
      '.media-element',
      'article'
    ], { maxAreaMultiplier: 6, maxOffset: 32 }),
    ignore: v => v.getBoundingClientRect().width < 40
  };

  const linkedinSiteConfig = {
    container: v => pickSiteContainer(v, [
      '.feed-shared-update-v2',
      '.video-player-container',
      'article'
    ], { maxAreaMultiplier: 5, maxOffset: 28 }),
    ignore: v => v.getBoundingClientRect().width < 40
  };

  const SITE_CFG = {
    'www.youtube.com': {
      container: v => {
        if (isYouTubeShortsPage()) {
          return v.closest('.html5-video-player') ||
            v.closest('#shorts-player') ||
            v.closest('ytd-reel-video-renderer') ||
            v.closest('#movie_player') ||
            findVideoContainer(v);
        }
        return v.closest('.html5-video-player') || v.closest('#movie_player') || findVideoContainer(v);
      },
      ignore:    v => v.classList.contains('video-thumbnail') ||
        !!v.closest('.ytp-ad-player-overlay')
    },
    'www.netflix.com': {
      container: v => v.parentElement,
      ignore:    v => v.classList.contains('preview-video')
    },
    'facebook.com': facebookSiteConfig,
    'www.facebook.com': facebookSiteConfig,
    'm.facebook.com': facebookSiteConfig,
    'web.facebook.com': facebookSiteConfig,
    'instagram.com': instagramSiteConfig,
    'www.instagram.com': instagramSiteConfig,
    'www.primevideo.com': {
      container: v => findVideoContainer(v),
      ignore:    v => v.getBoundingClientRect().width < 200
    },
    'www.twitch.tv': {
      container: v => v.closest('.video-player__container') || v.closest('[data-a-target="video-player"]') || findVideoContainer(v),
      ignore:    v => v.getBoundingClientRect().width < 200
    },
    'player.twitch.tv': {
      container: v => v.closest('#root') || findVideoContainer(v),
      ignore:    () => false
    },
    'vimeo.com': {
      container: v => v.closest('.player_container') || v.closest('#player') || findVideoContainer(v),
      ignore:    v => v.getBoundingClientRect().width < 200
    },
    'www.dailymotion.com': {
      container: v => v.closest('.player-container') || findVideoContainer(v),
      ignore:    () => false
    },
    'www.disneyplus.com': {
      container: v => v.closest('[data-testid="media-player"]') || findVideoContainer(v),
      ignore:    v => v.getBoundingClientRect().width < 200
    },
    'www.coursera.org': {
      container: v => v.closest('.c-video-player') || findVideoContainer(v),
      ignore:    () => false
    },
    'www.udemy.com': {
      container: v => v.closest('.vjs-tech') || findVideoContainer(v),
      ignore:    () => false
    },
    'tv.apple.com': {
      container: v => v.parentNode,
      ignore:    () => false
    },
    'www.tiktok.com': tiktokSiteConfig,
    'tiktok.com': tiktokSiteConfig,
    'm.tiktok.com': tiktokSiteConfig,
    'x.com': twitterSiteConfig,
    'twitter.com': twitterSiteConfig,
    'mobile.twitter.com': twitterSiteConfig,
    'mobile.x.com': twitterSiteConfig,
    'www.reddit.com': redditSiteConfig,
    'reddit.com': redditSiteConfig,
    'old.reddit.com': redditSiteConfig,
    'www.linkedin.com': linkedinSiteConfig,
    'linkedin.com': linkedinSiteConfig,
    'www.bilibili.com': {
      container: v => v.closest('.bpx-player-video-area') || v.closest('.player-container') || findVideoContainer(v),
      ignore: v => v.getBoundingClientRect().width < 40
    },
    'rumble.com': {
      container: v => v.closest('.videoPlayer') || findVideoContainer(v),
      ignore:    () => false
    },
    'www.ted.com': {
      container: v => v.closest('.talk-media') || v.closest('[data-testid="MediaPlayer"]') || findVideoContainer(v),
      ignore:    () => false
    },
    'open.spotify.com': {
      container: v => findVideoContainer(v),
      ignore:    () => false
    }
  };

  function getSiteCfg() {
    return SITE_CFG[location.hostname] || { container: findVideoContainer, ignore: () => false };
  }

  function shouldIgnoreVideo(video) {
    if (!video || video.tagName !== 'VIDEO') return false;

    // GIF-like videos: looping, muted, no controls, and short duration -> decorative
    if (video.loop && video.muted && !video.controls) {
      const dur = video.duration;
      // Only ignore if duration is very short (< 30s) or unknown — real content is longer
      if (!Number.isFinite(dur) || dur < 30) return true;
    }

    // Background/ambient videos: looping + autoplay + muted + no controls + covers full viewport
    if (video.loop && video.autoplay && video.muted && !video.controls) {
      const r = video.getBoundingClientRect();
      const coversViewport = r.width >= window.innerWidth * 0.9 && r.height >= window.innerHeight * 0.9;
      if (coversViewport) return true;
    }

    return getSiteCfg().ignore(video);
  }

  function shouldUseImmediateOverlaySync(video) {
    if (!video || video.tagName !== 'VIDEO') return false;
    if (isYouTubeShortsPage()) return isLikelyActiveShortsVideo(video) || (!video.paused && !video.ended);
    if (isViewportManagedSocialVideo(video)) return isPrimaryViewportVideo(video) || (!video.paused && !video.ended);
    return false;
  }

  function shouldUseHoverPriority(video) {
    if (!video || video.tagName !== 'VIDEO') return true;
    // Vertical feed UIs can keep :hover sticky on the previous card until the pointer moves.
    return !(isYouTubeShortsPage() || isViewportManagedSocialVideo(video));
  }

  function preferredOverlaySyncMode(video, fallback = 'animation') {
    return shouldUseImmediateOverlaySync(video) ? 'immediate' : fallback;
  }

  /* ── Custom CSS injection ────────────────────────────────────────── */
  function injectCustomCSS(css) {
    // Legacy cleanup only. Overlay custom CSS now lives inside each shadow root
    // so user styles never leak into the page itself.
    if (!css) {
      document.getElementById('_vxCustomCSS')?.remove();
      return;
    }
    document.getElementById('_vxCustomCSS')?.remove();
  }

  function injectSiteControllerCSS(css) {
    const id = '_vxSiteControllerCSS';
    if (!css) {
      document.getElementById(id)?.remove();
      return;
    }
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('style');
      el.id = id;
      (document.head || document.documentElement).appendChild(el);
    }
    el.textContent = css;
  }

  function syncSiteControllerCSS() {
    injectSiteControllerCSS(getSiteRuleMatch()?.rule?.controllerCSS || '');
  }

  /* ── Shadow DOM CSS for the overlay pill ─────────────────────────── */
  const SHADOW_CSS = `
:host {
  display: block;
  position: absolute;
  inset: 0;
  z-index: var(--vx-host-z, 2147483647);
  pointer-events: none;
}
:host([data-vx-layer="passive"]) {
  --vx-host-z: 2;
}
:host([data-vx-layer="active"]) {
  --vx-host-z: 2147483647;
}
:host([data-vx-mode="native-file"]) {
  position: fixed;
  inset: auto;
  top: 0;
  left: 0;
  width: 0;
  height: 0;
  overflow: visible;
}
#pill {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: auto;
  user-select: none;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  display: flex;
  align-items: center;
  gap: 4px;
  overflow: hidden;
  background: rgba(9,11,16,.92);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border-radius: 30px;
  padding: 4px 10px 4px 6px;
  border: 1px solid rgba(226,232,240,.14);
  box-shadow: 0 6px 24px rgba(0,0,0,.48), inset 0 1px 0 rgba(255,255,255,.06);
  transition: opacity .22s ease, visibility .22s ease;
  opacity: var(--vx-pill-opacity, 1);
  visibility: visible;
}
#pill.vx-compact {
  gap: 4px;
  transition:
    opacity .22s ease,
    visibility .22s ease,
    padding .18s ease,
    gap .18s ease;
}
#pill.vx-compact:not(.vx-expanded) {
  gap: 0;
  padding: 4px 8px 4px 8px;
}
#pill.vh {
  opacity: 0 !important;
  visibility: hidden !important;
  pointer-events: none !important;
}
#pill.vx-manual {
  opacity: 0 !important;
  visibility: hidden !important;
  pointer-events: none !important;
}
#bar {
  position: absolute;
  bottom: 0; left: 0;
  height: 2px; width: 0%;
  background: linear-gradient(90deg,#6f8cff,#64d8c4);
  pointer-events: none;
  transition: width .1s linear;
}
.vx-compact-hide {
  transition:
    opacity .18s ease,
    width .18s ease,
    min-width .18s ease,
    margin .18s ease,
    padding .18s ease,
    transform .18s ease,
    border-width .18s ease;
}
#pill.vx-compact:not(.vx-expanded) .vx-compact-hide {
  opacity: 0 !important;
  width: 0 !important;
  min-width: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
  border-width: 0 !important;
  transform: scale(.86) !important;
  pointer-events: none !important;
}
#pill.vx-compact:not(.vx-expanded) #bar {
  opacity: 0 !important;
}
button {
  background: rgba(255,255,255,.1);
  border: none;
  color: #d2f7f0;
  width: var(--vx-button-size, 22px); height: var(--vx-button-size, 22px);
  border-radius: 50%;
  cursor: pointer;
  font-size: var(--vx-button-font-size, 14px);
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background .13s, transform .1s;
  padding: 0;
  flex-shrink: 0;
  position: relative;
  z-index: 1;
}
button:hover { background: rgba(111,140,255,.72); color: #fff; transform: scale(1.1); }
button:active { transform: scale(.9); }
.cls {
  background: rgba(239,68,68,.14) !important;
  color: #fca5a5 !important;
  font-size: calc(var(--vx-button-font-size, 14px) * 0.85) !important;
}
.cls:hover { background: rgba(239,68,68,.85) !important; }
.lp { background: rgba(111,140,255,.16) !important; color: #d2f7f0 !important; overflow: hidden; }
.lp.on { background: rgba(100,216,196,.76) !important; color: #071016 !important; box-shadow: 0 0 8px rgba(100,216,196,.22); }
.ab { background: rgba(100,216,196,.13) !important; color: #b6f4e8 !important; font-size: calc(var(--vx-button-font-size, 14px) * 0.64) !important; font-weight: 700; letter-spacing: 0; }
.ab.on { background: rgba(100,216,196,.66) !important; color: #071016 !important; }
.mk { background: rgba(251,191,36,.15) !important; color: #fcd34d !important; font-size: calc(var(--vx-button-font-size, 14px) * 0.72) !important; }
.mk.on { background: rgba(251,191,36,.72) !important; color: #fff !important; }
.jmp { background: rgba(111,140,255,.13) !important; color: #b8c8ff !important; font-size: calc(var(--vx-button-font-size, 14px) * 0.72) !important; }
.jmp.on { background: rgba(111,140,255,.68) !important; color: #fff !important; }
.pip { font-size: calc(var(--vx-button-font-size, 14px) * 0.72) !important; }
#spd {
  color: #eef3f8;
  font-size: var(--vx-speed-font-size, 12px);
  font-weight: 700;
  min-width: var(--vx-speed-min-width, 46px);
  text-align: center;
  letter-spacing: 0;
  cursor: default;
  position: relative;
  z-index: 1;
}
#pill.vx-compact:not(.vx-expanded) #spd {
  min-width: 0;
  padding: 0 2px;
  cursor: pointer;
}
#restore {
  position: absolute;
  top: 8px;
  left: 8px;
  width: var(--vx-restore-size, 26px);
  height: var(--vx-restore-size, 26px);
  border-radius: 999px;
  background: rgba(9,11,16,.92);
  border: 1px solid rgba(226,232,240,.14);
  color: #d2f7f0;
  font-size: var(--vx-restore-font-size, 11px);
  font-weight: 800;
  letter-spacing: 0;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  box-shadow: 0 4px 18px rgba(0,0,0,.42);
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transform: scale(.9);
  transition: opacity .18s ease, visibility .18s ease, transform .18s ease;
}
:host([data-vx-mode="native-file"]) #pill,
:host([data-vx-mode="native-file"]) #restore {
  position: fixed;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}
#restore.show {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
  transform: scale(1);
}
@keyframes vxf { 0%{background:rgba(111,140,255,.34)} 100%{background:rgba(9,11,16,.92)} }
.fl { animation: vxf .35s ease-out; }
`;

  /* ── Fightback constants ─────────────────────────────────────────── */
  const MAX_FIGHT  = 5;
  const BASE_CD_MS = 200;
  const MAX_CD_MS  = 2000;
  const FIGHT_WIN  = 3000;
  const SEEK_RATE_GUARD_MS = 900;

  /* ══════════════════════════════════════════════════════════════════
     VelocityController — one per media element
  ══════════════════════════════════════════════════════════════════ */
  class VelocityController {
    constructor(media, { initialSpeed = null } = {}) {
      this.video     = media;
      this.overlay   = null;  // shadow host <div data-vx>
      this.shadow    = null;  // ShadowRoot
      this.userSpeed = initialSpeed ?? (ctxSpeed() ?? 1.0);
      this.isAudio   = media.tagName === 'AUDIO';
      this._pageHref = location.href;

      this.silenceActive = false;
      this.silenceTimer  = null;
      this._silenceRaf   = null;

      this._settingRate = false;
      this._srTimer     = null;

      this._fadeT = null;
      this._statusT = null;
      this._overlayMouseH = null;
      this._overlayPlayH  = null;
      this._overlaySeekH  = null;
      this._overlayContainerHoverH = null;
      this._overlayContainerFocusH = null;
      this._overlayCompactTimer = null;
      this._seekDebounceT = null;
      this._lastSeekInteractionAt = 0;
      this._overlayCompactExpanded = true;
      this._overlayLayerResetTimer = null;
      this._overlayPlaybackRevealUntil = 0;
      this._overlayLastAutoRevealAt = 0;
      this._overlayLastPlaybackSignalAt = this._isPlaybackActive() ? performance.now() : 0;

      this._trackT    = null;
      this._lastTrack = Date.now();

      this.loopActive = false;
      this._loopRaf   = null;
      this._loopStart = 0;
      this._loopEnd   = 0;
      this._loopLen   = 0;

      this.abActive = false;
      this._abRaf   = null;
      this.abA      = null;
      this.abB      = null;

      this.mark               = null;
      this.positionBeforeJump = null;

      this._intObs = null;

      this._rateH = null;
      this._playH = null;
      this._hoverH = null;
      this._seekMarkH = null;

      // Advanced fightback state
      this._fightCount = 0;
      this._fightTimer = null;
      this._coolDown   = false;
      this._cdTimer    = null;
      this._overlayDismissed = false;
      this._overlayResizeObs = null;
      this._overlayDragging = false;
      this._overlaySessionHidden = false;
      this._overlayToggleHidden = false;
      this._overlayLayoutRaf = 0;
      this._overlayLayoutTimer = null;
      this._overlayUrlKey = this._overlayRuntimeOffsetKey();
      this._overlayContainer = null;
      this._overlayRenderMode = 'default';

      this._init();
    }

    _init() {
      if (S.customCSS) injectCustomCSS(S.customCSS);
      if (!this.isAudio && this._isPlaybackActive()) this._queuePlaybackReveal(2400);
      if (!this.isAudio) {
        try {
          this._ensureOverlay(true);
        } catch (err) {
          logMessage('warn', '[VelocityX] Overlay build failed during init.', err);
          this._destroyOverlay();
        }
      }
      this._attachListeners();
      this.applySpeed(this.userSpeed, false);
      this._startTracking();
      if (!this.isAudio) this._observeVideo();
    }

    /* ── Build Shadow DOM overlay ────────────────────────────────── */
    _getOverlayContainer() {
      if (this.isAudio || !this.video?.isConnected) return null;
      const container = getSiteCfg().container(this.video);
      return container && container.isConnected ? container : null;
    }

    _isNativeFileOverlay() {
      return this._overlayRenderMode === 'native-file';
    }

    _getOverlayLayoutRect() {
      if (this._isNativeFileOverlay()) {
        return {
          left: 0,
          top: 0,
          width: window.innerWidth,
          height: window.innerHeight
        };
      }
      return this.overlay?.getBoundingClientRect() || {
        left: 0,
        top: 0,
        width: 0,
        height: 0
      };
    }

    _ensureOverlay(forceRebuild = false) {
      if (this.isAudio || !S.showOverlay) {
        if (this.overlay) this._destroyOverlay(true);
        return false;
      }
      if (this.video.tagName === 'VIDEO' && (!isQualifiedVideo(this.video) || shouldIgnoreVideo(this.video))) {
        if (this.overlay) this._destroyOverlay(true);
        return false;
      }
      const container = this._getOverlayContainer();
      if (!container) {
        if (this.overlay) this._destroyOverlay(true);
        return false;
      }
      const preferred = preferredOverlayController();
      if (preferred && preferred !== this) {
        if (this.overlay) this._destroyOverlay(true);
        return false;
      }
      const hadOverlay = !!(this.overlay && this.overlay.isConnected);
      const needsRebuild =
        forceRebuild ||
        !this.overlay ||
        !this.overlay.isConnected ||
        this.overlay.parentElement !== container ||
        this.overlay._vxController !== this;
      if (!needsRebuild) {
        if (!this._consumePlaybackReveal()) this._maybeRevealVisibleViewportVideo();
        return true;
      }
      this._buildOverlay({ container, preserveState: true });
      if (this.overlay) {
        const revealed = (!hadOverlay && this._isPlaybackActive())
          ? this._queuePlaybackReveal(2400)
          : this._consumePlaybackReveal();
        if (!revealed) this._maybeRevealVisibleViewportVideo();
      }
      return !!this.overlay;
    }

    _applyShadowCustomCSS() {
      if (!this.shadow) return;
      let el = this.shadow.querySelector('#vx-user-css');
      if (!el) {
        el = document.createElement('style');
        el.id = 'vx-user-css';
        this.shadow.appendChild(el);
      }
      el.textContent = S.customCSS || '';
    }

    _applyOverlayPresentation(pill = this._pill(), restore = this.shadow?.querySelector('#restore')) {
      const buttonSize = getOverlayButtonSize();
      const buttonFontSize = Math.max(11, Math.round(buttonSize * 0.64));
      const speedFontSize = Math.max(12, Math.round(buttonSize * 0.55));
      const speedMinWidth = Math.max(46, Math.round(buttonSize * 2.1));
      const restoreSize = Math.max(24, Math.round(buttonSize * 1.18));
      const restoreFontSize = Math.max(11, Math.round(buttonSize * 0.5));

      if (pill) {
        pill.style.setProperty('--vx-pill-opacity', getOverlayOpacity().toFixed(2));
        pill.style.setProperty('--vx-button-size', `${buttonSize}px`);
        pill.style.setProperty('--vx-button-font-size', `${buttonFontSize}px`);
        pill.style.setProperty('--vx-speed-font-size', `${speedFontSize}px`);
        pill.style.setProperty('--vx-speed-min-width', `${speedMinWidth}px`);
      }
      if (restore) {
        restore.style.setProperty('--vx-restore-size', `${restoreSize}px`);
        restore.style.setProperty('--vx-restore-font-size', `${restoreFontSize}px`);
      }
    }

    _buildOverlay(options = {}) {
      if (!S.showOverlay || this.isAudio) return;
      this._destroyOverlay(!!options.preserveState);

      const container = options.container || this._getOverlayContainer();
      if (!container) return;
      const renderMode = isNativeFileMediaPage(this.video) ? 'native-file' : 'default';

      this._overlayContainer = container;
      this._overlayRenderMode = renderMode;
      cleanupOrphanOverlays();

      container.querySelectorAll('[data-vx="1"]').forEach(existingHost => {
        const owner = existingHost._vxController;
        if (owner && owner !== this) {
          owner._destroyOverlay(true);
        } else if (existingHost !== this.overlay) {
          existingHost.remove();
        }
      });

      // Ensure container is positioned so absolute children work
      if (renderMode !== 'native-file' && window.getComputedStyle(container).position === 'static') {
        container.style.position = 'relative';
      }

      // Shadow host — covers entire container, pointer-events:none so page clicks pass through
      const host = document.createElement('div');
      host.setAttribute('data-vx', '1');
      host.setAttribute('data-vx-mode', renderMode);
      host._vxController = this;

      // Attach Shadow DOM (style isolation — page CSS can't break our overlay)
      const shadow = host.attachShadow({ mode: 'open' });
      this.shadow = shadow;

      const styleEl = document.createElement('style');
      styleEl.textContent = SHADOW_CSS;
      shadow.appendChild(styleEl);

      // Build pill
      const controls = S.overlayControls || D.overlayControls;
      const loopSec = clampLoopSeconds(S.loopSeconds);
      const pill = document.createElement('div');
      const restore = document.createElement('button');
      pill.id = 'pill';
      pill.className = '_vxPill';
      restore.id = 'restore';
      restore.className = '_vxRestore _vxBtn';
      restore.type = 'button';
      restore.title = 'Restore VelocityX overlay';
      restore.textContent = 'VX';

      this._applyPositionPreset(pill, S.overlayPosition);

      const appendOverlayNode = (tag, { id = '', className = '', title = '', ariaLabel = '', text = '' } = {}) => {
        const el = document.createElement(tag);
        if (id) el.id = id;
        if (className) el.className = className;
        if (tag === 'button') el.type = 'button';
        if (title) el.title = title;
        if (ariaLabel) el.setAttribute('aria-label', ariaLabel);
        if (text) el.textContent = text;
        pill.appendChild(el);
        return el;
      };

      appendOverlayNode('div', { id: 'bar' });
      if (controls.decrease) appendOverlayNode('button', { className: 'minus _vxBtn', title: actionLabel('Slower', 'decreaseSpeed'), text: '\u2212' });
      if (controls.speed) appendOverlayNode('span', { id: 'spd', className: '_vxSpd', text: `${this.userSpeed.toFixed(2)}\u00D7` });
      if (controls.increase) appendOverlayNode('button', { className: 'plus _vxBtn', title: actionLabel('Faster', 'increaseSpeed'), text: '+' });
      if (controls.loop) {
        const loopLabel = actionLabel(`Loop last ${loopSec}s from here`, 'toggleLoop');
        appendOverlayNode('button', { className: 'lp _vxBtn', title: loopLabel, ariaLabel: loopLabel, text: '\u21BA' });
      }
      if (controls.ab) appendOverlayNode('button', { className: 'ab _vxBtn', title: getABLoopTitle(this), text: 'AB' });
      if (controls.mark) appendOverlayNode('button', { className: 'mk _vxBtn', title: actionLabel('Mark position', 'setMark'), text: '\u{1F4CC}' });
      if (controls.jump) appendOverlayNode('button', { className: 'jmp _vxBtn', title: actionLabel('Jump to marker', 'jumpToMark'), text: '\u21AA' });
      if (controls.pip) appendOverlayNode('button', { className: 'pip _vxBtn', title: actionLabel('Picture-in-Picture', 'togglePiP'), text: '\u2750' });
      if (controls.volDown) appendOverlayNode('button', { className: 'vd _vxBtn', title: actionLabel('Volume Down', 'volumeDown'), text: '\u{1F509}' });
      if (controls.volUp) appendOverlayNode('button', { className: 'vu _vxBtn', title: actionLabel('Volume Up', 'volumeUp'), text: '\u{1F50A}' });
      if (controls.close) appendOverlayNode('button', { className: 'cls _vxBtn', title: 'Hide overlay', text: '\u00D7' });
      pill.querySelectorAll('#bar, button').forEach(el => el.classList.add('vx-compact-hide'));

      shadow.appendChild(pill);
      shadow.appendChild(restore);
      this._applyOverlayPresentation(pill, restore);
      this._applyShadowCustomCSS();
      this._syncPrimaryButtonTitles();
      this._syncABButton();
      this._syncMarkButtons();
      this._syncVolumeButtonTitles();
      this._syncLoopButton();

      // Button click handlers
      pill.querySelector('.minus')?.addEventListener('click', e => { e.stopPropagation(); this.adjust(-getSpeedStep()); });
      pill.querySelector('.plus')?.addEventListener('click',  e => { e.stopPropagation(); this.adjust(getSpeedStep()); });
      pill.querySelector('.lp')?.addEventListener('click',    e => { e.stopPropagation(); this.toggleLoop();              });
      pill.querySelector('.ab')?.addEventListener('click',    e => { e.stopPropagation(); this._cycleAB();                });
      pill.querySelector('.mk')?.addEventListener('click',    e => { e.stopPropagation(); this.setMark();                 });
      pill.querySelector('.jmp')?.addEventListener('click',   e => { e.stopPropagation(); this.jumpToMark();              });
      pill.querySelector('.pip')?.addEventListener('click',   e => { e.stopPropagation(); this._togglePiP();              });
      pill.querySelector('.vu')?.addEventListener('click',    e => {
        e.stopPropagation();
        this._adjustVolume(0.1);
      });
      pill.querySelector('.vd')?.addEventListener('click',    e => {
        e.stopPropagation();
        this._adjustVolume(-0.1);
      });
      pill.querySelector('.cls')?.addEventListener('click',   e => {
        e.stopPropagation();
        if (S.overlayRestoreBadge === false) {
          this._saveOverlayDismissedState(false);
          if (typeof this._setOverlaySessionHidden === 'function') this._setOverlaySessionHidden(true);
          return;
        }
        if (typeof this._saveRestoreCorner === 'function' && typeof this._resolveRestoreCorner === 'function') {
          this._saveRestoreCorner(this._resolveRestoreCorner(false));
        }
        this._setOverlayDismissed(true);
      });
      restore.addEventListener('click', e => {
        e.stopPropagation();
        if (this._overlayDismissed) {
          this._setOverlayDismissed(false);
        } else if (this._overlayToggleHidden) {
          this._setOverlayToggleHidden(false);
        }
        this._flash();
      });

      // Keep overlay events local without blocking button handlers.
      const shield = e => { e.stopPropagation(); };
      ['click','mousedown','mouseup','pointerdown','pointerup','touchstart','touchend','contextmenu'].forEach(ev => {
        pill.addEventListener(ev, shield);
        restore.addEventListener(ev, shield);
      });

      this._makeDraggable(pill);
      this._syncRestorePosition();
      this._overlayDismissed = false;

      // Show/hide logic
      const show = (dur = 2800) => {
        this._showOverlayTemporarily(dur, { expand: false });
      };

      this._overlayMouseH = (e) => {
        // Don't show overlay when mouse button is pressed (user is scrubbing/dragging native controls)
        if (e && e.buttons > 0) return;
        show();
      };
      this._overlayPlayH  = () => show();
      this._overlaySeekH  = () => {
        // Debounce rapid seeks (scrubbing) to avoid flickering overlay
        clearTimeout(this._seekDebounceT);
        this._seekDebounceT = setTimeout(() => show(1800), 400);
      };
      this._overlayContainerHoverH = (e) => {
        // Don't show overlay when mouse button is pressed (user is scrubbing/dragging)
        if (e && e.type !== 'touchstart' && e.buttons > 0) return;
        show();
      };
      this._overlayContainerFocusH = () => show(1800);
      this.video.addEventListener('mouseover', this._overlayMouseH);
      this.video.addEventListener('pointerenter', this._overlayMouseH);
      this.video.addEventListener('play',      this._overlayPlayH);
      this.video.addEventListener('playing',   this._overlayPlayH);
      this.video.addEventListener('seeked',    this._overlaySeekH);
      container.addEventListener('pointerover', this._overlayContainerHoverH, true);
      container.addEventListener('pointerdown', this._overlayContainerHoverH, true);
      container.addEventListener('touchstart',  this._overlayContainerHoverH, { passive: true, capture: true });
      container.addEventListener('focusin',     this._overlayContainerFocusH, true);
      pill.addEventListener('mouseenter', () => {
        if (this._isOverlayLockedHidden()) return;
        pill.classList.remove('vh');
        clearTimeout(this._fadeT);
        this._setOverlayInteractionLayer(true);
        this._setCompactOverlayExpanded(true);
      });
      pill.addEventListener('mouseleave', () => {
        show();
        this._setOverlayInteractionLayer(false, 180);
        this._setCompactOverlayExpanded(false, 120);
      });
      pill.addEventListener('pointerdown', () => {
        this._setOverlayInteractionLayer(true);
        this._setCompactOverlayExpanded(true);
      });
      pill.addEventListener('focusin', () => this._setOverlayInteractionLayer(true), true);
      restore.addEventListener('mouseenter', () => this._setOverlayInteractionLayer(true));
      restore.addEventListener('mouseleave', () => this._setOverlayInteractionLayer(false, 180));
      restore.addEventListener('pointerdown', () => this._setOverlayInteractionLayer(true));

      // Overlay starts faded until playback/hover reveals it.
      pill.classList.add('vh');

      container.appendChild(host);
      this.overlay = host;
      this._syncOverlayLayer(false);
      this._overlayCompactExpanded = !this._isCompactOverlayContext();
      this._syncCompactOverlayState({ expanded: this._overlayCompactExpanded, immediate: true });
      if (typeof this._observeOverlayLayout === 'function') this._observeOverlayLayout(container);
      this._queueOverlayLayoutSync();
      this._queueOverlayLayoutSync(false, 140);
      if (this._overlaySessionHidden) {
        if (typeof this._setOverlaySessionHidden === 'function') this._setOverlaySessionHidden(true);
        return;
      }
      const savedHidden = S.overlayRestoreBadge === false ? false : this._readSavedOverlayHidden();
      this._setOverlayDismissed(savedHidden, false);
    }

    _applyPositionPreset(pill, pos) {
      this._resetOverlayAnchorStyles(pill);
      const edgeInset = this._overlayEdgeInset();
      const topInset = this._overlayTopInset();

      const presets = {
        'top-left':      () => { pill.style.top = `${topInset}px`;     pill.style.left = `${edgeInset}px`; },
        'top-right':     () => { pill.style.top = `${topInset}px`;     pill.style.right = `${edgeInset}px`; },
        'top-center':    () => { pill.style.top = `${topInset}px`;     pill.style.left = '50%'; pill.style.transform = 'translateX(-50%)'; },
        'bottom-left':   () => { pill.style.bottom = `${edgeInset}px`; pill.style.left = `${edgeInset}px`; },
        'bottom-right':  () => { pill.style.bottom = `${edgeInset}px`; pill.style.right = `${edgeInset}px`; },
        'bottom-center': () => { pill.style.bottom = `${edgeInset}px`; pill.style.left = '50%'; pill.style.transform = 'translateX(-50%)'; },
      };
      (presets[pos] || presets['top-left'])();
    }

    _overlayEdgeInset() {
      return 8;
    }

    _overlayTopInset() {
      return this._usesPassiveSocialLayer() ? 46 : this._overlayEdgeInset();
    }

    _usesPassiveSocialLayer() {
      return !this.isAudio &&
        (isFacebookHost() || isInstagramHost()) &&
        isViewportManagedSocialVideo(this.video);
    }

    _isCompactOverlayContext() {
      return false;
    }

    _syncCompactOverlayState({ expanded = this._overlayCompactExpanded, immediate = false } = {}) {
      const pill = this._pill();
      if (!pill) return;
      const compact = this._isCompactOverlayContext();
      this._overlayCompactExpanded = compact ? !!expanded : true;
      pill.classList.toggle('vx-compact', compact);
      pill.classList.toggle('vx-expanded', !compact || this._overlayCompactExpanded);
      if (!immediate) this._queueCompactOverlayBoundsSync();
    }

    _queueCompactOverlayBoundsSync() {
      requestAnimationFrame(() => {
        const pill = this._pill();
        if (!pill || !this.overlay || this._overlayDragging) return;
        const hasPixelOffset = value => typeof value === 'string' && /^-?\d+(?:\.\d+)?px$/.test(value.trim());
        const hasExplicitPosition =
          hasPixelOffset(pill.style.left) &&
          hasPixelOffset(pill.style.top);
        if (hasExplicitPosition) {
          const pos = this._normalizeOverlayOffset({
            x: parseFloat(pill.style.left) || 0,
            y: parseFloat(pill.style.top) || 0
          }, pill);
          pill.style.left = `${pos.x}px`;
          pill.style.top = `${pos.y}px`;
        }
        this._syncRestorePosition(this._overlayDismissed ? 'dock' : 'mirror');
      });
    }

    _syncOverlayLayer(active = false) {
      if (!this.overlay) return;
      const passive = this._usesPassiveSocialLayer() && !active;
      this.overlay.setAttribute('data-vx-layer', passive ? 'passive' : 'active');
    }

    _setOverlayInteractionLayer(active, delay = 0) {
      clearTimeout(this._overlayLayerResetTimer);
      if (!this._usesPassiveSocialLayer()) {
        this._syncOverlayLayer(true);
        return;
      }
      if (!active && delay > 0) {
        this._overlayLayerResetTimer = setTimeout(() => {
          this._overlayLayerResetTimer = null;
          this._syncOverlayLayer(false);
        }, delay);
        return;
      }
      this._syncOverlayLayer(active);
    }

    _setCompactOverlayExpanded(expanded, delay = 0) {
      clearTimeout(this._overlayCompactTimer);
      if (!this._isCompactOverlayContext()) {
        this._overlayCompactExpanded = true;
        this._syncCompactOverlayState({ expanded: true });
        return;
      }
      if (!expanded && delay > 0) {
        this._overlayCompactTimer = setTimeout(() => {
          this._overlayCompactTimer = null;
          this._overlayCompactExpanded = false;
          this._syncCompactOverlayState({ expanded: false });
        }, delay);
        return;
      }
      this._overlayCompactExpanded = !!expanded;
      this._syncCompactOverlayState({ expanded: this._overlayCompactExpanded });
    }

    _resetOverlayAnchorStyles(el) {
      if (!el) return;
      // Use explicit auto/none values so preset changes do not fall back to base CSS anchors.
      el.style.top = 'auto';
      el.style.right = 'auto';
      el.style.bottom = 'auto';
      el.style.left = 'auto';
      el.style.transform = 'none';
      el.style.margin = '';
    }

    /* ── Pointer Capture drag (works reliably on all sites) ──────── */
    _overlayOffsetKeys() {
      const hostKey = location.hostname || location.protocol.replace(':', '') || 'local';
      const hostnameKey = hostKey;
      const pathKey = `${hostKey}${location.pathname}|${this.isAudio ? 'audio' : 'video'}`;
      return [hostnameKey, pathKey];
    }

    _overlayRuntimeOffsetKey() {
      return `${location.origin}${location.pathname}${location.search}|${this.isAudio ? 'audio' : 'video'}`;
    }

    _readSavedOverlayOffset() {
      return (S.overlayOffsets || {})[this._overlayRuntimeOffsetKey()] || null;
    }

    _readSavedOverlayHidden() {
      const hiddenStates = S.overlayHiddenStates || {};
      const hostKey = location.hostname || location.protocol.replace(':', '') || 'local';
      const pathKey = `${hostKey}${location.pathname}|${this.isAudio ? 'audio' : 'video'}`;
      if (typeof hiddenStates[pathKey] === 'boolean') return hiddenStates[pathKey];
      return false;
    }

    _readSavedRestoreCorner() {
      const corners = S.overlayRestoreCorners || {};
      for (const key of this._overlayOffsetKeys()) {
        if (corners[key]) return corners[key];
      }
      return '';
    }

    _saveOverlayDismissedState(hidden) {
      const states = { ...(S.overlayHiddenStates || {}) };
      const hostKey = location.hostname || location.protocol.replace(':', '') || 'local';
      const pathKey = `${hostKey}${location.pathname}|${this.isAudio ? 'audio' : 'video'}`;
      if (hidden) states[pathKey] = true;
      else delete states[pathKey];
      S.overlayHiddenStates = states;
      safeStorageSet({ overlayHiddenStates: states });
    }

    _saveRestoreCorner(corner) {
      if (!corner) return;
      const corners = { ...(S.overlayRestoreCorners || {}) };
      const [primaryKey] = this._overlayOffsetKeys();
      corners[primaryKey] = corner;
      S.overlayRestoreCorners = corners;
      safeStorageSet({ overlayRestoreCorners: corners });
    }

    _getOverlayBounds(pill = this._pill()) {
      if (!pill || !this.overlay) return { maxX: 0, maxY: 0 };
      const hostRect = this._getOverlayLayoutRect();
      const pillRect = pill.getBoundingClientRect();
      return {
        maxX: Math.max(0, hostRect.width - pillRect.width),
        maxY: Math.max(0, hostRect.height - pillRect.height)
      };
    }

    _normalizeOverlayOffset(pos, pill = this._pill()) {
      const { maxX, maxY } = this._getOverlayBounds(pill);
      const rawX = Number.isFinite(pos?.rx) && maxX > 0 ? pos.rx * maxX : (Number(pos?.x) || 0);
      const rawY = Number.isFinite(pos?.ry) && maxY > 0 ? pos.ry * maxY : (Number(pos?.y) || 0);
      const x = clamp(rawX, 0, maxX);
      const y = clamp(rawY, 0, maxY);
      return {
        x,
        y,
        rx: maxX > 0 ? r2(x / maxX) : 0,
        ry: maxY > 0 ? r2(y / maxY) : 0
      };
    }

    _restoreOverlayPosition(forcePreset = false) {
      const pill = this._pill();
      if (!pill) return;
      const saved = forcePreset ? null : this._readSavedOverlayOffset();
      if (!saved) {
        this._applyPositionPreset(pill, S.overlayPosition);
        this._syncRestorePosition();
        return;
      }
      this._resetOverlayAnchorStyles(pill);
      const pos = this._normalizeOverlayOffset(saved, pill);
      pill.style.left = `${pos.x}px`;
      pill.style.top  = `${pos.y}px`;
      this._syncRestorePosition();
    }

    _saveOverlayPosition() {
      const pill = this._pill();
      if (!pill) return;
      const pos = this._normalizeOverlayOffset({
        x: parseFloat(pill.style.left) || 0,
        y: parseFloat(pill.style.top) || 0
      }, pill);
      pill.style.left = `${pos.x}px`;
      pill.style.top  = `${pos.y}px`;
      const offsets = { ...(S.overlayOffsets || {}) };
      const runtimeKey = this._overlayRuntimeOffsetKey();
      this._overlayUrlKey = runtimeKey;
      offsets[runtimeKey] = pos;
      S.overlayOffsets = offsets;
      if (typeof this._saveRestoreCorner === 'function' && typeof this._resolveRestoreCorner === 'function') {
        this._saveRestoreCorner(this._resolveRestoreCorner(false));
      }
      this._syncRestorePosition(this._overlayDismissed ? 'dock' : 'mirror');
    }

    handlePageNavigation() {
      this._pageHref = location.href;
      const nextKey = this._overlayRuntimeOffsetKey();
      if (this._overlayUrlKey === nextKey) return;
      const prevKey = this._overlayUrlKey;
      if (prevKey && (S.overlayOffsets || {})[prevKey]) {
        const offsets = { ...(S.overlayOffsets || {}) };
        delete offsets[prevKey];
        S.overlayOffsets = offsets;
      }
      this._overlayUrlKey = nextKey;
      if (this._overlayDragging) return;
      if (!this._ensureOverlay(true)) return;
      this._queueOverlayLayoutSync(true);
      this._queueOverlayLayoutSync(true, 150);
    }

    _makeDraggable(pill) {
      let dragging = false, didMove = false, startX, startY, startL, startT;
      const dragThreshold = 4;

      pill.addEventListener('pointerdown', e => {
        if (e.button !== 0 || e.target.closest('button')) return;
        dragging = true;
        didMove = false;
        startX = e.clientX;
        startY = e.clientY;
        // Resolve current left/top to pixel values before drag
        const rect = pill.getBoundingClientRect();
        const hostRect = this._getOverlayLayoutRect();
        startL = rect.left - hostRect.left;
        startT = rect.top  - hostRect.top;
        // Clear preset anchors so left/top drag coordinates fully take over.
        this._resetOverlayAnchorStyles(pill);
        pill.style.left = `${startL}px`;
        pill.style.top = `${startT}px`;
        this._syncRestorePosition();
        pill.setPointerCapture(e.pointerId);
        e.preventDefault();
        e.stopPropagation();
      }, true);

      pill.addEventListener('pointermove', e => {
        if (!dragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (!didMove && Math.hypot(dx, dy) < dragThreshold) return;
        didMove = true;
        this._overlayDragging = true;
        const next = this._normalizeOverlayOffset({
          x: startL + dx,
          y: startT + dy
        }, pill);
        pill.style.left = `${next.x}px`;
        pill.style.top  = `${next.y}px`;
        this._syncRestorePosition();
        e.preventDefault();
      }, true);

      pill.addEventListener('pointerup', e => {
        if (!dragging) return;
        dragging = false;
        this._overlayDragging = false;
        if (pill.hasPointerCapture?.(e.pointerId)) {
          try { pill.releasePointerCapture(e.pointerId); } catch (_) {}
        }
        if (didMove) this._saveOverlayPosition();
        else this._restoreOverlayPosition();
        didMove = false;
        e.stopPropagation();
      }, true);

      pill.addEventListener('pointercancel', e => {
        dragging = false;
        this._overlayDragging = false;
        didMove = false;
        if (pill.hasPointerCapture?.(e.pointerId)) {
          try { pill.releasePointerCapture(e.pointerId); } catch (_) {}
        }
        this._restoreOverlayPosition();
      }, true);
    }

    _copyPositionStyles(fromEl, toEl) {
      if (!fromEl || !toEl) return;
      ['top', 'right', 'bottom', 'left', 'transform'].forEach(prop => {
        toEl.style[prop] = fromEl.style[prop] || '';
      });
    }

    _cornerFromPreset(pos = S.overlayPosition) {
      const map = {
        'top-left':      'top-left',
        'top-right':     'top-right',
        'top-center':    'top-left',
        'bottom-left':   'bottom-left',
        'bottom-right':  'bottom-right',
        'bottom-center': 'bottom-left'
      };
      return map[pos] || 'top-left';
    }

    _cornerFromRects(pillRect, hostRect) {
      if (!pillRect || !hostRect) return this._cornerFromPreset();
      const centerX = (pillRect.left - hostRect.left) + (pillRect.width / 2);
      const centerY = (pillRect.top - hostRect.top) + (pillRect.height / 2);
      const horizontal = centerX >= (hostRect.width / 2) ? 'right' : 'left';
      const vertical = centerY >= (hostRect.height / 2) ? 'bottom' : 'top';
      return `${vertical}-${horizontal}`;
    }

    _resolveRestoreCorner(preferSaved = true) {
      const saved = preferSaved ? this._readSavedRestoreCorner() : '';
      if (saved) return saved;
      if (this.overlay && this._pill()) {
        return this._cornerFromRects(
          this._pill().getBoundingClientRect(),
          this._getOverlayLayoutRect()
        );
      }
      const offset = this._readSavedOverlayOffset();
      if (offset) {
        const horizontal = (Number(offset.rx) || 0) >= 0.5 ? 'right' : 'left';
        const vertical = (Number(offset.ry) || 0) >= 0.5 ? 'bottom' : 'top';
        return `${vertical}-${horizontal}`;
      }
      return this._cornerFromPreset();
    }

    _applyRestoreCorner(corner) {
      const restore = this._restoreBtn();
      if (!restore || !this.overlay) return;
      this._resetOverlayAnchorStyles(restore);
      const target = corner || 'top-left';
      if (target.startsWith('top-')) restore.style.top = '8px';
      else restore.style.bottom = '8px';
      if (target.endsWith('-left')) restore.style.left = '8px';
      else restore.style.right = '8px';
    }

    _isOverlayLockedHidden() {
      return this._overlayDismissed || this._overlaySessionHidden || this._overlayToggleHidden;
    }

    _applyOverlayPersistentState() {
      const pill = this._pill();
      const restore = this._restoreBtn();
      const hidden = this._isOverlayLockedHidden();
      if (pill) pill.classList.toggle('vx-manual', hidden);
      // Keep the VX badge hidden whenever the "Keep VX Button After Close" setting is off.
      const showBadge = S.overlayRestoreBadge === false
        ? false
        : (this._overlayDismissed || this._overlayToggleHidden);
      if (restore) restore.classList.toggle('show', showBadge);
      if (hidden) {
        clearTimeout(this._fadeT);
        this._overlayPlaybackRevealUntil = 0;
        this._setOverlayInteractionLayer(false);
        this._setCompactOverlayExpanded(false);
      }
    }

    _syncRestorePosition(mode = this._overlayDismissed ? 'dock' : 'mirror') {
      const corner = mode === 'dock'
        ? this._resolveRestoreCorner()
        : this._cornerFromRects(
            this._pill()?.getBoundingClientRect(),
            this._getOverlayLayoutRect()
          );
      this._applyRestoreCorner(corner);
    }

    _setOverlayDismissed(hidden, persist = true) {
      this._overlaySessionHidden = false;
      this._overlayToggleHidden = false;
      this._overlayDismissed = hidden;
      this._applyOverlayPersistentState();
      this._syncRestorePosition(hidden ? 'dock' : 'mirror');
      if (persist) this._saveOverlayDismissedState(hidden);
    }

    _setOverlaySessionHidden(hidden) {
      this._overlaySessionHidden = hidden;
      this._overlayDismissed = false;
      this._overlayToggleHidden = false;
      this._applyOverlayPersistentState();
    }

    _setOverlayToggleHidden(hidden) {
      this._overlayToggleHidden = hidden;
      this._applyOverlayPersistentState();
      if (!hidden) this._flash();
    }

    _queueOverlayLayoutSync(forcePreset = false, delay = 0) {
      const schedule = () => {
        if (this._overlayLayoutRaf) cancelAnimationFrame(this._overlayLayoutRaf);
        this._overlayLayoutRaf = requestAnimationFrame(() => {
          this._overlayLayoutRaf = 0;
          if (!this.video?.isConnected || this._overlayDragging) return;
          if (!this._ensureOverlay(forcePreset)) return;
          const pill = this._pill();
          this._syncCompactOverlayState({ immediate: true });
          const hostRect = this._getOverlayLayoutRect();
          if (!pill) return;
          if (hostRect.width < MIN_W || hostRect.height < MIN_H) {
            if (delay === 0) this._queueOverlayLayoutSync(forcePreset, 120);
            return;
          }
          this._restoreOverlayPosition(forcePreset);
          this._syncRestorePosition(this._overlayDismissed ? 'dock' : 'mirror');
          this._applyOverlayPersistentState();
        });
      };

      clearTimeout(this._overlayLayoutTimer);
      if (delay > 0) {
        this._overlayLayoutTimer = setTimeout(schedule, delay);
        return;
      }
      schedule();
    }

    _observeOverlayLayout(container) {
      if (!('ResizeObserver' in window) || !container) return;
      this._overlayContainer = container;
      if (this._overlayResizeObs) this._overlayResizeObs.disconnect();
      this._overlayResizeObs = new ResizeObserver(() => {
        this._queueOverlayLayoutSync();
      });
      this._overlayResizeObs.observe(container);
      if (this.video?.isConnected) this._overlayResizeObs.observe(this.video);
    }

    _destroyOverlay(preserveState = false) {
      clearTimeout(this._fadeT);
      clearTimeout(this._seekDebounceT);
      clearTimeout(this._overlayLayoutTimer);
      clearTimeout(this._overlayCompactTimer);
      clearTimeout(this._overlayLayerResetTimer);
      if (this._overlayLayoutRaf) cancelAnimationFrame(this._overlayLayoutRaf);
      if (this._overlayMouseH) this.video.removeEventListener('mouseover', this._overlayMouseH);
      if (this._overlayMouseH) this.video.removeEventListener('pointerenter', this._overlayMouseH);
      if (this._overlayPlayH)  this.video.removeEventListener('play', this._overlayPlayH);
      if (this._overlayPlayH)  this.video.removeEventListener('playing', this._overlayPlayH);
      if (this._overlaySeekH)  this.video.removeEventListener('seeked', this._overlaySeekH);
      if (this._overlayContainer && this._overlayContainerHoverH) {
        this._overlayContainer.removeEventListener('pointerover', this._overlayContainerHoverH, true);
        this._overlayContainer.removeEventListener('pointerdown', this._overlayContainerHoverH, true);
        this._overlayContainer.removeEventListener('touchstart', this._overlayContainerHoverH, true);
      }
      if (this._overlayContainer && this._overlayContainerFocusH) {
        this._overlayContainer.removeEventListener('focusin', this._overlayContainerFocusH, true);
      }
      if (this._overlayResizeObs) this._overlayResizeObs.disconnect();
      this._overlayMouseH = null;
      this._overlayPlayH  = null;
      this._overlaySeekH  = null;
      this._overlayContainerHoverH = null;
      this._overlayContainerFocusH = null;
      this._overlayCompactTimer = null;
      this._overlayCompactExpanded = true;
      this._overlayLayerResetTimer = null;
      this._overlayResizeObs = null;
      this._overlayDragging = false;
      this._overlayLayoutRaf = 0;
      this._overlayLayoutTimer = null;
      if (this.overlay) this.overlay._vxController = null;
      if (this.overlay) this.overlay.remove();
      this.overlay = null;
      this.shadow = null;
      this._overlayContainer = null;
      this._overlayRenderMode = 'default';
      if (!preserveState) {
        this._overlayDismissed = false;
        this._overlaySessionHidden = false;
        this._overlayToggleHidden = false;
      }
    }

    /* ── Rate setter (avoids recursive fightback loop) ───────────── */
    _safeSetRate(speed) {
      this._settingRate = true;
      clearTimeout(this._srTimer);
      try {
        this.video.preservesPitch = true;
        this.video.mozPreservesPitch = true;
        this.video.playbackRate = speed;
      } catch (_) {}
      this._srTimer = setTimeout(() => { this._settingRate = false; }, 250);
    }

    _startCoolDown(ms) {
      this._coolDown = true;
      clearTimeout(this._cdTimer);
      this._cdTimer = setTimeout(() => { this._coolDown = false; }, ms);
    }

    _resetFightbackState() {
      this._coolDown = false;
      clearTimeout(this._cdTimer);
      clearTimeout(this._fightTimer);
      this._fightCount = 0;
      this._fightTimer = null;
    }

    _hadRecentSeekInteraction() {
      return !!this.video?.seeking || (Date.now() - this._lastSeekInteractionAt) <= SEEK_RATE_GUARD_MS;
    }

    _persistRememberedSpeed(speed) {
      const upd = {};
      if (S.rememberSpeed) upd.speed = speed;
      if (S.rememberPerUrl) {
        const urlKey = getUrlSpeedKey();
        if (urlKey) {
          S[urlKey] = speed;
          upd[urlKey] = speed;
        }
      }
      if (Object.keys(upd).length) safeStorageSet(upd);
    }

    _commitSpeedState(speed, { save = true, flash = true } = {}) {
      speed = clamp(r2(speed), MIN_SPEED, MAX_SPEED);
      const shouldSyncSharedState = shouldSyncControllerSpeedState(this);
      this.userSpeed = speed;
      if (shouldSyncSharedState) S.speed = speed;
      this._updateDisp(speed);
      if (flash) this._flash();
      if (save && shouldSyncSharedState) this._persistRememberedSpeed(speed);
      if (ctrlList.includes(this)) syncBadgeToActiveController();
      return speed;
    }

    /* ── Media event listeners with advanced fightback ───────────── */
    _attachListeners() {
      this._rateH = event => {
        if (this._settingRate) return;
        if (this.video.readyState === 0) return;

        const actual = this.video.playbackRate;
        const silenceSpeed = S.silenceSpeed || 2.0;
        const targetSpeed = this.silenceActive ? silenceSpeed : this.userSpeed;
        if (Math.abs(actual - targetSpeed) > 0.01) {
          if (!this.silenceActive && this._hadRecentSeekInteraction()) {
            this._safeSetRate(targetSpeed);
            return;
          }

          if (this.silenceActive && S.silenceSkip) {
            this._safeSetRate(silenceSpeed);
            return;
          }

          // Some players temporarily drop playbackRate below our supported minimum while scrubbing.
          // Never persist those transient preview rates as the user's chosen speed.
          if (actual < MIN_SPEED) {
            this._safeSetRate(targetSpeed);
            return;
          }

          const acceptNativeFileRateChange =
            isNativeFileMediaPage(this.video) &&
            event?.isTrusted !== false;

          if (acceptNativeFileRateChange || hadRecentPageGesture(event)) {
            this._resetFightbackState();
            this._commitSpeedState(actual, { save: true, flash: true });
            return;
          }

          if (!S.fightback) {
            this._resetFightbackState();
            this._commitSpeedState(actual, { save: true, flash: false });
            return;
          }

          if (this._coolDown) {
            // Actively enforce our speed during cooldown
            try {
              this.video.preservesPitch = true;
              this.video.mozPreservesPitch = true;
              this.video.playbackRate = this.userSpeed;
            } catch (_) {}
            return;
          }

          this._fightCount++;
          clearTimeout(this._fightTimer);
          this._fightTimer = setTimeout(() => {
            this._fightCount = 0;
            this._fightTimer = null;
          }, FIGHT_WIN);

          if (this._fightCount >= MAX_FIGHT) {
            // Site is overriding intentionally — accept it
            this._resetFightbackState();
            this._commitSpeedState(actual, { save: true, flash: false });
          } else {
            // Restore our speed with exponential cooldown
            const coolMs = Math.min(BASE_CD_MS * Math.pow(2, this._fightCount - 1), MAX_CD_MS);
            this._safeSetRate(this.userSpeed);
            this._startCoolDown(coolMs);
          }
        } else {
          this._updateDisp(this.silenceActive ? silenceSpeed : actual);
        }
      };

      this._playH = () => {
        this.handlePageNavigation();
        if (!this.silenceActive) this._safeSetRate(this.userSpeed);
        if (S.silenceSkip) {
          const entry = audioMap.get(this.video);
          if (entry && !isStaleSilenceEntry(entry)) this._startSilenceLoop();
          else this.initSilence({ fromGesture: hadRecentPageGesture(), forceRebuild: !!entry });
        }
        this._queuePlaybackReveal(2400);
        scheduleOverlayOwnershipSync(false, preferredOverlaySyncMode(this.video));
      };

      this._hoverH = () => {
        scheduleOverlayOwnershipSync(false, preferredOverlaySyncMode(this.video));
      };

      this._seekMarkH = () => {
        this._lastSeekInteractionAt = Date.now();
      };

      this.video.addEventListener('ratechange', this._rateH);
      this.video.addEventListener('play',       this._playH);
      this.video.addEventListener('playing',    this._playH);
      this.video.addEventListener('mouseover',  this._hoverH);
      this.video.addEventListener('pointerenter', this._hoverH);
      this.video.addEventListener('seeking',    this._seekMarkH);
      this.video.addEventListener('seeked',     this._seekMarkH);
    }

    /* ── Apply speed ─────────────────────────────────────────────── */
    applySpeed(speed, save = true) {
      speed = this._commitSpeedState(speed, { save, flash: true });
      this._safeSetRate(speed);
    }

    adjust(delta) {
      this.applySpeed(snapSpeed(this.userSpeed, delta));
    }

    /* ── Overlay display helpers ─────────────────────────────────── */
    _pill() { return this.shadow?.querySelector('#pill'); }
    _restoreBtn() { return this.shadow?.querySelector('#restore'); }

    _isHovered() {
      try {
        return !!(
          this.video.matches(':hover') ||
          this._pill()?.matches(':hover') ||
          this._restoreBtn()?.matches(':hover')
        );
      } catch (_) {
        return false;
      }
    }

    _isPlaybackActive() {
      return !!(
        this.video &&
        !this.video.paused &&
        !this.video.ended &&
        this.video.readyState > 0
      );
    }

    _hasRecentPlaybackSignal(windowMs = 3200) {
      return (performance.now() - (this._overlayLastPlaybackSignalAt || 0)) <= windowMs;
    }

    _isImmediatelyRevealableVideo() {
      if (this.isAudio || !this.video?.isConnected) return false;
      if (!shouldUseImmediateOverlaySync(this.video)) return false;
      if (!isRenderableElement(this.video)) return false;
      const rect = this.video.getBoundingClientRect();
      if (rect.width < MIN_W || rect.height < MIN_H) return false;
      if (isYouTubeShortsPage()) return isLikelyActiveShortsVideo(this.video, rect);
      if (isViewportManagedSocialVideo(this.video, rect)) return isPrimaryViewportVideo(this.video, rect);
      return false;
    }

    _maybeRevealVisibleViewportVideo(dur = 2400) {
      if (!S.showOverlay || this._isOverlayLockedHidden()) return false;
      const pill = this._pill();
      if (!pill || !this.overlay) return false;
      if (!this._isImmediatelyRevealableVideo()) return false;
      const now = performance.now();
      if (now - (this._overlayLastAutoRevealAt || 0) < 900) return false;
      this._overlayLastPlaybackSignalAt = now;
      if (!this._showOverlayTemporarily(dur, { expand: false })) return false;
      this._overlayLastAutoRevealAt = now;
      return true;
    }

    _showOverlayTemporarily(dur = 2800, { flash = false, expand = false } = {}) {
      const pill = this._pill();
      if (!pill || !S.showOverlay || this._isOverlayLockedHidden()) return false;
      pill.classList.remove('vh');
      if (expand) this._setOverlayInteractionLayer(true);
      if (flash) {
        pill.classList.remove('fl');
        void pill.offsetWidth;
        pill.classList.add('fl');
      }
      clearTimeout(this._fadeT);
      this._setCompactOverlayExpanded(!!expand);
      this._fadeT = setTimeout(() => {
        pill.classList.add('vh');
        this._setOverlayInteractionLayer(false);
        this._setCompactOverlayExpanded(false);
      }, dur);
      return true;
    }

    _queuePlaybackReveal(dur = 2400) {
      if (!S.showOverlay || this._isOverlayLockedHidden()) return false;
      const now = performance.now();
      this._overlayLastPlaybackSignalAt = now;
      this._overlayPlaybackRevealUntil = Math.max(this._overlayPlaybackRevealUntil || 0, now + dur);
      return this._consumePlaybackReveal();
    }

    _consumePlaybackReveal({ force = false } = {}) {
      if (!S.showOverlay || this._isOverlayLockedHidden()) {
        this._overlayPlaybackRevealUntil = 0;
        return false;
      }
      const pill = this._pill();
      if (!pill || !this.overlay) return false;
      const now = performance.now();
      const pendingFor = (this._overlayPlaybackRevealUntil || 0) - now;
      const hasPendingReveal = pendingFor > 120;
      if (!hasPendingReveal && !(force && this._hasRecentPlaybackSignal())) return false;
      if (!this._isPlaybackActive() && !this._hasRecentPlaybackSignal()) {
        this._overlayPlaybackRevealUntil = 0;
        return false;
      }
      if (!force && now - (this._overlayLastAutoRevealAt || 0) < 900) return false;
      const dur = Math.max(1800, Math.min(3200, Math.round(hasPendingReveal ? pendingFor : 2200)));
      if (!this._showOverlayTemporarily(dur, { expand: false })) return false;
      this._overlayPlaybackRevealUntil = 0;
      this._overlayLastAutoRevealAt = now;
      return true;
    }

    toggleOverlayVisibility() {
      const pill = this._pill();
      if (!pill) return;

      if (this._overlaySessionHidden) {
        this._setOverlaySessionHidden(false);
        this._flash();
        return;
      }

      if (this._overlayDismissed) {
        this._setOverlayDismissed(false);
        this._flash();
        return;
      }

      if (this._overlayToggleHidden) {
        this._setOverlayToggleHidden(false);
        this._flash();
        return;
      }

      if (S.overlayRestoreBadge === false) {
        this._saveOverlayDismissedState(false);
        this._setOverlaySessionHidden(true);
        return;
      }

      this._setOverlayToggleHidden(true);
    }

    _updateDisp(sp) {
      const el = this.shadow?.querySelector('#spd');
      if (el) el.textContent = sp.toFixed(2) + '\u00d7';
    }

    _flash() {
      this._showOverlayTemporarily(2000, { flash: true, expand: false });
    }

    _adjustVolume(delta) {
      if (!this.video) return;
      const newVol = Math.min(1, Math.max(0, this.video.volume + delta));
      this.video.volume = parseFloat(newVol.toFixed(2));
      const pct = Math.round(this.video.volume * 100);
      const icon = delta > 0 ? '\u{1F50A}' : '\u{1F509}';
      this._announce(`${icon} ${pct}%`, 1200);
    }

    /* ── Loop Last N Seconds ─────────────────────────────────────── */
    _announce(text, ms = 1600) {
      const el = this.shadow?.querySelector('#spd');
      if (!el) {
        this._flash();
        return;
      }
      clearTimeout(this._statusT);
      el.textContent = text;
      this._flash();
      this._statusT = setTimeout(() => {
        this._statusT = null;
        this._updateDisp(this.silenceActive ? (S.silenceSpeed || 2.0) : this.video.playbackRate);
      }, ms);
    }

    _syncPrimaryButtonTitles() {
      setButtonTitle(this.shadow?.querySelector('.minus'), actionLabel('Slower', 'decreaseSpeed'));
      setButtonTitle(this.shadow?.querySelector('.plus'), actionLabel('Faster', 'increaseSpeed'));
      setButtonTitle(this.shadow?.querySelector('.pip'), actionLabel('Picture-in-Picture', 'togglePiP'));
      const closeBtn = this.shadow?.querySelector('.cls');
      const toggleHint = actionShortcutText('toggleOverlay', '');
      setButtonTitle(closeBtn, toggleHint ? `Hide overlay - ${toggleHint} restores it` : 'Hide overlay');
    }

    _syncABButton() {
      const btn = this.shadow?.querySelector('.ab');
      if (!btn) return;
      btn.classList.toggle('on', !!this.abActive);
      btn.textContent = this.abA !== null && !this.abActive ? 'A→' : 'AB';
      setButtonTitle(btn, getABLoopTitle(this));
    }

    _syncMarkButtons() {
      const markBtn = this.shadow?.querySelector('.mk');
      const jumpBtn = this.shadow?.querySelector('.jmp');
      if (this.mark !== null && Number.isFinite(this.mark)) {
        if (markBtn) {
          markBtn.classList.add('on');
          const jumpHint = actionShortcutText('jumpToMark', '');
          setButtonTitle(markBtn, `Marker at ${this.mark.toFixed(1)}s${jumpHint ? ` - ${jumpHint} to jump` : ''}`);
        }
        if (jumpBtn) {
          jumpBtn.classList.add('on');
          setButtonTitle(jumpBtn, actionLabel(`Jump to ${this.mark.toFixed(1)}s`, 'jumpToMark'));
        }
        return;
      }
      if (markBtn) {
        markBtn.classList.remove('on');
        setButtonTitle(markBtn, actionLabel('Mark position', 'setMark'));
      }
      if (jumpBtn) {
        jumpBtn.classList.remove('on');
        setButtonTitle(jumpBtn, actionLabel('Jump to marker', 'jumpToMark'));
      }
    }

    _syncLoopButton() {
      const lpBtn = this.shadow?.querySelector('.lp');
      if (!lpBtn) return;
      lpBtn.classList.toggle('on', this.loopActive);
      lpBtn.querySelectorAll('.lp-sec').forEach(el => el.remove());
      const activeSeconds = Math.round(this._loopLen || clampLoopSeconds(S.loopSeconds));
      const label = this.loopActive
        ? `Loop active: last ${activeSeconds}s - click${actionShortcutText('toggleLoop', '') ? ` or ${actionShortcutText('toggleLoop')}` : ''} to stop`
        : actionLabel(`Loop last ${clampLoopSeconds(S.loopSeconds)}s from here`, 'toggleLoop');
      setButtonTitle(lpBtn, label);
    }

    _syncVolumeButtonTitles() {
      const downBtn = this.shadow?.querySelector('.vd');
      const upBtn = this.shadow?.querySelector('.vu');
      if (downBtn) setButtonTitle(downBtn, actionLabel('Volume Down', 'volumeDown'));
      if (upBtn) setButtonTitle(upBtn, actionLabel('Volume Up', 'volumeUp'));
    }

    _loopStatus(message = '', loopSeconds = S.loopSeconds) {
      return {
        ok: true,
        loopActive: this.loopActive,
        loopSeconds: clampLoopSeconds(loopSeconds),
        actualLoopSeconds: r2(this._loopLen || 0),
        loopStart: r2(this._loopStart || 0),
        loopEnd: r2(this._loopEnd || 0),
        message
      };
    }

    /* ── AB Loop ─────────────────────────────────────────────────── */
    updateLoopWindow(loopSeconds = S.loopSeconds) {
      const requested = clampLoopSeconds(loopSeconds);
      if (!this.loopActive) {
        this._syncLoopButton();
        return this._loopStatus('', requested);
      }
      const loopEnd = Math.max(0, this.video.currentTime || this._loopEnd || 0);
      const actual = Math.min(requested, loopEnd);
      if (actual <= 0.1) {
        this.loopActive = false;
        this._stopLoop();
        this._syncLoopButton();
        return this._loopStatus('Play a little further, then update Loop Last N Seconds.', requested);
      }
      this._loopEnd = loopEnd;
      this._loopLen = r2(actual);
      this._loopStart = Math.max(0, loopEnd - actual);
      this._runLoop();
      this._syncLoopButton();
      if (actual < requested) {
        return this._loopStatus(`Only ${this._loopLen.toFixed(1)}s is available here, so VelocityX kept the loop inside the watched portion.`, requested);
      }
      return this._loopStatus(`Loop updated to ${this._loopLen.toFixed(1)}s.`, requested);
    }

    toggleLoop(loopSeconds = S.loopSeconds) {
      if (this.abActive) this._clearAB(false);
      this.loopActive = !this.loopActive;
      const requested = clampLoopSeconds(loopSeconds);
      if (this.loopActive) {
        const loopEnd = Math.max(0, this.video.currentTime || 0);
        const actual = Math.min(requested, loopEnd);
        if (actual <= 0.1) {
          this.loopActive = false;
          this._syncLoopButton();
          return this._loopStatus('Play a little further, then start Loop Last N Seconds.', requested);
        }
        this._loopEnd = loopEnd;
        this._loopLen = r2(actual);
        this._loopStart = Math.max(0, loopEnd - actual);
        this._runLoop();
        this._syncLoopButton();
        if (actual < requested) {
          this._announce(`Loop ${this._loopLen.toFixed(1)}s`, 1700);
          return this._loopStatus(`Only ${this._loopLen.toFixed(1)}s is available here, so VelocityX is looping that watched part.`, requested);
        }
      } else {
        this._stopLoop();
        this._syncLoopButton();
        return this._loopStatus('Loop stopped.', requested);
      }
      this._flash();
      return this._loopStatus(`Looping the last ${this._loopLen.toFixed(1)}s from the point you selected.`, requested);
    }

    _runLoop() {
      if (this._loopRaf) cancelAnimationFrame(this._loopRaf);
      const tick = () => {
        if (!this.loopActive) return;
        const v = this.video;
        const span = Math.max(0.1, this._loopLen || (this._loopEnd - this._loopStart));
        const pct = (v.currentTime - this._loopStart) / span;
        const bar = this.shadow?.querySelector('#bar');
        if (bar) bar.style.width = `${Math.min(100, Math.max(0, pct * 100))}%`;
        if (v.currentTime >= this._loopEnd - 0.1 || v.ended) {
          v.currentTime = this._loopStart;
          v.play().catch(() => {});
        }
        this._loopRaf = requestAnimationFrame(tick);
      };
      this._loopRaf = requestAnimationFrame(tick);
    }

    _stopLoop() {
      if (this._loopRaf) { cancelAnimationFrame(this._loopRaf); this._loopRaf = null; }
      this._loopStart = 0;
      this._loopEnd = 0;
      this._loopLen = 0;
      const bar = this.shadow?.querySelector('#bar');
      if (bar) bar.style.width = '0%';
    }

    _cycleAB() {
      if (!this.abActive && this.abA === null) {
        this.abA = this.video.currentTime;
        this.abB = null;
        const btn = this.shadow?.querySelector('.ab');
        if (btn) { btn.title = `A=${this.abA.toFixed(1)}s – click to set B`; btn.textContent = 'A→'; }
        this._flash();
        this._syncABButton();
      } else if (this.abA !== null && !this.abActive) {
        this.abB = this.video.currentTime;
        if (this.abB <= this.abA) { this._clearAB(true); return; }
        if (this.loopActive) this.toggleLoop();
        this.abActive = true;
        const btn = this.shadow?.querySelector('.ab');
        if (btn) {
          btn.classList.add('on');
          btn.textContent = 'AB';
          btn.title = `AB: ${this.abA.toFixed(1)}s→${this.abB.toFixed(1)}s – click to clear`;
        }
        this._runAB();
        this._flash();
        this._syncABButton();
      } else {
        this._clearAB(true);
      }
    }

    setABPoint(point) {
      if (point === 'a') {
        this.abA = this.video.currentTime;
        this.abActive = false;
        if (this._abRaf) { cancelAnimationFrame(this._abRaf); this._abRaf = null; }
        const btn = this.shadow?.querySelector('.ab');
        if (btn) { btn.classList.remove('on'); btn.textContent = 'A→'; btn.title = `A=${this.abA.toFixed(1)}s – set B next`; }
        this._syncABButton();
      } else if (point === 'b' && this.abA !== null) {
        this.abB = this.video.currentTime;
        if (this.abB > this.abA) { this.abActive = false; this._cycleAB(); }
      }
    }

    _runAB() {
      if (this._abRaf) cancelAnimationFrame(this._abRaf);
      const tick = () => {
        if (!this.abActive) return;
        const v   = this.video;
        const pct = (v.currentTime - this.abA) / (this.abB - this.abA);
        const bar = this.shadow?.querySelector('#bar');
        if (bar) bar.style.width = `${Math.min(100, Math.max(0, pct * 100))}%`;
        if (v.currentTime >= this.abB - 0.1) v.currentTime = this.abA;
        this._abRaf = requestAnimationFrame(tick);
      };
      this._abRaf = requestAnimationFrame(tick);
    }

    _clearAB(resetBtn = true) {
      this.abActive = false; this.abA = null; this.abB = null;
      if (this._abRaf) { cancelAnimationFrame(this._abRaf); this._abRaf = null; }
      const bar = this.shadow?.querySelector('#bar');
      if (bar) bar.style.width = '0%';
      if (resetBtn) {
        const btn = this.shadow?.querySelector('.ab');
        if (btn) { btn.classList.remove('on'); btn.textContent = 'AB'; }
      }
      this._syncABButton();
    }

    /* ── Picture-in-Picture ──────────────────────────────────────── */
    _togglePiP() {
      if (this.isAudio || !document.pictureInPictureEnabled) return;
      if (document.pictureInPictureElement === this.video) {
        document.exitPictureInPicture().catch(() => {});
      } else {
        this.video.requestPictureInPicture().catch(() => {});
      }
    }

    /* ── Mark / Jump ─────────────────────────────────────────────── */
    setMark() {
      this.mark = this.video.currentTime;
      this._flash();
      const pill = this._pill();
      if (pill) {
        const orig = pill.style.background;
        pill.style.background = 'rgba(251,191,36,.7)';
        setTimeout(() => { pill.style.background = orig; }, 400);
      }
      this._syncMarkButtons();
    }

    jumpToMark() {
      if (this.mark === null || typeof this.mark !== 'number') return;
      const cur = this.video.currentTime;
      if (this.positionBeforeJump !== null && Math.abs(cur - this.mark) < 0.5) {
        this.video.currentTime = this.positionBeforeJump;
        this.positionBeforeJump = null;
      } else {
        this.positionBeforeJump = cur;
        this.video.currentTime = this.mark;
      }
      this._flash();
      const jmp = this.shadow?.querySelector('.jmp');
      if (jmp) { jmp.style.transform = 'scale(1.3)'; setTimeout(() => { jmp.style.transform = ''; }, 200); }
    }

    clearMark() {
      this.mark = null; this.positionBeforeJump = null;
      this._syncMarkButtons();
    }

    /* ── Smart Silence Skip™ ─────────────────────────────────────── */
    _clearSilenceState() {
      if (this.silenceTimer) { clearTimeout(this.silenceTimer); this.silenceTimer = null; }
      if (!this.silenceActive) return;
      this.silenceActive = false;
      this._safeSetRate(this.userSpeed);
      this._updateDisp(this.userSpeed);
    }

    _stopSilenceLoop(resetState = false) {
      if (this._silenceRaf) { cancelAnimationFrame(this._silenceRaf); this._silenceRaf = null; }
      if (resetState) this._clearSilenceState();
    }

    _startSilenceLoop() {
      if (!S.silenceSkip || !audioMap.has(this.video)) return false;
      if (this.video.paused || this.video.ended) {
        this._stopSilenceLoop(true);
        return false;
      }
      if (this._silenceRaf) return true;
      this._silenceLoop();
      return true;
    }

    _disposeSilenceContext(entry = audioMap.get(this.video)) {
      if (!entry) return;
      if (audioMap.get(this.video) === entry) audioMap.delete(this.video);

      if (entry.preserveOutputGraph) {
        try {
          entry.source?.disconnect(entry.analyser);
        } catch (_) {
          try { entry.source?.disconnect(); } catch (_) {}
          try { entry.source?.connect(entry.gain); } catch (_) {}
        }
      } else {
        try { entry.source?.disconnect(); } catch (_) {}
        try { entry.gain?.disconnect(); } catch (_) {}
      }

      try { entry.analyser?.disconnect(); } catch (_) {}
      try { entry.stream?.getTracks?.().forEach(track => track.stop()); } catch (_) {}
      if (!entry.preserveOutputGraph) {
        try { entry.ctx?.close(); } catch (_) {}
      }
    }

    _ensureSilenceContextRunning(entry, { fromGesture = false } = {}) {
      if (!entry?.ctx) return false;
      if (entry.ctx.state === 'closed') {
        if (audioMap.get(this.video) === entry) this._disposeSilenceContext(entry);
        return false;
      }
      if (entry.ctx.state === 'running') return true;
      if (!fromGesture) return false;
      if (entry.resumePending) return false;
      entry.resumePending = true;
      entry.ctx.resume().then(() => {
        entry.resumePending = false;
        if (audioMap.get(this.video) !== entry) return;
        if (entry.ctx.state === 'running') this._startSilenceLoop();
        else this._disposeSilenceContext(entry);
      }).catch(() => {
        entry.resumePending = false;
        if (audioMap.get(this.video) === entry) this._disposeSilenceContext(entry);
      });
      return false;
    }

    _isCurrentlySilent(d = audioMap.get(this.video)) {
      if (!d) return false;
      if (d.ctx?.state !== 'running') return false;
      if (d.stream && getLiveAudioTrackCount(d.stream) <= 0) return false;
      if (this.video.muted || Number(this.video.volume) <= 0.001) return false;
      let rms = 0;
      if (d.timeBuf && typeof d.analyser.getByteTimeDomainData === 'function') {
        d.analyser.getByteTimeDomainData(d.timeBuf);
        let sum = 0;
        for (let i = 0; i < d.timeBuf.length; i++) {
          const centered = (d.timeBuf[i] - 128) / 128;
          sum += centered * centered;
        }
        rms = Math.sqrt(sum / d.timeBuf.length);
      } else {
        d.analyser.getByteFrequencyData(d.buf);
        let sum = 0;
        for (let i = 0; i < d.buf.length; i++) sum += d.buf[i] * d.buf[i];
        rms = Math.sqrt(sum / d.buf.length) / 255;
      }
      d.lastRms = rms;
      if (rms >= (S.silenceThreshold || 0.02)) d.observedAudio = true;
      if (!d.observedAudio && d.sourceType === 'media-element') return false;
      return rms < (S.silenceThreshold || 0.02);
    }

    initSilence({ fromGesture = false, event = null, forceRebuild = false } = {}) {
      if (!S.silenceSkip) return false;
      const existing = audioMap.get(this.video);
      if (forceRebuild && existing) this._disposeSilenceContext(existing);
      const activeEntry = forceRebuild ? audioMap.get(this.video) : existing;
      if (activeEntry) {
        const running = this._ensureSilenceContextRunning(activeEntry, { fromGesture });
        return running ? this._startSilenceLoop() : !!fromGesture;
      }
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextCtor) return false;
      if (!fromGesture && !hadRecentPageGesture(event)) return false;
      try {
        const createAnalyser = ctx => {
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 512;
          analyser.smoothingTimeConstant = 0.6;
          return analyser;
        };

        let ctx = null;
        let analyser = null;
        let src = null;
        let gain = null;
        let stream = null;
        let sourceType = 'media-element';
        let preserveOutputGraph = false;
        const captureFactory = getMediaCaptureFactory(this.video);

        // Prefer a captured stream so silence analysis can stay independent
        // from the media element's output graph when audio tracks are exposed.
        if (captureFactory) {
          ctx = createSilenceAudioContext(AudioContextCtor);
        }
        if (captureFactory && ctx && typeof ctx.createMediaStreamSource === 'function') {
          try {
            stream = captureFactory();
          } catch (_) {
            stream = null;
          }
          if (getLiveAudioTrackCount(stream) > 0) {
            analyser = createAnalyser(ctx);
            src = ctx.createMediaStreamSource(stream);
            src.connect(analyser);
            sourceType = 'capture-stream';
          } else {
            try { stream?.getTracks?.().forEach(track => track.stop()); } catch (_) {}
            stream = null;
            try { ctx.close(); } catch (_) {}
            ctx = null;
          }
        }

        if (!src) {
          const graph = getOrCreateMediaElementAudioGraph(this.video, AudioContextCtor);
          if (!graph) return false;
          ctx = graph.ctx;
          src = graph.source;
          gain = graph.gain;
          analyser = createAnalyser(ctx);
          src.connect(analyser);
          preserveOutputGraph = true;
        }
        const entry = {
          ctx,
          analyser,
          source: src,
          gain,
          stream,
          sourceType,
          preserveOutputGraph,
          buf: new Uint8Array(analyser.frequencyBinCount),
          timeBuf: new Uint8Array(analyser.fftSize),
          observedAudio: false,
          lastRms: 0,
          resumePending: false
        };
        audioMap.set(this.video, entry);
        const running = this._ensureSilenceContextRunning(entry, { fromGesture });
        if (!running && ctx.state !== 'running') {
          if (!fromGesture) {
            this._disposeSilenceContext(entry);
            return false;
          }
          return true;
        }
        return this._startSilenceLoop();
      } catch (err) {
        logMessage('debug', '[VelocityX] Silence skip init failed.', err);
        return false;
      }
    }

    _silenceLoop() {
      this._silenceRaf = null;
      if (!S.silenceSkip) { this._clearSilenceState(); return; }
      const d = audioMap.get(this.video);
      if (!d) return;
      if (this.video.paused || this.video.ended) { this._clearSilenceState(); return; }
      if (!this._ensureSilenceContextRunning(d, { fromGesture: false })) {
        this._clearSilenceState();
        return;
      }
      const silent = this._isCurrentlySilent(d);

      if (silent && !this.video.paused && !this.video.ended) {
        if (!this.silenceActive && !this.silenceTimer) {
          this.silenceTimer = setTimeout(() => {
            this.silenceTimer = null;
            if (!S.silenceSkip || this.video.paused || this.video.ended) return;
            if (!this._isCurrentlySilent()) return;
            this.silenceActive = true;
            this._safeSetRate(S.silenceSpeed || 2.0);
            this._updateDisp(S.silenceSpeed || 2.0);
          }, S.silenceDelay || 800);
        }
      } else this._clearSilenceState();
      this._silenceRaf = requestAnimationFrame(() => this._silenceLoop());
    }

    /* ── VelocityX ──────────────────────────────────────────────── */
    _startTracking() {
      this._trackT = setInterval(() => {
        const now = Date.now();
        const elapsed = (now - this._lastTrack) / 1000;
        this._lastTrack = now;
        if (this.video.paused || this.video.ended || elapsed <= 0) return;

        const effectiveSpeed = clamp(r2(this.video.playbackRate || this.userSpeed || 1.0), MIN_SPEED, MAX_SPEED);
        reportSpeedDistSample(effectiveSpeed, elapsed);
        if (effectiveSpeed <= 1) return;

        safeStorageGet(['totalTimeSaved', 'weekTimeSaved'], d => {
          const saved = elapsed * (effectiveSpeed - 1);
          safeStorageSet({
            totalTimeSaved: r2((d.totalTimeSaved || 0) + saved),
            weekTimeSaved: r2((d.weekTimeSaved || 0) + saved)
          });
        });
      }, 2000);
    }

    /* ── Intersection observer (hide when scrolled off) ──────────── */
    _observeVideo() {
      if (!('IntersectionObserver' in window)) return;
      if (this._intObs) this._intObs.disconnect();
      this._intObs = new IntersectionObserver(entries => {
        const entry = entries[0];
        const viewportManagedVideo = isYouTubeShortsPage() || isViewportManagedSocialVideo(this.video);
        if (!entry.isIntersecting) {
          clearTimeout(this._fadeT);
          this._pill()?.classList.add('vh');
        } else if (viewportManagedVideo) {
          if (!this.overlay && S.showOverlay && !this.isAudio) {
            try { this._ensureOverlay(true); } catch (_) {}
          }
          if (S.showOverlay && (isLikelyActiveShortsVideo(this.video) || isPrimaryViewportVideo(this.video))) {
            this._queuePlaybackReveal(2400);
          }
        }
        scheduleOverlayOwnershipSync(viewportManagedVideo, preferredOverlaySyncMode(this.video));
      }, { threshold: 0.3 });
      this._intObs.observe(this.video);
    }

    /* ── Refresh after settings change ───────────────────────────── */
    refreshSettings(prev = S) {
      const prevPageHref = this._pageHref || location.href;
      const prevDesiredSpeed = resolveContextSpeed(prev, { href: prevPageHref });
      const nextDesiredSpeed = resolveContextSpeed(S);
      if (this.isAudio && prev.controlAudio !== S.controlAudio && !S.controlAudio) {
        this.destroy({ restorePlayback: true });
        return;
      }

      const ruleStateChanged =
        prev.defaultSpeed !== S.defaultSpeed ||
        prev.rememberSpeed !== S.rememberSpeed ||
        prev.rememberPerUrl !== S.rememberPerUrl ||
        JSON.stringify(prev.siteRules || {}) !== JSON.stringify(S.siteRules || {}) ||
        contextSpeedDiffers(prevDesiredSpeed, nextDesiredSpeed);
      const overlayChanged =
        prev.showOverlay !== S.showOverlay ||
        prev.overlayRestoreBadge !== S.overlayRestoreBadge ||
        prev.overlayPosition !== S.overlayPosition ||
        JSON.stringify(prev.overlayControls || {}) !== JSON.stringify(S.overlayControls || {}) ||
        JSON.stringify(prev.overlayRestoreCorners || {}) !== JSON.stringify(S.overlayRestoreCorners || {}) ||
        JSON.stringify(prev.overlayOffsets || {}) !== JSON.stringify(S.overlayOffsets || {}) ||
        JSON.stringify(prev.overlayHiddenStates || {}) !== JSON.stringify(S.overlayHiddenStates || {});
      const overlayPresentationChanged =
        prev.overlayOpacity !== S.overlayOpacity ||
        prev.overlayButtonSize !== S.overlayButtonSize;
      const loopSecondsChanged =
        clampLoopSeconds(prev.loopSeconds) !== clampLoopSeconds(S.loopSeconds);

      if (!this.isAudio && overlayChanged) {
        this._destroyOverlay(true);
        if (S.showOverlay) {
          try {
            this._ensureOverlay(true);
            this._queueOverlayLayoutSync(true);
            this._queueOverlayLayoutSync(true, 150);
          } catch (err) {
            logMessage('warn', '[VelocityX] Overlay rebuild failed after settings change.', err);
            this._destroyOverlay();
          }
        }
      }
      if (!this.isAudio && overlayPresentationChanged) {
        this._applyOverlayPresentation();
      }

      const silenceEntry = audioMap.get(this.video);
      if (S.silenceSkip && (!silenceEntry || isStaleSilenceEntry(silenceEntry))) {
        this.initSilence({ fromGesture: hadRecentPageGesture(), forceRebuild: !!silenceEntry });
      }
      if (!S.silenceSkip) this._stopSilenceLoop(true);
      this._syncPrimaryButtonTitles();
      this._syncABButton();
      this._syncMarkButtons();
      if (S.customCSS !== undefined) {
        injectCustomCSS(S.customCSS);
        this._applyShadowCustomCSS();
      }
      syncSiteControllerCSS();
      this._syncVolumeButtonTitles();
      if (loopSecondsChanged && this.loopActive) this.updateLoopWindow(S.loopSeconds);
      else this._syncLoopButton();
      if (!this.isAudio) this._ensureOverlay();
      if (ruleStateChanged) {
        const desired = nextDesiredSpeed;
        if (desired == null) {
          this.destroy({ restorePlayback: true });
          return;
        }
        if (Math.abs((this.userSpeed || 0) - desired) > 0.001) {
          this.userSpeed = desired;
          this._safeSetRate(desired);
          this._updateDisp(desired);
        }
      }
      this._pageHref = location.href;
    }

    /* ── Destroy ─────────────────────────────────────────────────── */
    resetOverlayState() {
      this._overlayDismissed = false;
      this._overlaySessionHidden = false;
      this._overlayToggleHidden = false;
      this._overlayDragging = false;
      if (this.isAudio) return;
      this._destroyOverlay();
      if (!S.showOverlay) return;
      try {
        this._ensureOverlay(true);
        this._queueOverlayLayoutSync(true);
        this._queueOverlayLayoutSync(true, 150);
      } catch (err) {
        logMessage('warn', '[VelocityX] Overlay reset failed.', err);
        this._destroyOverlay();
      }
    }

    destroy({ restorePlayback = false } = {}) {
      this._destroyOverlay();
      this.video.removeEventListener('ratechange', this._rateH);
      this.video.removeEventListener('play',       this._playH);
      this.video.removeEventListener('playing',    this._playH);
      this.video.removeEventListener('mouseover',  this._hoverH);
      this.video.removeEventListener('pointerenter', this._hoverH);
      if (this._seekMarkH) {
        this.video.removeEventListener('seeking', this._seekMarkH);
        this.video.removeEventListener('seeked', this._seekMarkH);
      }
      clearInterval(this._trackT);
      clearTimeout(this.silenceTimer);
      clearTimeout(this._fadeT);
      clearTimeout(this._seekDebounceT);
      clearTimeout(this._statusT);
      clearTimeout(this._srTimer);
      clearTimeout(this._cdTimer);
      clearTimeout(this._fightTimer);
      if (this._silenceRaf) { cancelAnimationFrame(this._silenceRaf); this._silenceRaf = null; }
      if (this._loopRaf)    { cancelAnimationFrame(this._loopRaf);    this._loopRaf = null; }
      if (this._abRaf)      { cancelAnimationFrame(this._abRaf);      this._abRaf = null; }
      if (this._intObs)     this._intObs.disconnect();
      if (!restorePlayback) rememberDetachedSpeed(this.video, this.userSpeed);
      if (restorePlayback) restoreMediaPlaybackRate(this.video);
      const d = audioMap.get(this.video);
      if (d) this._disposeSilenceContext(d);
      ctrlMap.delete(this.video);
      const idx = ctrlList.indexOf(this);
      if (idx > -1) ctrlList.splice(idx, 1);
      syncBadgeToActiveController();
    }
  }

  /* ── Attach to a media element ──────────────────────────────────── */
  function attach(el, { scheduleSync = true, syncMode = 'animation' } = {}) {
    if (!S.enabled) return;
    if (ctrlMap.has(el)) return;
    if (getSiteRuleMatch()?.rule?.disabled) return;
    if (el.tagName === 'AUDIO' && S.controlAudio === false) return;
    if (el.tagName === 'VIDEO' && shouldIgnoreVideo(el)) return;

    if (el.tagName === 'VIDEO' && el.readyState < 2 && (el.currentSrc || el.src)) {
      if (pendingAttach.has(el)) return;
      pendingAttach.add(el);
      const retry = () => {
        pendingAttach.delete(el);
        attach(el, { syncMode: preferredOverlaySyncMode(el) });
      };
      el.addEventListener('loadeddata', retry, { once: true });
      el.addEventListener('canplay', retry, { once: true });
      return;
    }

    if (el.tagName === 'VIDEO' && !isQualifiedVideo(el)) {
      if (pendingAttach.has(el)) return;
      pendingAttach.add(el);
      // Watch for the video to become qualified (size or src loads)
      const retry = () => {
        if (!el.isConnected) { pendingAttach.delete(el); return; }
        if (isQualifiedVideo(el)) {
          pendingAttach.delete(el);
          attach(el, { syncMode: preferredOverlaySyncMode(el) });
        }
      };
      el.addEventListener('loadedmetadata', retry, { once: true });
      el.addEventListener('play',           retry, { once: true });
      if ('ResizeObserver' in window) {
        const ro = new ResizeObserver(() => {
          if (!el.isConnected) {
            ro.disconnect();
            pendingAttach.delete(el);
            return;
          }
          if (isQualifiedVideo(el)) {
            ro.disconnect();
            pendingAttach.delete(el);
            attach(el, { syncMode: preferredOverlaySyncMode(el) });
          }
        });
        ro.observe(el);
      }
      return;
    }

    pendingAttach.delete(el);
    const ctrl = new VelocityController(el, { initialSpeed: resolveInitialControllerSpeed(el) });
    ctrlMap.set(el, ctrl);
    ctrlList.push(ctrl);
    syncBadgeToActiveController();
    if (S.silenceSkip) ctrl.initSilence({ fromGesture: hadRecentPageGesture() });
    if (scheduleSync) scheduleOverlayOwnershipSync(false, preferredOverlaySyncMode(el, syncMode));
    return true;
  }

  function detach(el, { scheduleSync = true, syncMode = 'animation' } = {}) {
    pendingAttach.delete(el);
    const ctrl = ctrlMap.get(el);
    if (ctrl) ctrl.destroy();
    if (ctrl && scheduleSync) scheduleOverlayOwnershipSync(false, syncMode);
    return !!ctrl;
  }

  function cleanupOrphanOverlays() {
    document.querySelectorAll('[data-vx="1"]').forEach(host => {
      const owner = host._vxController;
      if (!owner) {
        host.remove();
        return;
      }
      if (owner.overlay !== host) {
        host.remove();
        return;
      }
      const expectedContainer = owner._getOverlayContainer?.();
      if (!owner.video?.isConnected || !expectedContainer || host.parentElement !== expectedContainer) {
        try { owner._destroyOverlay(true); } catch (_) { host.remove(); }
      }
    });
  }

  function controllerOverlayScore(ctrl) {
    if (!ctrl || ctrl.isAudio || !S.showOverlay) return -1;
    const video = ctrl.video;
    if (!video?.isConnected) return -1;
    if (shouldIgnoreVideo(video) || !isQualifiedVideo(video)) return -1;
    const container = ctrl._getOverlayContainer?.();
    if (!container) return -1;
    const rect = video.getBoundingClientRect();
    const visibleArea = getVisibleViewportArea(rect);
    const primaryViewportVideo = isPrimaryViewportVideo(video, rect);
    const viewportManagedVideo = isYouTubeShortsPage() || isViewportManagedSocialVideo(video, rect);
    if (document.pictureInPictureElement !== video && !primaryViewportVideo) {
      const warmViewportCandidate =
        viewportManagedVideo &&
        visibleArea > 0 &&
        (
          !!ctrl.overlay ||
          (!video.paused && !video.ended) ||
          ctrl._hasRecentPlaybackSignal?.(4000)
        );
      if (!warmViewportCandidate) return -1;
    }
    if (visibleArea <= 0 && (video.paused || video.ended)) return -1;
    let score = visibleArea;
    if (document.pictureInPictureElement === video) score += 1_000_000_000;
    if (!video.paused && !video.ended) score += 2_000_000_000;
    try {
      if (shouldUseHoverPriority(video) && ctrl._isHovered()) score += 4_000_000_000;
    } catch (_) {}
    return score;
  }

  function preferredOverlayController() {
    let best = null;
    let bestScore = -1;
    ctrlList.forEach(ctrl => {
      const score = controllerOverlayScore(ctrl);
      if (score > bestScore) {
        best = ctrl;
        bestScore = score;
      }
    });
    return best;
  }

  function syncOverlayOwnership(forceRebuild = false) {
    cleanupOrphanOverlays();
    const preferred = preferredOverlayController();
    ctrlList.slice().forEach(ctrl => {
      try {
        if (ctrl === preferred) ctrl._ensureOverlay(forceRebuild);
        else if (ctrl.overlay) ctrl._destroyOverlay(true);
      } catch (_) {}
    });
    syncBadgeToActiveController();
    return preferred;
  }

  function activeCtrl() {
    for (const c of ctrlList) {
      try {
        if (shouldUseHoverPriority(c.video) && c._isHovered()) return c;
      } catch (_) {}
    }
    return preferredOverlayController() || ctrlList[ctrlList.length - 1] || null;
  }

  function shouldSyncControllerSpeedState(ctrl) {
    if (!ctrl) return false;
    if (!ctrlList.includes(ctrl)) return ctrlList.length === 0 || !activeCtrl();
    const current = activeCtrl();
    return !current || current === ctrl;
  }

  function syncBadgeToActiveController() {
    const ctrl = activeCtrl();
    if (ctrl) updateBadge(ctrl.userSpeed);
    else clearBadge();
    return ctrl;
  }

  function scanShadowDOM({ scheduleSync = true, syncMode = 'animation' } = {}) {
    let changed = false;
    findInShadow(document.documentElement, 'video,audio').forEach(el => {
      if (attach(el, { scheduleSync: false })) changed = true;
    });
    if (changed && scheduleSync) scheduleOverlayOwnershipSync(false, syncMode);
    return changed;
  }

  function settingsSnapshotDiffers(next = {}, prev = {}) {
    return Object.keys(next || {}).some(key => JSON.stringify(next[key]) !== JSON.stringify(prev[key]));
  }

  function applyBootstrapSettings(stored = {}, { refresh = false } = {}) {
    if (!contextActive) return;
    const prev = S;
    S = mergeSettings(S, { ...stored, overlayOffsets: {} });
    setDebugToolsEnabled();
    syncSiteControllerCSS();

    if (!refresh) return;
    if (!S.enabled) {
      dispatchEarlyControl({ type: 'DISABLE' });
      ctrlList.slice().forEach(c => c.destroy({ restorePlayback: true }));
      clearBadge();
      return;
    }

    ctrlList.slice().forEach(c => c.refreshSettings(prev));
    document.querySelectorAll('video, audio').forEach(el => {
      attach(el, { scheduleSync: false });
    });
    scanShadowDOM({ scheduleSync: false });
    scheduleOverlayOwnershipSync(true, 'animation');
  }

  function refreshUrlScopedSpeed(callback) {
    if (!contextActive) return;
    const prev = mergeSettings(S);
    const urlKey = getUrlSpeedKey();
    const finish = () => {
      if (!contextActive) return;
      ctrlList.slice().forEach(c => c.refreshSettings(prev));
      callback?.();
    };

    if (!urlKey) {
      finish();
      return;
    }

    chrome.storage.local.get([urlKey], stored => {
      if (!contextActive) return;
      if (chrome.runtime.lastError) {
        if (isInvalidatedError(chrome.runtime.lastError)) deactivateContext();
        return;
      }

      if (Object.prototype.hasOwnProperty.call(stored || {}, urlKey)) S[urlKey] = stored[urlKey];
      else delete S[urlKey];
      finish();
    });
  }

  function bootstrapControllerContext(stored = {}) {
    if (!contextActive) return;
    applyBootstrapSettings(stored);

    document.querySelectorAll('video, audio').forEach(el => {
      attach(el, { scheduleSync: false });
    });
    scanShadowDOM({ scheduleSync: false });
    flushOverlayOwnershipSync();

    _mutationObs = new MutationObserver(ms => {
      if (!contextActive) return;
      queuePendingMutations(ms);
    });
    _mutationObs.observe(document.documentElement, { childList: true, subtree: true });

    // YouTube SPA navigation handler
    if (location.hostname === 'www.youtube.com') {
      document.addEventListener('yt-navigate-finish', () => {
        if (!contextActive) return;
        // Re-scan for videos after YouTube SPA navigation
        setTimeout(() => {
          refreshUrlScopedSpeed(() => {
            document.querySelectorAll('video, audio').forEach(el => {
              if (!ctrlMap.has(el)) attach(el, { scheduleSync: false });
            });
            scanShadowDOM({ scheduleSync: false });
            ctrlList.forEach(c => {
              try { c.handlePageNavigation(); } catch (_) {}
              try {
                if (isLikelyActiveShortsVideo(c.video) && S.showOverlay) c._queuePlaybackReveal?.(2400);
              } catch (_) {}
            });
            scheduleOverlayOwnershipSync(true, isYouTubeShortsPage() ? 'immediate' : 'animation');
          });
        }, 300);
      }, true);

      document.addEventListener('yt-page-data-updated', () => {
        if (!contextActive) return;
        // Update active Shorts video detection after page data changes
        ctrlList.forEach(c => {
          try {
            const newActive = isLikelyActiveShortsVideo(c.video);
            if (!newActive && c.overlay) {
              c._destroyOverlay(true);
            } else if (newActive && S.showOverlay) {
              if (!c.overlay) c._ensureOverlay(true);
              c._queuePlaybackReveal?.(2400);
            }
          } catch (_) {}
        });
        scheduleOverlayOwnershipSync(true, isYouTubeShortsPage() ? 'immediate' : 'animation');
      }, true);
    }

    // Generic SPA navigation handler for all non-YouTube sites
    if (location.hostname !== 'www.youtube.com') {
      const _spaNavHandler = () => {
        if (!contextActive) return;
        setTimeout(() => {
          refreshUrlScopedSpeed(() => {
            document.querySelectorAll('video, audio').forEach(el => {
              if (!ctrlMap.has(el)) attach(el, { scheduleSync: false });
            });
            scanShadowDOM({ scheduleSync: false });
            ctrlList.forEach(c => {
              try { c.handlePageNavigation(); } catch (_) {}
            });
            scheduleOverlayOwnershipSync(true, 'animation');
          });
        }, 400);
      };
      window.addEventListener('popstate', _spaNavHandler);
      window.addEventListener('hashchange', _spaNavHandler);
    }

    // Periodic re-scan for dynamically loaded media (social media feeds, infinite scroll)
    let _periodicScanTimer = setInterval(() => {
      if (!contextActive) { clearInterval(_periodicScanTimer); return; }
      let changed = false;
      document.querySelectorAll('video, audio').forEach(el => {
        if (!ctrlMap.has(el) && !pendingAttach.has(el)) {
          if (attach(el, { scheduleSync: false })) changed = true;
        }
      });
      if (scanShadowDOM({ scheduleSync: false })) changed = true;
      if (changed) scheduleOverlayOwnershipSync(false, 'idle');
    }, 3000);

    _mediaDiscoveryHandler = event => {
      if (!contextActive) return;
      const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
      const media = path.find(node => node && (node.tagName === 'VIDEO' || node.tagName === 'AUDIO'));
      if (!media) return;
      const ctrl = ctrlMap.get(media);
      if (ctrl) {
        if (shouldUseImmediateOverlaySync(media)) {
          ctrl._queuePlaybackReveal?.(2400);
          scheduleOverlayOwnershipSync(false, 'immediate');
        }
        return;
      }
      attach(media, { syncMode: preferredOverlaySyncMode(media) });
    };
    MEDIA_DISCOVERY_EVENTS.forEach(ev => document.addEventListener(ev, _mediaDiscoveryHandler, true));
    _pageGestureHandler = event => {
      notePageGesture(event);
      startPendingSilenceSkip(event);
    };
    PAGE_GESTURE_EVENTS.forEach(type => document.addEventListener(type, _pageGestureHandler, true));
    dispatchEarlyControl({ type: 'TEARDOWN' });
  }

  /* ── Bootstrap ──────────────────────────────────────────────────── */
  const bootstrapLocalKeys = [...Object.keys(D)];
  const bootstrapUrlKey = getUrlSpeedKey();
  if (bootstrapUrlKey) bootstrapLocalKeys.push(bootstrapUrlKey);

  chrome.storage.local.get(bootstrapLocalKeys, localStored => {
    if (!contextActive) return;
    if (chrome.runtime.lastError) {
      if (isInvalidatedError(chrome.runtime.lastError)) deactivateContext();
      return;
    }

    const initialStored = { ...D, ...(localStored || {}) };
    bootstrapControllerContext(initialStored);

    const syncQuery = getSyncQuery(D);
    if (!syncQuery) return;
    chrome.storage.sync.get(syncQuery, syncStored => {
      if (!contextActive) return;
      if (chrome.runtime.lastError) {
        if (isInvalidatedError(chrome.runtime.lastError)) deactivateContext();
        return;
      }

      const nextStored = { ...initialStored, ...(syncStored || {}) };
      if (!settingsSnapshotDiffers(syncStored || {}, initialStored)) return;
      applyBootstrapSettings(nextStored, { refresh: true });
    });
  });

  /* ── Message listener ───────────────────────────────────────────── */
  chrome.runtime.onMessage.addListener((msg, _, respond) => {
    if (!contextActive) return;
    const ac = activeCtrl();

    if (msg.type === 'SET_SPEED')    { dispatchEarlyControl({ type: 'SET_SPEED', speed: msg.speed }); ctrlList.forEach(c => c.applySpeed(msg.speed, msg.save !== false)); respond({ ok: true }); return true; }
    if (msg.type === 'ADJUST_SPEED') { ctrlList.forEach(c => c.adjust(msg.delta));     respond({ ok: true }); return true; }
    if (msg.type === 'SETTINGS_UPDATE') {
      const prev = S;
      S = mergeSettings(S, msg.settings || {});
      setDebugToolsEnabled();
      syncSiteControllerCSS();
      if (!S.enabled) {
        dispatchEarlyControl({ type: 'DISABLE' });
        ctrlList.slice().forEach(c => c.destroy({ restorePlayback: true }));
        clearBadge();
        respond({ ok: true }); return true;
      }
      ctrlList.slice().forEach(c => c.refreshSettings(prev));
      document.querySelectorAll('video, audio').forEach(el => {
        attach(el, { scheduleSync: false });
      });
      scanShadowDOM({ scheduleSync: false });
      scheduleOverlayOwnershipSync(true, 'animation');
      respond({ ok: true }); return true;
    }
    if (msg.type === 'RESET_OVERLAY_STATE') {
      S = mergeSettings(S, { overlayOffsets: {}, overlayHiddenStates: {}, overlayRestoreCorners: {} });
      ctrlList.slice().forEach(c => {
        try { c.resetOverlayState(); } catch (_) {}
      });
      respond({ ok: true }); return true;
    }
    if (msg.type === 'SYNC_BADGE') {
      syncBadgeToActiveController();
      return;
    }
    if (msg.type === 'GET_SPEED')    { respond({ speed: ctrlList[ctrlList.length-1]?.userSpeed ?? 1.0 }); return true; }
    if (msg.type === 'GET_STATE')    {
      const mediaState = getPopupMediaState(ac);
      if (ac) respond({
        ok: true,
        speed: ac.userSpeed,
        loopActive: ac.loopActive,
        loopSeconds: clampLoopSeconds(S.loopSeconds),
        actualLoopSeconds: r2(ac._loopLen || 0),
        loopStart: r2(ac._loopStart || 0),
        loopEnd: r2(ac._loopEnd || 0),
        ...mediaState
      });
      else {
        // Let child frames with active media reply first so popup state does not
        // snap back to "no media" on embedded/iframe players.
        if (window.top !== window) return false;
        setTimeout(() => {
          try {
            respond({
              ok: false,
              speed: ctrlList[ctrlList.length-1]?.userSpeed ?? 1.0,
              loopActive: false,
              loopSeconds: clampLoopSeconds(S.loopSeconds),
              ...mediaState
            });
          } catch (_) {}
        }, CROSS_FRAME_RESPONSE_GRACE_MS);
      }
      return true;
    }
    if (msg.type === 'GET_DEBUG_SNAPSHOT') { respond(getDebugSnapshot()); return true; }
    if (msg.type === 'TOGGLE_LOOP')  {
      const requestedLoopSeconds = clampLoopSeconds(msg.loopSeconds ?? S.loopSeconds);
      if (requestedLoopSeconds !== clampLoopSeconds(S.loopSeconds)) {
        S = mergeSettings(S, { loopSeconds: requestedLoopSeconds });
        ctrlList.forEach(ctrl => {
          try {
            if (ctrl.loopActive) ctrl.updateLoopWindow?.(requestedLoopSeconds);
            else ctrl._syncLoopButton?.();
          } catch (_) {}
        });
      }
      respond(ac ? ac.toggleLoop(requestedLoopSeconds) : { ok: false, loopActive: false, loopSeconds: requestedLoopSeconds, message: 'Open a playing video first.' });
      return true;
    }
    if (msg.type === 'SET_AB')       { if (ac) ac.setABPoint(msg.point); respond({ ok: true }); return true; }
    if (msg.type === 'CLEAR_AB')     { if (ac) ac._clearAB(true);        respond({ ok: true }); return true; }
    if (msg.type === 'SET_MARK')     { if (ac) ac.setMark();             respond({ ok: true }); return true; }
    if (msg.type === 'JUMP_TO_MARK') { if (ac) ac.jumpToMark();          respond({ ok: true }); return true; }
    if (msg.type === 'CLEAR_MARK')   { if (ac) ac.clearMark();           respond({ ok: true }); return true; }
  });

  /* ── Keyboard shortcuts ─────────────────────────────────────────── */
  function shortcutMatchesEvent(binding, event) {
    return !!binding &&
      binding.code === event.code &&
      !!binding.ctrlKey === !!event.ctrlKey &&
      !!binding.altKey === !!event.altKey &&
      !!binding.shiftKey === !!event.shiftKey &&
      !!binding.metaKey === !!event.metaKey;
  }

  function runShortcutAction(action, ctrl) {
    if (!ctrl) return false;
    switch (action) {
      case 'increaseSpeed': ctrl.adjust(getSpeedStep()); return true;
      case 'decreaseSpeed': ctrl.adjust(-getSpeedStep()); return true;
      case 'resetSpeed': ctrl.applySpeed(1.0); return true;
      case 'skipForward': ctrl.video.currentTime += (S.skipSeconds || 10); return true;
      case 'skipBackward': ctrl.video.currentTime -= (S.skipSeconds || 10); return true;
      case 'toggleOverlay': ctrl.toggleOverlayVisibility(); return true;
      case 'volumeUp': ctrl._adjustVolume(0.1); return true;
      case 'volumeDown': ctrl._adjustVolume(-0.1); return true;
      case 'togglePiP': ctrl._togglePiP(); return true;
      case 'preset1':
        ctrl.applySpeed(ctrl.userSpeed === (S.preset1Speed || 1.8) ? 1.0 : (S.preset1Speed || 1.8));
        return true;
      case 'preset2':
        ctrl.applySpeed(ctrl.userSpeed === (S.preset2Speed || 1.25) ? 1.0 : (S.preset2Speed || 1.25));
        return true;
      case 'preset3':
        ctrl.applySpeed(ctrl.userSpeed === (S.preset3Speed || 2.5) ? 1.0 : (S.preset3Speed || 2.5));
        return true;
      case 'toggleLoop': ctrl.toggleLoop(); return true;
      case 'setMark': ctrl.setMark(); return true;
      case 'jumpToMark': ctrl.jumpToMark(); return true;
      case 'clearMark': ctrl.clearMark(); return true;
      case 'setABStart': ctrl.setABPoint('a'); return true;
      case 'setABEnd': ctrl.setABPoint('b'); return true;
      case 'clearABLoop': ctrl._clearAB(true); return true;
      case 'togglePlayPause':
        if (ctrl.video.paused) ctrl.video.play().catch(() => {});
        else ctrl.video.pause();
        return true;
      case 'toggleMute':
        ctrl.video.muted = !ctrl.video.muted;
        ctrl._announce(ctrl.video.muted ? 'Muted' : 'Unmuted', 1200);
        return true;
      default:
        return false;
    }
  }

  _keydownHandler = e => {
    if (!contextActive) return;
    if (e.isComposing || e.keyCode === 229) return;
    if (eventHasTypingContext(e)) return;

    const ctrl = activeCtrl();
    if (!ctrl) return;

    const consumeShortcutEvent = () => {
      e.preventDefault();
      if (S.exclusiveKeys) {
        e.stopPropagation();
        e.stopImmediatePropagation?.();
      }
    };

    const binding = allShortcutBindings(S).find(item => shortcutMatchesEvent(item, e));
    if (!binding) return;

    if (runShortcutAction(binding.action, ctrl)) consumeShortcutEvent();
  };
  document.addEventListener('keydown', _keydownHandler, true);

  /* ── Mouse wheel speed (Shift + scroll) ─────────────────────────── */
  _wheelHandler = e => {
    if (!contextActive || !S.mouseWheel || !e.shiftKey) return;
    const ctrl =
      ctrlList.find(c => {
        try { return shouldUseHoverPriority(c.video) && c._isHovered(); }
        catch (_) { return false; }
      }) || activeCtrl();
    if (!ctrl) return;
    const wStep = getWheelStep();
    ctrl.adjust(e.deltaY < 0 ? wStep : -wStep);
    e.preventDefault();
  };
  document.addEventListener('wheel', _wheelHandler, { passive: false });

})();
