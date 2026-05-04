/* VelocityX v1.0.0 – background.js (Service Worker)
   ═══════════════════════════════════════════════════
   Features:
   ✦ Reinject content scripts on install/update
   ✦ Weekly stats auto-reset
   ✦ Session counter
   ✦ Speed distribution tracking (speedDist)
   ✦ Badge speed display per tab
   ✦ Multi-preset speed defaults (preset1, preset2, preset3)
*/

importScripts('shared/settings-defaults.js');

const Settings = globalThis.VelocityXSettings || {};
const DEFAULT_OVERLAY_CONTROLS = { ...(Settings.DEFAULT_OVERLAY_CONTROLS || {}) };
const PREVIOUS_OVERLAY_CONTROLS_V4 = { ...(Settings.PREVIOUS_OVERLAY_CONTROLS_V4 || {}) };
const PREVIOUS_OVERLAY_CONTROLS_V3 = { ...(Settings.PREVIOUS_OVERLAY_CONTROLS_V3 || {}) };
const SETTINGS_DEFAULTS = {
  ...(Settings.SETTINGS_DEFAULTS || {}),
  overlayControls: { ...((Settings.SETTINGS_DEFAULTS || {}).overlayControls || DEFAULT_OVERLAY_CONTROLS) }
};
const LOCAL_DEFAULTS = { ...(Settings.LOCAL_DEFAULTS || {}) };
const DEFAULTS = { ...SETTINGS_DEFAULTS, ...LOCAL_DEFAULTS };
const SETTINGS_KEY_SET = new Set(Settings.SYNC_SETTINGS_KEYS || Object.keys(SETTINGS_DEFAULTS));
const OVERLAY_DEFAULTS_VERSION = Settings.OVERLAY_DEFAULTS_VERSION || SETTINGS_DEFAULTS.overlayDefaultsVersion || 6;

function matchesOverlayControls(controls = {}, preset = {}) {
  const merged = { ...(preset || {}), ...(controls || {}) };
  return Object.keys(preset || {}).every(key => merged[key] === preset[key]);
}

function normalizeOverlayControls(controls = {}) {
  const merged = Object.fromEntries(
    Object.keys(DEFAULT_OVERLAY_CONTROLS).map(key => [key, controls?.[key] ?? DEFAULT_OVERLAY_CONTROLS[key]])
  );
  if (!Object.values(merged).some(Boolean)) merged.speed = true;
  return merged;
}

function hasOverlayControlShapeDiff(controls = {}) {
  const existingKeys = Object.keys(controls || {});
  const defaultKeys = Object.keys(DEFAULT_OVERLAY_CONTROLS);
  return existingKeys.some(key => !(key in DEFAULT_OVERLAY_CONTROLS)) ||
    defaultKeys.some(key => !Object.prototype.hasOwnProperty.call(controls || {}, key));
}

const EXCLUDED_PREFIXES = [
  'https://meet.google.com/',
  'https://hangouts.google.com/'
];

const ACTION_ICON_PATHS = {
  enabled: {
    16: 'icons/icon16.png',
    24: 'icons/icon24.png',
    32: 'icons/icon32.png',
    48: 'icons/icon48.png'
  },
  disabled: {
    16: 'icons/icon16_disabled.png',
    24: 'icons/icon24_disabled.png',
    32: 'icons/icon32_disabled.png',
    48: 'icons/icon48_disabled.png'
  }
};
const DEVTOOLS_SNAPSHOT_KEYS = [
  ...Object.keys(DEFAULTS),
  'installTime',
  'weekStart'
];

/* ── Default management ─────────────────────────────────────────────── */
function getMissingDefaults(existing, defaults) {
  const out = {};
  for (const [k, v] of Object.entries(defaults)) {
    if (k === 'defaultSpeed') {
      if (!(k in existing)) out[k] = existing.speed ?? v;
      continue;
    }
    if (!(k in existing)) out[k] = v;
  }
  return out;
}

function getMissingSettingDefaults(existing) {
  const out = getMissingDefaults(existing, SETTINGS_DEFAULTS);
  if (hasOverlayControlShapeDiff(existing.overlayControls)) {
    out.overlayControls = normalizeOverlayControls(existing.overlayControls);
  }
  if ((existing.overlayDefaultsVersion ?? 0) < OVERLAY_DEFAULTS_VERSION) {
    out.overlayDefaultsVersion = OVERLAY_DEFAULTS_VERSION;
    if (
      matchesOverlayControls(existing.overlayControls, PREVIOUS_OVERLAY_CONTROLS_V4) ||
      matchesOverlayControls(existing.overlayControls, PREVIOUS_OVERLAY_CONTROLS_V3)
    ) {
      out.overlayControls = { ...DEFAULT_OVERLAY_CONTROLS };
    }
  }
  return out;
}

function getMissingLocalDefaults(existing) {
  const out = getMissingDefaults(existing, LOCAL_DEFAULTS);
  if (!existing.installTime) out.installTime = Date.now();
  if (!existing.weekStart)   out.weekStart   = Date.now();
  return out;
}

function getSyncQuery(keys) {
  if (keys == null) return null;
  if (typeof keys === 'string') return SETTINGS_KEY_SET.has(keys) ? keys : null;
  if (Array.isArray(keys)) {
    const syncKeys = keys.filter(key => SETTINGS_KEY_SET.has(key));
    return syncKeys.length ? syncKeys : null;
  }
  if (typeof keys === 'object') {
    const syncDefaults = {};
    Object.keys(keys).forEach(key => {
      if (SETTINGS_KEY_SET.has(key)) syncDefaults[key] = keys[key];
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

function migrateLocalSettingsToSync(callback) {
  chrome.storage.sync.get(Object.keys(SETTINGS_DEFAULTS), syncExisting => {
    chrome.storage.local.get(Object.keys(SETTINGS_DEFAULTS), localExisting => {
      const missing = {};
      Object.keys(SETTINGS_DEFAULTS).forEach(key => {
        if (syncExisting[key] === undefined && localExisting[key] !== undefined) {
          missing[key] = localExisting[key];
        }
      });
      if (!Object.keys(missing).length) {
        callback?.();
        return;
      }
      chrome.storage.sync.set(missing, () => {
        if (chrome.runtime.lastError) {
          console.warn('[VelocityX] Failed to migrate settings to chrome.storage.sync.', chrome.runtime.lastError.message);
        }
        callback?.();
      });
    });
  });
}

function ensureDefaults(cb) {
  migrateLocalSettingsToSync(() => {
    chrome.storage.local.get(null, localExisting => {
      chrome.storage.sync.get(null, syncExisting => {
        const mergedExisting = { ...(localExisting || {}), ...(syncExisting || {}) };
        const missingLocal = getMissingLocalDefaults(localExisting || {});
        const missingSettings = getMissingSettingDefaults(mergedExisting);
        let pending = 0;
        const done = () => {
          pending--;
          if (pending <= 0) cb?.();
        };

        if (Object.keys(missingLocal).length) {
          pending++;
          chrome.storage.local.set(missingLocal, done);
        }

        if (Object.keys(missingSettings).length) {
          pending++;
          chrome.storage.sync.set(missingSettings, () => {
            if (chrome.runtime.lastError) {
              console.warn('[VelocityX] Failed to write default settings to chrome.storage.sync.', chrome.runtime.lastError.message);
            }
            done();
          });
        }

        if (!pending) cb?.();
      });
    });
  });
}

function getActionIconPaths(enabled) {
  return enabled ? ACTION_ICON_PATHS.enabled : ACTION_ICON_PATHS.disabled;
}

async function updateActionIcon(enabled) {
  const path = getActionIconPaths(enabled);
  try {
    await chrome.action.setIcon({ path });
  } catch (err) {
    console.warn('[VelocityX] Failed to update action icon.', { enabled, path, err });
    if (enabled) return;
    try {
      await chrome.action.setIcon({ path: ACTION_ICON_PATHS.enabled });
    } catch (_) {}
  }
}

function syncActionIcon() {
  getMergedStorage('enabled', d => {
    updateActionIcon(d.enabled !== false);
  });
}

/* ── Injectable URL check ───────────────────────────────────────────── */
function isInjectableUrl(url = '') {
  if (!url) return false;
  if (!/^https?:\/\/|^file:\/\//.test(url)) return false;
  return !EXCLUDED_PREFIXES.some(p => url.startsWith(p));
}

/* ── Reinject content scripts into existing tabs ────────────────────── */
function reinjectContentScripts() {
  if (!chrome.scripting?.executeScript) return;
  chrome.tabs.query({}, tabs => {
    for (const tab of tabs) {
      if (!tab.id || !isInjectableUrl(tab.url)) continue;
      chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        files: ['shared/settings-defaults.js', 'shared/site-rule-engine.js', 'content-bridge.js']
      }).catch(() => {});
      chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        files: ['inject.js'],
        world: 'MAIN'
      }).catch(() => {});
      chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        files: ['shared/settings-defaults.js', 'shared/site-rule-engine.js', 'content.js']
      }).catch(() => {});
    }
  });
}

/* ── Weekly stats reset ─────────────────────────────────────────────── */
function checkWeeklyReset() {
  chrome.storage.local.get(['weekStart', 'weekTimeSaved'], d => {
    const now   = Date.now();
    const weekMs = 7 * 24 * 3600 * 1000;
    if (now - (d.weekStart || 0) > weekMs) {
      chrome.storage.local.set({ weekTimeSaved: 0, weekStart: now });
    }
  });
}

/* ── Session counter ────────────────────────────────────────────────── */
function incrementSessions() {
  chrome.storage.local.get('totalSessions', d => {
    chrome.storage.local.set({ totalSessions: (d.totalSessions || 0) + 1 });
  });
}

/* ── Speed distribution tracker ─────────────────────────────────────── */
function recordSpeedDist(speed, seconds) {
  const rate = Number(speed);
  const duration = seconds == null ? 2 : Number(seconds);
  if (!Number.isFinite(rate) || rate <= 0 || !Number.isFinite(duration) || duration <= 0) return;
  const bucket = parseFloat(rate.toFixed(2));
  chrome.storage.local.get('speedDist', d => {
    const dist = d.speedDist || {};
    dist[bucket] = Math.round(((dist[bucket] || 0) + duration) * 100) / 100;
    chrome.storage.local.set({ speedDist: dist });
  });
}

function broadcastSettingsUpdate(settings) {
  if (!settings || !Object.keys(settings).length) return;
  chrome.tabs.query({}, tabs => {
    tabs.forEach(tab => {
      if (tab.id) chrome.tabs.sendMessage(tab.id, { type: 'SETTINGS_UPDATE', settings }).catch(() => {});
    });
  });
}

function getDevtoolsSnapshot(tabId, callback) {
  if (!tabId) {
    callback({ error: 'No inspected tab id was provided.' });
    return;
  }

  getMergedStorage(DEVTOOLS_SNAPSHOT_KEYS, settings => {
    chrome.tabs.sendMessage(tabId, { type: 'GET_DEBUG_SNAPSHOT' }, page => {
      const lastError = chrome.runtime.lastError?.message || null;
      callback({
        capturedAt: new Date().toISOString(),
        tabId,
        error: lastError,
        settings,
        page: page || null
      });
    });
  });
}

function syncEnabledState(enabled) {
  updateActionIcon(enabled);
  if (!enabled) {
    chrome.tabs.query({}, tabs => {
      tabs.forEach(tab => {
        if (tab.id) setBadge(tab.id, null);
      });
    });
    return;
  }
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    const tabId = tabs[0]?.id;
    if (tabId) chrome.tabs.sendMessage(tabId, { type: 'SYNC_BADGE' }).catch(() => {});
  });
}

/* ── Badge helper ───────────────────────────────────────────────────── */
function setBadge(tabId, speed) {
  const text = (!speed || speed === 1.0)
    ? ''
    : (speed.toFixed(2).replace(/\.?0+$/, '') + '×');
  try {
    chrome.action.setBadgeText({ text, tabId });
    chrome.action.setBadgeBackgroundColor({ color: '#6f8cff', tabId });
  } catch (_) {}
}

/* ── Lifecycle events ───────────────────────────────────────────────── */
chrome.runtime.onInstalled.addListener(() => {
  ensureDefaults(() => {
    checkWeeklyReset();
    syncActionIcon();
    reinjectContentScripts();
  });
});

chrome.runtime.onStartup.addListener(() => {
  ensureDefaults(() => {
    syncActionIcon();
    reinjectContentScripts();
  });
  checkWeeklyReset();
  incrementSessions();
});

syncActionIcon();

/* ── Message handler ────────────────────────────────────────────────── */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'OPEN_OPTIONS') {
    chrome.runtime.openOptionsPage();
    return;
  }

  if (msg.type === 'RECORD_SPEED_DIST') {
    recordSpeedDist(msg.speed, msg.seconds);
    return;
  }

  if (msg.type === 'DEVTOOLS_GET_SNAPSHOT') {
    getDevtoolsSnapshot(msg.tabId, snapshot => sendResponse(snapshot));
    return true;
  }

  const tabId = sender?.tab?.id;
  if (!tabId) return;

  if (msg.type === 'UPDATE_BADGE') {
    setBadge(tabId, msg.speed);
    return;
  }

  if (msg.type === 'CLEAR_BADGE') {
    setBadge(tabId, null);
  }
});

/* ── Tab activation / update → sync badge ───────────────────────────── */
chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.sendMessage(tabId, { type: 'SYNC_BADGE' }).catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete') {
    chrome.tabs.sendMessage(tabId, { type: 'SYNC_BADGE' }).catch(() => {});
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if ((areaName === 'local' || areaName === 'sync') && changes.enabled) {
    syncEnabledState(changes.enabled.newValue !== false);
  }

  if (areaName !== 'sync') return;
  const settings = {};
  Object.entries(changes).forEach(([key, change]) => {
    if (!SETTINGS_KEY_SET.has(key) || change.newValue === undefined) return;
    settings[key] = change.newValue;
  });
  broadcastSettingsUpdate(settings);
});
