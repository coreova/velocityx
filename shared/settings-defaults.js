(function (global) {
  'use strict';

  const PREVIOUS_OVERLAY_CONTROLS_V4 = {
    decrease: true,
    speed: true,
    increase: true,
    loop: true,
    ab: true,
    mark: true,
    jump: true,
    pip: true,
    volDown: true,
    volUp: true,
    close: true
  };

  const PREVIOUS_OVERLAY_CONTROLS_V3 = {
    decrease: true,
    speed: true,
    increase: true,
    loop: true,
    ab: false,
    mark: false,
    jump: false,
    pip: true,
    volDown: true,
    volUp: true,
    close: true
  };

  const DEFAULT_OVERLAY_CONTROLS = {
    decrease: true,
    speed: true,
    increase: true,
    loop: true,
    ab: false,
    mark: false,
    jump: false,
    pip: true,
    volDown: false,
    volUp: false,
    close: true
  };

  const OVERLAY_DEFAULTS_VERSION = 6;

  const LEGACY_KEY_DEFAULTS = Object.freeze({
    keyFaster: 'KeyD',
    keySlower: 'KeyS',
    keyReset: 'KeyR',
    keyForward: 'KeyX',
    keyRewind: 'KeyZ',
    keyToggle: 'KeyV',
    keyPiP: 'KeyP',
    keyPreset1: 'KeyG',
    keyPreset2: 'KeyH',
    keyPreset3: 'KeyN',
    keyLoop: 'KeyL',
    keyVolumeDown: 'KeyI',
    keyVolumeUp: 'KeyU',
    keyMark: 'KeyM',
    keyJump: 'KeyJ'
  });

  const DEFAULT_SHORTCUT_BINDINGS = Object.freeze([
    Object.freeze({ action: 'setABStart', code: 'KeyA', shiftKey: true, ctrlKey: false, altKey: false, metaKey: false }),
    Object.freeze({ action: 'setABEnd', code: 'KeyB', shiftKey: true, ctrlKey: false, altKey: false, metaKey: false }),
    Object.freeze({ action: 'clearABLoop', code: 'KeyC', shiftKey: true, ctrlKey: false, altKey: false, metaKey: false }),
    Object.freeze({ action: 'clearMark', code: 'KeyM', shiftKey: true, ctrlKey: false, altKey: false, metaKey: false })
  ]);

  const LEGACY_ACTION_KEYS = Object.freeze({
    increaseSpeed: 'keyFaster',
    decreaseSpeed: 'keySlower',
    resetSpeed: 'keyReset',
    skipForward: 'keyForward',
    skipBackward: 'keyRewind',
    toggleOverlay: 'keyToggle',
    togglePiP: 'keyPiP',
    preset1: 'keyPreset1',
    preset2: 'keyPreset2',
    preset3: 'keyPreset3',
    toggleLoop: 'keyLoop',
    volumeDown: 'keyVolumeDown',
    volumeUp: 'keyVolumeUp',
    setMark: 'keyMark',
    jumpToMark: 'keyJump'
  });

  function getLegacyShortcutCode(settings = {}, key = '') {
    if (Object.prototype.hasOwnProperty.call(settings, key)) {
      return typeof settings[key] === 'string' ? settings[key] : '';
    }
    return LEGACY_KEY_DEFAULTS[key] || '';
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

  function normalizeShortcutBindings(bindings = DEFAULT_SHORTCUT_BINDINGS) {
    return (Array.isArray(bindings) ? bindings : [])
      .map(normalizeShortcutBinding)
      .filter(Boolean);
  }

  function codeToLabel(code, fallback = '') {
    if (!code) return fallback;
    if (code.startsWith('Key')) return code.slice(3);
    if (code.startsWith('Digit')) return code.slice(5);
    if (/^Numpad\d$/.test(code)) return `Num ${code.slice(-1)}`;
    const labels = {
      Space: 'Space',
      ArrowLeft: 'Left',
      ArrowRight: 'Right',
      ArrowUp: 'Up',
      ArrowDown: 'Down',
      Enter: 'Enter',
      Escape: 'Esc',
      Tab: 'Tab',
      Backspace: 'Backspace',
      Delete: 'Delete',
      Equal: '=',
      Minus: '-',
      BracketLeft: '[',
      BracketRight: ']',
      Backslash: '\\',
      Semicolon: ';',
      Quote: "'",
      Comma: ',',
      Period: '.',
      Slash: '/',
      Backquote: '`',
      NumpadAdd: 'Num +',
      NumpadSubtract: 'Num -',
      NumpadMultiply: 'Num *',
      NumpadDivide: 'Num /',
      NumpadDecimal: 'Num .',
      NumpadEnter: 'Num Enter'
    };
    return labels[code] || fallback || code;
  }

  function formatShortcutCombo(binding = {}, fallback = '') {
    if (!binding?.code) return fallback;
    const parts = [];
    if (binding.ctrlKey) parts.push('Ctrl');
    if (binding.altKey) parts.push('Alt');
    if (binding.shiftKey) parts.push('Shift');
    if (binding.metaKey) parts.push('Meta');
    parts.push(codeToLabel(binding.code, binding.code));
    return parts.join('+');
  }

  function getLegacyShortcutBindings(settings = {}) {
    return Object.entries(LEGACY_ACTION_KEYS)
      .map(([action, key]) => {
        const code = getLegacyShortcutCode(settings, key);
        if (!code) return null;
        return { action, code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false };
      })
      .filter(Boolean);
  }

  function getCustomShortcutBindings(settings = {}) {
    return normalizeShortcutBindings(settings.shortcutBindings || DEFAULT_SHORTCUT_BINDINGS);
  }

  function getAllShortcutBindings(settings = {}) {
    return [...getLegacyShortcutBindings(settings), ...getCustomShortcutBindings(settings)];
  }

  function getActionBindings(settings = {}, action = '') {
    const seen = new Set();
    return getAllShortcutBindings(settings)
      .filter(binding => binding.action === action)
      .filter(binding => {
        const signature = [
          binding.code,
          binding.ctrlKey ? '1' : '0',
          binding.altKey ? '1' : '0',
          binding.shiftKey ? '1' : '0',
          binding.metaKey ? '1' : '0'
        ].join('|');
        if (seen.has(signature)) return false;
        seen.add(signature);
        return true;
      });
  }

  function getPrimaryActionBinding(settings = {}, action = '') {
    return getActionBindings(settings, action)[0] || null;
  }

  function getPrimaryActionShortcut(settings = {}, action = '', fallback = '') {
    return formatShortcutCombo(getPrimaryActionBinding(settings, action), fallback);
  }

  function formatActionShortcuts(settings = {}, action = '', options = {}) {
    const separator = options.separator || ' or ';
    const fallback = options.empty || '';
    const labels = getActionBindings(settings, action)
      .map(binding => formatShortcutCombo(binding))
      .filter(Boolean);
    return labels.length ? labels.join(separator) : fallback;
  }

  function withShortcutLabel(label, settings = {}, action = '', options = {}) {
    const suffix = formatActionShortcuts(settings, action, { ...options, empty: '' });
    return suffix ? `${label} (${suffix})` : label;
  }

  const SETTINGS_DEFAULTS = {
    enabled: true,
    defaultSpeed: 1.0,
    step: 0.1,
    ...LEGACY_KEY_DEFAULTS,
    preset1Speed: 1.8,
    preset2Speed: 1.25,
    preset3Speed: 2.5,
    loopSeconds: 10,
    skipSeconds: 10,
    rememberSpeed: false,
    rememberPerUrl: false,
    controlAudio: true,
    silenceSkip: false,
    silenceThreshold: 0.02,
    silenceDelay: 800,
    silenceSpeed: 2.0,
    wheelStep: 0.10,
    showOverlay: true,
    overlayPosition: 'top-left',
    overlayRestoreBadge: true,
    overlayOpacity: 0.92,
    overlayButtonSize: 22,
    fightback: true,
    mouseWheel: true,
    exclusiveKeys: false,
    debugMode: false,
    logLevel: 'warn',
    siteRules: [],
    shortcutBindings: DEFAULT_SHORTCUT_BINDINGS.map(binding => ({ ...binding })),
    customCSS: '',
    overlayControls: { ...DEFAULT_OVERLAY_CONTROLS },
    overlayDefaultsVersion: OVERLAY_DEFAULTS_VERSION
  };

  const LOCAL_DEFAULTS = {
    speed: 1.0,
    popupSpeedScope: 'tab',
    overlayOffsets: {},
    overlayRestoreCorners: {},
    overlayHiddenStates: {},
    totalTimeSaved: 0,
    weekTimeSaved: 0,
    totalSessions: 0,
    speedDist: {}
  };

  const DEFAULTS = { ...SETTINGS_DEFAULTS, ...LOCAL_DEFAULTS };
  const SYNC_SETTINGS_KEYS = Object.freeze(Object.keys(SETTINGS_DEFAULTS));
  const LOCAL_ONLY_STORAGE_KEYS = Object.freeze(Object.keys(LOCAL_DEFAULTS));

  global.VelocityXShortcuts = Object.freeze({
    LEGACY_ACTION_KEYS,
    LEGACY_KEY_DEFAULTS,
    DEFAULT_SHORTCUT_BINDINGS,
    codeToLabel,
    formatShortcutCombo,
    normalizeShortcutBinding,
    normalizeShortcutBindings,
    getLegacyShortcutBindings,
    getCustomShortcutBindings,
    getAllShortcutBindings,
    getActionBindings,
    getPrimaryActionBinding,
    getPrimaryActionShortcut,
    formatActionShortcuts,
    withShortcutLabel
  });

  global.VelocityXSettings = Object.freeze({
    DEFAULT_OVERLAY_CONTROLS: Object.freeze({ ...DEFAULT_OVERLAY_CONTROLS }),
    PREVIOUS_OVERLAY_CONTROLS_V4: Object.freeze({ ...PREVIOUS_OVERLAY_CONTROLS_V4 }),
    PREVIOUS_OVERLAY_CONTROLS_V3: Object.freeze({ ...PREVIOUS_OVERLAY_CONTROLS_V3 }),
    DEFAULT_SHORTCUT_BINDINGS,
    LEGACY_KEY_DEFAULTS,
    OVERLAY_DEFAULTS_VERSION,
    SETTINGS_DEFAULTS: Object.freeze({
      ...SETTINGS_DEFAULTS,
      overlayControls: Object.freeze({ ...SETTINGS_DEFAULTS.overlayControls }),
      shortcutBindings: Object.freeze(SETTINGS_DEFAULTS.shortcutBindings.map(binding => Object.freeze({ ...binding })))
    }),
    LOCAL_DEFAULTS: Object.freeze({ ...LOCAL_DEFAULTS }),
    DEFAULTS: Object.freeze({
      ...DEFAULTS,
      overlayControls: Object.freeze({ ...DEFAULTS.overlayControls }),
      shortcutBindings: Object.freeze(DEFAULTS.shortcutBindings.map(binding => Object.freeze({ ...binding })))
    }),
    SYNC_SETTINGS_KEYS,
    LOCAL_ONLY_STORAGE_KEYS
  });
})(globalThis);
