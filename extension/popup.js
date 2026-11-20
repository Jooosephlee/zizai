(() => {
  const keys = globalThis.__zizai_keys;
  const config = globalThis.__zizai_settings;
  const message = (key, values) => chrome.i18n.getMessage(key, values);
  const byId = id => document.getElementById(id);
  const list = byId("shortcuts");
  const controls = ["enabled", "trigger", "sites", "showCaption"];
  let settings;
  let recording = null;
  let currentHost = "";
  let currentTab = null;
  // Whether Chrome lets the extension run on the current site.
  let currentGranted = false;

  document.documentElement.lang = chrome.i18n.getUILanguage();
  document.title = message("extensionName");
  for (const node of document.querySelectorAll("[data-message]")) node.textContent = message(node.dataset.message);
  for (const node of document.querySelectorAll("[data-message-aria]")) node.setAttribute("aria-label", message(node.dataset.messageAria));
  byId("version").textContent = chrome.runtime.getManifest().version_name || chrome.runtime.getManifest().version;

  function status(key, values, isError = false) {
    byId("status").textContent = key ? message(key, values) : "";
    byId("status").classList.toggle("error", isError);
  }

  function renderShortcuts() {
    for (const action of keys.actions) {
      const button = byId("record-" + action);
      button.textContent = action === recording
        ? message(keys.holdActions.has(action) ? "recordModifier" : "recordKey")
        : keys.format(settings.shortcuts[action]);
      button.setAttribute("aria-pressed", String(action === recording));
      // Reset only shows on rows that differ from the default. It keeps its
      // space so the key boxes stay aligned in one column.
      byId("reset-" + action).classList.toggle("unchanged", keys.same(settings.shortcuts[action], keys.defaults[action]));
    }
  }

  function renderSettings(next) {
    settings = next;
    for (const id of controls) {
      const input = byId(id);
      if (document.activeElement === input) continue;
      if (input.type === "checkbox") input.checked = next[id];
      else input.value = id === "sites" ? next[id].join("\n") : next[id];
    }
    byId("siteEnabled").checked = currentGranted && config.siteAllowed(currentHost, next.sites);
    byId("siteEnabled").disabled = !currentHost || !next.enabled;
    document.body.classList.toggle("paused", !next.enabled);
    for (const button of document.querySelectorAll("[data-setting]")) {
      button.setAttribute("aria-pressed", String(button.dataset.value === String(next[button.dataset.setting])));
    }
    renderShortcuts();
  }

  async function save(values) {
    try {
      await chrome.storage.local.set(values);
      renderSettings(await config.read());
      status("settingsSaved");
    } catch {
      status("settingsError", undefined, true);
    }
  }

  function saveBinding(action, binding) {
    const problem = keys.validate(binding, action, settings.shortcuts);
    if (problem) {
      status(problem.message, problem.values, true);
      return false;
    }
    const shortcuts = { ...settings.shortcuts, [action]: binding };
    recording = null;
    renderShortcuts();
    void save({ shortcuts });
    return true;
  }

  for (const action of keys.actions) {
    const row = document.createElement("div");
    row.className = "row";
    const label = document.createElement("span");
    label.id = "label-" + action;
    label.textContent = message(action);
    const buttons = document.createElement("div");
    buttons.className = "shortcut-buttons";
    const record = document.createElement("button");
    record.id = "record-" + action;
    record.type = "button";
    record.setAttribute("aria-labelledby", label.id + " " + record.id);
    record.addEventListener("click", () => {
      recording = recording === action ? null : action;
      renderShortcuts();
      status();
    });
    const reset = document.createElement("button");
    reset.id = "reset-" + action;
    reset.type = "button";
    reset.textContent = message("resetBinding");
    reset.setAttribute("aria-label", message("resetNamed", [label.textContent]));
    reset.addEventListener("click", () => saveBinding(action, keys.defaults[action]));
    buttons.append(record, reset);
    row.append(label, buttons);
    list.append(row);
  }

  for (const id of controls) {
    const input = byId(id);
    input.addEventListener("change", async () => {
      let value = input.value;
      if (input.type === "checkbox") value = input.checked;
      if (id === "sites") {
        const sites = value.split(/\n|,|，/).map(site => site.trim()).filter(Boolean);
        if (sites.some(site => !config.siteName(site))) {
          status("sitesInvalid", undefined, true);
          return;
        }
        value = [...new Set(sites.map(config.siteName))];
        // New sites outside the built-in list need Chrome's OK first.
        const added = value.filter(site => !settings.sites.includes(site) && !config.builtIn(site));
        if (added.length && !await askFor(added)) {
          value = value.filter(site => !added.includes(site));
          input.value = value.join("\n");
          await save({ sites: value });
          status("sitesNeedPermission", undefined, true);
          return;
        }
        letGo(settings.sites.filter(site => !value.includes(site)));
        input.value = value.join("\n");
      }
      void save({ [id]: value });
    });
  }

  for (const button of document.querySelectorAll("[data-setting]")) {
    button.addEventListener("click", () => void save({ [button.dataset.setting]: button.dataset.setting === "delay" ? Number(button.dataset.value) : button.dataset.value }));
  }
  // Ask Chrome for sites, inside the reader's click. Built-in sites pass at once.
  async function askFor(sites) {
    try {
      return await chrome.permissions.request({ origins: sites.map(config.sitePattern) });
    } catch {
      return false;
    }
  }
  // A site the reader turned off gives its access back (built-in ones keep theirs).
  function letGo(sites) {
    const extra = sites.filter(site => !config.builtIn(site));
    if (extra.length) chrome.permissions.remove({ origins: extra.map(config.sitePattern) }).catch(() => {});
  }
  // Start on the open page right away, no reload needed.
  function startOnPage() {
    if (currentTab?.id === undefined) return;
    chrome.scripting.executeScript({ target: { tabId: currentTab.id, allFrames: true }, files: ["shortcut-keys.js", "settings.js", "bootstrap.js"] }).catch(() => {});
  }

  byId("siteEnabled").addEventListener("change", async event => {
    const input = event.target;
    if (!currentHost) return;
    const site = config.siteName(currentHost);
    if (input.checked) {
      // Call this first, while the click still counts as the reader's.
      currentGranted = await askFor([site]);
      if (!currentGranted) {
        input.checked = false;
        status("sitePermissionDenied", undefined, true);
        return;
      }
    }
    const current = await config.read();
    const next = config.siteAllowed(currentHost, current.sites) !== input.checked ? config.toggleSite(currentHost, current.sites) : current.sites;
    if (next !== current.sites) await save({ sites: next });
    if (input.checked) startOnPage();
    else {
      // Give back access for exactly the entries turned off (a parent domain too).
      letGo([...current.sites.filter(entry => !next.includes(entry)), site]);
      currentGranted = config.builtIn(site);
    }
  });

  window.addEventListener("keydown", event => {
    if (!recording || event.isComposing || !event.isTrusted) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.key === "Escape") {
      recording = null;
      renderShortcuts();
      status();
      return;
    }
    if (event.repeat) return;
    if (keys.holdActions.has(recording)) {
      saveBinding(recording, keys.holdFromEvent(event));
    } else if (!keys.modifierCode.test(event.code)) {
      saveBinding(recording, keys.fromEvent(event));
    }
  }, true);

  byId("resetSites").addEventListener("click", () => {
    letGo(settings.sites);
    void save({ sites: [...config.defaults.sites] });
  });

  byId("resetAll").addEventListener("click", () => {
    recording = null;
    void save({ shortcuts: {} });
  });

  config.watch(renderSettings);
  config.read().then(renderSettings).catch(() => status("settingsError", undefined, true));
  // Opening the popup lends access to this tab (activeTab), so its address can be read.
  chrome.tabs.query({ active: true, currentWindow: true }).then(async tabs => {
    currentTab = tabs[0] || null;
    currentHost = config.hostname(currentTab?.url);
    byId("currentSite").textContent = currentHost || message("unsupportedPage");
    if (currentHost) {
      currentGranted = await chrome.permissions.contains({ origins: [config.sitePattern(currentHost)] }).catch(() => false);
    }
    if (settings) renderSettings(settings);
  }).catch(() => { byId("currentSite").textContent = message("unsupportedPage"); });
})();
