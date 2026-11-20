(() => {
  const images = globalThis.__zizai_site_images;
  const site = images.platform();

  // "展开", "Show more" and similar links mean the page holds back the rest
  // of the text. They are removed from the text and reported as a cut.
  const MORE = /^[.…\s]*(展开全文c?|展开|全文|显示更多|查看更多|Show more|Read more|See more|more)$/i;
  const LESS = /^(收起|收起全文d?|Show less)$/i;

  // The same buttons sometimes reach the text itself (in the page's data, or
  // as plain words at the end of a block): "…展开", "收起", "Show more".
  // They are page controls, not words of the post.
  // Short words like 展开 count only after "…" or a break, so a sentence
  // that ends "故事慢慢展开" keeps its last word.
  const TAIL = /(?:(?:\.{3}|…|\s)\s*(展开|收起)|\s*(展开全文c?|收起全文d?|显示更多|查看更多|Show more|Show less|Read more|See more))\s*$/i;
  function withoutLabels(text) {
    let value = String(text || "");
    let cut = false;
    for (let match; (match = value.match(TAIL)); ) {
      if (MORE.test(match[1] || match[2])) cut = true;
      value = value.slice(0, match.index);
    }
    return { text: value.trim(), cut };
  }
  function cleanPost(post) {
    const main = withoutLabels(post.content);
    post.content = main.text;
    if (main.cut) post.truncated = true;
    if (post.quote?.content) {
      const quote = withoutLabels(post.quote.content);
      post.quote = { ...post.quote, content: quote.text, truncated: post.quote.truncated || quote.cut };
    }
    return post;
  }

  function textFrom(node, info) {
    if (!node) return "";
    const copy = node.cloneNode(true);
    for (const marker of copy.querySelectorAll("a,span,button,i")) {
      if (!marker.isConnected) continue;
      const label = (marker.textContent || "").trim();
      if (label.length > 12) continue;
      if (MORE.test(label)) {
        if (info) info.cut = true;
        marker.remove();
      } else if (LESS.test(label)) marker.remove();
    }
    for (const image of copy.querySelectorAll("img")) image.replaceWith(image.alt || "");
    for (const br of copy.querySelectorAll("br")) br.replaceWith("\n");
    for (const unwanted of copy.querySelectorAll("button,script,style,[aria-hidden='true']")) unwanted.remove();
    for (const block of copy.querySelectorAll("p,div,li")) block.append("\n");
    return (copy.textContent || "").replace(/\u200b/g, "").replace(/\n{3,}/g, "\n\n").trim().slice(0, 60000);
  }

  function rootFor(element) {
    if (!site) return null;
    if (site === "instagram") return element.closest("article,[role='dialog']");
    const known = element.closest(site === "x" ? "article[data-testid='tweet'],article" : "article,[data-testid='post'],[class*='_post_'],.WB_feed_type,.WB_cardwrap");
    if (known || site === "x") return known;
    let node = element.parentElement;
    for (let depth = 0; node && node !== document.body && depth < 9; depth++, node = node.parentElement) {
      if (node.querySelector("a[href*='/u/'],a[href*='/user/'],a[href*='/n/']") &&
          node.querySelectorAll("img").length <= 24) return node;
    }
    return null;
  }

  // The page can watch and fake these events, so the answer is treated as
  // outside input: plain data only, links only http(s), sizes bounded.
  function cleanAnswer(value, depth = 0) {
    if (depth > 6) return null;
    if (typeof value === "string") {
      if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^https?:\/\//i.test(value)) return "";
      return value.slice(0, 60000);
    }
    if (typeof value === "number") return Number.isFinite(value) ? value : 0;
    if (typeof value === "boolean" || value === null) return value;
    if (Array.isArray(value)) return value.slice(0, 60).map(item => cleanAnswer(item, depth + 1));
    if (typeof value !== "object") return null;
    const out = {};
    for (const [key, item] of Object.entries(value).slice(0, 40)) {
      if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
      out[key] = cleanAnswer(item, depth + 1);
    }
    return out;
  }

  function cachedPost(url, id = "") {
    if (!site) return null;
    const requestId = Date.now().toString(36) + Math.random().toString(36).slice(2);
    let post = null;
    const onResponse = event => {
      try {
        if (typeof event.detail !== "string" || event.detail.length > 200000) return;
        const response = JSON.parse(event.detail);
        if (response.requestId === requestId && response.post && typeof response.post === "object") post = cleanAnswer(response.post);
      } catch {}
    };
    document.addEventListener("__zizai_post_response", onResponse);
    document.dispatchEvent(new CustomEvent("__zizai_post_request", { detail: JSON.stringify({ requestId, url, id }) }));
    document.removeEventListener("__zizai_post_response", onResponse);
    return post;
  }

  // X marks the parts of a post with data-testid. A quoted post sits in a
  // nested link box with its own name and text; when the hovered picture is
  // inside that box, the quoted post is the one shown.
  function xName(node) {
    if (!node) return { name: "", handle: "" };
    // The name row also holds the post time; leave it out.
    const copy = node.cloneNode(true);
    for (const time of copy.querySelectorAll("time")) (time.closest("a") || time).remove();
    const text = textFrom(copy);
    const handle = text.match(/@[A-Za-z0-9_]{1,15}/)?.[0] || "";
    const first = text.split("\n").map(line => line.trim()).find(Boolean) || "";
    return { name: (first.startsWith("@") ? "" : first).slice(0, 80), handle };
  }

  // The small round picture next to the name, if the page shows one.
  function avatarIn(scope, selector) {
    const image = scope?.querySelector(selector);
    const box = image?.getBoundingClientRect();
    return image && box.width <= 96 ? image.currentSrc || image.src || "" : "";
  }

  function timeIn(node) {
    return node ? (node.textContent || "").trim().slice(0, 40) : "";
  }

  function instagramAvatarUrl(value) {
    if (typeof value !== "string" || value.length >= 12000) return "";
    try {
      const url = new URL(value);
      if (url.protocol === "https:" && !url.username && !url.password &&
          ["cdninstagram.com", "fbcdn.net"].some(host => images.isHost(url.hostname, host))) return url.href;
    } catch {}
    return "";
  }

  function instagramProfileName(link) {
    if (!link) return "";
    try {
      const url = new URL(link.href);
      if (images.platform(url.hostname) === "instagram") return /^\/([\w.]{1,30})\/?$/.exec(url.pathname)?.[1] || "";
    } catch {}
    return "";
  }

  function instagramAvatarIn(scope, expected) {
    if (!scope) return null;
    for (const image of scope.querySelectorAll("img")) {
      // The feed's avatar button may have no link. Its alt still names the
      // profile, and the adjacent username link confirms who owns it.
      const owner = instagramProfileName(image.closest("a[href]")) ||
        /^([\w.]{1,30})(?:['’]s profile picture|\s*的(?:头像|頭像|個人檔案相片))$/i.exec(image.alt)?.[1];
      if (!owner || (expected && owner.toLowerCase() !== expected)) continue;
      if (!expected && ![...scope.querySelectorAll("a[href]")].some(link =>
        instagramProfileName(link).toLowerCase() === owner.toLowerCase())) continue;
      const { width, height } = image.getBoundingClientRect();
      if (Math.min(width, height) <= 0 || Math.max(width, height) > 96) continue;
      const avatar = instagramAvatarUrl(image.currentSrc || image.src);
      if (avatar) return { author: owner, avatar };
    }
    return null;
  }

  function fromInstagramDom(root, code, author) {
    const expected = String(author || "").trim().toLowerCase();
    const time = [...(root?.querySelectorAll("a[href] time") || [])].find(node =>
      code && INSTAGRAM_POST_PATH.exec(node.closest("a[href]")?.getAttribute("href") || "")?.[1] === code);
    const permalink = time?.closest("a[href]");
    let owner = instagramAvatarIn(root?.querySelector("header"), expected);
    let scope = permalink?.parentElement;
    for (let depth = 0; !owner && scope && scope !== root && depth < 10; depth++, scope = scope.parentElement) {
      owner = instagramAvatarIn(scope, expected);
    }
    if (!owner && expected) owner = instagramAvatarIn(root, expected);
    return {
      author: owner?.author || "", avatar: owner?.avatar || "", time: timeIn(time),
      url: permalink?.href || "", content: "", handle: "", quote: null
    };
  }

  function fromX(root, element) {
    const quoteBox = [...root.querySelectorAll("div[role='link']")]
      .find(node => node.querySelector("[data-testid='User-Name']"));
    const outer = selector => [...root.querySelectorAll(selector)].find(node => !quoteBox?.contains(node)) || null;
    const mainName = xName(outer("[data-testid='User-Name']"));
    const main = {
      author: mainName.name || mainName.handle, handle: mainName.name ? mainName.handle : "",
      content: textFrom(outer("[data-testid='tweetText']")),
      truncated: Boolean(outer("[data-testid='tweet-text-show-more-link']")),
      avatar: avatarIn(outer("[data-testid='Tweet-User-Avatar']"), "img"),
      time: timeIn(outer("time"))
    };
    let quoted = null;
    if (quoteBox) {
      const quoteName = xName(quoteBox.querySelector("[data-testid='User-Name']"));
      quoted = {
        author: quoteName.name || quoteName.handle, handle: quoteName.name ? quoteName.handle : "",
        content: textFrom(quoteBox.querySelector("[data-testid='tweetText']")),
        truncated: Boolean(quoteBox.querySelector("[data-testid='tweet-text-show-more-link']")),
        avatar: avatarIn(quoteBox, "[data-testid='Tweet-User-Avatar'] img,img[src*='profile_images']"),
        time: timeIn(quoteBox.querySelector("time"))
      };
    }
    const link = outer("a[href*='/status/'] time")?.closest("a");
    if (quoted && quoteBox.contains(element)) return { ...quoted, url: "", quote: null };
    return { ...main, url: link?.href || "", quote: quoted?.content ? quoted : null };
  }

  function fromDom(root, element) {
    if (!root) return { author: "", handle: "", avatar: "", time: "", content: "", url: "", quote: null };
    if (site === "x") return fromX(root, element);
    const userLinks = [...root.querySelectorAll("a[href*='/u/'],a[href*='/user/'],a[href*='/n/']")];
    const author = userLinks.map(textFrom).find(text => text && text.length < 80) || "";
    let body;
    if (site === "weibo") {
      body = root.querySelector(".wbpro-feed-ogText,.WB_text,[node-type='feed_list_content'],[class*='_text_']");
    } else {
      body = root.querySelector("[class*='_contentWrapper_'] > div:first-child,[data-testid='post-content'],[class*='post-content']");
    }
    const info = {};
    const content = textFrom(body, info);
    const links = [...root.querySelectorAll("a[href]")];
    const link = links.find(node => {
      try {
        const url = new URL(node.href);
        return images.platform(url.hostname) === site && (site === "jike"
          ? /\/(originalPost|original-post|originalPosts|post)\//.test(url.pathname)
          : /^\/(status|detail)\//.test(url.pathname) || /^\/\d+\/[A-Za-z0-9]+$/.test(url.pathname));
      } catch { return false; }
    });
    const quoted = root.querySelector(".retweet,[class*='_retweet_'],.WB_feed_expand");
    const quoteInfo = {};
    const quoteText = quoted ? textFrom(quoted.querySelector(".wbpro-feed-content,.WB_text,[class*='_text_']"), quoteInfo) : "";
    return {
      author, content, truncated: Boolean(info.cut), url: link?.href || "", handle: "",
      avatar: avatarIn(root, "a[href*='/u/'] img,a[href*='/user/'] img,img[class*='avatar' i]"),
      time: timeIn(root.querySelector("time,[class*='_time_'],.WB_from a[date]")),
      quote: quoted ? {
        author: textFrom(quoted.querySelector("a[href*='/u/'],a[href*='/n/']")).replace(/^@/, ""),
        content: quoteText, truncated: Boolean(quoteInfo.cut)
      } : null
    };
  }

  // Video files listed for a picture (a video's still, a Live Photo).
  function cleanVideo(picture) {
    const urls = Array.isArray(picture?.video) ? picture.video.filter(url =>
      typeof url === "string" && url.length < 12000 && /^https?:\/\//i.test(url)).slice(0, 6) : [];
    return urls.length ? { urls, live: picture.live === true, gif: picture.gif === true } : null;
  }

  function pictureIn(cached, url) {
    if (!cached || !Array.isArray(cached.pictures)) return null;
    const key = images.mediaKey(url);
    return key && cached.pictures.slice(0, 24).find(item => typeof item?.url === "string" && images.mediaKey(item.url) === key) || null;
  }
  const videoIn = (cached, url) => cleanVideo(pictureIn(cached, url));
  // The post's only video, when it has exactly one.
  function soleVideo(cached) {
    const videos = Array.isArray(cached?.pictures) ? cached.pictures.slice(0, 24).map(cleanVideo).filter(Boolean) : [];
    return videos.length === 1 ? videos[0] : null;
  }
  const cleanRatio = picture => {
    const ratio = Number(picture?.ratio);
    return Number.isFinite(ratio) && ratio > 0.01 && ratio < 100 ? ratio : 0;
  };

  // Width over height of a picture or video, as the page's data lists it
  // (0 when unknown). Used to plan the frame before anything has loaded.
  function ratioFor(...urls) {
    if (!site) return 0;
    for (const url of urls) {
      if (!url) continue;
      const ratio = cleanRatio(pictureIn(cachedPost(url), url));
      if (ratio) return ratio;
    }
    return 0;
  }

  // The address the page's data lists for a picture (its full copy), or "".
  function listedUrl(url) {
    const picture = site ? pictureIn(cachedPost(url), url) : null;
    return typeof picture?.url === "string" ? picture.url : "";
  }

  // Whether the page's data lists a video for this still. Used while
  // hovering, so a video poster opens even when it is not larger than shown.
  function videoFor(url) {
    return site ? videoIn(cachedPost(url), url) : null;
  }

  // An Instagram post's code, from the link around the picture (a profile
  // grid), the post's own links (a feed post) or the address (a post page).
  const INSTAGRAM_POST_PATH = /\/(?:p|reel|tv)\/([A-Za-z0-9_-]{5,40})/;
  function instagramCode(element, root) {
    const link = element.closest("a[href*='/p/'],a[href*='/reel/']") || root?.querySelector("a[href*='/p/'],a[href*='/reel/']");
    return INSTAGRAM_POST_PATH.exec(link?.getAttribute("href") || "")?.[1] || INSTAGRAM_POST_PATH.exec(location.pathname)?.[1] || "";
  }

  const slideLabel = /^(\D*)(\d+)(\D*)$/;
  const slideTrack = "ul,ol,[role='list']";
  function instagramCarousel(element, root) {
    const item = element.closest("li");
    const track = item?.parentElement;
    if (!root || !track?.matches(slideTrack) || !root.contains(track)) return null;
    const width = item.getBoundingClientRect().width;
    if (width < 48) return null;
    const itemIndex = instagramItemIndex(item, width);
    const steps = instagramSteps(root, 0, itemIndex);
    return steps ? { root, track, buttons: steps.buttons, width, index: steps.index } : null;
  }

  function instagramSteps(root, count = 0, itemIndex = null) {
    for (const current of root.querySelectorAll("button[aria-current='step']")) {
      const label = slideLabel.exec(current.getAttribute("aria-label") || "");
      if (!label) continue;
      const dots = [...current.parentElement.children].flatMap(node => {
        const part = node.matches("button") && slideLabel.exec(node.getAttribute("aria-label") || "");
        return part && part[1] === label[1] && part[3] === label[3] ? [{ button: node, number: Number(part[2]) }] : [];
      });
      if (dots.length < 2 || dots.length > 24 || !dots.every((dot, index) => dot.number === index + 1)) continue;
      if (count && dots.length !== count) continue;
      const buttons = dots.map(dot => dot.button);
      const index = itemIndex ?? buttons.indexOf(current);
      if (buttons[index] !== current) continue;
      return { buttons, index };
    }
    return null;
  }

  function instagramItemIndex(item, width) {
    const shift = /^translateX\((-?[\d.]+)px\)$/.exec(item.style.transform);
    if (!shift) return null;
    const index = Math.round(Number(shift[1]) / width);
    return Math.abs(Number(shift[1]) - index * width) <= 2 ? index : null;
  }

  // Instagram can replace the track or its buttons while filling a slide.
  // Find their replacements inside the same post, retaining the preview's
  // original position independently of Instagram's current slide.
  function refreshInstagramCarousel(carousel) {
    if (!carousel?.root.isConnected) return -1;
    let index = carousel.buttons.findIndex(button => button.getAttribute("aria-current") === "step");
    if (index < 0 || carousel.buttons.some(button => !button.isConnected)) {
      const steps = instagramSteps(carousel.root, carousel.buttons.length);
      if (!steps) return -1;
      carousel.buttons = steps.buttons;
      index = steps.index;
    }
    if (!carousel.track.isConnected) {
      const candidates = [...carousel.root.querySelectorAll(slideTrack)].filter(track =>
        [...track.children].some(item => instagramItemIndex(item, carousel.width) === index && item.querySelector("img,video")));
      if (candidates.length !== 1) return -1;
      carousel.track = candidates[0];
    }
    return index;
  }

  function instagramSlides(carousel) {
    const { track, buttons, width } = carousel;
    if (!track.isConnected) return [];
    const items = [...track.children];
    // Instagram mounts only nearby slides. Their horizontal offsets encode
    // the absolute index. The 1px spacer at the end has no media.
    return items.flatMap(item => {
      const index = instagramItemIndex(item, width);
      if (index === null || !buttons[index]) return [];
      const element = item.querySelector("video") ||
        [...item.querySelectorAll("img")].find(image => image.getBoundingClientRect().width >= width * 0.5);
      return element ? [{ index, element }] : [];
    });
  }

  function contextFor(anchor, existingCarousel) {
    const root = existingCarousel?.root || rootFor(anchor.element);
    // Instagram: by the post's code first, so a set is found whole even
    // from a picture the page has not drawn yet; else by the picture.
    const code = site === "instagram" ? instagramCode(anchor.element, root) : "";
    const byCode = code ? cachedPost("", code) : null;
    const byUrl = byCode ? null : cachedPost(anchor.fallback || anchor.url);
    const cached = byCode || (code && byUrl?.id !== code ? null : byUrl);
    const dom = site === "instagram" ? fromInstagramDom(root, code, cached?.author) : fromDom(root, anchor.element);
    const valid = cached && typeof cached === "object";
    const pictures = valid && Array.isArray(cached.pictures)
      ? cached.pictures.slice(0, 24).filter(picture => picture && typeof picture.url === "string" && picture.url.length < 12000)
        .map(picture => ({
          url: picture.url, format: String(picture.format || ""), video: cleanVideo(picture),
          index: picture.index, ratio: cleanRatio(picture)
        })) : [];
    let video = valid ? videoIn(cached, anchor.fallback || anchor.url) : null;
    const fromCache = Boolean(byCode) || pictures.some(picture => images.mediaKey(picture.url) === images.mediaKey(anchor.url));
    const longer = (text, than) => typeof text === "string" && text.trim().length > than.length ? text.trim().slice(0, 60000) : "";
    if (site === "x") {
      // A video's cover address on the page does not always match the one in
      // the page's data. The post's own number does: find the post by it, so
      // the video plays from its file (full quality), not as a copy of the
      // page's small player.
      const number = /\/status\/(\d+)/.exec(dom.url || "")?.[1];
      // Only for something that is itself a video (its player, or one of
      // X's video covers): a picture next to a video in the same post must
      // stay a picture.
      const isVideo = Boolean(anchor.video) || anchor.element instanceof HTMLVideoElement ||
        /\/(?:ext_tw_video_thumb|amplify_video_thumb|tweet_video_thumb)\//.test(anchor.fallback || anchor.url || "");
      if (!video && number && isVideo) {
        const byNumber = cachedPost("", number);
        video = videoIn(byNumber, anchor.fallback || anchor.url) || soleVideo(byNumber);
      }
      // The page's own timeline data holds the full text of long posts;
      // the visible card stops at "Show more". The gallery still comes from
      // the page, as before.
      const post = { ...dom };
      const full = fromCache && dom.truncated && longer(cached.content, dom.content);
      if (full) { post.content = full; post.truncated = false; }
      const quoteFull = valid && dom.quote?.truncated && longer(cached.quote?.content, dom.quote.content);
      if (quoteFull) post.quote = { ...dom.quote, content: quoteFull, truncated: false };
      return { root, post: cleanPost(post), pictures: [], video };
    }
    // A shortened name ("很长的名…") still counts as the same person.
    const short = name => String(name || "").replace(/(\.\.\.|…)$/, "").trim();
    const samePerson = Boolean(short(cached?.author)) && short(cached?.author).startsWith(short(dom.author)) || Boolean(short(cached?.author)) && short(dom.author).startsWith(short(cached?.author));
    const quotedPicture = fromCache && dom.quote && dom.author && !samePerson;
    const useCached = fromCache && !quotedPicture && String(cached.content || "").length > dom.content.length;
    const post = {
      // The page's own data holds the whole name; the visible one may be
      // shortened (Jike cuts long names) or picked from the wrong link.
      author: (fromCache && !quotedPicture && String(cached.author || "").trim().slice(0, 80)) || dom.author,
      content: useCached ? String(cached.content).slice(0, 60000) : dom.content,
      truncated: useCached ? Boolean(cached.truncated) : dom.truncated,
      url: dom.url || (fromCache ? String(cached.url || "") : ""),
      handle: dom.handle || "", time: dom.time || "",
      avatar: dom.avatar || (site === "instagram" && fromCache ? instagramAvatarUrl(cached.avatar) : ""),
      quote: quotedPicture
        ? { author: String(cached.author || "").slice(0, 80), content: String(cached.content || "").slice(0, 60000), truncated: Boolean(cached.truncated) }
        : dom.quote
    };
    // A quoted post the page cut short may be whole in the page's data.
    if (!quotedPicture && post.quote && fromCache && longer(cached.quote?.content, post.quote.content || "")) {
      post.quote = { ...post.quote, content: cached.quote.content.trim().slice(0, 60000), truncated: Boolean(cached.quote.truncated) };
    }
    cleanPost(post);
    if (post.url) {
      try {
        if (images.platform(new URL(post.url).hostname) !== site) post.url = "";
      } catch { post.url = ""; }
    }
    const carousel = site === "instagram" ? existingCarousel || instagramCarousel(anchor.element, root) : null;
    const mediaCount = fromCache && Number.isInteger(cached?.mediaCount) ? cached.mediaCount : 0;
    return { root, post, pictures: fromCache ? pictures : [], video, carousel, mediaCount };
  }

  globalThis.__zizai_posts = { contextFor, rootFor, videoFor, ratioFor, listedUrl, instagramSlides, refreshInstagramCarousel };
})();
