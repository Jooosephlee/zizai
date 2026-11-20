const assert = require("node:assert/strict");
const { test } = require("node:test");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { runInNewContext } = require("node:vm");

const source = readFileSync(join(__dirname, "../extension/page-media.js"), "utf8");

// Feeds the page's data to page-media.js and asks for the post that owns a picture.
async function postFor(hostname, payload, picture, id, options = {}) {
  const listeners = {};
  let mutations;
  const document = {
    readyState: "complete",
    addEventListener: (type, listener) => (listeners[type] ||= []).push(listener),
    removeEventListener: (type, listener) => { listeners[type] = (listeners[type] || []).filter(item => item !== listener); },
    dispatchEvent: event => (listeners[event.type] || []).forEach(listener => listener(event)),
    querySelectorAll: () => []
  };
  class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } }
  class MutationObserver {
    constructor(callback) { mutations = callback; }
    observe() {}
  }
  const responses = [...(options.responses || [payload])];
  const window = { fetch: async () => {
    const incoming = responses.shift();
    const body = typeof incoming === "string" ? incoming : JSON.stringify(incoming);
    return new Response(body, { headers: { "content-type": options.contentType || "application/json" } });
  } };
  function XMLHttpRequest() {}
  XMLHttpRequest.prototype = { open() {}, send() {} };
  runInNewContext(source, { window, document, CustomEvent, MutationObserver, XMLHttpRequest, TextDecoder, URL, URLSearchParams, JSON, location: { hostname, pathname: options.path || "/", href: "https://" + hostname + (options.path || "/") } });
  const api = options.api || (hostname === "x.com" ? "https://x.com/i/api/graphql/abc/HomeTimeline" : hostname === "web.okjike.com" ? "https://web.okjike.com/api/feed"
    : hostname === "www.instagram.com" ? "https://www.instagram.com/graphql/query" : "https://weibo.com/ajax/feed/friends");
  while (responses.length) {
    const pending = window.fetch(api);
    if (options.stopBeforeAnswer) document.dispatchEvent(new CustomEvent("__zizai_stop"));
    const response = await pending;
    await response.text();
    await new Promise(resolve => setImmediate(resolve));
  }
  if (options.inline) {
    const script = { matches: () => true, textContent: JSON.stringify(options.inline) };
    mutations([{ target: {}, addedNodes: [script] }]);
  }
  if (options.stop) document.dispatchEvent(new CustomEvent("__zizai_stop"));
  if (options.restart) {
    document.dispatchEvent(new CustomEvent("__zizai_start"));
    responses.push(payload);
    const again = await window.fetch(api).catch(() => null);
    await again?.text?.();
    await new Promise(resolve => setImmediate(resolve));
  }
  let post = null;
  document.addEventListener("__zizai_post_response", event => { post = JSON.parse(event.detail).post; });
  document.dispatchEvent(new CustomEvent("__zizai_post_request", { detail: JSON.stringify({ requestId: "r", url: picture, id }) }));
  return post;
}

test("a Weibo video's shape comes from its files, not its (portrait) cover", async () => {
  const post = await postFor("weibo.com", { data: { statuses: [{
    mblogid: "V1", user: { screen_name: "a" }, text_raw: "视频",
    page_info: { object_type: "video", page_pic: { url: "https://wx1.sinaimg.cn/large/COVER.jpg", width: 720, height: 1280 },
      media_info: { playback_list: [{ play_info: { url: "https://f.video.weibocdn.com/v.mp4", width: 1920, height: 1080 } }] } }
  }] } }, "https://wx1.sinaimg.cn/orj360/COVER.jpg");
  assert.equal(post.pictures[0].ratio, 1.7778);
  assert.ok(post.pictures[0].video.length);
});

test("Weibo pictures and Live Photos carry their size and the Live mark", async () => {
  const post = await postFor("weibo.com", { data: { statuses: [{
    mblogid: "P1", user: { screen_name: "a" }, text_raw: "", pic_ids: ["L1"],
    pic_infos: { L1: { type: "livephoto", video: "https://video.weibo.com/l.mov", largest: { url: "https://wx1.sinaimg.cn/large/L1.jpg", width: 3024, height: 4032 } } }
  }] } }, "https://wx1.sinaimg.cn/orj360/L1.jpg");
  assert.equal(post.pictures[0].ratio, 0.75);
  assert.equal(post.pictures[0].live, true);
});

test("X media carry their original size", async () => {
  const tweet = { __typename: "Tweet", rest_id: "1", core: { user_results: { result: { legacy: { name: "n", screen_name: "h" } } } },
    legacy: { full_text: "t", extended_entities: { media: [{ media_url_https: "https://pbs.twimg.com/ext_tw_video_thumb/1/pu/img/VID.jpg",
      original_info: { width: 1280, height: 720 }, video_info: { variants: [{ content_type: "video/mp4", bitrate: 1, url: "https://video.twimg.com/v.mp4" }] } }] } } };
  const post = await postFor("x.com", { data: { tweet_result: { result: tweet } } }, "https://pbs.twimg.com/ext_tw_video_thumb/1/pu/img/VID.jpg?name=small");
  assert.equal(post.pictures[0].ratio, 1.7778);
});

test("Jike pictures carry their size; nonsense sizes are dropped", async () => {
  const post = await postFor("web.okjike.com", { data: [{ id: "j1", content: "x", user: { screenName: "a" },
    pictures: [{ picUrl: "https://cdn.jellow.site/A1.jpg", width: 1000, height: 500 }, { picUrl: "https://cdn.jellow.site/A2.jpg", width: 0, height: "x" }] }] },
    "https://cdn.jellow.site/A1.jpg?imageMogr2/thumbnail/300x");
  assert.equal(post.pictures[0].ratio, 2);
  assert.equal(post.pictures[1].ratio, 0);
});

test("an X post is found by its own number when the cover address does not match", async () => {
  const tweet = { __typename: "Tweet", rest_id: "1890", core: { user_results: { result: { legacy: { name: "n", screen_name: "h" } } } },
    legacy: { full_text: "t", extended_entities: { media: [{ media_url_https: "https://pbs.twimg.com/amplify_video_thumb/1/img/DATAKEY.jpg",
      original_info: { width: 1920, height: 1080 }, video_info: { variants: [
        { content_type: "video/mp4", bitrate: 632000, url: "https://video.twimg.com/low.mp4" },
        { content_type: "video/mp4", bitrate: 2176000, url: "https://video.twimg.com/high.mp4" }] } }] } } };
  const payload = { data: { tweet_result: { result: tweet } } };
  assert.equal(await postFor("x.com", payload, "https://pbs.twimg.com/amplify_video_thumb/1/img/PAGEKEY.jpg"), null);
  const post = await postFor("x.com", payload, "", "1890");
  assert.equal(post.pictures[0].video[0], "https://video.twimg.com/high.mp4");
});

// Instagram: a set's pictures are all in the page's data, though its
// carousel draws two at a time.
const ig = (name, size) => "https://scontent-lax3-1.cdninstagram.com/v/t51.2885-15/" + name + "_" + size + "_n.jpg?stp=dst-jpg_e35&oh=x";
function igItem(index, video) {
  const item = { pk: String(index), media_type: video ? 2 : 1, original_width: 1080, original_height: 1350,
    image_versions2: { candidates: [
      { url: ig("47" + index, "s640x640"), width: 640, height: 800 },
      { url: ig("47" + index, "p1080x1080"), width: 1080, height: 1350 }] } };
  if (video) item.video_versions = [{ url: "https://scontent.cdninstagram.com/v/clip" + index + ".mp4", width: 720, height: 900 }];
  return item;
}

test("an Instagram set is read whole, widest copies first, by the post's code", async () => {
  const media = { code: "DfsjOcnl4nQ", pk: "1", media_type: 8, carousel_media_count: 12, user: { username: "nasa" }, caption: { text: "Twelve views" },
    carousel_media: Array.from({ length: 12 }, (_, index) => igItem(index, index === 3)) };
  const payload = { data: { xdt_api__v1__feed__timeline__connection: { edges: [{ node: { media } }] } } };
  const post = await postFor("www.instagram.com", payload, "", "DfsjOcnl4nQ");
  assert.equal(post.pictures.length, 12);
  assert.equal(post.mediaCount, 12);
  assert.equal(post.complete, true);
  assert.equal(post.pictures[11].index, 11);
  assert.equal(post.pictures[0].url, ig("470", "p1080x1080"));
  assert.equal(post.pictures[0].ratio, 0.8);
  assert.deepEqual([...post.pictures[3].video], ["https://scontent.cdninstagram.com/v/clip3.mp4"]);
  assert.equal(post.pictures[4].video, undefined);
  assert.equal(post.author, "nasa");
  assert.equal(post.content, "Twelve views");
  assert.equal(post.url, "https://www.instagram.com/p/DfsjOcnl4nQ/");
  // From a picture on the page, in another size.
  const byPicture = await postFor("www.instagram.com", payload, ig("477", "s320x320"));
  assert.equal(byPicture.pictures.length, 12);
});

test("an Instagram set listed only by its count is not stored as one picture", async () => {
  const media = { code: "ABCDEF12", pk: "2", media_type: 8, carousel_media_count: 10, image_versions2: igItem(0).image_versions2 };
  const post = await postFor("www.instagram.com", { data: { media } }, "", "ABCDEF12");
  assert.equal(post.mediaCount, 10);
  assert.equal(post.complete, false);
  assert.deepEqual(post.pictures, []);
});

test("Instagram's older set data (sidecar) is read too", async () => {
  const media = { shortcode: "OLDCODE1", owner: { username: "old" }, edge_media_to_caption: { edges: [{ node: { text: "hi" } }] },
    edge_sidecar_to_children: { edges: [
      { node: { display_url: ig("901", "p1080x1080"), dimensions: { width: 1080, height: 1080 } } },
      { node: { display_url: ig("902", "p1080x1080"), is_video: true, video_url: "https://scontent.cdninstagram.com/v/old.mp4", dimensions: { width: 1920, height: 1080 } } }] } };
  const post = await postFor("www.instagram.com", { graphql: { shortcode_media: media } }, "", "OLDCODE1");
  assert.equal(post.pictures.length, 2);
  assert.equal(post.pictures[1].ratio, 1.7778);
  assert.equal(post.pictures[1].video[0], "https://scontent.cdninstagram.com/v/old.mp4");
  assert.equal(post.content, "hi");
});

test("Instagram keeps the author's avatar through a metadata refresh", async () => {
  const avatar = ig("profile", "s150x150");
  const media = { code: "IGAVATAR", carousel_media: [igItem(0), igItem(1)] };
  const post = (username, profile_pic_url) => ({ data: { media: { ...media, user: { username, profile_pic_url } } } });
  const replies = [post("artist", avatar), post("artist"), post("ARTIST", "https://cdninstagram.com.example/other.jpg")];
  assert.equal((await postFor("www.instagram.com", null, "", media.code, { responses: replies })).avatar, avatar);
  const newAuthor = await postFor("www.instagram.com", null, "", media.code, { responses: [replies[0], post("other")] });
  assert.equal(newAuthor.author, "other");
  assert.equal(newAuthor.avatar, "");
});

test("Instagram keeps the real indexes of missing carousel entries and joins later data", async () => {
  const media = { code: "IGPARTIAL", media_type: 8, carousel_media_count: 4, carousel_media: [igItem(0), null, igItem(2)] };
  const initial = { data: { media } };
  const post = await postFor("www.instagram.com", initial, "", media.code);
  assert.equal(post.mediaCount, 4);
  assert.equal(post.complete, false);
  assert.deepEqual(post.pictures.map(picture => picture.index), [0, 2]);

  const later = { data: { media: { ...media, carousel_media: [null, igItem(1), null, igItem(3)] } } };
  const stale = { data: { media: { code: media.code, carousel_media: [igItem(0), igItem(1)] } } };
  const full = await postFor("www.instagram.com", null, "", media.code, { responses: [initial, later, stale] });
  assert.equal(full.complete, true);
  assert.deepEqual(full.pictures.map(picture => picture.index), [0, 1, 2, 3]);
});

test("late Instagram JSON in a Relay page wrapper is indexed by the exact post code", async () => {
  const media = { code: "IGLATEPOST", carouselMediaCount: 3, carouselMedia: [igItem(0), igItem(1), igItem(2)] };
  const result = { data: { xdt_api__v1__feed__timeline__connection: { edges: [{ node: { explore_story: { media } } }] } } };
  const inline = { require: [["ScheduledServerJS", "handle", null, [{ __bbox: { require: [
    ["RelayPrefetchedStreamCache", "next", null, ["feed", { __bbox: { result } }]]
  ] } }]]] };
  const picture = ig("470", "s320x320");
  const full = await postFor("www.instagram.com", null, picture, media.code, { responses: [], inline });
  assert.equal(full.complete, true);
  assert.equal(full.mediaCount, 3);
  assert.equal(await postFor("www.instagram.com", null, picture, "OTHERPOST", { responses: [], inline }), null);
});

test("a reused Instagram image cannot identify the wrong album", async () => {
  const first = { code: "IGREUSE1", carousel_media: [igItem(0), igItem(1)] };
  const second = { code: "IGREUSE2", carousel_media: [igItem(0), igItem(2), igItem(3)] };
  const payload = { data: [first, second] };
  const picture = ig("470", "s320x320");
  assert.equal(await postFor("www.instagram.com", payload, picture), null);
  assert.equal((await postFor("www.instagram.com", payload, picture, first.code)).mediaCount, 2);
  assert.equal((await postFor("www.instagram.com", payload, picture, second.code)).mediaCount, 3);
});

test("Instagram assembles the media list from batched Relay response fragments", async () => {
  const media = { code: "IGSTREAM", carousel_media_count: 3, carousel_media: [igItem(0)] };
  const first = { data: { feed: { edges: [{ node: { media } }] } }, extensions: { is_final: false } };
  const second = { path: ["feed", "edges", 0, "node", "media", "carousel_media", 1], items: [igItem(1), igItem(2)] };
  const frame = (body, final = "") => "--zizai\r\nContent-Type: application/json\r\n\r\n" + body + "\r\n" + final;
  for (const [body, contentType] of [
    [JSON.stringify([first, second]), "application/json"],
    ["for (;;);" + JSON.stringify(first) + "\n" + JSON.stringify(second), "application/json"],
    [frame(JSON.stringify(first)) + frame(JSON.stringify(second), "--zizai--"), 'multipart/mixed; boundary="zizai"']
  ]) {
    const full = await postFor("www.instagram.com", body, "", media.code, { contentType });
    assert.equal(full.complete, true);
    assert.deepEqual(full.pictures.map(picture => picture.index), [0, 1, 2]);
  }
});

// Privacy: only what a picture's card needs is read and kept.
const jikePost = { id: "J9", content: "海边", user: { screenName: "a" }, pictures: [{ picUrl: "https://cdnv2.ruguoapp.com/J9.jpg", width: 800, height: 600 }] };

test("a text-only message is never kept, even when it looks like a post", async () => {
  const message = { id: "M1", content: "私下说的话", user: { screenName: "friend" } };
  assert.equal(await postFor("web.okjike.com", { data: [message] }, "", "M1"), null);
});

test("private areas (messages, chats, notifications) are not read at all", async () => {
  for (const api of ["https://web.okjike.com/api/messages", "https://web.okjike.com/api/chats/list", "https://api.ruguoapp.com/1.0/notifications/list"]) {
    assert.equal(await postFor("web.okjike.com", { data: [jikePost] }, "", "J9", { api }), null, api);
  }
  assert.equal(await postFor("x.com", { data: {} }, "", "1", { api: "https://x.com/i/api/graphql/abc/DMInboxTimeline" }), null);
  assert.ok(await postFor("web.okjike.com", { data: [jikePost] }, "", "J9"), "a feed post with a picture is still read");
});

test("a random query id that happens to spell a private word does not hide a feed", async () => {
  const tweet = { __typename: "Tweet", rest_id: "7", core: { user_results: { result: { legacy: { name: "n", screen_name: "h" } } } },
    legacy: { full_text: "t", extended_entities: { media: [{ media_url_https: "https://pbs.twimg.com/media/P.jpg", original_info: { width: 10, height: 10 } }] } } };
  const post = await postFor("x.com", { data: { tweet_result: { result: tweet } } }, "https://pbs.twimg.com/media/P.jpg", "", { api: "https://x.com/i/api/graphql/aPay0rder1234567x/HomeTimeline" });
  assert.ok(post);
});

test("turning previews off forgets everything read on the page", async () => {
  assert.equal(await postFor("web.okjike.com", { data: [jikePost] }, "", "J9", { stop: true }), null);
});

test("a query named after messages is skipped, whatever its address", async () => {
  // Body or address may carry the GraphQL operation name.
  const api = "https://web.okjike.com/api/graphql?operationName=MessagesList";
  assert.equal(await postFor("web.okjike.com", { data: [jikePost] }, "", "J9", { api }), null);
  assert.equal(await postFor("x.com", { data: {} }, "", "1", { api: "https://x.com/i/api/graphql/abc/DMInboxTimeline" }), null);
  assert.equal(await postFor("x.com", { data: {} }, "", "1", { api: "https://x.com/i/api/graphql/abc/Viewer" }), null, "X: only post-listing queries");
});

test("a private page is never read, but a user whose name holds a private word is", async () => {
  assert.equal(await postFor("web.okjike.com", { data: [jikePost] }, "", "J9", { path: "/me/messages" }), null);
  assert.ok(await postFor("web.okjike.com", { data: [jikePost] }, "", "J9", { path: "/u/bordercollie" }));
});

test("an answer that arrives after previews were turned off is dropped", async () => {
  assert.equal(await postFor("web.okjike.com", { data: [jikePost] }, "", "J9", { stopBeforeAnswer: true }), null);
});

test("the page cannot restart reading once previews are off", async () => {
  assert.equal(await postFor("web.okjike.com", { data: [jikePost] }, "", "J9", { stop: true, restart: true }), null);
});
