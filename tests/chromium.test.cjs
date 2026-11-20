const assert = require("node:assert/strict");
const { test } = require("node:test");
const { spawn } = require("node:child_process");
const { createServer } = require("node:http");
const { mkdtempSync, rmSync, writeFileSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { once } = require("node:events");
const { setTimeout: sleep } = require("node:timers/promises");

test("extension browser acceptance", {
  skip: !process.env.ZIZAI_CHROMIUM,
  timeout: 60000
}, async t => {
  const requests = [];
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500"><rect width="800" height="500" fill="teal"/></svg>';
  const gif = Buffer.from("R0lGODlhAQABAIAAAAD/AP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
  const server = createServer((req, res) => {
    requests.push({ path: req.url, cookie: req.headers.cookie });
    res.setHeader("cache-control", "no-store");
    if (/\.svg$/.test(req.url)) {
      res.setHeader("content-type", "image/svg+xml");
      res.end(svg);
    } else if (req.url === "/image.gif") {
      res.setHeader("content-type", "image/gif");
      res.end(gif);
    } else if (req.url === "/") {
      res.setHeader("content-type", "text/html");
      res.end('<!doctype html><style>body{margin:40px}img{width:200px;height:125px}figure{margin:0;display:flex;gap:16px}.bg{margin-top:30px;width:200px;height:125px;background:url(/image.gif)}input{display:block;margin-top:20px}</style><figure><img id="first" src="/first.svg"><img id="second" src="/second.svg"></figure><div class="bg"></div><input id="typing"><p id="text">Copy this text</p><script>document.cookie="fixture=present; path=/";window.copyKeys=0;window.addEventListener("keydown",e=>{if(e.code==="KeyC")window.copyKeys++})</script>');
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const origin = "http://127.0.0.1:" + server.address().port;
  // The same fixture under a built-in site's name: on from install.
  const builtIn = "http://zizai-test.zcool.com.cn:" + server.address().port;
  const profile = mkdtempSync(join(tmpdir(), "zizai-chromium-"));
  t.after(() => rmSync(profile, { recursive: true, force: true, maxRetries: 5 }));
  const extension = resolve(__dirname, "../extension");
  const browser = spawn(process.env.ZIZAI_CHROMIUM, [
    "--headless=new", "--no-first-run", "--no-default-browser-check",
    "--use-mock-keychain", "--password-store=basic",
    "--disable-background-networking", "--disable-component-update", "--disable-sync",
    "--disable-features=MediaRouter,OptimizationHints", "--lang=en-US",
    "--window-size=1280,900", "--remote-debugging-pipe",
    "--host-resolver-rules=MAP zizai-test.zcool.com.cn 127.0.0.1", "--no-proxy-server", "--unsafely-treat-insecure-origin-as-secure=" + builtIn,
    "--user-data-dir=" + profile,
    "--disable-extensions-except=" + extension, "--load-extension=" + extension,
    "about:blank"
  ], { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] });
  let diagnostics = "";
  browser.stderr.setEncoding("utf8").on("data", text => { diagnostics = (diagnostics + text).slice(-4000); });
  let sequence = 0;
  let buffer = "";
  const pending = new Map();
  const errors = [];
  const fixtures = new Map();
  browser.stdio[4].setEncoding("utf8").on("data", chunk => {
    buffer += chunk;
    let boundary;
    while ((boundary = buffer.indexOf("\0")) >= 0) {
      const data = JSON.parse(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 1);
      if (data.method === "Runtime.exceptionThrown") errors.push(data.params.exceptionDetails);
      if (data.method === "Fetch.requestPaused") {
        const fixture = fixtures.get(data.sessionId);
        if (fixture) {
          Promise.resolve(fixture(data.params.request)).then(response => send("Fetch.fulfillRequest", {
            requestId: data.params.requestId, responseCode: response.status || 200,
            responseHeaders: [{ name: "content-type", value: response.type + (response.type.startsWith("text/") ? "; charset=utf-8" : "") }, { name: "cache-control", value: "no-store" }],
            body: Buffer.from(response.body).toString("base64")
          }, data.sessionId)).catch(error => errors.push(String(error)));
        }
      }
      const entry = pending.get(data.id);
      if (!entry) continue;
      pending.delete(data.id);
      clearTimeout(entry.timer);
      if (data.error) entry.reject(new Error(data.error.message));
      else entry.resolve(data.result);
    }
  });
  const send = (method, params = {}, sessionId) => new Promise((resolveRequest, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(method + " timed out. " + diagnostics));
    }, 8000);
    pending.set(id, { resolve: resolveRequest, reject, timer });
    browser.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + "\0");
  });
  t.after(async () => {
    await send("Browser.close").catch(() => browser.kill());
    if (browser.exitCode === null) await once(browser, "exit");
  });
  const attach = async targetId => {
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    await send("Runtime.enable", {}, sessionId);
    await send("Page.enable", {}, sessionId);
    return sessionId;
  };
  const evaluate = async (session, expression, contextId) => {
    const result = await send("Runtime.evaluate", { expression, contextId, awaitPromise: true, returnByValue: true }, session);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const wait = async (session, expression) => {
    for (let attempt = 0; attempt < 80; attempt++) {
      if (await evaluate(session, expression)) return;
      await sleep(50);
    }
    throw new Error("Condition failed: " + expression + " " +
      JSON.stringify(await evaluate(session, "({url:location.href,text:document.body?.innerText})")) +
      " " + JSON.stringify(errors));
  };
  // The hover checks below are about the floating preview; full view is
  // the default, so pick floating first through the extension's storage.
  for (let attempt = 0; attempt < 80; attempt++) {
    const workers = (await send("Target.getTargets")).targetInfos.filter(target => target.type === "service_worker");
    let picked = false;
    for (const worker of workers) {
      const { sessionId } = await send("Target.attachToTarget", { targetId: worker.targetId, flatten: true });
      // Chromium ships its own extensions too; skip any worker that is not ours.
      const version = await evaluate(sessionId, "chrome.runtime?.getManifest?.().version_name").catch(() => null);
      if (version !== JSON.parse(readFileSync(join(extension, "manifest.json"))).version_name) continue;
      await evaluate(sessionId, 'chrome.storage.local.set({ mode: "float" }).then(() => true)');
      picked = true;
    }
    if (picked) break;
    await sleep(50);
  }
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const page = await attach(targetId);
  await send("Page.navigate", { url: origin }, page);
  await wait(page, 'document.querySelector("#first")?.complete');
  const primary = await evaluate(page, '/mac/i.test(navigator.platform)') ? 4 : 2;
  await sleep(200);
  const visible = '!!document.querySelector("#__zizai_overlay")?.shadowRoot.querySelector(".stage:not([hidden])")';
  const image = 'document.querySelector("#__zizai_overlay")?.shadowRoot.querySelector(".picture img.main")';
  const move = (x, y) => send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }, page);
  const key = async (code, keyValue, modifiers = 0, session = page) => {
    await send("Input.dispatchKeyEvent", { type: "keyDown", code, key: keyValue, modifiers }, session);
    await send("Input.dispatchKeyEvent", { type: "keyUp", code, key: keyValue, modifiers: 0 }, session);
  };

  await move(100, 90);
  await sleep(400);
  assert.equal(await evaluate(page, visible), false, "unlisted sites stay off");
  await key("KeyZ", "z", 1);
  await sleep(400);
  assert.equal(await evaluate(page, visible), false, "an unlisted site only turns on after the reader allows it in the popup");
  await send("Page.navigate", { url: builtIn }, page);
  await wait(page, 'document.querySelector("#first")?.complete');
  await sleep(200);
  await move(1000, 600);
  await move(100, 90);
  await wait(page, visible);
  assert.equal(await evaluate(page, image + ".naturalWidth"), 800);
  await move(1000, 600);
  await wait(page, "!(" + visible + ")");
  await move(100, 90);
  await sleep(50);
  assert.equal(await evaluate(page, visible), false);
  await move(1000, 600);
  await sleep(400);
  assert.equal(await evaluate(page, visible), false);
  await move(100, 90);
  await wait(page, visible);
  await key("KeyF", "f");
  assert.equal(await evaluate(page, 'document.querySelector("#__zizai_overlay").shadowRoot.querySelector(".stage").classList.contains("full")'), true);
  await key("ArrowRight", "ArrowRight");
  await wait(page, image + '?.src.endsWith("/second.svg") && ' + visible);
  await key("Escape", "Escape");
  await move(1000, 600);
  await send("Input.dispatchKeyEvent", { type: "keyDown", code: "ShiftLeft", key: "Shift", modifiers: 8 }, page);
  await move(100, 90);
  await sleep(400);
  assert.equal(await evaluate(page, visible), false, "Shift suppresses new previews");
  await send("Input.dispatchKeyEvent", { type: "keyUp", code: "ShiftLeft", key: "Shift", modifiers: 0 }, page);
  await wait(page, visible);

  await evaluate(page, 'document.querySelector("#typing").focus()');
  await send("Input.dispatchKeyEvent", { type: "keyDown", code: "KeyF", key: "f", text: "f" }, page);
  assert.equal(await evaluate(page, 'document.querySelector("#typing").value'), "f");
  await evaluate(page, 'document.querySelector("#typing").blur(); getSelection().selectAllChildren(document.querySelector("#text"))');
  await key("KeyC", "c", primary);
  assert.equal(await evaluate(page, "window.copyKeys"), 1);
  await evaluate(page, "getSelection().removeAllRanges()");
  await key("Slash", "?", 8);
  assert.equal(await evaluate(page, 'document.querySelector("#__zizai_overlay").shadowRoot.querySelector(".help").hidden'), false);
  await key("Escape", "Escape");
  await wait(page, "!(" + visible + ")");
  await move(104, 94);
  await sleep(400);
  assert.equal(await evaluate(page, visible), false);

  const { targetInfos } = await send("Target.getTargets");
  let extensionId;
  for (const worker of targetInfos.filter(target => target.type === "service_worker")) {
    const { sessionId } = await send("Target.attachToTarget", { targetId: worker.targetId, flatten: true });
    const identity = await evaluate(sessionId, "({id:chrome.runtime?.id,version:chrome.runtime?.getManifest?.().version_name})").catch(() => ({}));
    if (identity.version === JSON.parse(readFileSync(join(extension, "manifest.json"))).version_name) {
      extensionId = identity.id;
      break;
    }
  }
  assert.ok(extensionId, "Zizai service worker loaded");
  const popupTarget = await send("Target.createTarget", { url: "about:blank" });
  const popup = await attach(popupTarget.targetId);
  await send("Page.navigate", { url: "chrome-extension://" + extensionId + "/popup.html" }, popup);
  await send("Emulation.setDeviceMetricsOverride", { width: 380, height: 600, deviceScaleFactor: 1, mobile: false }, popup);
  await wait(popup, 'document.querySelector("#record-toggleMode")?.textContent === "F"');
  await evaluate(popup, 'document.querySelector("#record-toggleMode").click()');
  await key("KeyG", "g", 0, popup);
  await wait(popup, 'document.querySelector("#record-toggleMode").textContent === "G"');
  await evaluate(popup, 'document.querySelector("[data-setting=mode][data-value=float]").click()');
  await send("Page.bringToFront", {}, page);
  await move(1000, 600);
  await move(100, 90);
  await wait(page, visible);
  await key("KeyG", "g");
  assert.equal(await evaluate(page, 'document.querySelector("#__zizai_overlay").shadowRoot.querySelector(".stage").classList.contains("full")'), true);
  await key("KeyZ", "z", 1);
  await wait(page, "!(" + visible + ")");
  await move(110, 90);
  await sleep(400);
  assert.equal(await evaluate(page, visible), false);
  await key("KeyZ", "z", 1);
  await wait(page, visible);

  await move(100, 220);
  await wait(page, image + '?.src.endsWith("/image.gif") && ' + visible);
  // Replace only this isolated world's write endpoint. This validates PNG bytes
  // and network behavior without changing the user's system clipboard.
  const { executionContextId } = await send("Page.createIsolatedWorld", { frameId: (await send("Page.getFrameTree", {}, page)).frameTree.frame.id, worldName: "zizai-test" }, page);
  let isolatedContext;
  for (let id = 1; id < executionContextId + 2; id++) {
    try {
      const found = await evaluate(page, "Boolean(globalThis.__zizai_runtime)", id);
      if (found) { isolatedContext = id; break; }
    } catch {}
  }
  assert.ok(isolatedContext);
  await evaluate(page, 'Object.defineProperty(navigator.clipboard,"write",{configurable:true,value:async items=>{const blob=await items[0].getType("image/png");const bytes=new Uint8Array(await blob.arrayBuffer());globalThis.__zizai_copy={type:blob.type,signature:[...bytes.slice(0,8)]}}})', isolatedContext);
  const beforeCopy = requests.length;
  await key("KeyC", "c", primary);
  for (let i = 0; i < 60; i++) {
    if (await evaluate(page, "Boolean(globalThis.__zizai_copy)", isolatedContext)) break;
    await sleep(50);
  }
  const copied = await evaluate(page, "globalThis.__zizai_copy", isolatedContext);
  assert.equal(copied.type, "image/png");
  assert.deepEqual(copied.signature, [137, 80, 78, 71, 13, 10, 26, 10]);
  const copyRequests = requests.slice(beforeCopy);
  assert.equal(copyRequests.length, 1);
  assert.equal(copyRequests[0].path, "/image.gif");
  assert.equal(copyRequests[0].cookie, undefined);
  assert.equal(errors.length, 0, JSON.stringify(errors));
  console.log("Browser checks passed: hover delay, leave, suppression, mode, gallery, typing, selection, help, dismissal, popup rebinding, site toggle, background, PNG conversion, cookie-free copy.");
  if (process.env.ZIZAI_SCREENSHOT) {
    const { data } = await send("Page.captureScreenshot", {}, popup);
    writeFileSync(process.env.ZIZAI_SCREENSHOT, Buffer.from(data, "base64"));
  }

  // Serve fictional social pages inside the isolated browser. The real host
  // names exercise document-start registration and image-host URL rewriting.
  for (const site of ["jike", "weibo"]) {
    const host = site === "jike" ? "web.okjike.com" : "weibo.com";
    const imageHost = site === "jike" ? "cdnv2.ruguoapp.com" : "wx1.sinaimg.cn";
    const photo = name => site === "jike"
      ? "https://" + imageHost + "/" + name + ".jpg?imageMogr2/thumbnail/180x180/quality/70"
      : "https://" + imageHost + "/orj360/" + name + ".jpg";
    const original = name => site === "jike"
      ? "https://" + imageHost + "/" + name + ".jpg"
      : "https://" + imageHost + "/original/" + name + ".jpg";
    const fullText = "完整正文第一段，图片有自己的故事。\n第二段也会保留在正文卡片里。";
    const payload = site === "jike" ? { data: [{
      id: "fixture-post", content: fullText, user: { screenName: "示例作者" },
      pictures: [{ picUrl: original("first") }, { picUrl: original("second") }]
    }] } : { data: [{
      mblogid: "fixture-post", text_raw: fullText, user: { screen_name: "示例作者" },
      pic_ids: ["first", "second"],
      pic_infos: { first: { original: { url: original("first") } }, second: { original: { url: original("second") } } }
    }] };
    const target = await send("Target.createTarget", { url: "about:blank" });
    const session = await attach(target.targetId);
    const socialRequests = [];
    const api = site === "jike" ? "/api/feed" : "/ajax/feed";
    fixtures.set(session, request => {
      const url = new URL(request.url);
      socialRequests.push(request.url);
      if (url.hostname === host && url.pathname === "/") {
        const bodyClass = site === "jike" ? "_contentWrapper_fixture" : "wbpro-feed-content";
        const body = site === "jike" ? '<div>页面摘要</div>' : '<div class="wbpro-feed-ogText">页面摘要</div>';
        return { type: "text/html", body: '<!doctype html><style>body{margin:40px}img{width:180px;height:120px;object-fit:cover}article{width:500px}</style><article><a href="/u/fixture">示例作者</a><div class="' + bodyClass + '">' + body + '</div><img id="social-first" src="' + photo("first") + '"><img src="' + photo("second") + '"></article><script>fetch("' + api + '").then(r=>r.json()).then(()=>window.fixtureReady=true)</script>' };
      }
      if (url.hostname === host && url.pathname === api) return { type: "application/json", body: JSON.stringify(payload) };
      if (url.hostname === imageHost) {
        const thumbnail = /orj360|thumbnail/.test(url.href);
        return { type: "image/svg+xml", body: svg.replace('width="800" height="500"', thumbnail ? 'width="180" height="120"' : 'width="1600" height="1000"') };
      }
      return { type: "text/plain", body: "", status: 404 };
    });
    await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] }, session);
    await send("Page.navigate", { url: "https://" + host + "/" }, session);
    await wait(session, 'window.fixtureReady && document.querySelector("#social-first")?.complete');
    await send("Page.bringToFront", {}, session);
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 100, y: 130 }, session);
    await wait(session, visible + " && " + image + '?.src === ' + JSON.stringify(original("first")));
    assert.equal(await evaluate(session, image + ".naturalWidth"), 1600, site + " loads original pixels");
    await key("KeyG", "g", 0, session);
    const caption = 'document.querySelector("#__zizai_overlay").shadowRoot.querySelector(".caption")';
    assert.equal(await evaluate(session, caption + ".hidden"), false);
    assert.equal(await evaluate(session, caption + '.querySelector(".name").textContent'), "示例作者");
    assert.equal(await evaluate(session, caption + '.querySelector(".post-body").textContent'), fullText);
    const [captionX, captionY] = await evaluate(session, "(() => { const box = " + caption +
      ".getBoundingClientRect(); return [box.left + box.width / 2, box.top + box.height / 2]; })()");
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: captionX, y: captionY }, session);
    assert.equal(await evaluate(session, visible), true, "moving onto the card keeps full-window preview open");
    await send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, x: captionX, y: captionY }, session);
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, x: captionX, y: captionY }, session);
    assert.equal(await evaluate(session, visible), true, "clicking the card never dismisses the preview");
    await evaluate(session, 'window.cardCopyKey=false;window.addEventListener("keydown",event=>{if(event.code==="KeyC")window.cardCopyKey=!event.defaultPrevented});getSelection().selectAllChildren(document.querySelector("#__zizai_overlay").shadowRoot.querySelector(".post-body"))');
    await key("KeyC", "c", primary, session);
    assert.equal(await evaluate(session, "window.cardCopyKey"), true, "copying selected post text remains a native text copy");
    await evaluate(session, "getSelection().removeAllRanges()");
    await key("ArrowRight", "ArrowRight", 0, session);
    await wait(session, image + '.src === ' + JSON.stringify(original("second")) + " && " + visible);
    assert.equal(socialRequests.filter(url => url.endsWith(api)).length, 1, "the extension never requests another post response");
    assert.ok(socialRequests.every(url => new URL(url).hostname === host || new URL(url).hostname === imageHost));

    // A page script cannot press the viewer's buttons; a real click can.
    const overlay = 'document.querySelector("#__zizai_overlay").shadowRoot';
    const copyButton = overlay + '.querySelector(".img-acts .act")';
    // Any copy notice (in progress, done or failed) means the copy started.
    const copyNotice = "[..." + overlay + '.querySelectorAll("*")].some(node => !node.hidden && !node.children.length && /cop(y|ied|ying)|复制/i.test(node.textContent))';
    await evaluate(session, copyButton + ".click()");
    await sleep(300);
    assert.equal(await evaluate(session, copyNotice), false, "a scripted click does not copy");
    const [copyX, copyY] = await evaluate(session, "(() => { const box = " + copyButton + ".getBoundingClientRect(); return [box.left + box.width / 2, box.top + box.height / 2]; })()");
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: copyX, y: copyY }, session);
    await send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, x: copyX, y: copyY }, session);
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, x: copyX, y: copyY }, session);
    await wait(session, copyNotice);

    if (site === "weibo") {
      // Turning a site off stops the page-data script now, and it is not
      // loaded again on the next visit.
      const ask = '(() => { let got = "none"; document.addEventListener("__zizai_post_response", e => { got = e.detail; }, { once: true }); document.dispatchEvent(new CustomEvent("__zizai_post_request", { detail: JSON.stringify({ requestId: "t", id: "fixture-post", url: "" }) })); return got; })()';
      assert.notEqual(await evaluate(session, ask), "none", "while on, the page data answers");
      await evaluate(popup, 'chrome.storage.local.get("sites").then(({ sites }) => chrome.storage.local.set({ sites: (sites || ' + JSON.stringify(["weibo.com", "okjike.com", "x.com", "twitter.com", "instagram.com"]) + ').filter(site => site !== "weibo.com") })).then(() => true)');
      await wait(session, ask + ' === "none"');
      await sleep(600);
      await send("Page.reload", {}, session);
      await wait(session, 'document.querySelector("#social-first")?.complete');
      assert.equal(await evaluate(session, "Boolean(window.__zizai_post_cache)"), false, "after turning Weibo off, a new page does not load the page-data script");
      await evaluate(popup, 'chrome.storage.local.remove("sites").then(() => true)');
      await sleep(600);
    }
    if (process.env.ZIZAI_SCREENSHOT) {
      const { data } = await send("Page.captureScreenshot", {}, session);
      writeFileSync(process.env.ZIZAI_SCREENSHOT + "." + site + ".png", Buffer.from(data, "base64"));
    }
    await send("Target.closeTarget", { targetId: target.targetId });
    fixtures.delete(session);
  }
  // Instagram keeps only neighboring slides mounted. The site tells us
  // which slide is showing and the total even before its full data arrives.
  const instagram = await send("Target.createTarget", { url: "about:blank" });
  const instagramSession = await attach(instagram.targetId);
  const instagramHost = "www.instagram.com";
  const imageHost = "scontent.cdninstagram.com";
  const instagramCode = "Fixture0001";
  const instagramPath = "/p/" + instagramCode + "/";
  const instagramApi = "/graphql/query";
  const igAuthor = "ig_author";
  const avatarUrl = "https://" + imageHost + "/avatar_s32x32_n.jpg";
  const photoNumber = index => index === 4 ? 2 : index; // The same photo can occupy two positions.
  const previewUrl = index => "https://" + imageHost + "/photo" + photoNumber(index) + "_s468x292_n.jpg";
  const fullUrl = index => "https://" + imageHost + "/photo" + photoNumber(index) + "_p1600x1000_n.jpg";
  const slides = Array.from({ length: 6 }, (_, index) => index + 1);
  const dots = slides.map(index => '<button type="button" aria-label="Go to slide ' + index + '"' +
    (index === 3 ? ' aria-current="step"' : "") + "></button>").join("");
  const instagramPayload = { data: { media: { code: instagramCode, media_type: 8, carousel_media_count: slides.length,
    carousel_media: slides.map(index => ({ image_versions2: { candidates: [{ url: fullUrl(index), width: 1600, height: 1000 }] } }))
  } } };
  const instagramRequests = [];
  let holdPreviewImage = false;
  let releasePreviewImage;
  const previewImageGate = new Promise(resolve => { releasePreviewImage = resolve; });
  fixtures.set(instagramSession, request => {
    const url = new URL(request.url);
    instagramRequests.push(url);
    if (url.hostname === instagramHost && url.pathname === instagramPath) {
      return { type: "text/html", body: `<!doctype html>
        <style>
          body { margin: 40px }
          article { width: 468px }
          .viewport { overflow: hidden }
          [role=list] { position: relative; height: 292px; margin: 0; padding: 0; list-style: none }
          li { position: absolute; left: 0; top: 0 }
          li img { display: block; width: 468px; height: 292px; object-fit: cover }
          .overlay { position: absolute; inset: 0 }
          .tags { position: absolute; left: 8px; top: 8px; width: 60px; height: 40px }
        </style>
        <article>
          <div>
            <span><img src="${avatarUrl}" width="32" height="32" alt="${igAuthor}'s profile picture"></span>
            <a href="/${igAuthor}/">${igAuthor}</a>
            <a href="${instagramPath}"><time>Today</time></a>
          </div>
          <div class="viewport"><ul role="list"></ul></div>
          <div class="dots">${dots}</div>
        </article>
        <script>
          const slideUrls = ${JSON.stringify(slides.map(previewUrl))};
          let track = document.querySelector('[role=list]');
          let dots = [...document.querySelectorAll('.dots button')];
          function showSlide(position) {
            dots.forEach(button => button.removeAttribute('aria-current'));
            dots[position - 1].setAttribute('aria-current', 'step');
            track.style.transform = 'translateX(' + (-(position - 1) * 468) + 'px)';
            const indices = position === 1 ? [1, 2] : [position - 1, position];
            track.replaceChildren(...indices.map(index => {
              const slide = document.createElement('li');
              slide.style.transform = 'translateX(' + ((index - 1) * 468) + 'px)';
              const image = new Image();
              image.src = slideUrls[index - 1];
              const overlay = document.createElement('div');
              overlay.className = 'overlay';
              overlay.setAttribute('role', 'button');
              overlay.setAttribute('aria-label', 'Photo shared by Example');
              const tags = document.createElement('button');
              tags.className = 'tags';
              tags.setAttribute('aria-label', 'Tags');
              tags.textContent = 'Tags';
              slide.append(image, overlay, tags);
              return slide;
            }));
          }
          window.nativeClicks = 0;
          function bindDots() {
            dots.forEach((button, index) => button.addEventListener('click', () => {
              window.nativeClicks++;
              // The page can replace both the media list and the buttons.
              const replacementTrack = track.cloneNode(false);
              track.replaceWith(replacementTrack);
              track = replacementTrack;
              const dotList = button.parentElement;
              dots = dots.map(dot => dot.cloneNode(false));
              dotList.replaceChildren(...dots);
              bindDots();
              showSlide(index + 1);
            }));
          }
          bindDots();
          showSlide(3);
          window.loadInstagramMedia = () => fetch("${instagramApi}").then(r => r.json());
        </script>` };
    }
    if (url.hostname === instagramHost && url.pathname === instagramApi) {
      return { type: "application/json", body: JSON.stringify(instagramPayload) };
    }
    if (url.hostname === imageHost) {
      const original = url.pathname.includes("_p1600x1000");
      const imageResponse = { type: "image/svg+xml", body: svg.replace('width="800" height="500"', original ? 'width="1600" height="1000"' : 'width="468" height="292"') };
      return holdPreviewImage && url.href === previewUrl(3) ? previewImageGate.then(() => imageResponse) : imageResponse;
    }
    return { type: "text/plain", body: "", status: 404 };
  });
  await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] }, instagramSession);
  await send("Page.navigate", { url: "https://" + instagramHost + instagramPath }, instagramSession);
  await wait(instagramSession, 'document.querySelector("li:last-child img")?.naturalWidth === 468');
  await send("Page.bringToFront", {}, instagramSession);
  const [tagsX, tagsY] = await evaluate(instagramSession, `(() => {
    const box = document.querySelector("li:last-child .tags").getBoundingClientRect();
    return [box.left + box.width / 2, box.top + box.height / 2];
  })()`);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: tagsX, y: tagsY }, instagramSession);
  await sleep(400);
  assert.equal(await evaluate(instagramSession, visible), false, "Instagram's Tags control keeps its own pointer hit");
  await send("Network.enable", {}, instagramSession);
  await send("Network.setCacheDisabled", { cacheDisabled: true }, instagramSession);
  holdPreviewImage = true;
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 274, y: 150 }, instagramSession);
  try {
    await wait(instagramSession, visible + ' && !!document.querySelector("#__zizai_overlay").shadowRoot.querySelector(".picture canvas.main")');
  } finally {
    holdPreviewImage = false;
    releasePreviewImage();
  }
  await wait(instagramSession, visible + " && " + image + "?.src === " + JSON.stringify(previewUrl(3)));
  const instagramCount = 'document.querySelector("#__zizai_overlay").shadowRoot.querySelector(".pcount").textContent';
  assert.equal(await evaluate(instagramSession, instagramCount), "3 / 6");
  await key("KeyG", "g", 0, instagramSession);
  assert.equal(await evaluate(instagramSession, instagramCount), "3 / 6", "moving to full view keeps the hovered position");
  await wait(instagramSession, `(() => {
    const avatar = document.querySelector("#__zizai_overlay").shadowRoot.querySelector(".caption .avatar");
    return avatar?.src === ${JSON.stringify(avatarUrl)} && !avatar.hidden && avatar.naturalWidth > 0;
  })()`);
  await key("ArrowRight", "ArrowRight", 0, instagramSession);
  assert.equal(await evaluate(instagramSession, 'document.querySelector(".dots [aria-current=step]").ariaLabel'), "Go to slide 4");
  await wait(instagramSession, visible + " && " + image + "?.src === " + JSON.stringify(previewUrl(4)));
  assert.equal(await evaluate(instagramSession, instagramCount), "4 / 6", "Instagram supplies an unmounted picture after remounting its carousel controls");
  assert.equal(await evaluate(instagramSession, "window.nativeClicks"), 1);
  await evaluate(instagramSession, "window.loadInstagramMedia().then(() => true)");
  await wait(instagramSession, visible + " && " + image + "?.src === " + JSON.stringify(fullUrl(4)));
  assert.equal(await evaluate(instagramSession, instagramCount), "4 / 6", "full metadata keeps the selected position even when another slide uses the same photo");
  await key("ArrowRight", "ArrowRight", 0, instagramSession);
  await wait(instagramSession, visible + " && " + image + "?.src === " + JSON.stringify(fullUrl(5)));
  assert.equal(await evaluate(instagramSession, instagramCount), "5 / 6");
  assert.equal(await evaluate(instagramSession, "window.nativeClicks"), 1, "fully cached navigation stays in the extension");
  assert.equal(instagramRequests.filter(url => url.pathname === instagramApi).length, 1, "only the page requests its own metadata");
  await send("Target.closeTarget", { targetId: instagram.targetId });
  fixtures.delete(instagramSession);

  const targets = await send("Target.getTargets");
  const guide = targets.targetInfos.find(target => target.url === "chrome-extension://" + extensionId + "/welcome.html");
  assert.ok(guide, "first install opens the user guide");
  const guidePage = await attach(guide.targetId);
  await wait(guidePage, 'document.querySelector("#headline")?.textContent.length > 0');
  await evaluate(guidePage, 'document.querySelector("#next").click()');
  assert.equal(await evaluate(guidePage, 'document.querySelector("#demoView").classList.contains("full")'), true);
  assert.ok(await evaluate(guidePage, 'document.querySelector(".demo-caption").textContent.length > 0'));
  if (process.env.ZIZAI_SCREENSHOT) {
    await send("Page.bringToFront", {}, guidePage);
    await evaluate(guidePage, "document.getAnimations().forEach(animation => animation.finish())");
    const { data } = await send("Page.captureScreenshot", {}, guidePage);
    writeFileSync(process.env.ZIZAI_SCREENSHOT + ".guide.png", Buffer.from(data, "base64"));
  }
  assert.equal(errors.length, 0, JSON.stringify(errors));
  console.log("Social checks passed: original images, full post cards, gallery navigation, Instagram late media and slide position, first-install guide.");
});
