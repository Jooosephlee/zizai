(() => {
  const keys = globalThis.__zizai_keys;
  const defaults = {
    enabled: true,
    trigger: "auto",
    delay: 320,
    mode: "full",
    showCaption: true,
    // Viewer background: dark, light, or follow the system appearance.
    viewerTheme: "dark",
    // Allowlist: previews only run on these sites and their subdomains.
    // Readers add or remove sites from the popup or with the site shortcut.
    // Only sites checked to work: the three read from the page's own data
    // (Weibo, Jike, X), and those whose pages were checked to hold a larger
    // picture the pointer can reach. Other sites are one tap away.
    sites: [
      "weibo.com", "weibo.cn", "okjike.com", "x.com", "twitter.com",
      "xiaohongshu.com", "rednote.com", "instagram.com", "pinterest.com",
      "douban.com", "bilibili.com", "zcool.com.cn"
    ],
    shortcuts: {}
  };

  function hostname(value) {
    const text = String(value || "").trim();
    if (!text || /[\s@*]/.test(text)) return "";
    try {
      const url = new URL(text.includes("://") ? text : "https://" + text);
      return /^https?:$/.test(url.protocol) ? url.hostname.replace(/\.$/, "") : "";
    } catch {
      return "";
    }
  }

  // Store sites without a leading "www." so one entry covers the whole site.
  function siteName(value) {
    return hostname(value).replace(/^www\./, "");
  }

  function siteAllowed(host, sites) {
    return Boolean(host) && sites.some(site => host === site || host.endsWith("." + site));
  }

  // Turning a site off removes every entry that covers it, including a parent
  // domain. Turning it on adds the hostname without "www.".
  function toggleSite(host, sites) {
    return siteAllowed(host, sites)
      ? sites.filter(site => !(host === site || host.endsWith("." + site)))
      : [...sites, siteName(host)];
  }

  // Chrome's access pattern for a site and all its subdomains.
  function sitePattern(site) {
    return "*://*." + siteName(site) + "/*";
  }

  // Sites the extension may run on from install. Any other site needs the
  // reader's OK first: they turn it on, Chrome asks once.
  function builtIn(host) {
    const patterns = chrome.runtime.getManifest().host_permissions || [];
    return Boolean(host) && patterns.some(pattern => {
      const site = /^\*:\/\/\*\.([^/]+)\/\*$/.exec(pattern)?.[1];
      return site && (host === site || host.endsWith("." + site));
    });
  }

  // How long the pointer rests on a picture before it opens: three steps.
  const DELAYS = [150, 320, 600];
  // Behaviour that used to be a setting and is now fixed at its best value.
  // Values a reader stored for these earlier are ignored.
  const FIXED = {
    // The card's place is chosen by which keeps the picture larger; this
    // only breaks a near tie.
    captionLayout: "side",
    captionStyle: "glass",
    steadyHover: true,
    dismissUntilLeave: true,
    singleWheelClose: true,
    edgeExit: false,
    wheelSensitivity: "medium"
  };

  function normalize(values) {
    const asked = Number(values.delay ?? defaults.delay);
    const delay = Number.isFinite(asked)
      ? DELAYS.reduce((best, step) => Math.abs(step - asked) < Math.abs(best - asked) ? step : best)
      : defaults.delay;
    return {
      ...FIXED,
      enabled: values.enabled !== false,
      trigger: values.trigger === "hold" ? "hold" : defaults.trigger,
      delay,
      mode: ["float", "full"].includes(values.mode) ? values.mode : defaults.mode,
      showCaption: values.showCaption !== false,
      viewerTheme: ["dark", "light", "system"].includes(values.viewerTheme) ? values.viewerTheme : defaults.viewerTheme,
      sites: Array.isArray(values.sites)
        ? [...new Set(values.sites.map(siteName).filter(Boolean))]
        : [...defaults.sites],
      shortcuts: keys.resolve(values.shortcuts)
    };
  }

  function read() {
    return chrome.storage.local.get(defaults).then(normalize);
  }

  function watch(callback) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && Object.keys(changes).some(key => key in defaults)) {
        read().then(callback).catch(() => {});
      }
    });
  }

  function isEditable(event) {
    const target = event.composedPath()[0];
    return target instanceof Element && (
      target.isContentEditable || Boolean(target.closest("input, textarea, select, [role='textbox']"))
    );
  }

  globalThis.__zizai_settings = { defaults, DELAYS, hostname, siteName, siteAllowed, toggleSite, sitePattern, builtIn, normalize, read, watch, isEditable };
})();
