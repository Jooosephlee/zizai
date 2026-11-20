// Layout audit for the Zizai overlay. Run window.__audit() while a preview
// is open; window.__matrix() opens every picture on the page in both modes.
(() => {
  const root = () => document.getElementById("__zizai_overlay")?.shadowRoot;
  const visible = el => el && !el.hidden && el.offsetParent !== null && getComputedStyle(el).display !== "none" &&
    getComputedStyle(el).visibility !== "hidden" && el.getBoundingClientRect().width > 0;
  const rect = el => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
  const overlap = (a, b) => Math.max(0, Math.min(a.r, b.r) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.y, b.y));

  window.__audit = () => {
    const r = root();
    if (!r || r.querySelector(".stage").hidden) return null;
    const q = s => r.querySelector(s);
    const stage = q(".stage");
    const full = stage.classList.contains("full");
    const parts = {
      picture: q(".picture"), card: q(".caption"), acts: full && q(".img-acts"), corner: q(".full-controls"),
      prev: q(".nav.prev"), next: q(".nav.next"), strip: q(".pager"), vbar: q(".vbar"), lbar: q(".lbar"), live: q(".live-mark")
    };
    const main = q(".picture>.main");
    const box = {};
    for (const [k, el] of Object.entries(parts)) {
      if (!el || !visible(el)) continue;
      if (k === "acts" && ![...el.children].some(visible)) continue;
      box[k] = rect(el);
    }
    // The picture's content: what of the image is inside the frame.
    let content = null;
    if (main && box.picture) {
      const m = rect(main);
      content = { x: Math.max(m.x, box.picture.x), y: Math.max(m.y, box.picture.y), r: Math.min(m.r, box.picture.r), b: Math.min(m.b, box.picture.b) };
      content.w = content.r - content.x; content.h = content.b - content.y;
    }
    const issues = [];
    const W = innerWidth, H = innerHeight;
    for (const [k, b] of Object.entries(box)) {
      if (b.x < -1 || b.y < -1 || b.r > W + 1 || b.b > H + 1) issues.push(k + " leaves the window");
    }
    if (box.card && box.picture && overlap(box.card, box.picture) > 4 && !q(".caption.open")) issues.push("card covers picture");
    // Chrome pieces never overlap each other.
    const chrome = ["acts", "corner", "prev", "next", "strip", "vbar", "lbar", "live"].filter(k => box[k]);
    for (let i = 0; i < chrome.length; i++) for (let j = i + 1; j < chrome.length; j++) {
      if (overlap(box[chrome[i]], box[chrome[j]]) > 4) issues.push(chrome[i] + " meets " + chrome[j]);
    }
    // Chrome never sits on the card.
    if (box.card) for (const k of chrome) if (overlap(box[k], box.card) > 4) issues.push(k + " on card");
    // How much of the picture's content chrome covers (always-on pieces only:
    // the strip and arrows fade when the pointer rests).
    const covered = content ? Object.fromEntries(chrome.map(k => [k, Math.round(overlap(box[k], content))]).filter(([, v]) => v)) : {};
    return {
      mode: full ? "full" : "float",
      layout: (q(".caption").className.match(/\b(side|below)\b/) || ["none"])[0] + (visible(parts.card) ? "" : "(hidden)"),
      frame: box.picture && [Math.round(box.picture.x), Math.round(box.picture.y), Math.round(box.picture.w), Math.round(box.picture.h)].join(","),
      card: box.card && [Math.round(box.card.w), Math.round(box.card.h)].join("x"),
      use: content ? Math.round(content.w * content.h / (W * H) * 100) + "%" : "",
      long: q(".picture").classList.contains("long"),
      covered, issues
    };
  };

  const sleep = ms => new Promise(res => setTimeout(res, ms));
  const hover = el => {
    const r = el.getBoundingClientRect();
    const init = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, composed: true };
    for (const type of ["pointerover", "pointerenter", "mouseover", "pointermove", "mousemove"]) el.dispatchEvent(new (type.startsWith("pointer") ? PointerEvent : MouseEvent)(type, init));
  };
  const key = (k, code) => document.dispatchEvent(new KeyboardEvent("keydown", { key: k, code, bubbles: true, composed: true }));
  const away = () => { document.body.dispatchEvent(new PointerEvent("pointermove", { clientX: innerWidth - 2, clientY: innerHeight - 2, bubbles: true })); };

  // Opens the first picture of each post, float then full, and steps
  // through the set, auditing each step.
  window.__matrix = async (selector = "article") => {
    const out = [];
    for (const [n, post] of [...document.querySelectorAll(selector)].entries()) {
      const first = post.querySelector("img,video");
      if (!first) continue;
      first.scrollIntoView({ block: "center" });
      await sleep(200);
      key("Escape", "Escape"); away(); await sleep(300);
      hover(first); await sleep(1400);
      const float = __audit();
      key("f", "KeyF"); await sleep(1200);
      const steps = [];
      const count = root()?.querySelectorAll(".thumb").length || 1;
      for (let i = 0; i < count; i++) {
        steps.push(__audit());
        if (count > 1) { key("ArrowRight", "ArrowRight"); await sleep(1000); }
      }
      const frames = new Set(steps.filter(Boolean).map(s => s.frame + "|" + s.card));
      out.push({ post: n + 1, float, full: steps, frameStable: frames.size <= 1 });
      key("Escape", "Escape"); await sleep(300);
    }
    return out;
  };
})();
// Scrolls post n (1-based) into view and returns its first picture's
// centre in an 800x600 screenshot frame.
window.__target = (n, frameW = 800, frameH = 600) => {
  const el = document.querySelectorAll(".row")[n - 1].querySelector("img,video");
  el.scrollIntoView({ block: "center" });
  const r = el.getBoundingClientRect();
  return [Math.round((r.left + r.width / 2) * frameW / innerWidth), Math.round((r.top + r.height / 2) * frameH / innerHeight)];
};
window.__log = [];
window.__rec = label => { const a = __audit(); __log.push({ label, ...a }); return a && (a.mode + " " + a.layout + " frame " + a.frame + " card " + a.card + " use " + a.use + (a.long ? " LONG" : "") + " cover " + JSON.stringify(a.covered) + " issues " + JSON.stringify(a.issues)); };
// Which controls are visible right now (opacity above half).
window.__shown = () => {
  const r = document.getElementById("__zizai_overlay")?.shadowRoot;
  if (!r) return [];
  const names = { ".img-acts": "acts", ".nav.prev": "prev", ".nav.next": "next", ".pager": "strip", ".full-controls": "corner", ".vbar": "vbar", ".flash": "count" };
  return Object.entries(names).filter(([sel]) => {
    const el = r.querySelector(sel);
    return el && !el.hidden && getComputedStyle(el).display !== "none" && Number(getComputedStyle(el).opacity) > 0.5;
  }).map(([, name]) => name);
};
