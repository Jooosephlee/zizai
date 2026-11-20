const assert = require("node:assert/strict");
const { test } = require("node:test");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { runInNewContext } = require("node:vm");

const source = readFileSync(join(__dirname, "../extension/page-media.js"), "utf8");

// A fake Weibo page: the feed answer holds a long post cut short; the
// long-text endpoint answers with the whole text. Every request is logged.
function page(hostname, answers) {
  const listeners = {};
  const document = {
    readyState: "complete",
    addEventListener: (type, listener) => (listeners[type] ||= []).push(listener),
    removeEventListener: (type, listener) => { listeners[type] = (listeners[type] || []).filter(item => item !== listener); },
    dispatchEvent: event => (listeners[event.type] || []).forEach(listener => listener(event)),
    querySelectorAll: () => []
  };
  class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } }
  const requests = [];
  const window = {
    fetch: async url => {
      requests.push(String(url));
      const payload = answers(new URL(url, "https://" + hostname + "/"));
      return { headers: { get: () => null }, clone: () => ({ json: async () => payload }) };
    }
  };
  function XMLHttpRequest() {}
  XMLHttpRequest.prototype = { open() {}, send() {} };
  runInNewContext(source, { window, document, CustomEvent, XMLHttpRequest, URL, JSON, location: { hostname, href: "https://" + hostname + "/" } });
  const ask = url => {
    let post = null;
    const listener = event => { post = JSON.parse(event.detail).post; };
    document.addEventListener("__zizai_post_response", listener);
    document.dispatchEvent(new CustomEvent("__zizai_post_request", { detail: JSON.stringify({ requestId: "r", url }) }));
    document.removeEventListener("__zizai_post_response", listener);
    return post;
  };
  const wantText = url => document.dispatchEvent(new CustomEvent("__zizai_longtext_request", { detail: JSON.stringify({ url }) }));
  const settle = () => new Promise(resolve => setTimeout(resolve, 10));
  return { window, ask, wantText, settle, requests };
}

const FULL = "第一段。".repeat(80);
const feed = {
  data: { statuses: [{
    mblogid: "Pabc123", idstr: "500", isLongText: true, text_raw: "第一段。第一段。…",
    user: { screen_name: "长文作者" }, pic_ids: ["PIC1"], pic_infos: { PIC1: { large: { url: "https://wx1.sinaimg.cn/large/PIC1.jpg" } } }
  }] }
};
const picture = "https://wx1.sinaimg.cn/orj360/PIC1.jpg";

test("the full page gets a long Weibo post's whole text, once, from the page's long-text endpoint", async () => {
  const site = page("weibo.com", url => url.pathname === "/ajax/statuses/longtext" ? { data: { longTextContent: FULL } } : feed);
  await site.window.fetch("https://weibo.com/ajax/feed/friends");
  await site.settle();
  assert.equal(site.ask(picture).truncated, true);

  site.wantText(picture);
  await site.settle();
  const post = site.ask(picture);
  assert.equal(post.content, FULL);
  assert.equal(post.truncated, false);
  assert.deepEqual(site.requests.slice(1), ["/ajax/statuses/longtext?id=Pabc123"]);

  // Asking again does not request again.
  site.wantText(picture);
  await site.settle();
  assert.equal(site.requests.length, 2);
});

test("a long text the page loaded itself (the reader clicked 展开) fills in the post", async () => {
  const site = page("weibo.com", url => url.pathname === "/ajax/statuses/longtext" ? { data: { longTextContent: FULL } } : feed);
  await site.window.fetch("https://weibo.com/ajax/feed/friends");
  await site.window.fetch("https://weibo.com/ajax/statuses/longtext?id=500");
  await site.settle();
  assert.equal(site.ask(picture).content, FULL);
});

test("no long-text request is made off Weibo, or for a post that is already whole", async () => {
  const whole = { data: { statuses: [{ ...feed.data.statuses[0], isLongText: false, text_raw: "短" }] } };
  const site = page("weibo.com", () => whole);
  await site.window.fetch("https://weibo.com/ajax/feed/friends");
  await site.settle();
  site.wantText(picture);
  await site.settle();
  assert.equal(site.requests.length, 1);

  const x = page("x.com", () => ({}));
  x.wantText(picture);
  await x.settle();
  assert.equal(x.requests.length, 0);
});
