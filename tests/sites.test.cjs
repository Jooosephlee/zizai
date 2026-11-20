const assert = require("node:assert/strict");
const { test } = require("node:test");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { runInNewContext } = require("node:vm");

const context = { URL, __zizai_keys: { resolve: () => ({}) }, chrome: {} };
context.globalThis = context;
runInNewContext(readFileSync(join(__dirname, "../extension/settings.js"), "utf8"), context);
const config = context.__zizai_settings;

test("common image sites are on by default, other sites are off", () => {
  const { sites } = config.normalize({});
  for (const host of ["www.xiaohongshu.com", "web.okjike.com", "weibo.com", "x.com", "www.rednote.com", "www.pinterest.com"]) {
    assert.equal(config.siteAllowed(host, sites), true, host);
  }
  for (const host of ["one.google.com", "example.com", "notweibo.com", "www.zhihu.com", ""]) {
    assert.equal(config.siteAllowed(host, sites), false, host);
  }
});

test("turning a site on stores it without www, and turning it off removes the covering entry", () => {
  const on = config.toggleSite("www.example.com", ["zhihu.com"]);
  assert.deepEqual([...on], ["zhihu.com", "example.com"]);
  assert.equal(config.siteAllowed("img.example.com", on), true);
  const off = config.toggleSite("www.zhihu.com", on);
  assert.deepEqual([...off], ["example.com"]);
});

test("stored lists are cleaned, and an emptied list stays empty", () => {
  assert.deepEqual([...config.normalize({ sites: ["https://www.Example.com/path", "example.com", "bad site"] }).sites], ["example.com"]);
  assert.deepEqual([...config.normalize({ sites: [] }).sites], []);
});

test("settings that are now fixed ignore stored values, and the delay snaps to one of three steps", () => {
  const settings = config.normalize({ captionLayout: "below", captionStyle: "thin", edgeExit: true, steadyHover: false, wheelSensitivity: "fast", delay: 0 });
  assert.equal(settings.captionLayout, "side");
  assert.equal(settings.captionStyle, "glass");
  assert.equal(settings.edgeExit, false);
  assert.equal(settings.steadyHover, true);
  assert.equal(settings.wheelSensitivity, "medium");
  assert.equal(settings.delay, 150);
  assert.equal(config.normalize({ delay: 1200 }).delay, 600);
  assert.equal(config.normalize({}).delay, 320);
});
