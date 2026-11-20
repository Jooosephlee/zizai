(() => {
  if (globalThis.__zizai_bootstrap) return;
  globalThis.__zizai_bootstrap = true;
  const keys = globalThis.__zizai_keys;
  const config = globalThis.__zizai_settings;
  const host = config.hostname(location.href);
  const isInstagram = /(^|\.)instagram\.com$/.test(host);
  let settings = null;
  let pointer = null;
  let loading = false;
  let togglingSite = false;
  let held = new Set();

  function enabled() {
    return settings?.enabled && config.siteAllowed(host, settings.sites);
  }

  function mayPreview() {
    return enabled() && !held.has(settings.shortcuts.holdToSuppress.code) &&
      (settings.trigger === "auto" || held.has(settings.shortcuts.holdToTrigger.code));
  }

  function imageNearby(point) {
    return point.path.slice(0, 6).some(node => node instanceof Element && (
      node instanceof HTMLImageElement || node instanceof HTMLVideoElement ||
      /url\(/i.test(getComputedStyle(node).backgroundImage) || Boolean(node.querySelector("video"))
    // A picture under a transparent layer the site lays over it.
    )) || document.elementsFromPoint(point.x, point.y).slice(0, isInstagram ? undefined : 6).some(node =>
      node !== document.body && node !== document.documentElement &&
      (node instanceof HTMLImageElement || Boolean(node.querySelector("img"))));
  }

  function refresh() {
    const runtime = globalThis.__zizai_runtime;
    if (!pointer || !mayPreview()) {
      runtime?.reset();
      return;
    }
    if (runtime) {
      runtime.pointerMoved(pointer, settings);
      return;
    }
    if (loading || !imageNearby(pointer)) return;
    loading = true;
    chrome.runtime.sendMessage({ type: "loadContentRuntime" }).then(result => {
      if (result?.ok && globalThis.__zizai_runtime) refresh();
    }).catch(() => {}).finally(() => { loading = false; });
  }

  function onPointer(event) {
    if (!event.isTrusted || event.pointerType === "touch") return;
    const path = event.composedPath();
    if (pointer && pointer.x === event.clientX && pointer.y === event.clientY &&
        pointer.path[0] === path[0] && pointer.buttons === event.buttons) return;
    pointer = { x: event.clientX, y: event.clientY, path, buttons: event.buttons };
    refresh();
  }

  function clearPointer(event) {
    if (event && globalThis.__zizai_runtime?.ownsEvent(event)) return;
    pointer = null;
    globalThis.__zizai_runtime?.reset();
  }

  function resetInput() {
    held = new Set();
    clearPointer();
  }

  function onKeydown(event) {
    if (!settings || !event.isTrusted || event.isComposing || config.isEditable(event)) return;
    const hold = keys.modifierCode.exec(event.code)?.[1];
    const runtime = globalThis.__zizai_runtime;
    const previewOpen = Boolean(runtime?.isOpen());
    if (hold && !event.repeat) {
      held.add(hold);
      // Holding a modifier pauses new previews. An open preview stays, so
      // shortcuts typed with Shift (such as ?) still reach it.
      if (!previewOpen) refresh();
    }
    if (!event.repeat && host && keys.matches(event, settings.shortcuts.toggleSite)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (togglingSite) return;
      togglingSite = true;
      chrome.runtime.sendMessage({ type: "toggleSite" }).then(async result => {
        if (!result?.ok) return;
        applySettings(result.settings);
        // Confirm the change on the page. The runtime may not be loaded yet
        // on a site that was off until now.
        if (!globalThis.__zizai_runtime) await chrome.runtime.sendMessage({ type: "loadContentRuntime" });
        globalThis.__zizai_runtime?.notify(chrome.i18n.getMessage(result.allowed ? "siteTurnedOn" : "siteTurnedOff", [host]));
      }).catch(() => {}).finally(() => { togglingSite = false; });
      return;
    }
    if (previewOpen ? enabled() : mayPreview()) runtime?.keydown(event, settings);
  }

  function onKeyup(event) {
    if (!event.isTrusted) return;
    const hold = keys.modifierCode.exec(event.code)?.[1];
    if (hold && !event.getModifierState(hold) && held.delete(hold)) refresh();
  }

  function applySettings(next) {
    settings = next;
    // The page-data script (Weibo, Jike, X, Instagram) stops reading for good
    // and forgets what it read once previews are off here.
    if (!enabled()) document.dispatchEvent(new CustomEvent("__zizai_stop"));
    globalThis.__zizai_runtime?.settingsChanged(next);
    refresh();
  }

  document.addEventListener("pointermove", onPointer, { capture: true, passive: true });
  if (isInstagram) {
    // A lazy image can finish loading after the pointer has stopped.
    document.addEventListener("load", event => {
      if (!pointer || !(event.target instanceof HTMLImageElement) || !mayPreview()) return;
      const box = event.target.getBoundingClientRect();
      if (pointer.x >= box.left && pointer.x <= box.right && pointer.y >= box.top && pointer.y <= box.bottom) refresh();
    }, true);
  }
  document.addEventListener("pointerout", event => {
    // Leaving the window closes a floating preview. A full-page preview
    // stays until the reader closes it.
    if (event.isTrusted && !event.relatedTarget && !globalThis.__zizai_runtime?.isFull()) clearPointer();
  }, true);
  // A click on a video opens it enlarged. The whole click (press, release,
  // click) is taken from the page, so the site's player does not start a
  // second copy of the same video underneath.
  let swallowUntil = 0;
  window.addEventListener("pointerdown", event => {
    swallowUntil = 0;
    const runtime = globalThis.__zizai_runtime;
    if (!event.isTrusted || event.pointerType === "touch" || !enabled() || !runtime || runtime.ownsEvent(event)) return;
    if (!runtime.videoPress(event)) return;
    swallowUntil = performance.now() + 1000;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  for (const type of ["mousedown", "pointerup", "mouseup", "click", "dblclick"]) {
    window.addEventListener(type, event => {
      if (!event.isTrusted || performance.now() > swallowUntil) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
  }
  document.addEventListener("pointerdown", event => {
    const runtime = globalThis.__zizai_runtime;
    if (runtime?.ownsEvent(event)) return;
    pointer = null;
    runtime?.pointerDown();
  }, true);
  document.addEventListener("scroll", clearPointer, { capture: true, passive: true });
  window.addEventListener("resize", clearPointer);
  window.addEventListener("blur", resetInput);
  document.addEventListener("visibilitychange", () => { if (document.hidden) resetInput(); });
  window.addEventListener("keydown", onKeydown, true);
  window.addEventListener("keyup", onKeyup, true);
  config.watch(applySettings);
  config.read().then(applySettings).catch(() => {});
})();
