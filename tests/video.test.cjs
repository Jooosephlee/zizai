const assert = require("node:assert/strict");
const { test } = require("node:test");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { runInNewContext } = require("node:vm");

const source = readFileSync(join(__dirname, "../extension/page-media.js"), "utf8");

// Run the page hook on a fake page, feed it one response the site
// "requested", and ask it about a still the way the content script does.
async function hook(hostname, payload) {
  const listeners = {};
  const document = {
    readyState: "complete",
    addEventListener: (type, listener) => (listeners[type] ||= []).push(listener),
    removeEventListener: (type, listener) => { listeners[type] = (listeners[type] || []).filter(item => item !== listener); },
    dispatchEvent: event => (listeners[event.type] || []).forEach(listener => listener(event)),
    querySelectorAll: () => []
  };
  class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } }
  const window = { fetch: async () => ({ headers: { get: () => null }, clone: () => ({ json: async () => payload }) }) };
  function XMLHttpRequest() {}
  XMLHttpRequest.prototype = { open() {}, send() {} };
  runInNewContext(source, { window, document, CustomEvent, XMLHttpRequest, URL, JSON, location: { hostname, href: "https://" + hostname + "/" } });
  const api = { "x.com": "https://x.com/i/api/graphql/q/HomeTimeline", "weibo.com": "https://weibo.com/ajax/feed/friends", "web.okjike.com": "https://api.ruguoapp.com/1.0/feed" };
  await window.fetch(api[hostname]);
  await new Promise(resolve => setTimeout(resolve, 10));
  return url => {
    let post = null;
    const listener = event => { post = JSON.parse(event.detail).post; };
    document.addEventListener("__zizai_post_response", listener);
    document.dispatchEvent(new CustomEvent("__zizai_post_request", { detail: JSON.stringify({ requestId: "r", url }) }));
    document.removeEventListener("__zizai_post_response", listener);
    return post;
  };
}

const still = (post, key) => post?.pictures.find(picture => picture.url.includes(key));

test("X lists a video's MP4 files largest first, skips the stream, and marks GIFs", async () => {
  const media = [
    { type: "video", media_url_https: "https://pbs.twimg.com/ext_tw_video_thumb/1/pu/img/VID.jpg", video_info: { variants: [
      { content_type: "application/x-mpegURL", url: "https://video.twimg.com/ext_tw_video/1/pu/pl/list.m3u8" },
      { content_type: "video/mp4", bitrate: 832000, url: "https://video.twimg.com/ext_tw_video/1/pu/vid/640x360/low.mp4" },
      { content_type: "video/mp4", bitrate: 2176000, url: "https://video.twimg.com/ext_tw_video/1/pu/vid/1280x720/high.mp4" }
    ] } },
    { type: "animated_gif", media_url_https: "https://pbs.twimg.com/tweet_video_thumb/GIF.jpg", video_info: { variants: [
      { content_type: "video/mp4", bitrate: 0, url: "https://video.twimg.com/tweet_video/GIF.mp4" }
    ] } },
    { type: "photo", media_url_https: "https://pbs.twimg.com/media/PIC.jpg" }
  ];
  const tweet = { __typename: "Tweet", rest_id: "9", core: { user_results: { result: { core: { name: "A", screen_name: "a" } } } },
    legacy: { id_str: "9", full_text: "clip", entities: {}, extended_entities: { media } } };
  const ask = await hook("x.com", { data: { entries: [{ content: { itemContent: { tweet_results: { result: tweet } } } }] } });
  const post = ask("https://pbs.twimg.com/ext_tw_video_thumb/1/pu/img/VID.jpg?name=small");
  assert.deepEqual([...still(post, "VID").video], [
    "https://video.twimg.com/ext_tw_video/1/pu/vid/1280x720/high.mp4",
    "https://video.twimg.com/ext_tw_video/1/pu/vid/640x360/low.mp4"
  ]);
  assert.equal(still(post, "GIF").gif, true);
  assert.equal(still(post, "PIC").video, undefined);
});

test("Weibo lists a video card's files by quality and a Live Photo's short video", async () => {
  const status = {
    mblogid: "Ab1", user: { screen_name: "B" }, text_raw: "clip",
    pic_ids: ["live1"],
    pic_infos: { live1: { type: "livephoto", large: { url: "https://wx1.sinaimg.cn/large/live1.jpg" }, video: "https://video.weibo.com/media/play?livephoto=x.mov" } },
    page_info: { object_type: "video", page_pic: { url: "https://wx2.sinaimg.cn/orj480/cover.jpg" },
      urls: { mp4_hd_mp4: "https://f.video.weibocdn.com/hd.mp4", mp4_720p_mp4: "https://f.video.weibocdn.com/720.mp4" },
      media_info: { stream_url: "https://f.video.weibocdn.com/stream.m3u8" } }
  };
  const ask = await hook("weibo.com", { statuses: [status] });
  const post = ask("https://wx2.sinaimg.cn/orj480/cover.jpg");
  assert.deepEqual([...still(post, "cover").video], ["https://f.video.weibocdn.com/720.mp4", "https://f.video.weibocdn.com/hd.mp4"]);
  const live = still(ask("https://wx1.sinaimg.cn/orj360/live1.jpg"), "live1");
  assert.equal(live.live, true);
  assert.deepEqual([...live.video], ["https://video.weibo.com/media/play?livephoto=x.mov"]);
});

test("Jike lists a video post's still and file, and a Live Photo", async () => {
  const post = {
    id: "p1", content: "clip", user: { screenName: "C" },
    pictures: [{ picUrl: "https://cdnv2.ruguoapp.com/live.jpg", livePhoto: { videoUrl: "https://cdnv2.ruguoapp.com/live.mov" } }],
    video: { image: { picUrl: "https://cdnv2.ruguoapp.com/still.jpg" }, url: "https://videocdn.ruguoapp.com/clip.mp4" }
  };
  const ask = await hook("web.okjike.com", { data: [post] });
  const record = ask("https://cdnv2.ruguoapp.com/still.jpg?imageMogr2/thumbnail/400x");
  assert.deepEqual([...still(record, "still").video], ["https://videocdn.ruguoapp.com/clip.mp4"]);
  assert.equal(still(record, "live").live, true);
});

test("Weibo skips picture-only DASH files, which play without sound", async () => {
  const status = {
    mblogid: "Ab2", user: { screen_name: "B" }, text_raw: "clip",
    page_info: { object_type: "video", page_pic: { url: "https://wx2.sinaimg.cn/orj480/cover2.jpg" },
      media_info: { playback_list: [
        { play_info: { url: "https://f.video.weibocdn.com/dash1080.mp4", height: 1080, protocol: "dash", mime: "video/mp4" } },
        { play_info: { url: "https://f.video.weibocdn.com/audio.m4a", height: 0, protocol: "general", mime: "audio/mp4" } },
        { play_info: { url: "https://f.video.weibocdn.com/p720.mp4", height: 720, protocol: "general", mime: "video/mp4" } }
      ] } }
  };
  const ask = await hook("weibo.com", { statuses: [status] });
  assert.deepEqual([...still(ask("https://wx2.sinaimg.cn/orj480/cover2.jpg"), "cover2").video], ["https://f.video.weibocdn.com/p720.mp4"]);
});
