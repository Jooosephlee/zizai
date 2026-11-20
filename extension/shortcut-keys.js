// Shortcut storage uses physical KeyboardEvent.code and exact modifier matching.
(() => {
  const isMac = /mac/i.test(navigator.userAgentData?.platform || navigator.platform);
  const modifierFlags = { Alt: "alt", Control: "ctrl", Meta: "meta", Shift: "shift" };
  const modifierCode = /^(Alt|Control|Meta|Shift)(Left|Right)$/;
  const holdActions = new Set(["holdToSuppress", "holdToTrigger"]);

  function combo(code, ...modifiers) {
    return {
      code,
      alt: modifiers.includes("alt"),
      ctrl: modifiers.includes("ctrl"),
      meta: modifiers.includes("meta"),
      shift: modifiers.includes("shift")
    };
  }

  const defaults = {
    holdToSuppress: combo("Shift"),
    holdToTrigger: combo("Alt"),
    toggleSite: combo("KeyZ", "alt"),
    prevImage: combo("ArrowLeft"),
    nextImage: combo("ArrowRight"),
    toggleMode: combo("KeyF"),
    playPause: combo("Space"),
    toggleMute: combo("KeyM"),
    openOriginal: combo("KeyO"),
    copyImage: combo("KeyC", isMac ? "meta" : "ctrl"),
    saveImage: combo("KeyS"),
    copyText: combo("KeyT")
  };
  const actions = Object.keys(defaults);

  function normalize(value) {
    if (!value || typeof value !== "object" || typeof value.code !== "string" || !/^[A-Za-z0-9]+$/.test(value.code)) return null;
    return {
      code: value.code,
      alt: value.alt === true,
      ctrl: value.ctrl === true,
      meta: value.meta === true,
      shift: value.shift === true
    };
  }

  function fromEvent(event) {
    return {
      code: event.code,
      alt: Boolean(event.altKey),
      ctrl: Boolean(event.ctrlKey),
      meta: Boolean(event.metaKey),
      shift: Boolean(event.shiftKey)
    };
  }

  function same(a, b) {
    return Boolean(a && b && a.code === b.code && a.alt === b.alt &&
      a.ctrl === b.ctrl && a.meta === b.meta && a.shift === b.shift);
  }

  function matches(event, binding) {
    return same(fromEvent(event), binding);
  }

  function holdFromEvent(event) {
    const modifier = modifierCode.exec(event.code)?.[1];
    if (!modifier) return null;
    const current = fromEvent(event);
    current[modifierFlags[modifier]] = false;
    return Object.values(modifierFlags).some(flag => current[flag]) ? null : combo(modifier);
  }

  function format(binding) {
    const names = isMac ? ["⌃", "⌥", "⇧", "⌘"] : ["Ctrl", "Alt", "Shift", "Win"];
    const keyNames = {
      ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓",
      Space: chrome.i18n.getMessage("spaceKey"), Enter: "↵",
      Shift: names[2], Alt: names[1], Control: names[0], Meta: names[3]
    };
    const parts = ["ctrl", "alt", "shift", "meta"].flatMap((flag, i) => binding[flag] ? [names[i]] : []);
    parts.push(keyNames[binding.code] || binding.code.replace(/^(Key|Digit)(?=[A-Z0-9]$)/, ""));
    return parts.join(isMac ? "" : "+");
  }

  function reserved(binding) {
    const { code, alt, ctrl, meta, shift } = binding;
    const primary = isMac ? meta && !ctrl && !alt : ctrl && !meta && !alt;
    if (ctrl && code === "Tab") return true;
    if (primary && /^(Key[WTRNLQHMSPDUGKOB]|Digit[1-9]|Tab|Space|BracketLeft|BracketRight)$/.test(code)) return true;
    if (primary && (code === "Comma" || shift && /^(Key[IJBC]|Delete)$/.test(code))) return true;
    if (isMac && meta && alt && /^(Key[CIJ]|ArrowLeft|ArrowRight)$/.test(code)) return true;
    if (alt && !ctrl && !meta && /^(F4|Tab|Space|Home|ArrowLeft|ArrowRight)$/.test(code)) return true;
    return !alt && !ctrl && !meta && /^(F5|F11|F12)$/.test(code);
  }

  function validate(binding, action, others) {
    if (!binding) return { message: "shortcutInvalid" };
    if (holdActions.has(action)) {
      if (!Object.hasOwn(modifierFlags, binding.code)) return { message: "shortcutHoldOnly" };
    } else {
      if (reserved(binding)) return { message: "shortcutReserved", values: [format(binding)] };
      if (modifierCode.test(binding.code) || Object.hasOwn(modifierFlags, binding.code) ||
          /^(Tab|Escape|CapsLock|Fn|FnLock|OSLeft|OSRight|ContextMenu|Lang\d|KanaMode)$/.test(binding.code) ||
          binding.code === "Slash" && binding.shift && !binding.alt && !binding.ctrl && !binding.meta) {
        return { message: "shortcutInvalid" };
      }
      if (action === "toggleSite" && !binding.alt && !binding.ctrl && !binding.meta) {
        return { message: "shortcutNeedsModifier" };
      }
    }

    const conflict = actions.find(other => other !== action && same(binding, others[other]));
    return conflict ? { message: "shortcutConflict", values: [chrome.i18n.getMessage(conflict)] } : null;
  }

  function resolve(stored) {
    const bindings = { ...defaults };
    for (const action of actions) {
      const value = normalize(stored?.[action]);
      if (value && !validate(value, action, {})) bindings[action] = value;
    }
    return actions.some(action => validate(bindings[action], action, bindings)) ? { ...defaults } : bindings;
  }

  globalThis.__zizai_keys = {
    actions, defaults, holdActions, modifierCode, fromEvent, holdFromEvent, matches, format, validate, resolve, same
  };
})();
