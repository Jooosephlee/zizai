const assert = require("node:assert/strict");
const { test } = require("node:test");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { runInNewContext } = require("node:vm");

const dir = join(__dirname, "../extension");
const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));

function background(fetch, rules = [], options = {}) {
  let onMessage;
  const active = new Map();
  const declarativeNetRequest = {
    getSessionRules: async () => [...active.values()],
    updateSessionRules: async change => {
      rules.push(JSON.parse(JSON.stringify(change)));
      if (change.removeRuleIds && !change.addRules?.length && options.failRemove?.()) throw new Error("cannot remove");
      for (const id of change.removeRuleIds || []) active.delete(id);
      for (const rule of change.addRules || []) active.set(rule.id, rule);
    }
  };
  options.active = active;
  const context = {
    importScripts() {},
    __zizai_settings: { hostname: value => new URL(value).hostname, watch() {}, read: async () => ({ enabled: true, sites: ["weibo.com", "okjike.com", "x.com", "twitter.com", "instagram.com"] }), siteAllowed: (host, sites) => sites.some(site => host === site || host.endsWith("." + site)) },
    chrome: { runtime: { id: "zizai", onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onMessage: { addListener: handler => { onMessage = handler; } } }, permissions: { onAdded: { addListener() {} }, onRemoved: { addListener() {} } }, tabs: { TAB_ID_NONE: -1 }, declarativeNetRequest },
    AbortSignal, URL, btoa, fetch
  };
  runInNewContext(readFileSync(join(dir, "background.js"), "utf8"), context);
  return onMessage;
}

test("manifest only asks for storage, scripting and header rules on its own requests, with page hooks restricted to the supported social sites", () => {
  assert.deepEqual(manifest.permissions, ["storage", "scripting", "activeTab", "declarativeNetRequestWithHostAccess"]);
  // No blanket access at install: only the built-in sites, their picture
  // servers and local files. Any other site is asked for when the reader turns it on.
  assert.ok(!manifest.host_permissions.includes("<all_urls>"));
  assert.ok(!manifest.host_permissions.includes("*://*/*"));
  assert.deepEqual(manifest.optional_host_permissions, ["*://*/*"]);
  const pages = manifest.content_scripts[0].matches;
  assert.ok(pages.every(pattern => manifest.host_permissions.includes(pattern)));
  assert.equal(manifest.web_accessible_resources, undefined);
  // The page-data script is not in the manifest: the background registers it
  // only where previews are on.
  assert.equal(manifest.content_scripts.filter(script => script.world === "MAIN").length, 0);
});

test("a redirect may change the image host, but never leave http(s)", async () => {
  const sender = { id: "zizai", tab: { id: 1 }, frameId: 0, url: "https://page.example/article" };
  const run = finalUrl => {
    const handle = background(async () => {
      const response = new Response(Uint8Array.of(0x47, 0x49, 0x46), { headers: { "content-type": "image/gif" } });
      Object.defineProperty(response, "url", { value: finalUrl });
      return response;
    });
    return new Promise(resolve => handle({ type: "fetchImageBytes", url: "https://img.example/a.gif" }, sender, resolve));
  };
  assert.equal((await run("https://cdn.example/a.gif")).ok, true);
  assert.equal((await run("file:///etc/hosts")).ok, false);
});

test("copy only requests the supplied image address, without credentials", async () => {
  const requests = [];
  const rules = [];
  const handle = background(async (url, options) => {
    requests.push({ url, options });
    return new Response(Uint8Array.of(0x47, 0x49, 0x46), { headers: { "content-type": "image/gif" } });
  }, rules);
  const sender = { id: "zizai", tab: { id: 1 }, frameId: 0, url: "https://page.example/article" };
  const url = "https://img.example/photo.gif";
  const result = await new Promise(resolve => {
    assert.equal(handle({ type: "fetchImageBytes", url }, sender, resolve), true);
  });

  assert.equal(result.ok, true);
  assert.equal(result.base64, "R0lG");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, url);
  assert.equal(requests[0].options.credentials, "omit");
  assert.equal(requests[0].options.redirect, "follow");
  // The image host sees the page's origin only (as when the page shows the
  // picture), never its path, and only on this extension's own request.
  const rule = rules[0].addRules[0];
  assert.deepEqual(rule.action.requestHeaders, [{ header: "referer", operation: "set", value: "https://page.example/" }]);
  assert.deepEqual(rule.condition.requestDomains, ["img.example"]);
  assert.deepEqual(rule.condition.initiatorDomains, ["zizai"]);
  assert.deepEqual(rule.condition.tabIds, [-1]);
  // The rule is removed once the request is done.
  await new Promise(resolve => setTimeout(resolve));
  assert.deepEqual(rules.at(-1), { removeRuleIds: [rule.id] });
  assert.equal(handle({ type: "fetchImageBytes", url }, { ...sender, id: "other" }, assert.fail), undefined);
  assert.equal(requests.length, 1);
});

test("a web page response is rejected, even when the address ends in an image suffix", async () => {
  const handle = background(async () => new Response("<html></html>", { headers: { "content-type": "text/html" } }));
  const result = await new Promise(resolve => handle(
    { type: "fetchImageBytes", url: "https://img.example/photo.png" },
    { id: "zizai", tab: { id: 1 }, frameId: 0, url: "https://page.example/" }, resolve
  ));
  assert.equal(result.ok, false);
});

test("every site on by default is one the extension may open on from install", () => {
  const context = { chrome: { runtime: { getManifest: () => manifest } }, navigator: { platform: "MacIntel", userAgent: "Mac", userAgentData: undefined }, URL, globalThis: {} };
  context.globalThis = context;
  runInNewContext(readFileSync(join(dir, "shortcut-keys.js"), "utf8") + readFileSync(join(dir, "settings.js"), "utf8"), context);
  const config = context.__zizai_settings;
  for (const site of config.defaults.sites) {
    assert.ok(manifest.content_scripts[0].matches.includes(config.sitePattern(site)), site);
    assert.equal(config.builtIn(site), true, site);
  }
  assert.equal(config.builtIn("example.com"), false);
  assert.equal(config.builtIn("m.weibo.cn"), true);
  assert.equal(config.sitePattern("www.example.com"), "*://*.example.com/*");
});

test("a site the reader allowed gets the page scripts; built-in sites keep the manifest's", async () => {
  const listeners = {};
  const registered = [];
  const on = name => ({ addListener: handler => { listeners[name] = handler; } });
  const context = {
    importScripts() {},
    __zizai_settings: { hostname: value => new URL(value).hostname, watch() {}, read: async () => ({ enabled: true, sites: ["weibo.com", "okjike.com", "x.com", "twitter.com", "instagram.com"] }), siteAllowed: (host, sites) => sites.some(site => host === site || host.endsWith("." + site)) },
    chrome: {
      runtime: { id: "zizai", getManifest: () => manifest, onInstalled: on("installed"), onStartup: on("startup"), onMessage: on("message") },
      permissions: { getAll: async () => ({ origins: [...manifest.host_permissions, "*://*.example.org/*"] }), onAdded: on("added"), onRemoved: on("removed") },
      scripting: {
        getRegisteredContentScripts: async ({ ids }) => registered.filter(script => ids.includes(script.id)),
        // Like Chrome: an id that is not registered fails the whole call.
        unregisterContentScripts: async ({ ids }) => {
          if (ids.some(id => !registered.some(script => script.id === id))) throw new Error("Nonexistent script ID");
          for (const id of ids) registered.splice(registered.findIndex(script => script.id === id), 1);
        },
        registerContentScripts: async scripts => {
          if (scripts.some(script => registered.some(old => old.id === script.id))) throw new Error("Duplicate script ID");
          registered.push(...scripts);
        }
      },
      tabs: { TAB_ID_NONE: -1, create: async () => {} },
      declarativeNetRequest: {}
    },
    AbortSignal, URL, btoa, fetch
  };
  runInNewContext(readFileSync(join(dir, "background.js"), "utf8"), context);
  listeners.added();
  await new Promise(resolve => setTimeout(resolve, 20));
  // A second change re-registers cleanly (no duplicate, no stale entries).
  listeners.removed();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(registered.length, 2);
  const sites = registered.find(script => script.id === "zizai-sites");
  assert.deepEqual([...sites.matches], ["*://*.example.org/*"]);
  assert.deepEqual([...sites.js], manifest.content_scripts[0].js);
  assert.equal(sites.allFrames, true);
  // Page data only where previews are on: Weibo (weibo.cn is off here), Jike, X, Instagram.
  const data = registered.find(script => script.id === "zizai-page-data");
  assert.equal(data.world, "MAIN");
  assert.deepEqual([...data.js], ["page-media.js"]);
  assert.deepEqual([...data.matches], ["*://*.okjike.com/*", "*://*.weibo.com/*", "*://*.x.com/*", "*://*.twitter.com/*", "*://*.instagram.com/*"]);
});

test("two copies from the same image server run one after the other, each with its own page's origin", async () => {
  const rules = [];
  let active = 0, overlap = false;
  const handle = background(async () => {
    active++; if (active > 1) overlap = true;
    await new Promise(resolve => setTimeout(resolve, 15));
    active--;
    return new Response(Uint8Array.of(0x47, 0x49, 0x46), { headers: { "content-type": "image/gif" } });
  }, rules);
  const ask = page => new Promise(resolve => handle({ type: "fetchImageBytes", url: "https://wx1.sinaimg.cn/large/a.gif" },
    { id: "zizai", tab: { id: 1 }, frameId: 0, url: page }, resolve));
  const [a, b] = await Promise.all([ask("https://weibo.com/a"), ask("https://m.weibo.cn/b")]);
  assert.ok(a.ok && b.ok);
  assert.equal(overlap, false);
  const steps = rules.map(change => change.addRules?.length ? "add " + change.addRules[0].action.requestHeaders[0].value : "remove");
  assert.deepEqual(steps, ["add https://weibo.com/", "remove", "add https://m.weibo.cn/", "remove"]);
});

test("a temporary rule that will not go away stops downloads instead of lingering", async () => {
  const rules = [];
  let failing = true;
  const options = { failRemove: () => failing };
  const handle = background(async () => new Response(Uint8Array.of(0x47, 0x49, 0x46), { headers: { "content-type": "image/gif" } }), rules, options);
  const ask = page => new Promise(resolve => handle({ type: "fetchImageBytes", url: "https://wx1.sinaimg.cn/large/a.gif" },
    { id: "zizai", tab: { id: 1 }, frameId: 0, url: page }, resolve));
  assert.equal((await ask("https://weibo.com/a")).ok, false, "the download whose rule stuck fails");
  const adds = () => rules.filter(change => change.addRules?.length).length;
  const before = adds();
  assert.equal((await ask("https://m.weibo.cn/b")).ok, false, "the next one does not start while a rule is stuck");
  assert.equal(adds(), before, "no second rule is added next to the stuck one");
  failing = false;
  assert.equal((await ask("https://m.weibo.cn/b")).ok, true, "once cleanup works, downloads work again");
  assert.equal(options.active.size, 0);
});

test("pictures on this computer or the local network are never fetched for a public page", async () => {
  let fetched = 0;
  const handle = background(async () => { fetched++; return new Response(Uint8Array.of(0x47), { headers: { "content-type": "image/gif" } }); });
  const ask = url => new Promise(resolve => handle({ type: "fetchImageBytes", url }, { id: "zizai", tab: { id: 1 }, frameId: 0, url: "https://weibo.com/a" }, resolve));
  for (const url of ["http://127.0.0.1/a.gif", "http://192.168.1.2/a.gif", "http://router.local/a.gif", "http://[::1]/a.gif"]) {
    assert.equal((await ask(url)).ok, false, url);
  }
  assert.equal(fetched, 0);
});
