const assert = require("node:assert/strict");
const { test } = require("node:test");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { runInNewContext } = require("node:vm");

class Element {
  constructor(rect, style = {}, parent = null) {
    const [left, top, width, height] = rect;
    this.rect = { left, top, width, height, right: left + width, bottom: top + height };
    this.style = style;
    this.parentElement = parent;
  }
  getBoundingClientRect() { return this.rect; }
  getRootNode() { return null; }
  closest() { return this.control ? this : null; }
  contains(element) {
    for (let node = element; node; node = node.parentElement) {
      if (node === this) return true;
    }
    return false;
  }
}

class HTMLImageElement extends Element {
  constructor(rect, [width, height], style, parent) {
    super(rect, style, parent);
    this.naturalWidth = width;
    this.naturalHeight = height;
  }
}

const source = readFileSync(join(__dirname, "../extension/image-geometry.js"), "utf8");

function geometry(top = null) {
  const context = {
    Element, HTMLImageElement,
    window: { innerWidth: 1280, innerHeight: 860, getComputedStyle: node => node.style },
    document: { elementFromPoint: () => top }
  };
  runInNewContext(source, context);
  return context.__zizai_geometry;
}

test("painted image opens inside, keeps at the edge, and ignores contain letterboxing", () => {
  const { previewPointerPictureHit: hit } = geometry();
  const img = new HTMLImageElement([100, 100, 200, 200], [400, 200], { objectFit: "contain" });
  assert.equal(hit(img, { x: 200, y: 200 }), "inside");
  assert.equal(hit(img, { x: 103, y: 200 }), "edge");
  assert.equal(hit(img, { x: 200, y: 140 }), "outside");
});

test("overflow clips the image and a page control in front takes priority", () => {
  const parent = new Element([100, 100, 110, 120], { overflowX: "hidden", overflowY: "hidden" });
  const img = new HTMLImageElement([80, 90, 250, 200], [250, 200], {}, parent);
  const point = { x: 150, y: 150 };
  assert.equal(geometry().previewPointerPictureHit(img, point), "inside");
  assert.equal(geometry().previewPointerPictureHit(img, { x: 220, y: 150 }), "outside");
  const control = new Element([140, 140, 40, 40]);
  control.control = true;
  assert.equal(geometry(control).previewPointerPictureHit(img, point), "control");
});

test("background hit testing respects the content box", () => {
  const tile = new Element([0, 0, 200, 200], {
    backgroundImage: 'url("image.png")', backgroundClip: "content-box", paddingLeft: "30px"
  });
  const { previewPointerPictureHit: hit } = geometry();
  assert.equal(hit(tile, { x: 20, y: 100 }), "outside");
  assert.equal(hit(tile, { x: 50, y: 100 }), "inside");
});

test("layout preserves the aspect ratio and never enlarges beyond native dimensions", () => {
  const { fitSizeWithinBox: fit } = geometry();
  assert.deepEqual({ ...fit(300, 150, 800, 600) }, { width: 300, height: 150 });
  assert.deepEqual({ ...fit(2000, 1000, 800, 600) }, { width: 800, height: 400 });
  assert.deepEqual({ ...fit(400, 2000, 800, 600) }, { width: 120, height: 600 });
});
