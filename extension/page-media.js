// Read post/image metadata from responses the page already requested.
// On Instagram it only listens; a set's pictures are all in the page's data
// even when its carousel shows two at a time.
// It issues one request of its own, only on Weibo and only when asked: the
// full text of a long post open in the full page, from the same endpoint
// the page's own "展开" uses.
(() => {
  if (window.__zizai_post_cache) return;
  window.__zizai_post_cache = true;
  const site = /(^|\.)okjike\.com$/.test(location.hostname) ? "jike"
    : /(^|\.)(x|twitter)\.com$/.test(location.hostname) ? "x"
    : /(^|\.)instagram\.com$/.test(location.hostname) ? "instagram" : "weibo";
  const records = new Map();
  const owners = new Map();
  // Every id a Weibo post goes by (mblogid, mid, idstr), and which post
  // quotes which, so a long-text answer finds its post.
  const aliases = new Map();
  const quotedBy = new Map();
  const asked = new Set();
  const MAX_POSTS = 200;
  // Turning previews off (everywhere or on this site) stops all reading for
  // good on this page and forgets what was read; answers still on their way
  // are dropped too. Nothing can restart it: turning previews back on takes
  // effect from the next page load, when the background registers this
  // script again.
  let stopped = false;
  document.addEventListener("__zizai_stop", () => {
    stopped = true;
    for (const map of [records, owners, aliases, quotedBy]) map.clear();
    asked.clear();
  });
  // A matching private-area path skips new cache writes (also after in-page
  // navigation). It does not stop the image viewer from reading pictures,
  // and it does not clear what was already cached.
  const off = () => stopped || privatePath(location.pathname);
  const MAX_INSTAGRAM_MEDIA = 24;
  const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
  const INSTAGRAM_MEDIA_FIELDS = /carousel_media|carouselMedia|image_versions2|imageVersions2|edge_sidecar|display_url|displayUrl/;

  // Same rule as site-images.js mediaKey: the file's name, without its
  // extension; on Instagram's servers also without the size marks
  // (_s640x640, _p1080x1080, _e35…) that differ between copies of one picture.
  function imageKey(value) {
    try {
      const url = new URL(value, location.href);
      const name = (url.pathname.split("/").pop() || "").replace(/@.*$/, "").replace(/\.[a-z0-9]+$/i, "");
      return /(^|\.)(cdninstagram\.com|fbcdn\.net)$/.test(url.hostname)
        ? name.replace(/_[esp]\d+(?:x\d+)?/g, "").replace(/_n$/, "") || name : name;
    } catch {
      return "";
    }
  }

  function pickUrl(...values) {
    return values.find(value => typeof value === "string" && /^https?:\/\//i.test(value)) || "";
  }

  function plainText(value) {
    const raw = String(value || "").slice(0, 60000);
    if (!raw.includes("<")) return raw.trim();
    // Inert parsing preserves emoji labels without inserting page markup.
    const template = document.createElement("template");
    template.innerHTML = raw;
    for (const image of template.content.querySelectorAll("img")) image.replaceWith(image.alt || "");
    for (const br of template.content.querySelectorAll("br")) br.replaceWith("\n");
    for (const unsafe of template.content.querySelectorAll("script,style")) unsafe.remove();
    return template.content.textContent.trim();
  }

  // Video files the page can play directly. Streams (m3u8 / mpd) need the
  // site's own player, so they are left out.
  function videoUrls(...values) {
    const urls = values.flat().filter(value => typeof value === "string" && /^https?:\/\//i.test(value) &&
      !/\.(?:m3u8|mpd)(?:[?#]|$)/i.test(value) && value.length < 12000);
    return [...new Set(urls)].slice(0, 6);
  }

  // Width over height, from the sizes the page's data lists. The frame is
  // planned from it at open, so a video whose cover is cropped (a portrait
  // cover on a landscape video) is not mistaken for portrait.
  function ratioOf(...pairs) {
    for (const pair of pairs) {
      const width = Number(pair?.[0]);
      const height = Number(pair?.[1]);
      if (width > 0 && height > 0 && width < 100000 && height < 100000) return Math.round(width / height * 10000) / 10000;
    }
    return 0;
  }
  const sizeOf = node => node && typeof node === "object" ? [node.width, node.height] : null;

  const nested = value => typeof value === "string" ? value : value?.url || value?.videoUrl || value?.src || "";

  function jikePicture(node) {
    if (!node || typeof node !== "object") return null;
    const live = node.livePhoto || node.livephoto || node.live_photo;
    const url = pickUrl(node.picUrl, node.picurl, node.pictureUrl, node.imageUrl, node.url, node.src, live?.picUrl, node.image?.picUrl);
    if (!url) return null;
    const picture = { url, format: String(node.format || node.picFormat || live?.format || ""), ratio: ratioOf(sizeOf(node), sizeOf(live)) };
    const video = videoUrls(live?.videoUrl, live?.videourl, live?.url, node.livePhotoVideoUrl);
    if (live && video.length) Object.assign(picture, { video, live: true });
    return picture;
  }

  // Jike's video posts carry a still and, when the feed includes it, a file.
  function jikeVideo(node) {
    const video = node.video || node.media?.video;
    if (!video || typeof video !== "object") return null;
    const still = pickUrl(video.image?.picUrl, video.image?.thumbnailUrl, video.thumbnailUrl, video.picUrl, video.coverUrl, video.poster);
    const urls = videoUrls(video.url, video.videoUrl, video.originUrl, video.playUrl, video.src, node.videoUrl);
    return still ? { url: still, format: "", video: urls, ratio: ratioOf(sizeOf(video)) } : null;
  }

  function weiboPicture(node) {
    if (!node || typeof node !== "object") return null;
    const url = pickUrl(
      node.original?.url, node.largest?.url, node.mw2000?.url, node.oslarge?.url,
      node.large?.url, node.large, node.bmiddle?.url, node.url, node.pic, node.src
    );
    if (!url) return null;
    const picture = { url, format: String(node.type || ""),
      ratio: ratioOf(sizeOf(node.original), sizeOf(node.largest), sizeOf(node.mw2000), sizeOf(node.large), sizeOf(node.bmiddle), sizeOf(node)) };
    // Live Photo: a still with a short video.
    const type = String(node.type || node.pic_type || "").toLowerCase();
    const video = videoUrls(nested(node.video), node.videoSrc, node.video_url, node.livephoto_url,
      nested(node.live_photo), nested(node.livePhoto), nested(node.livephoto));
    if (video.length && (/live/.test(type) || node.livephoto_url || node.live_photo || node.videoSrc)) {
      Object.assign(picture, { video, live: true });
    } else if (video.length && /gif/.test(type)) {
      Object.assign(picture, { video, gif: true });
    }
    return picture;
  }

  // A Weibo video card (page_info or a mixed-media item): cover plus files,
  // best quality first.
  function weiboVideo(page) {
    if (!page || typeof page !== "object") return null;
    const type = String(page.object_type || page.type || "").toLowerCase();
    const media = page.media_info || page.mediaInfo || {};
    const urls = page.urls || {};
    // DASH entries are picture-only files whose sound is a separate stream;
    // played alone they are silent.
    const played = Array.isArray(media.playback_list) ? media.playback_list : [];
    const listed = played
      .filter(item => !/dash/i.test(String(item?.play_info?.protocol || item?.protocol || "")) &&
        !/^audio\//i.test(String(item?.play_info?.mime || "")))
      .map(item => ({ url: nested(item?.play_info) || item?.url, height: Number(item?.play_info?.height || item?.meta?.height || 0) }))
      .sort((a, b) => b.height - a.height).map(item => item.url);
    const video = videoUrls(listed, urls.mp4_1080p_mp4, urls.mp4_720p_mp4, media.mp4_720p_mp4, urls.mp4_hd_mp4,
      media.mp4_hd_url, media.mp4_sd_url, urls.mp4_ld_mp4, media.stream_url_hd, media.stream_url);
    const cover = pickUrl(page.page_pic?.url, typeof page.page_pic === "string" ? page.page_pic : "",
      media.big_pic_info?.pic_big?.url, media.cover_image_url);
    if (!cover || !(/video|gif/.test(type) || video.length)) return null;
    // The files' own size, never the cover's (covers are often cropped).
    const ratio = ratioOf(...played.map(item => sizeOf(item?.play_info)), sizeOf(media));
    return { url: cover, format: "", video, gif: /gif/.test(type), ratio };
  }

  function fromJike(node) {
    const pictures = Array.isArray(node.pictures) ? node.pictures : node.picture ? [node.picture] : [];
    const video = jikeVideo(node);
    const user = node.user || node.author || node.owner || node.postedBy || {};
    const id = String(node.id || node.postId || node.originalPostId || "");
    const content = String(node.content || node.text || node.message || "").trim().slice(0, 60000);
    return {
      id, content, author: String(user.screenName || user.nickName || user.nickname || user.name || ""),
      pictures: [...pictures.map(jikePicture), video].filter(Boolean),
      url: id ? "https://web.okjike.com/originalPost/" + encodeURIComponent(id) : "",
      quote: null
    };
  }

  function fromWeibo(node) {
    const infos = node.pic_infos || node.picInfos || {};
    const ids = node.pic_ids || node.picIds || Object.keys(infos);
    const pictures = [...ids.map(id => infos[id] || id), ...(node.pics || [])];
    const videos = [];
    for (const item of node.mix_media_info?.items || node.mixMediaInfo?.items || []) {
      if (item.type === "pic" || item.type === "image" || /live/i.test(item.type)) pictures.push(item.data || item);
      else if (/video/i.test(item.type)) videos.push(weiboVideo(item.data || item));
    }
    if (!videos.length) videos.push(weiboVideo(node.page_info || node.pageInfo));
    const id = String(node.mblogid || node.bid || node.idstr || node.mid || node.id || "");
    const longer = node.longText?.longTextContent || node.longText?.content || node.longTextContent || node.long_text || node.longtext?.content;
    const content = plainText(longer || node.text_raw || node.textRaw || node.text || "");
    const user = node.user || {};
    const quoteNode = node.retweeted_status || node.retweetedStatus;
    const quoteLonger = quoteNode && (quoteNode.longText?.longTextContent || quoteNode.longText?.content);
    const quote = quoteNode ? {
      id: String(quoteNode.mblogid || quoteNode.bid || quoteNode.idstr || quoteNode.mid || quoteNode.id || ""),
      author: String(quoteNode.user?.screen_name || quoteNode.user?.screenName || ""),
      content: plainText(quoteLonger || quoteNode.text_raw || quoteNode.text || ""),
      truncated: Boolean(quoteNode.isLongText) && !quoteLonger
    } : null;
    for (const alias of [node.mblogid, node.bid, node.idstr, node.mid, node.id]) if (alias && id) aliases.set(String(alias), id);
    if (quote?.id) quotedBy.set(quote.id, id);
    return {
      id, content, truncated: Boolean(node.isLongText) && !longer,
      author: String(user.screen_name || user.screenName || user.name || ""),
      pictures: [...pictures.map(weiboPicture), ...videos].filter(Boolean),
      url: id ? "https://weibo.com/status/" + encodeURIComponent(id) : "",
      quote
    };
  }

  // X timeline entries: a tweet result with "legacy" fields. Long posts keep
  // their full text in note_tweet; the visible card stops at "Show more".
  function xTweet(node) {
    if (node?.__typename === "TweetWithVisibilityResults" || (!node?.legacy && node?.tweet)) node = node.tweet;
    return node?.legacy && typeof node.legacy.full_text === "string" ? node : null;
  }

  function xText(tweet) {
    const legacy = tweet.legacy;
    const note = tweet.note_tweet?.note_tweet_results?.result;
    let text = String(note?.text || legacy.full_text || "").slice(0, 60000);
    const entities = note?.text ? note.entity_set : legacy.entities;
    for (const link of entities?.urls || []) if (link.url) text = text.split(link.url).join(link.display_url || link.expanded_url || "");
    for (const media of legacy.extended_entities?.media || legacy.entities?.media || []) if (media.url) text = text.split(media.url).join("");
    return text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim();
  }

  function xUser(tweet) {
    const user = tweet.core?.user_results?.result || {};
    return { name: String(user.core?.name || user.legacy?.name || ""), handle: String(user.core?.screen_name || user.legacy?.screen_name || "") };
  }

  // A video or GIF is listed with its still and its files; the largest MP4
  // comes first.
  function xPicture(item) {
    const url = pickUrl(item?.media_url_https);
    if (!url) return null;
    const variants = (Array.isArray(item.video_info?.variants) ? item.video_info.variants : [])
      .filter(variant => /mp4/i.test(variant?.content_type || "") || /\.mp4(?:[?#]|$)/i.test(variant?.url || ""))
      .sort((a, b) => Number(b.bitrate || 0) - Number(a.bitrate || 0));
    const video = videoUrls(variants.map(variant => variant.url));
    const ratio = ratioOf(sizeOf(item.original_info), item.video_info?.aspect_ratio, [item.sizes?.large?.w, item.sizes?.large?.h]);
    if (!video.length) return { url, format: "", ratio };
    return { url, format: "", video, gif: item.type === "animated_gif", ratio };
  }

  function fromX(tweet) {
    const legacy = tweet.legacy;
    const id = String(tweet.rest_id || legacy.id_str || "");
    const user = xUser(tweet);
    const quoted = xTweet(tweet.quoted_status_result?.result);
    const media = legacy.extended_entities?.media || legacy.entities?.media || [];
    return {
      id, content: xText(tweet), author: user.name || user.handle,
      pictures: media.map(xPicture).filter(Boolean),
      url: id && user.handle ? "https://x.com/" + encodeURIComponent(user.handle) + "/status/" + encodeURIComponent(id) : "",
      quote: quoted ? { author: xUser(quoted).name, content: xText(quoted) } : null
    };
  }

  // Instagram lists each picture in several sizes; the widest is the one to
  // open. A video lists its files the same way, with its still beside them.
  function largestOf(list) {
    return (Array.isArray(list) ? list : [])
      .map(item => ({ url: pickUrl(item?.url, item?.src), width: Number(item?.width || item?.config_width || 0), height: Number(item?.height || item?.config_height || 0) }))
      .filter(item => item.url).sort((a, b) => b.width - a.width);
  }

  function instagramPicture(node, index) {
    if (!node || typeof node !== "object") return null;
    const still = [
      ...largestOf(node.image_versions2?.candidates || node.imageVersions2?.candidates),
      ...largestOf(node.display_resources || node.displayResources)
    ].sort((a, b) => b.width - a.width)[0];
    const url = pickUrl(still?.url, node.display_url, node.displayUrl);
    if (!url) return null;
    const files = largestOf(node.video_versions || node.videoVersions);
    const ratio = ratioOf([node.original_width, node.original_height], sizeOf(node.dimensions), sizeOf(still), sizeOf(files[0]));
    const video = videoUrls(files.map(file => file.url), node.video_url, node.videoUrl);
    const picture = { url, format: "", ratio, index, width: still?.width || 0 };
    if (node.pk || node.id) picture.id = String(node.pk || node.id).slice(0, 80);
    if (video.length || node.media_type === 2 || node.mediaType === 2 || node.is_video === true || node.isVideo === true) {
      picture.video = video;
    }
    return picture;
  }

  function instagramCount(value) {
    const count = Number(value);
    return Number.isInteger(count) && count > 0 && count <= MAX_INSTAGRAM_MEDIA ? count : undefined;
  }

  function isInstagramCarousel(node) {
    return Boolean(node.carousel_media || node.carouselMedia || node.edge_sidecar_to_children ||
      node.__typename === "GraphSidecar" || Number(node.media_type || node.mediaType) === 8 ||
      Number(node.carousel_media_count || node.carouselMediaCount) > 1);
  }

  function instagramAvatar(user) {
    for (const value of [user.profile_pic_url, user.profilePicUrl, user.profile_pic_url_hd, user.hd_profile_pic_url_info?.url]) {
      if (typeof value !== "string" || value.length >= 12000) continue;
      try {
        const url = new URL(value);
        if (url.protocol === "https:" && !url.username && !url.password &&
            /(^|\.)(cdninstagram\.com|fbcdn\.net)$/.test(url.hostname)) return url.href;
      } catch {}
    }
    return "";
  }

  // A post: its own picture, or the pictures of its set ("carousel" in the
  // newer data, "sidecar" in the older).
  function fromInstagram(node) {
    const code = String(node.code || node.shortcode || "").slice(0, 40);
    const carousel = node.carousel_media || node.carouselMedia;
    const sidecar = node.edge_sidecar_to_children;
    const set = Array.isArray(carousel) ? carousel
      : Array.isArray(sidecar?.edges) ? sidecar.edges.map(edge => edge?.node || edge) : [];
    const album = isInstagramCarousel(node);
    const pictures = (album ? set.slice(0, MAX_INSTAGRAM_MEDIA) : [node]).map(instagramPicture).filter(Boolean);
    const count = instagramCount(node.carousel_media_count || node.carouselMediaCount || sidecar?.count);
    const mediaCount = album ? count || (!sidecar?.page_info?.has_next_page ? instagramCount(set.length) : undefined) : 1;
    const user = node.user?.username ? node.user : node.owner || node.user || {};
    const caption = node.caption?.text ?? node.edge_media_to_caption?.edges?.[0]?.node?.text ?? "";
    return {
      id: code, content: String(caption || "").trim().slice(0, 60000), author: String(user.username || ""), avatar: instagramAvatar(user),
      pictures, mediaCount, complete: Boolean(mediaCount && pictures.length === mediaCount &&
        pictures.every((picture, index) => picture.index === index)),
      url: "https://www.instagram.com/p/" + encodeURIComponent(code) + "/", quote: null
    };
  }
  const isInstagramPost = node => (node.code || node.shortcode) && typeof (node.code || node.shortcode) === "string" &&
    (isInstagramCarousel(node) || node.image_versions2 || node.imageVersions2 || node.display_url || node.displayUrl);

  function mergeInstagram(previous, record) {
    const total = Math.max(previous.mediaCount || 0, record.mediaCount || 0) || undefined;
    const canReplace = record.complete && record.mediaCount === total;
    const slots = new Map((canReplace ? [] : previous.pictures).map(picture => [picture.index, picture]));
    for (const picture of record.pictures) {
      const old = previous.pictures.find(item =>
        (picture.id && item.id === picture.id) || imageKey(item.url) === imageKey(picture.url));
      if (canReplace || !slots.has(picture.index) || old?.index === picture.index) {
        const same = old
          ? { ...(old.width > picture.width ? old : picture), index: picture.index, ratio: picture.ratio || old.ratio }
          : picture;
        if (old?.video || picture.video) same.video = videoUrls(picture.video || [], old?.video || []);
        slots.set(picture.index, same);
      }
    }
    record.pictures = [...slots.values()].sort((a, b) => a.index - b.index);
    record.mediaCount = total;
    record.complete = Boolean(total && record.pictures.length === total &&
      record.pictures.every((picture, index) => picture.index === index));
  }

  function claimPicture(url, id) {
    const key = imageKey(url);
    if (!key) return;
    if (site !== "instagram") {
      owners.set(key, id);
      return;
    }
    let matches = owners.get(key);
    if (!matches) owners.set(key, matches = new Set());
    matches.add(id);
  }

  function releasePicture(url, id) {
    const key = imageKey(url);
    const owner = owners.get(key);
    if (site !== "instagram") {
      if (owner === id) owners.delete(key);
      return;
    }
    if (owner?.delete(id) && !owner.size) owners.delete(key);
  }

  function postByPicture(url) {
    if (!url) return null;
    const owner = owners.get(imageKey(url));
    if (site !== "instagram") return records.get(owner);
    // A picture shared by multiple posts cannot identify one album by itself.
    return owner?.size === 1 ? records.get(owner.values().next().value) : null;
  }

  function store(record) {
    if (off()) return false;
    if (!record.id && !record.pictures.length) return;
    // Only posts with pictures or videos, or reposts of one, are kept: the
    // card only ever shows next to a picture. Text-only messages are skipped.
    // (Instagram records are media posts by shape; a set may list only its count.)
    if (site !== "instagram" && !record.pictures.length && !record.quote && !records.has(record.id)) return false;
    const id = record.id || imageKey(record.pictures[0].url);
    const previous = records.get(id);
    if (previous) {
      if (previous.content.length > record.content.length) {
        record.content = previous.content;
        record.truncated = previous.truncated;
      }
      if (!record.author) record.author = previous.author;
      if (previous.quote && record.quote && previous.quote.content.length > record.quote.content.length) {
        record.quote.content = previous.quote.content;
        record.quote.truncated = previous.quote.truncated;
      }
      if (site === "instagram") {
        if (!record.avatar && record.author.toLowerCase() === previous.author.toLowerCase()) record.avatar = previous.avatar;
        mergeInstagram(previous, record);
        if (JSON.stringify(record) === JSON.stringify(previous)) return false;
      } else if (!record.pictures.length) {
        record.pictures = previous.pictures;
      }
    }
    // Refresh media ownership when a post changes, including after eviction.
    if (previous) {
      for (const picture of previous.pictures) releasePicture(picture.url, id);
    }
    records.delete(id);
    records.set(id, record);
    for (const picture of record.pictures) claimPicture(picture.url, id);
    while (records.size > MAX_POSTS) {
      const oldest = records.keys().next().value;
      for (const picture of records.get(oldest).pictures) releasePicture(picture.url, oldest);
      records.delete(oldest);
    }
    return true;
  }

  function ingest(payload) {
    if (off()) return;
    let remaining = site === "x" || site === "instagram" ? 40000 : 12000;
    const seen = new WeakSet();
    let changed = false;
    function visit(node, depth) {
      // Instagram tucks some of its data into JSON written inside strings.
      if (site === "instagram" && typeof node === "string" && node.length > 80 && node.length < 3000000 &&
          INSTAGRAM_MEDIA_FIELDS.test(node) && --remaining >= 0) {
        try { visit(JSON.parse(node), depth + 1); } catch {}
        return;
      }
      if (!node || typeof node !== "object" || depth > 30 || --remaining < 0 || seen.has(node)) return;
      seen.add(node);
      if (Array.isArray(node)) {
        for (const child of node) visit(child, depth + 1);
        return;
      }
      if (site === "x") {
        const tweet = xTweet(node);
        if (tweet) {
          // A repost wraps the original; the original owns the pictures.
          const reposted = tweet.legacy.retweeted_status_result;
          if (reposted) visit(reposted, depth + 1);
          else store(fromX(tweet));
          visit(tweet.quoted_status_result, depth + 1);
          return;
        }
      }
      if (site === "instagram") {
        // A post's own set is read whole; its pictures are not posts.
        if (isInstagramPost(node)) {
          if (store(fromInstagram(node))) changed = true;
          return;
        }
        const entries = Object.entries(node);
        for (const [key, child] of entries) {
          if (entries.length <= 80 || /data|item|media|node|edge|xdt|carousel|sidecar|result|require|feed|post|bbox|props|story/i.test(key)) visit(child, depth + 1);
        }
        return;
      }
      const isPost = site === "x" ? false : site === "jike"
        ? (node.id || node.postId) && (Array.isArray(node.pictures) || typeof node.content === "string")
        : (node.mblogid || node.bid || node.mid || node.idstr && (node.pic_infos || node.pics)) &&
          (node.user || node.pic_infos || node.pics);
      if (isPost) store(site === "jike" ? fromJike(node) : fromWeibo(node));
      const entries = Object.entries(node);
      for (const [key, child] of entries) {
        if (entries.length <= 80 || /data|item|post|status|mblog|list|feed|content|card|result|page|state|props|retweet/i.test(key)) {
          visit(child, depth + 1);
        }
      }
    }
    try {
      visit(payload, 0);
      if (site !== "instagram" || changed) document.dispatchEvent(new CustomEvent("__zizai_posts_updated"));
    } catch {
      // Malformed page data must never interrupt the site's own request.
    }
  }

  // Weibo's long-text answer: { data: { longTextContent } }, with the post's
  // id only in the request's address.
  function longTextId(value) {
    try {
      const url = new URL(value, location.href);
      return site === "weibo" && /\/(ajax\/statuses\/longtext|statuses\/extend)$/.test(url.pathname) ? url.searchParams.get("id") || "" : "";
    } catch {
      return "";
    }
  }
  function takeLongText(id, payload) {
    if (off()) return;
    const text = plainText(payload?.data?.longTextContent || payload?.data?.longText?.longTextContent || "");
    if (!id || !text) return;
    const own = records.get(aliases.get(id) || id);
    if (own && own.content.length < text.length) {
      own.content = text;
      own.truncated = false;
    }
    const quoting = records.get(quotedBy.get(id));
    if (quoting?.quote && quoting.quote.content.length < text.length) {
      quoting.quote.content = text;
      quoting.quote.truncated = false;
    }
    document.dispatchEvent(new CustomEvent("__zizai_posts_updated"));
  }
  function handle(url, payload) {
    if (off()) return;
    const id = longTextId(url);
    if (id) takeLongText(id, payload);
    else ingest(payload);
  }

  // Never read private areas: messages, notifications, accounts, payments.
  const PRIVATE = /chat|conversation|direct|\/dms?\/|DM[A-Z]|Dm[A-Z]|inbox|notification|webim|\/im\/|message|account|setting|wallet|pay|order|password|verify|login|logout|oauth/i;
  // In an address, a private area is a whole path part (/messages,
  // /direct_v2, /notifications), so a user named "bordercollie" is still read.
  const PRIVATE_PART = /^(chats?|conversations?|direct|dms?|inbox|notifications?|webim|im|messages?|accounts?|settings?|wallet|pay(ments?)?|orders?|password|verify|login|logout|oauth)(_|\b|$)/i;
  function privatePath(path) {
    return String(path || "").split("/").some(part => PRIVATE_PART.test(part));
  }
  // X names each query in its address. Only the ones that list posts are read.
  const X_POSTS = /Timeline|Tweet|UserMedia|Likes|Bookmarks|Search/;
  // The query's own name, when the page gives one: in the address or in the
  // request body (GraphQL operationName, Instagram's friendly name).
  function operation(url, body) {
    const names = [url.searchParams.get("operationName"), url.searchParams.get("fb_api_req_friendly_name")];
    try {
      if (typeof body === "string") {
        if (/^\s*[{[]/.test(body)) {
          const parsed = JSON.parse(body.slice(0, 200000));
          for (const item of [].concat(parsed)) names.push(item?.operationName);
        } else {
          const form = new URLSearchParams(body);
          names.push(form.get("fb_api_req_friendly_name"), form.get("operationName"));
        }
      } else if (body && typeof body.get === "function") {
        names.push(body.get("fb_api_req_friendly_name"), body.get("operationName"));
      }
    } catch {}
    return names.filter(name => typeof name === "string" && name).join(" ");
  }
  function interesting(value, body) {
    if (off()) return false;
    try {
      const url = new URL(value, location.href);
      if (privatePath(url.pathname)) return false;
      // Query names are joined words (DMInboxTimeline), so any part counts.
      const name = [operation(url, body), site === "x" ? url.pathname.split("/").pop() : ""].join(" ").trim();
      if (name && PRIVATE.test(name)) return false;
      if (site === "x" && !X_POSTS.test(url.pathname.split("/").pop() || "")) return false;
      if (site === "x") return /(^|\.)(x|twitter)\.com$/.test(url.hostname) && /\/graphql\//.test(url.pathname);
      if (site === "instagram") return /(^|\.)instagram\.com$/.test(url.hostname) && /graphql|\/api\/v1\//i.test(url.pathname);
      return site === "jike"
        ? /(^|\.)(okjike\.com|ruguoapp\.com)$/.test(url.hostname) && /\/api\/|\/feed|\/originalPost|\/personalUpdate|\/posts/i.test(url.pathname)
        : /(^|\.)(weibo\.com|weibo\.cn)$/.test(url.hostname) && /\/ajax\/|\/api\/|\/statuses\//i.test(url.pathname);
    } catch {
      return false;
    }
  }

  // The site's Relay responses can be JSON, newline-delimited JSON, or
  // multipart JSON. Deferred fields are relative to the initial "data"
  // object, so assemble them before interpreting a partial carousel.
  function parseInstagramText(text, contentType = "") {
    if (off()) return;
    if (!text || text.length > MAX_RESPONSE_BYTES) return;
    const parse = value => {
      try { return JSON.parse(value.trim().replace(/^for\s*\(\s*;;\s*\)\s*;\s*/, "")); } catch { return null; }
    };
    const boundary = /\bboundary\s*=\s*(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
    const marker = boundary?.[1] || boundary?.[2];
    const ordinary = marker ? null : parse(text);
    const packets = ordinary ? (Array.isArray(ordinary) ? ordinary : [ordinary]) : marker
      ? text.split("--" + marker).map(part => parse(part.split(/\r?\n\r?\n/, 2)[1] || ""))
      : text.split(/\r?\n/).map(parse);
    const roots = [];
    let current = null;
    for (const value of packets) {
      if (!value) continue;
      const packet = value.payload || value;
      if (!Array.isArray(packet.path)) {
        if (packet.data && typeof packet.data === "object") current = packet;
        roots.push(packet);
      } else if (current) {
        applyInstagramPatch(current, packet);
      }
      if (current && Array.isArray(packet.incremental)) {
        for (const patch of packet.incremental) applyInstagramPatch(current, patch);
      }
    }
    ingest(roots);
  }

  function validPatchKey(key) {
    return typeof key === "string" && key !== "__proto__" && key !== "constructor" && key !== "prototype" ||
      Number.isInteger(key) && key >= 0 && key < 2000;
  }

  function mergePatchValue(previous, value, depth = 0) {
    if (!value || typeof value !== "object" || depth >= 30) return value;
    const next = Array.isArray(value)
      ? (Array.isArray(previous) ? previous : [])
      : (previous && typeof previous === "object" && !Array.isArray(previous) ? previous : {});
    for (const [key, child] of Object.entries(value)) {
      if (validPatchKey(key) && (!Array.isArray(next) || /^\d+$/.test(key) && Number(key) < 2000)) {
        next[key] = mergePatchValue(next[key], child, depth + 1);
      }
    }
    return next;
  }

  function applyInstagramPatch(root, patch) {
    if (!Array.isArray(patch?.path) || patch.path.length > 30 || !patch.path.every(validPatchKey)) return;
    const path = patch.path[0] === "data" ? patch.path : ["data", ...patch.path];
    if (Array.isArray(patch.items) && Number.isInteger(path.at(-1))) {
      const index = path.pop();
      const list = valueAtPath(root, path, true);
      if (Array.isArray(list)) {
        for (const [offset, item] of patch.items.entries()) {
          if (index + offset >= 2000) break;
          list[index + offset] = mergePatchValue(list[index + offset], item);
        }
      }
    } else if (patch.data && typeof patch.data === "object") {
      const last = path.pop();
      const parent = valueAtPath(root, path, Number.isInteger(last));
      if (parent && (!Array.isArray(parent) || Number.isInteger(last))) parent[last] = mergePatchValue(parent[last], patch.data);
    }
  }

  function valueAtPath(root, path, arrayAtEnd) {
    let current = root;
    for (const [index, key] of path.entries()) {
      if (Array.isArray(current) && !Number.isInteger(key)) return null;
      if (!Object.hasOwn(current, key) || !current[key] || typeof current[key] !== "object") {
        const array = index === path.length - 1 ? arrayAtEnd : Number.isInteger(path[index + 1]);
        current[key] = array ? [] : {};
      }
      current = current[key];
    }
    return current;
  }

  async function readInstagramResponse(response) {
    const stream = response.body?.getReader();
    if (!stream) return;
    const decoder = new TextDecoder();
    let text = "";
    let length = 0;
    while (true) {
      const { done, value } = await stream.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_RESPONSE_BYTES) {
        stream.cancel().catch(() => {});
        return;
      }
      text += decoder.decode(value, { stream: true });
    }
    parseInstagramText(text + decoder.decode(), response.headers.get("content-type") || "");
  }

  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    const result = originalFetch.apply(this, args);
    try {
      const url = typeof args[0] === "string" ? args[0] : args[0]?.url || args[0]?.href;
      if (interesting(url, args[1]?.body)) result.then(response => {
        try {
          if (off()) return;
          const length = Number(response.headers.get("content-length"));
          if (length > MAX_RESPONSE_BYTES) return;
          const copy = response.clone();
          if (site === "instagram") readInstagramResponse(copy).catch(() => {});
          else copy.json().then(payload => handle(url, payload), () => {});
        } catch {}
      }, () => {});
    } catch {}
    return result;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const requestUrls = new WeakMap();
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    requestUrls.set(this, String(url || ""));
    return originalOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    if (interesting(requestUrls.get(this), args[0])) {
      this.addEventListener("load", () => {
        try {
          if (off()) return;
          const url = requestUrls.get(this);
          if (this.responseType === "json") handle(url, this.response);
          else if ((!this.responseType || this.responseType === "text") && this.responseText.length <= MAX_RESPONSE_BYTES) {
            if (site === "instagram") parseInstagramText(this.responseText, this.getResponseHeader("content-type") || "");
            else handle(url, JSON.parse(this.responseText));
          }
        } catch {}
      }, { once: true });
    }
    return originalSend.apply(this, args);
  };

  document.addEventListener("__zizai_post_request", event => {
    if (stopped) return;
    try {
      const request = JSON.parse(String(event.detail).slice(0, 12000));
      // By the post's own number when given, else by the picture.
      const byId = request.id ? records.get(String(request.id).slice(0, 40)) : null;
      const post = site === "instagram" && request.id ? byId : byId || postByPicture(request.url);
      document.dispatchEvent(new CustomEvent("__zizai_post_response", {
        detail: JSON.stringify({ requestId: request.requestId, post: post || null })
      }));
    } catch {}
  });

  // The full page asks for the whole text of a long Weibo post (and of the
  // post it quotes). Once per post, from the page's own long-text endpoint,
  // with the page's own session, as a click on "展开" would.
  document.addEventListener("__zizai_longtext_request", event => {
    if (stopped) return;
    try {
      if (site !== "weibo") return;
      const request = JSON.parse(String(event.detail).slice(0, 12000));
      const post = records.get(owners.get(imageKey(request.url)));
      if (!post) return;
      const path = /(^|\.)weibo\.cn$/.test(location.hostname) ? "/statuses/extend?id=" : "/ajax/statuses/longtext?id=";
      for (const id of [post.truncated && post.id, post.quote?.truncated && post.quote.id]) {
        if (!id || asked.has(id)) continue;
        asked.add(id);
        window.fetch(path + encodeURIComponent(id), { credentials: "same-origin" }).catch(() => {});
      }
    } catch {}
  });

  const INLINE_JSON = "#__NEXT_DATA__,script[type='application/json']";
  const scannedInline = new WeakMap();
  function readInline(script) {
    if (stopped) return;
    const text = script.textContent;
    if (!text || text.length > MAX_RESPONSE_BYTES || scannedInline.get(script) === text.length) return;
    if (site === "instagram" && !INSTAGRAM_MEDIA_FIELDS.test(text)) return;
    try {
      const payload = JSON.parse(text);
      scannedInline.set(script, text.length);
      ingest(payload);
    } catch {}
  }

  function scanInline() {
    if (stopped) return;
    const state = site === "weibo" ? window.$render_data || window.__PRELOADED_STATE__ : null;
    if (state) ingest(state);
    for (const script of document.querySelectorAll(INLINE_JSON)) readInline(script);
  }
  if (site === "instagram" && typeof MutationObserver === "function") {
    // On a client-side navigation the feed can append more JSON after the
    // initial document has loaded. Scan just the newly attached scripts.
    new MutationObserver(mutations => {
      for (const mutation of mutations) {
        if (mutation.target.matches?.(INLINE_JSON)) readInline(mutation.target);
        for (const node of mutation.addedNodes) {
          if (node.matches?.(INLINE_JSON)) readInline(node);
          else node.querySelectorAll?.(INLINE_JSON).forEach(readInline);
        }
      }
    }).observe(document, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scanInline, { once: true });
  else scanInline();
})();
