importScripts("shortcut-keys.js", "settings.js", "runtime-loader.js");

const config = globalThis.__zizai_settings;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
let siteChanges = Promise.resolve();

chrome.runtime.onInstalled.addListener(details => {
  if (details.reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") }).catch(() => {});
  }
  void syncSiteScripts();
});

// Sites the reader turned on beyond the built-in list: once Chrome has granted
// access, the page scripts run there too. Access and scripts change together.
const SITE_SCRIPTS = "zizai-sites";
const PAGE_FILES = ["shortcut-keys.js", "settings.js", "bootstrap.js"];
let scriptSync = Promise.resolve();
// The page-data script reads post text from responses the page already
// gets (Weibo, Jike, X, Instagram). It runs from the page's start, and only
// where previews are on: turning a site or everything off unregisters it,
// and open pages are told to stop and forget (bootstrap.js).
const PAGE_DATA = "zizai-page-data";
const PAGE_DATA_SITES = ["okjike.com", "weibo.com", "weibo.cn", "x.com", "twitter.com", "instagram.com"];
function syncSiteScripts() {
  scriptSync = scriptSync.then(async () => {
    const declared = new Set(chrome.runtime.getManifest().host_permissions);
    const { origins = [] } = await chrome.permissions.getAll();
    const extra = origins.filter(origin => !declared.has(origin) && origin !== "*://*/*");
    const settings = await config.read();
    const dataSites = settings.enabled ? PAGE_DATA_SITES.filter(site => config.siteAllowed(site, settings.sites)) : [];
    // Unregister only what is there: one unknown id fails the whole call.
    const present = (await chrome.scripting.getRegisteredContentScripts({ ids: [SITE_SCRIPTS, PAGE_DATA] })).map(script => script.id);
    if (present.length) await chrome.scripting.unregisterContentScripts({ ids: present });
    const scripts = [];
    if (extra.length) {
      scripts.push({ id: SITE_SCRIPTS, matches: extra, js: PAGE_FILES, allFrames: true, runAt: "document_idle", persistAcrossSessions: true });
    }
    if (dataSites.length) {
      scripts.push({ id: PAGE_DATA, matches: dataSites.map(site => "*://*." + site + "/*"), js: ["page-media.js"], world: "MAIN", runAt: "document_start", persistAcrossSessions: true });
    }
    if (scripts.length) await chrome.scripting.registerContentScripts(scripts);
  }).catch(() => {});
  return scriptSync;
}
config.watch(() => void syncSiteScripts());
chrome.runtime.onStartup.addListener(() => void syncSiteScripts());
chrome.permissions.onAdded.addListener(() => void syncSiteScripts());
chrome.permissions.onRemoved.addListener(() => void syncSiteScripts());

// Rules last only as long as one request; ids wrap well before the limit.
let ruleCounter = 0;
function nextRuleId() {
  ruleCounter = ruleCounter % 4000 + 1;
  return 1000 + ruleCounter;
}
// The rule follows the host's own CDN nodes: wx1.sinaimg.cn -> sinaimg.cn.
function baseDomain(host) {
  const parts = host.split(".");
  if (parts.length <= 2 || /^\d+$/.test(parts.at(-1))) return host;
  const second = parts.at(-2);
  return parts.slice(/^(com|net|org|gov|edu|co|ac)$/.test(second) && parts.length > 2 ? -3 : -2).join(".");
}

// One download at a time: the source rule below is the only one in force while
// it runs, so two pages copying from the same image server never mix origins.
let imageQueue = Promise.resolve();
function fetchImageBytes(rawUrl, senderUrl) {
  const run = imageQueue.then(() => fetchImageBytesNow(rawUrl, senderUrl));
  imageQueue = run.catch(() => {});
  return run;
}

// Copy and save refuse a fixed list of literal local hostnames when the host
// is not the page's own. This is not a block on every private-network address.
function privateHost(host) {
  host = host.replace(/^\[|\]$/g, "").toLowerCase();
  return host === "localhost" || /\.(local|localhost|internal|lan|home\.arpa)$/.test(host) ||
    /^(127|10|0)\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host === "::1" || /^f[cd][0-9a-f]{2}:/.test(host) || /^fe80:/.test(host);
}

// Removes every temporary rule. Only this file adds session rules, and only
// for one download at a time, so any rule here is a leftover.
async function clearRules() {
  const rules = await chrome.declarativeNetRequest.getSessionRules();
  if (rules.length) await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: rules.map(rule => rule.id) });
}

async function fetchImageBytesNow(rawUrl, senderUrl) {
  const url = new URL(rawUrl);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new Error("Invalid image URL");
  const page = new URL(senderUrl);
  if (!/^https?:$/.test(page.protocol)) throw new Error("Invalid page URL");
  if (privateHost(url.hostname) && url.hostname !== page.hostname) throw new Error("Private address");
  // A leftover from a failed cleanup must never apply to this download: if it
  // cannot be removed, this download does not start.
  await clearRules();

  // Image hosts such as Weibo's refuse requests that do not come from their
  // own site. A worker cannot set another site's Referer itself, so for this
  // one request a short-lived session rule sends the page's origin, as the
  // page does when it shows the picture.
  const ruleId = nextRuleId();
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [ruleId],
    addRules: [{
      id: ruleId,
      priority: 1,
      action: { type: "modifyHeaders", requestHeaders: [{ header: "referer", operation: "set", value: page.origin + "/" }] },
      condition: { requestDomains: [baseDomain(url.hostname)], initiatorDomains: [chrome.runtime.id], tabIds: [chrome.tabs.TAB_ID_NONE], resourceTypes: ["xmlhttprequest", "other"] }
    }]
  });
  let response;
  try {
    response = await fetch(url.href, {
      credentials: "omit",
      redirect: "follow",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(12000)
    });
  } finally {
    // Wait until the rule is really gone before the next download starts;
    // if it will not go, this download fails and the next one clears first.
    try {
      await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId] });
    } catch {
      await clearRules().catch(() => {});
      throw new Error("Rule cleanup failed");
    }
  }
  const mime = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() || "";
  // Image hosts often redirect to a CDN node. Follow it, but only to http(s).
  let finalProtocol = url.protocol, finalHost = url.hostname;
  try { if (response.url) ({ protocol: finalProtocol, hostname: finalHost } = new URL(response.url)); } catch { finalProtocol = ""; }
  if (!/^https?:$/.test(finalProtocol) || privateHost(finalHost) && finalHost !== page.hostname || !response.ok || !/^image\/[a-z0-9.+-]+$/.test(mime) || !response.body ||
      Number(response.headers.get("content-length")) > MAX_IMAGE_BYTES) {
    await response.body?.cancel();
    throw new Error("Image unavailable");
  }

  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_IMAGE_BYTES) {
      await reader.cancel();
      throw new Error("Image exceeds byte limit");
    }
    for (let offset = 0; offset < value.length; offset += 8192) {
      chunks.push(String.fromCharCode(...value.subarray(offset, offset + 8192)));
    }
  }
  if (!size) throw new Error("Empty image");
  return { mime, base64: btoa(chunks.join("")) };
}

function toggleSite(host) {
  const change = siteChanges.then(async () => {
    const settings = await config.read();
    const before = settings.sites;
    settings.sites = config.toggleSite(host, before);
    await chrome.storage.local.set({ sites: settings.sites });
    const allowed = config.siteAllowed(host, settings.sites);
    // Off on a site the reader added: give its access back too, for exactly
    // the entries that were removed (sub.example.com may turn off example.com).
    // Built-in sites keep the access Chrome granted at install.
    const removed = before.filter(site => !settings.sites.includes(site) && !config.builtIn(site));
    if (removed.length) await chrome.permissions.remove({ origins: removed.map(config.sitePattern) }).catch(() => {});
    return { settings, allowed };
  });
  siteChanges = change.catch(() => {});
  return change;
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !Number.isInteger(sender.tab?.id) || !Number.isInteger(sender.frameId)) return;
  const host = config.hostname(sender.url);

  let action;
  if (message?.type === "loadContentRuntime" && host) action = loadContentRuntime(sender);
  if (message?.type === "toggleSite" && host) action = toggleSite(host);
  if (message?.type === "fetchImageBytes" && host && typeof message.url === "string") {
    action = fetchImageBytes(message.url, sender.url);
  }
  if (!action) return;
  action.then(value => respond({ ...value, ok: true })).catch(() => respond({ ok: false }));
  return true;
});
