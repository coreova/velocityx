/* VelocityX v1.0.0 - inject.js */
(function () {
  'use strict';

  const root = document.documentElement;
  if (!root) return;
  if (window.__velocityxEarlyInjectLoaded) return;
  window.__velocityxEarlyInjectLoaded = true;

  const REQUEST_EVENT = 'VX_EARLY_REQUEST_SETTINGS';
  const SETTINGS_EVENT = 'VX_EARLY_SETTINGS';
  const CONTROL_EVENT = 'VX_EARLY_CONTROL';
  const MEDIA_EVENTS = ['play', 'playing', 'loadedmetadata', 'loadeddata', 'canplay', 'ratechange'];
  const MIN_SPEED = 0.07;
  const MAX_SPEED = 16;
  const mediaState = new WeakMap();
  let active = true;
  let enabled = false;
  let initialized = false;
  let allowAudio = true;
  let desiredSpeed = 1.0;
  let observer = null;

  function clampSpeed(value, fallback = 1.0) {
    const parsed = Math.round((parseFloat(value) || 0) * 100) / 100;
    return Math.max(MIN_SPEED, Math.min(MAX_SPEED, parsed || fallback));
  }

  function getMediaSelector() {
    return allowAudio ? 'video, audio' : 'video';
  }

  function isMedia(node) {
    return !!node && (node.tagName === 'VIDEO' || (allowAudio && node.tagName === 'AUDIO'));
  }

  function getState(media) {
    let state = mediaState.get(media);
    if (!state) {
      state = { setting: false, timer: null };
      mediaState.set(media, state);
    }
    return state;
  }

  function rememberOwnWrite(media) {
    const state = getState(media);
    state.setting = true;
    clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      state.setting = false;
    }, 160);
  }

  function applySpeed(media) {
    if (!active || !initialized || !enabled || !isMedia(media)) return;

    const target = clampSpeed(desiredSpeed, 1.0);
    const current = Number(media.playbackRate);
    if (Number.isFinite(current) && Math.abs(current - target) <= 0.01) return;

    rememberOwnWrite(media);
    try {
      media.preservesPitch = true;
      media.mozPreservesPitch = true;
      media.playbackRate = target;
    } catch (_) {}
  }

  function applyToNode(node) {
    if (!node || node.nodeType !== 1) return;
    if (isMedia(node)) applySpeed(node);
    node.querySelectorAll?.(getMediaSelector()).forEach(applySpeed);
  }

  function scanDocument() {
    document.querySelectorAll(getMediaSelector()).forEach(applySpeed);
  }

  function handleMediaEvent(event) {
    if (!active || !initialized || !enabled) return;

    const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
    const media = path.find(isMedia);
    if (!media) return;

    const state = getState(media);
    if (event.type === 'ratechange' && state.setting) return;
    applySpeed(media);
  }

  function handleSettings(event) {
    if (!active) return;

    const detail = event.detail;
    if (!detail || typeof detail !== 'object') return;

    initialized = true;
    allowAudio = detail.controlAudio !== false;
    if (detail.abort || detail.enabled === false) {
      enabled = false;
      return;
    }

    enabled = true;
    desiredSpeed = clampSpeed(detail.speed, desiredSpeed);
    scanDocument();
  }

  function teardown() {
    if (!active) return;
    active = false;
    MEDIA_EVENTS.forEach(eventName => document.removeEventListener(eventName, handleMediaEvent, true));
    root.removeEventListener(SETTINGS_EVENT, handleSettings, true);
    root.removeEventListener(CONTROL_EVENT, handleControl, true);
    if (observer) observer.disconnect();
    observer = null;
    try {
      delete window.__velocityxEarlyInjectLoaded;
    } catch (_) {
      window.__velocityxEarlyInjectLoaded = false;
    }
  }

  function handleControl(event) {
    if (!active) return;

    const detail = event.detail || {};
    if (detail.type === 'TEARDOWN') {
      teardown();
      return;
    }

    if (detail.type === 'DISABLE') {
      initialized = true;
      enabled = false;
      return;
    }

    if (detail.type === 'SET_SPEED' && Number.isFinite(Number(detail.speed))) {
      initialized = true;
      enabled = true;
      desiredSpeed = clampSpeed(detail.speed, desiredSpeed);
      scanDocument();
    }
  }

  function startObserver() {
    if (!('MutationObserver' in window)) return;
    observer = new MutationObserver(mutations => {
      if (!active || !initialized || !enabled) return;
      mutations.forEach(mutation => mutation.addedNodes.forEach(applyToNode));
    });
    observer.observe(root, { childList: true, subtree: true });
  }

  root.addEventListener(SETTINGS_EVENT, handleSettings, true);
  root.addEventListener(CONTROL_EVENT, handleControl, true);
  MEDIA_EVENTS.forEach(eventName => document.addEventListener(eventName, handleMediaEvent, true));
  startObserver();

  try {
    root.dispatchEvent(new CustomEvent(REQUEST_EVENT));
  } catch (_) {}
})();
