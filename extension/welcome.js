(() => {
  const message = (key, values) => chrome.i18n.getMessage(key, values);
  const byId = id => document.getElementById(id);
  const motionOK = !matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Four steps. Each one plays once by itself, then rings the exact spot to
  // try it; doing it shows a tick. Nothing is required: Continue always works.
  const STEPS = [
    { title: "guideStartTitle", body: "guideStartBody", target: ["sampleImage", "guideTryHover"], done: "guideDoneOpen", play: playOpen },
    { title: "guideFullTitle", body: "guideFullBody", target: ["demoPicture", "guideTryScroll"], done: "guideDoneFlip", play: playFlip, open: true, ways: true },
    { title: "guideCopyTitle", body: "guideCopyBody", target: ["demoPicture", "guideTryClose"], done: "guideDoneClose", play: playClose, open: true,
      also: [["guideAlsoVideoLabel", "guideAlsoVideo"], ["guideAlsoMoreLabel", "guideAlsoMore"]] },
    { title: "guideReadyTitle", body: "guideReadyBody", play: playSites, sites: true }
  ];
  const PICTURES = ["demo-landscape.svg", "demo-evening.svg"];
  let step = 0, picture = 0, isOpen = false, dismissed = false, hoverTimer = 0, peekTimer = 0, wheelAt = 0;
  let token = 0, playing = false;

  document.documentElement.lang = chrome.i18n.getUILanguage();
  document.title = message("guideTitle");
  byId("version").textContent = chrome.runtime.getManifest().version_name || chrome.runtime.getManifest().version;
  for (const node of document.querySelectorAll("[data-message]")) node.textContent = message(node.dataset.message);
  for (const node of document.querySelectorAll("[data-message-aria]")) node.setAttribute("aria-label", message(node.dataset.messageAria));
  // The made-up author's initial, in the reader's language.
  for (const node of document.querySelectorAll(".avatar")) node.textContent = [...message("demoAuthor")][0] || "";

  const page = byId("demoPage"), view = byId("demoView"), cursor = byId("cursor");

  // ---- The viewer, as the extension behaves ----
  function showPicture() {
    byId("demoImage").src = PICTURES[picture];
    byId("demoCount").textContent = (picture + 1) + " / " + PICTURES.length;
    [...byId("strip").querySelectorAll("img")].forEach((img, i) => img.classList.toggle("on", i === picture));
  }
  function openView(byReader) {
    clearTimeout(hoverTimer);
    if (isOpen) return;
    isOpen = true;
    view.hidden = false;
    view.classList.add("full");
    showPicture();
    const dot = byId("redDot");
    dot.classList.add("peek");
    clearTimeout(peekTimer);
    peekTimer = setTimeout(() => dot.classList.remove("peek"), 1400);
    if (byReader && step === 0) succeed();
    placeTarget();
  }
  function closeView(byReader) {
    if (!isOpen) return;
    isOpen = false;
    view.hidden = true;
    // The picture stays closed until the pointer leaves it, as in the extension.
    dismissed = byReader;
    if (byReader && step === 2) succeed();
    placeTarget();
  }
  function turn(delta, way, byReader) {
    if (!isOpen) return;
    picture = (picture + delta + PICTURES.length) % PICTURES.length;
    showPicture();
    for (const id of ["wayWheel", "wayPad", "wayKeys"]) byId(id).classList.toggle("on", id === way);
    clearTimeout(turn.timer);
    turn.timer = setTimeout(() => { for (const id of ["wayWheel", "wayPad", "wayKeys"]) byId(id).classList.remove("on"); }, 700);
    if (byReader && step === 1) succeed();
  }

  // ---- Where to try, and the tick when it is done ----
  let succeeded = false;
  function placeTarget() {
    const target = byId("target"), s = STEPS[step];
    const wanted = !playing && !succeeded && s.target;
    // On the close step the ring is only useful while the view is open.
    const ready = wanted && (step !== 2 || isOpen) && (step !== 1 || isOpen) && (step !== 0 || !isOpen);
    target.hidden = !ready;
    if (!ready) return;
    const el = byId(s.target[0]);
    const box = page.getBoundingClientRect(), r = el.getBoundingClientRect();
    Object.assign(target.style, { left: r.left - box.left + "px", top: r.top - box.top + "px", width: r.width + "px", height: r.height + "px" });
    byId("targetLabel").textContent = message(s.target[1]);
    target.classList.toggle("above", r.bottom - box.top > box.height - 60);
  }
  function succeed() {
    if (playing || succeeded) return;
    succeeded = true;
    byId("status").textContent = message(STEPS[step].done);
    byId("next").classList.add("ready");
    placeTarget();
  }

  // ---- Playing a step once, with the demo's own pointer ----
  const wait = (ms, my) => new Promise((ok, no) => setTimeout(() => (my === token ? ok() : no("stop")), ms));
  function at(el, fx = .5, fy = .5) {
    const box = page.getBoundingClientRect(), r = el.getBoundingClientRect();
    return [r.left - box.left + r.width * fx, r.top - box.top + r.height * fy];
  }
  function moveCursor([x, y], ms) {
    cursor.style.transition = ms ? `transform ${ms}ms cubic-bezier(.45,0,.2,1), opacity .25s` : "opacity .25s";
    cursor.style.transform = `translate(${x}px, ${y}px)`;
    cursor.classList.add("on");
  }
  function tapAt([x, y]) {
    const tap = byId("tap");
    Object.assign(tap.style, { left: x + "px", top: y + "px" });
    tap.classList.remove("go"); void tap.offsetWidth; tap.classList.add("go");
  }
  function wheelAtCursor([x, y]) {
    const tick = byId("wheelTick");
    Object.assign(tick.style, { left: x + "px", top: y + "px" });
    tick.classList.remove("go"); void tick.offsetWidth; tick.classList.add("go");
  }
  const corner = () => [page.clientWidth - 40, page.clientHeight - 30];

  async function playOpen(my) {
    closeView(false);
    moveCursor(corner(), 0);
    await wait(400, my);
    const spot = at(byId("sampleImage"), .5, .55);
    moveCursor(spot, 900);
    await wait(1400, my);
    openView(false);
    await wait(1900, my);
    closeView(false);
  }
  async function playFlip(my) {
    openView(false);
    const spot = at(byId("demoPicture"), .55, .5);
    moveCursor(corner(), 0);
    await wait(300, my);
    moveCursor(spot, 700);
    await wait(900, my);
    for (const way of ["wayWheel", "wayPad", "wayKeys"]) {
      if (way !== "wayKeys") wheelAtCursor(spot);
      turn(1, way, false);
      await wait(1000, my);
    }
  }
  async function playClose(my) {
    openView(false);
    const spot = at(byId("demoPicture"), .55, .5);
    moveCursor(corner(), 0);
    await wait(300, my);
    moveCursor(spot, 700);
    await wait(900, my);
    tapAt(spot);
    closeView(false);
    await wait(900, my);
    // Rest on the picture again: it opens again, ready to try.
    moveCursor(at(byId("sampleImage"), .5, .55), 600);
    await wait(1000, my);
    openView(false);
    await wait(500, my);
  }
  async function playSites(my) {
    const sites = byId("sites"), sw = sites.querySelector(".switch"), allow = sites.querySelector(".allow");
    sw.classList.remove("on");
    sites.classList.add("playing");
    for (const [i, id] of ["site1", "site2", "site3"].entries()) {
      for (const el of sites.querySelectorAll(".site-step")) el.classList.toggle("now", el.id === id);
      await wait(500, my);
      if (i === 1) sw.classList.add("on");
      if (i === 2) { allow.classList.add("press"); await wait(200, my); allow.classList.remove("press"); }
      await wait(1100, my);
    }
  }
  function settle() {
    // The state each step should rest in, played or not.
    const s = STEPS[step];
    if (s.open) openView(false);
    else if (!s.sites && step === 0) closeView(false);
    if (s.sites) {
      byId("sites").classList.remove("playing");
      byId("sites").querySelector(".switch").classList.add("on");
    }
    cursor.classList.remove("on");
    playing = false;
    placeTarget();
  }
  async function play() {
    const my = ++token;
    playing = true;
    placeTarget();
    try {
      if (motionOK) await STEPS[step].play(my);
    } catch (e) {
      if (e !== "stop") throw e;
      return;
    }
    if (my === token) settle();
  }
  // The reader takes over at once: any press, scroll or key in the demo.
  function takeOver() {
    if (!playing) return;
    token++;
    settle();
  }

  function showStep(index) {
    token++;
    playing = false;
    step = Math.max(0, Math.min(index, STEPS.length - 1));
    const s = STEPS[step];
    succeeded = false;
    byId("status").textContent = "";
    byId("next").classList.remove("ready");
    byId("stepLabel").textContent = message("guideStep", [String(step + 1), String(STEPS.length)]);
    byId("headline").textContent = message(s.title);
    byId("description").textContent = message(s.body);
    const also = byId("also");
    also.hidden = !s.also;
    also.replaceChildren(...(s.also || []).map(([label, text]) => {
      const li = document.createElement("li");
      const b = document.createElement("b");
      b.textContent = message(label);
      li.append(b, (document.documentElement.lang.startsWith("zh") ? "：" : ": ") + message(text));
      return li;
    }));
    byId("ways").hidden = !s.ways;
    byId("demo").hidden = Boolean(s.sites);
    byId("sites").hidden = !s.sites;
    byId("back").hidden = step === 0;
    byId("next").textContent = message(step === STEPS.length - 1 ? "guideDone" : "guideNext");
    byId("counter").textContent = (step + 1) + " / " + STEPS.length;
    for (const [i, button] of [...byId("progress").children].entries()) {
      if (i === step) button.setAttribute("aria-current", "step");
      else button.removeAttribute("aria-current");
    }
    dismissed = false;
    // Steps 2 and 3 start with the view open; Continue lands on it ready.
    if (s.open) openView(false);
    else closeView(false);
    byId("headline").focus({ preventScroll: true });
    void play();
  }

  for (let i = 0; i < STEPS.length; i++) {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", message(STEPS[i].title).replace(/\n/g, " "));
    button.addEventListener("click", () => showStep(i));
    byId("progress").append(button);
  }
  byId("next").addEventListener("click", () => {
    if (step === STEPS.length - 1) window.close();
    else showStep(step + 1);
  });
  byId("back").addEventListener("click", () => showStep(step - 1));
  byId("skip").addEventListener("click", () => window.close());
  byId("replay").addEventListener("click", () => { succeeded = false; byId("status").textContent = ""; byId("next").classList.remove("ready"); void play(); });

  // ---- The reader's own hand ----
  for (const type of ["pointerdown", "wheel"]) page.addEventListener(type, event => { if (event.isTrusted) takeOver(); }, { capture: true, passive: true });
  const sample = byId("sampleImage");
  sample.addEventListener("pointerenter", event => {
    if (!event.isTrusted || playing || dismissed || isOpen) return;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => openView(true), 320);
  });
  sample.addEventListener("pointerleave", event => { if (!event.isTrusted) return; clearTimeout(hoverTimer); dismissed = false; });
  sample.addEventListener("click", event => { if (event.isTrusted) openView(true); });
  sample.addEventListener("focus", () => { if (!dismissed && !playing) openView(true); });

  view.addEventListener("wheel", event => {
    event.preventDefault();
    const now = Date.now();
    if (now - wheelAt < 320 || Math.abs(event.deltaY) + Math.abs(event.deltaX) < 4) return;
    wheelAt = now;
    const pad = event.deltaMode === 0 && Math.abs(event.deltaY) < 40;
    turn((event.deltaY || event.deltaX) > 0 ? 1 : -1, pad ? "wayPad" : "wayWheel", true);
  }, { passive: false });

  // Close: the picture or the space around it, the red dot, or Esc. The post
  // and the strip keep it open; a drag is not a click.
  let pressed = null;
  view.addEventListener("pointerdown", event => { pressed = { x: event.clientX, y: event.clientY }; });
  view.addEventListener("click", event => {
    const start = pressed;
    pressed = null;
    if (!event.isTrusted || !start || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) return;
    const path = event.composedPath();
    const thumb = path.find(node => node instanceof HTMLImageElement && node.parentElement === byId("strip"));
    if (thumb) { picture = [...byId("strip").querySelectorAll("img")].indexOf(thumb); showPicture(); return; }
    if (path.includes(byId("strip")) || path.includes(byId("demoCaption"))) return;
    closeView(true);
  });
  document.addEventListener("keydown", event => {
    if (!isOpen || event.metaKey || event.ctrlKey || event.altKey) return;
    if (!["ArrowRight", "ArrowLeft", "Escape"].includes(event.key)) return;
    takeOver();
    if (event.key === "ArrowRight") turn(1, "wayKeys", true);
    else if (event.key === "ArrowLeft") turn(-1, "wayKeys", true);
    else closeView(true);
    event.preventDefault();
  });
  addEventListener("resize", placeTarget);

  showStep(0);
})();
