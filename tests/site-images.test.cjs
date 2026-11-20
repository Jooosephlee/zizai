const assert = require("node:assert/strict");
const { test } = require("node:test");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { runInNewContext } = require("node:vm");

const context = { URL, location: { hostname: "web.okjike.com", href: "https://web.okjike.com/following" } };
runInNewContext(readFileSync(join(__dirname, "../extension/site-images.js"), "utf8"), context);
const rules = context.__zizai_site_images;

test("Jike removes thumbnail and quality operations before trying the source image", () => {
  const source = "https://cdnv2.ruguoapp.com/photo.jpg?imageMogr2/auto-orient/thumbnail/400x2000%3E/quality/70/interlace/1";
  const urls = rules.candidates(source);
  assert.equal(urls[0], "https://cdnv2.ruguoapp.com/photo.jpg");
  assert.equal(urls.at(-1), source);
});

test("HEIC images use a full-resolution JPEG display conversion", () => {
  const [url] = rules.candidates("https://cdnv2.ruguoapp.com/photo.heic?imageMogr2/thumbnail/400x2000", "heic");
  assert.equal(new URL(url).pathname, "/photo.heic");
  assert.match(new URL(url).search, /format\/jpeg\/quality\/100/);
  assert.doesNotMatch(new URL(url).search, /thumbnail/);
});

test("Weibo tries original, then large, then the page thumbnail", () => {
  const source = "https://wx1.sinaimg.cn/orj360/photo.jpg";
  assert.deepEqual([...rules.candidates(source)], [
    "https://wx1.sinaimg.cn/original/photo.jpg",
    "https://wx1.sinaimg.cn/large/photo.jpg",
    source
  ]);
});

test("image transformations stay on recognized hosts", () => {
  const source = "https://ruguoapp.com.example/photo.jpg?width=400";
  assert.equal(rules.candidates(source)[0], source);
  assert.equal(rules.platform("okjike.com.example"), "");
  assert.equal(rules.platform("m.weibo.cn"), "weibo");
});

test("X tries the original size, then smaller named sizes, then the page image", () => {
  const source = "https://pbs.twimg.com/media/AbC123?format=jpg&name=small";
  assert.deepEqual([...rules.candidates(source)], [
    "https://pbs.twimg.com/media/AbC123?format=jpg&name=orig",
    "https://pbs.twimg.com/media/AbC123?format=jpg&name=4096x4096",
    "https://pbs.twimg.com/media/AbC123?format=jpg&name=large",
    source
  ]);
  assert.equal(rules.candidates("https://pbs.twimg.com/profile_images/1/a_normal.jpg")[0], "https://pbs.twimg.com/profile_images/1/a_normal.jpg");
  assert.equal(rules.platform("mobile.x.com"), "x");
  assert.equal(rules.platform("twitter.com"), "x");
  assert.equal(rules.platform("notx.com"), "");
});

test("Douban pictures open at the large size", () => {
  assert.deepEqual([...rules.candidates("https://img3.doubanio.com/view/photo/s_ratio_poster/public/p2913.webp")], [
    "https://img3.doubanio.com/view/photo/l/public/p2913.webp",
    "https://img3.doubanio.com/view/photo/s_ratio_poster/public/p2913.webp"
  ]);
  assert.equal(rules.candidates("https://img1.doubanio.com/view/subject/s/public/s1.jpg")[0], "https://img1.doubanio.com/view/subject/l/public/s1.jpg");
  // Already large: left alone.
  assert.deepEqual([...rules.candidates("https://img1.doubanio.com/view/photo/l/public/p1.jpg")], ["https://img1.doubanio.com/view/photo/l/public/p1.jpg"]);
});

test("Pinterest pictures open from the upload, then the largest listed width", () => {
  assert.deepEqual([...rules.candidates("https://i.pinimg.com/236x/ab/cd/ef/abcdef.jpg")], [
    "https://i.pinimg.com/originals/ab/cd/ef/abcdef.jpg",
    "https://i.pinimg.com/736x/ab/cd/ef/abcdef.jpg",
    "https://i.pinimg.com/236x/ab/cd/ef/abcdef.jpg"
  ]);
});

test("the largest copy a srcset lists is found", () => {
  const big = rules.largestInSrcset("https://a.com/404/x.jpg 404w, https://a.com/max_808/x.jpg 808w, https://a.com/202/x.jpg 202w");
  assert.equal(big.url, "https://a.com/max_808/x.jpg");
  assert.equal(big.size, 808);
  assert.equal(rules.largestInSrcset("https://i.pinimg.com/236x/a.jpg 1x, https://i.pinimg.com/474x/a.jpg 2x, https://i.pinimg.com/originals/a.jpg 4x").url, "https://i.pinimg.com/originals/a.jpg");
  // An address with commas in it stays whole.
  assert.equal(rules.largestInSrcset("https://img.com/w_200,h_100/a.jpg 200w, https://img.com/w_900,h_450/a.jpg 900w").url, "https://img.com/w_900,h_450/a.jpg");
  assert.equal(rules.largestInSrcset(""), null);
});

test("Instagram copies of one picture share a key", () => {
  const a = rules.mediaKey("https://scontent-lax3-1.cdninstagram.com/v/t51.2885-15/471_s640x640_n.jpg?stp=dst-jpg_e35");
  const b = rules.mediaKey("https://scontent.cdninstagram.com/v/t51.2885-15/471_p1080x1080_n.webp?x=1");
  assert.equal(a, "471");
  assert.equal(a, b);
  // Other sites keep the whole name.
  assert.equal(rules.mediaKey("https://wx1.sinaimg.cn/large/abc_s640x640.jpg"), "abc_s640x640");
});
