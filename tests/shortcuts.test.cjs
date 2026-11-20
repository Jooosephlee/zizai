const assert = require("node:assert/strict");
const { test } = require("node:test");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { runInNewContext } = require("node:vm");

function model(platform) {
  const context = {
    navigator: { platform },
    chrome: { i18n: { getMessage: key => key } }
  };
  runInNewContext(readFileSync(join(__dirname, "../extension/shortcut-keys.js"), "utf8"), context);
  return context.__zizai_keys;
}

test("copy defaults follow the platform and extra modifiers never match", () => {
  const mac = model("MacIntel");
  const windows = model("Win32");
  assert.equal(mac.defaults.copyImage.meta, true);
  assert.equal(windows.defaults.copyImage.ctrl, true);
  assert.equal(mac.matches({ code: "KeyC", metaKey: true }, mac.defaults.copyImage), true);
  assert.equal(mac.matches({ code: "KeyC", metaKey: true, shiftKey: true }, mac.defaults.copyImage), false);
});

test("reserved browser keys and duplicate bindings are rejected", () => {
  const keys = model("MacIntel");
  const bindings = keys.defaults;
  assert.equal(keys.validate({ ...bindings.copyImage, code: "KeyW" }, "copyImage", bindings).message, "shortcutReserved");
  assert.equal(keys.validate({ ...bindings.copyImage, code: "Tab", meta: false, ctrl: true }, "copyImage", bindings).message, "shortcutReserved");
  assert.equal(keys.validate(bindings.prevImage, "nextImage", bindings).message, "shortcutConflict");
  assert.equal(keys.validate({ ...bindings.toggleMode }, "toggleSite", bindings).message, "shortcutNeedsModifier");
});

test("both sides of a modifier can be recorded for hold actions", () => {
  const keys = model("MacIntel");
  for (const code of ["ShiftLeft", "ShiftRight"]) {
    const binding = keys.holdFromEvent({ code, shiftKey: true });
    assert.equal(binding.code, "Shift");
    assert.equal(binding.shift, false);
    assert.equal(keys.validate(binding, "holdToSuppress", keys.defaults), null);
  }
});

test("custom keys resolve together, including an action taking a freed default key", () => {
  const keys = model("MacIntel");
  const custom = {
    prevImage: { ...keys.defaults.prevImage, code: "KeyG" },
    nextImage: { ...keys.defaults.prevImage }
  };
  const resolved = keys.resolve(custom);
  assert.equal(resolved.prevImage.code, "KeyG");
  assert.equal(resolved.nextImage.code, "ArrowLeft");
});
