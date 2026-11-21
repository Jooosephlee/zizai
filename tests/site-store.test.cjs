const assert = require("node:assert/strict");
const { test } = require("node:test");
const { readFileSync, existsSync, mkdirSync } = require("node:fs");
const { spawn } = require("node:child_process");
const { join } = require("node:path");
const { once } = require("node:events");
const { setTimeout: sleep } = require("node:timers/promises");

const htmlPath = join(__dirname, "../docs/index.html");
const html = readFileSync(htmlPath, "utf8");
const ITEM = "gicgnhlpofjobdoloefejjeaicijcbie";
const store = hl => "https://chromewebstore.google.com/detail/zizai/" + ITEM + "?hl=" + hl;

test("the site links both languages to the published Chrome Web Store item", () => {
  assert.equal(html.includes("尚未上架"), false);
  assert.equal(html.includes("还没上架"), false);
  assert.equal(html.includes("not listed"), false);
  assert.equal(html.includes("install it by hand"), false);
  assert.equal(html.includes("STORE_URL"), false);
  assert.equal((html.match(/gicgnhlpofjobdoloefejjeaicijcbie/g) || []).length >= 3, true);
  assert.equal(html.includes(store("zh-CN")), true);
  assert.equal(html.includes('hl=" + (lang === "en" ? "en" : "zh-CN")'), true);
  assert.equal(html.includes('ctaInstall: "Get it on the Chrome Web Store"'), true);
  assert.equal(html.includes('iGo: "Get it on the Chrome Web Store"'), true);
  assert.equal(html.includes('iNote: "Version 1.1.0 is in the Chrome Web Store."'), true);
  assert.equal(html.includes(">在 Chrome 应用商店安装</a>"), true);
  assert.equal(html.includes("1.1.0 已在 Chrome 应用商店上架。"), true);
  assert.equal(html.includes('href="https://github.com/Jooosephlee/zizai"'), true);
  assert.equal(html.includes("从 GitHub 下载源码"), true);
  assert.equal(html.includes('iSrc: "Download the source on GitHub"'), true);
  assert.equal(html.includes("extension/"), false);
});

const chromium = process.env.ZIZAI_CHROMIUM || (existsSync("/tmp/chrome-linux64/chrome") ? "/tmp/chrome-linux64/chrome" : "");

test("both languages show the store buttons in a browser", { skip: !chromium, timeout: 30000 }, async t => {
  const browser = spawn(chromium, [
    "--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-gpu",
    "--window-size=1280,900", "--remote-debugging-pipe", "--allow-file-access-from-files",
    "about:blank"
  ], { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] });
  let diagnostics = "";
  browser.stderr.setEncoding("utf8").on("data", text => { diagnostics = (diagnostics + text).slice(-2000); });
  let sequence = 0, buffer = "";
  const pending = new Map();
  browser.stdio[4].setEncoding("utf8").on("data", chunk => {
    buffer += chunk;
    let boundary;
    while ((boundary = buffer.indexOf("\0")) >= 0) {
      const data = JSON.parse(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 1);
      const entry = pending.get(data.id);
      if (!entry) continue;
      pending.delete(data.id);
      clearTimeout(entry.timer);
      if (data.error) entry.reject(new Error(data.error.message));
      else entry.resolve(data.result);
    }
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(method + " timed out. " + diagnostics));
    }, 8000);
    pending.set(id, { resolve, reject, timer });
    browser.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + "\0");
  });
  t.after(async () => {
    await send("Browser.close").catch(() => browser.kill());
    if (browser.exitCode === null) await once(browser, "exit").catch(() => {});
  });
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Runtime.enable", {}, sessionId);
  await send("Page.enable", {}, sessionId);
  const evaluate = async expression => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const page = "file://" + htmlPath;
  await send("Page.navigate", { url: page }, sessionId);
  await sleep(400);
  const read = () => evaluate(`(() => {
    const text = name => document.querySelector('[data-i="' + name + '"]').textContent;
    const href = name => document.querySelector('[data-i="' + name + '"]').closest("a").href;
    return {
      lang: document.documentElement.lang,
      hero: text("ctaInstall"), heroHref: href("ctaInstall"),
      title: text("iTitle"), note: text("iNote"),
      go: text("iGo"), goHref: href("iGo"),
      src: text("iSrc"), srcHref: href("iSrc"),
      steps: ["i1", "i2", "i3"].map(text),
      github: document.querySelector("a.repo").href,
      listed: !document.body.innerText.includes("尚未上架") && !document.body.innerText.includes("not listed")
    };
  })()`);
  await evaluate('localStorage.setItem("zizai-lang","zh")');
  await send("Page.reload", {}, sessionId);
  await sleep(500);
  const zh = await read();
  assert.equal(zh.lang, "zh-CN");
  assert.equal(zh.hero, "在 Chrome 应用商店安装");
  assert.equal(zh.heroHref, store("zh-CN"));
  assert.equal(zh.go, "在 Chrome 应用商店安装");
  assert.equal(zh.goHref, store("zh-CN"));
  assert.equal(zh.note, "1.1.0 已在 Chrome 应用商店上架。");
  assert.equal(zh.title, "从应用商店安装。");
  assert.deepEqual(zh.steps, ["打开下面的 Chrome 应用商店页面。", "点「添加至 Chrome」。", "装好后，刷新要看图的网页。"]);
  assert.equal(zh.src, "从 GitHub 下载源码");
  assert.equal(zh.srcHref, "https://github.com/Jooosephlee/zizai/archive/refs/heads/main.zip");
  assert.equal(zh.github, "https://github.com/Jooosephlee/zizai");
  assert.equal(zh.listed, true);

  await evaluate('document.querySelector("#lang").click()');
  await sleep(200);
  const en = await read();
  assert.equal(en.lang, "en");
  assert.equal(en.hero, "Get it on the Chrome Web Store");
  assert.equal(en.heroHref, store("en"));
  assert.equal(en.go, "Get it on the Chrome Web Store");
  assert.equal(en.goHref, store("en"));
  assert.equal(en.note, "Version 1.1.0 is in the Chrome Web Store.");
  assert.equal(en.title, "Install from the Chrome Web Store.");
  assert.deepEqual(en.steps, ["Open the Chrome Web Store page below.", "Click Add to Chrome.", "After it installs, reload the page you want to view."]);
  assert.equal(en.src, "Download the source on GitHub");
  assert.equal(en.srcHref, zh.srcHref);
  assert.equal(en.github, zh.github);
  assert.equal(en.listed, true);

  if (process.env.ZIZAI_SCREENSHOT) {
    mkdirSync(process.env.ZIZAI_SCREENSHOT, { recursive: true });
    const shot = async name => {
      const { data } = await send("Page.captureScreenshot", { format: "png" }, sessionId);
      require("node:fs").writeFileSync(join(process.env.ZIZAI_SCREENSHOT, name), Buffer.from(data, "base64"));
    };
    const scrollTo = async selector => {
      await evaluate(`window.scrollTo(0, ${selector === "top" ? 0 : "document.querySelector('#install').offsetTop - 12"})`);
      await sleep(250);
    };
    await scrollTo("top");
    await shot("hero-en.png");
    await scrollTo("install");
    await shot("install-en.png");
    await evaluate('document.querySelector("#lang").click()');
    await sleep(200);
    await scrollTo("top");
    await shot("hero-zh.png");
    await scrollTo("install");
    await shot("install-zh.png");
  }
});
