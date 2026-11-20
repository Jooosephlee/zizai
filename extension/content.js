(() => {
  if (globalThis.__zizai_runtime) return;

  const keys = globalThis.__zizai_keys;
  const siteImages = globalThis.__zizai_site_images;
  const posts = globalThis.__zizai_posts;
  const isInstagram = siteImages.platform() === "instagram";
  const { fitSizeWithinBox, previewPointerPictureHit, previewVisiblePictureRect } = globalThis.__zizai_geometry;
  const message = (key, values) => chrome.i18n.getMessage(key, values);
  const IMAGE_LINK = /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i;
  const GALLERY = "figure, ul, ol, [role='group'], [role='list'], [data-gallery]";
  const MOVE_RADIUS = 6;
  const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
  const MAX_IMAGE_PIXELS = 24 * 1000 * 1000;
  // Video sites have their own players; their videos are not previewed.
  const VIDEO_SITE = /(^|\.)(youtube\.com|bilibili\.com|douyin\.com|tiktok\.com|vimeo\.com|youku\.com|iqiyi\.com|v\.qq\.com)$/i;

  let pointer;
  let settings;
  let frame = 0;
  let pending = null;
  let dismissed = null;
  let active = null;
  let view = null;
  let toastTimer = 0;
  let copying = false;
  let hintChecked = false;
  let wheelTotal = 0;
  let lastWheelSwitch = 0;
  let lastWheelAt = 0;
  let wheelScrolled = false;
  let clicked = false;
  // The reader's video volume, kept across videos and visits.
  let volume = 1;
  // Mute is the reader's choice too: muted once, every video opens muted
  // until sound is turned back on. A mute the browser forced is not kept.
  let soundMuted = false;
  chrome.storage.local.get(["videoVolume", "videoMuted"]).then(({ videoVolume, videoMuted }) => {
    if (Number.isFinite(videoVolume) && videoVolume > 0 && videoVolume <= 1) volume = videoVolume;
    soundMuted = videoMuted === true;
  }).catch(() => {});
  function rememberMute(muted) {
    soundMuted = muted;
    chrome.storage.local.set({ videoMuted: muted }).catch(() => {});
  }

  function mediaUrl(value) {
    if (!value) return "";
    try {
      const url = new URL(value, document.baseURI);
      if (url.username || url.password) return "";
      if (/^https?:$/.test(url.protocol)) return url.href;
      if (url.protocol === "blob:" && url.origin === location.origin) return url.href;
      return /^data:image\//i.test(value) ? value : "";
    } catch {
      return "";
    }
  }

  function imageSource(element) {
    const fallback = mediaUrl(element.currentSrc || element.src);
    if (!fallback) return null;
    const href = mediaUrl(element.closest("a[href]")?.href);
    // A link to the image itself, else the largest copy the page lists
    // (srcset, or the page's own data), else the picture as shown.
    const url = /^https?:/.test(href) && IMAGE_LINK.test(new URL(href).pathname) ? href
      : listedLarger(element, fallback) || dataCopy(fallback) || fallback;
    const urls = siteImages.candidates(url);
    return { element, url: urls[0], urls, fallback, alt: element.alt };
  }

  // The full copy the page's data lists for a picture, on the sites whose
  // data is read (Instagram lists every size; the page shows a small one).
  function dataCopy(shown) {
    if (!isInstagram) return "";
    const url = mediaUrl(posts.listedUrl?.(shown));
    return url && url !== shown ? url : "";
  }

  // Many pages list larger copies of a picture in its srcset (or in the
  // <source> tags of its <picture>) and show the one that fits the box.
  // The largest listed copy is the one to open, when it is larger than
  // the one shown.
  function listedLarger(element, shown) {
    const lists = [element.getAttribute("srcset")];
    if (element.parentElement instanceof HTMLPictureElement) {
      for (const source of [...element.parentElement.querySelectorAll("source")].slice(0, 6)) lists.push(source.getAttribute("srcset"));
    }
    let best = null;
    for (const text of lists) {
      const item = siteImages.largestInSrcset(text);
      if (item && (!best || item.unit === best.unit && item.size > best.size || item.unit === "w" && best.unit === "x")) best = item;
    }
    if (!best) return "";
    const url = mediaUrl(best.url);
    if (!url || url === shown) return "";
    const larger = best.unit === "w" ? best.size > (element.naturalWidth || 0) * 1.2 : best.size > (window.devicePixelRatio || 1);
    return larger ? url : "";
  }

  function backgroundSource(element) {
    if (element === document.body || element === document.documentElement) return null;
    const url = mediaUrl(getComputedStyle(element).backgroundImage.match(/url\((['"]?)(.*?)\1\)/i)?.[2]);
    const urls = siteImages.candidates(url);
    return url ? { element, url: urls[0], urls, fallback: url, alt: "" } : null;
  }

  // A page video. Its still is the poster; files the page plays directly
  // come from its source. Streamed videos (blob:) are mirrored from the
  // page's own player when no file is known.
  // How much two boxes overlap, as a share of the smaller one.
  function overlap(a, b) {
    const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (width <= 0 || height <= 0) return 0;
    return width * height / Math.max(1, Math.min(a.width * a.height, b.width * b.height));
  }

  // Sites such as X lay the video's cover as a picture over or under the
  // player. That picture and the video are one item: the video.
  function videoBehind(picture) {
    if (VIDEO_SITE.test(location.hostname)) return null;
    const box = picture.getBoundingClientRect();
    let node = picture.parentElement;
    for (let depth = 0; node && node !== document.body && depth < 5; depth++, node = node.parentElement) {
      const video = [...node.querySelectorAll("video")].slice(0, 4).find(video => overlap(box, video.getBoundingClientRect()) >= 0.6);
      if (video) return video;
    }
    return null;
  }

  function coverNear(video) {
    const box = video.getBoundingClientRect();
    let node = video.parentElement;
    for (let depth = 0; node && node !== document.body && depth < 3; depth++, node = node.parentElement) {
      const cover = [...node.querySelectorAll("img")].slice(0, 6).find(image => overlap(box, image.getBoundingClientRect()) >= 0.6);
      if (cover) return mediaUrl(cover.currentSrc || cover.src);
    }
    return "";
  }

  function videoSource(element) {
    if (VIDEO_SITE.test(location.hostname)) return null;
    const poster = mediaUrl(element.poster) || coverNear(element);
    const files = [element.currentSrc, element.src, ...[...element.querySelectorAll("source")].map(source => source.src)]
      .map(mediaUrl).filter(url => /^https?:/.test(url));
    const key = poster || files[0] || mediaUrl(element.currentSrc);
    if (!key) return null;
    return { element, url: key, urls: [key], fallback: poster, alt: "",
      video: { urls: [...new Set(files)], live: false, gif: false, source: element } };
  }

  // Videos listed in the page's data for a still, remembered briefly so
  // hovering does not ask on every frame.
  let videoMemo = { url: "", at: 0, value: null };
  function listedVideo(url) {
    if (!siteImages.platform() || !url) return null;
    if (videoMemo.url !== url || performance.now() - videoMemo.at > 1000) {
      videoMemo = { url, at: performance.now(), value: posts.videoFor(url) };
    }
    return videoMemo.value;
  }

  function mediaSize(element) {
    if (element instanceof HTMLVideoElement) return [element.videoWidth, element.videoHeight];
    if (element instanceof HTMLCanvasElement) return [element.width, element.height];
    return element ? [element.naturalWidth, element.naturalHeight] : [0, 0];
  }

  // The proportions of a picture as the page already has it loaded, so the
  // frame for the whole set is planned once, at open, and never jumps.
  // In order of trust: the size the page's data lists, then the media as
  // loaded. A video's cover picture is never trusted: sites crop covers
  // (a portrait cover on a landscape video).
  function listedRatio(item) {
    if (item?.ratio) return item.ratio;
    return item && siteImages.platform() && posts.ratioFor ? posts.ratioFor(item.fallback, item.url) : 0;
  }
  function pageRatio(item) {
    const listed = listedRatio(item);
    if (listed) return listed;
    const element = item?.element;
    if (item?.video && !(element instanceof HTMLVideoElement)) return 0;
    if (element instanceof HTMLImageElement && element.complete && element.naturalWidth && element.naturalHeight) {
      return element.naturalWidth / element.naturalHeight;
    }
    if (element instanceof HTMLVideoElement && element.videoWidth && element.videoHeight) return element.videoWidth / element.videoHeight;
    return 0;
  }

  function samePicture(a, b) {
    return Boolean(a && b && a.element === b.element && a.url === b.url);
  }

  // Different srcset sizes or a later album response can change the
  // chosen URL during the hover delay without changing the slide.
  function sameHoverPicture(a, b) {
    if (samePicture(a, b)) return true;
    if (!isInstagram || !a || !b || a.element !== b.element || !a.fallback || !b.fallback) return false;
    return siteImages.mediaKey(a.fallback) === siteImages.mediaKey(b.fallback);
  }

  function instagramPostPhoto(candidate) {
    const image = candidate.element;
    if (!isInstagram || !(image instanceof HTMLImageElement) || !candidate.fallback ||
        /profile picture|头像/i.test(image.alt || "")) return null;
    const host = new URL(candidate.fallback).hostname;
    if (!siteImages.isHost(host, "cdninstagram.com") && !siteImages.isHost(host, "fbcdn.net")) return null;
    const rendered = image.getBoundingClientRect();
    return Math.min(rendered.width, rendered.height) >= 100
      ? image.closest("article,[role='dialog'],a[href*='/p/']") : null;
  }

  // Instagram can put a full-size clickable photo surface next to the
  // actual img. Small overlaid controls such as Tags and Next still win.
  function instagramPhotoSurface(control, image) {
    if (!isInstagram || !(image instanceof HTMLImageElement) || ownWords(control)) return false;
    if (!control.matches("button,[role='button']")) return false;
    const label = control.getAttribute("aria-label") || "";
    if (label && !/^(?:photo\b|image\b|图片|照片|相片)/i.test(label)) return false;
    const post = image.closest("article,[role='dialog'],a[href*='/p/']");
    if (!post?.contains(control)) return false;
    const box = image.getBoundingClientRect();
    const cover = control.getBoundingClientRect();
    if (Math.min(box.width, box.height) < 100) return false;
    return Math.abs(cover.left - box.left) <= 4 && Math.abs(cover.right - box.right) <= 4 &&
      Math.abs(cover.top - box.top) <= 4 && Math.abs(cover.bottom - box.bottom) <= 4;
  }

  // Only open a preview when it shows more than the page already does:
  // a larger source, more pixels than displayed, or a cropped picture in full.
  // This keeps icons, logos and avatars from popping up.
  const SMALLEST_OWN = 600;
  function worthPreview(candidate, box) {
    // A video already shown large on the page needs no preview.
    if (candidate.video) {
      return Math.min(box.width, box.height) >= 100 && box.width < window.innerWidth * 0.8 && box.height < window.innerHeight * 0.8;
    }
    if (candidate.url !== candidate.fallback) return true;
    const element = candidate.element;
    // The still of a video or Live Photo opens even at its own size.
    if (listedVideo(candidate.fallback)) return true;
    if (element instanceof HTMLImageElement) {
      const { naturalWidth: nw, naturalHeight: nh } = element;
      if (!nw || !nh) return false;
      const instagramPost = instagramPostPhoto(candidate);
      // A post photo is still worth opening in the reader at its native
      // size. An album is useful even when this one slide is small.
      if (instagramPost && (Math.max(nw, nh) >= SMALLEST_OWN ||
          instagramPost.querySelector("button[aria-current='step'], ul > li + li img"))) return true;
      // No larger copy is known: the page's own picture is all there is.
      // A small one (a thumbnail) only turns blurry when enlarged, so it
      // does not open, however much smaller the page shows it.
      if (Math.max(nw, nh) < SMALLEST_OWN) return false;
      const shown = element.getBoundingClientRect();
      if (nw > shown.width * 1.25 || nh > shown.height * 1.25) return true;
      const ratio = nw / nh;
      return Math.abs(ratio - shown.width / Math.max(shown.height, 1)) > ratio * 0.12;
    }
    // A background's real size is unknown before loading it, so skip the
    // small boxes and vector graphics that are almost always icons.
    return Math.min(box.width, box.height) >= 100 && !/^data:image\/svg|\.svg(?:[?#]|$)/i.test(candidate.url);
  }

  // Videos open on a click, not on hover. GIFs (looping clips without
  // sound) and Live Photos stay with pictures and open on hover.
  function clickOnly(candidate) {
    if (!candidate) return false;
    if (candidate.video) return !candidate.video.gif && !listedVideo(candidate.fallback)?.gif;
    const listed = listedVideo(candidate.fallback);
    return Boolean(listed && !listed.live && !listed.gif);
  }

  function candidateAt(point) {
    if (!point || point.buttons) return null;
    for (const node of point.path.slice(0, 6)) {
      if (!(node instanceof Element) || !node.isConnected || node === document.body || node === document.documentElement) continue;
      const image = node instanceof HTMLImageElement ? node : node.querySelector(":scope > img, :scope > picture > img");
      const videos = node instanceof HTMLVideoElement ? [node] : [...node.querySelectorAll("video")].slice(0, 4);
      const found = usable([...videos.map(videoSource), image && pictureSource(image), backgroundSource(node)], point);
      if (found) return found;
    }
    return usable([coveredImage(point)].map(image => image && pictureSource(image)), point);
  }

  function pictureSource(image) {
    const behind = videoBehind(image);
    return behind ? videoSource(behind) : imageSource(image);
  }

  function usable(candidates, point) {
    for (const candidate of candidates) {
      if (!candidate || clickOnly(candidate)) continue;
      const box = previewVisiblePictureRect(candidate.element);
      if (!box || Math.min(box.width, box.height) < 24) continue;
      if (siteImages.platform() && (box.width <= 72 && box.height <= 72 ||
          /avatar|userpic|user-pic/i.test(String(candidate.element.className) + " " + candidate.url))) continue;
      if (!worthPreview(candidate, box)) continue;
      const hit = previewPointerPictureHit(candidate.element, point, instagramPhotoSurface);
      if (hit === "inside" || hit === "edge" && samePicture(candidate, active?.anchor)) return candidate;
    }
    return null;
  }

  // Many sites (Instagram, Behance, Pinterest…) lay layers over each
  // picture: an empty one, a link, the site's own hover bar. Some also make
  // the picture itself ignore the pointer. Look straight down through
  // whatever is under the pointer: a layer with no words of its own there
  // is passed through; the first box holding a picture right under the
  // pointer gives that picture. Words, a control or a drawing on top keep
  // the page's own (the pointer is on a caption or a button, not the
  // picture).
  function coveredImage(point) {
    if (typeof point.x !== "number" || typeof point.y !== "number") return null;
    const under = image => {
      const box = image.getBoundingClientRect();
      return point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom;
    };
    // A layer seen through must sit on the picture (a bar across the page,
    // such as a fixed header, hides what is under it).
    const passed = [];
    const onPicture = image => {
      const box = image.getBoundingClientRect();
      return passed.every(layer => {
        const own = layer.getBoundingClientRect();
        return (!layer.matches("button,[role=button]") || instagramPhotoSurface(layer, image)) &&
          overlap(own, box) * Math.min(own.width * own.height, box.width * box.height) >= own.width * own.height * 0.5;
      }) ? image : null;
    };
    const stack = document.elementsFromPoint(point.x, point.y);
    for (const node of isInstagram ? stack : stack.slice(0, 10)) {
      if (view && node === view.host) return null;
      if (node instanceof HTMLImageElement) return onPicture(node);
      if (node === document.body || node === document.documentElement) return null;
      if (node instanceof HTMLVideoElement || node instanceof HTMLCanvasElement || node instanceof SVGElement ||
          node.matches("input,textarea,select,iframe") || ownWords(node)) return null;
      if (node.matches("button,[role=button]")) {
        if (!isInstagram) return null;
        passed.push(node);
        continue;
      }
      const image = [...node.querySelectorAll("img")].slice(0, 12).find(under);
      if (image) return onPicture(image);
      if (/url\(/.test(getComputedStyle(node).backgroundImage)) return null;
      passed.push(node);
    }
    return null;
  }

  function ownWords(node) {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE && child.textContent.trim()) return true;
    }
    return false;
  }


  // The video under a click: the page's player, the cover picture laid over
  // or under it, or a still the page's data lists a video for (such as a
  // Weibo card before its player exists). The play button the site draws on
  // top is not a picture, so look at everything stacked under the point.
  function videoAt(point) {
    if (!point || VIDEO_SITE.test(location.hostname)) return null;
    const inside = box => point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom;
    const stacked = document.elementsFromPoint(point.x, point.y).slice(0, 12);
    const near = point.path.slice(0, 6).filter(node => node instanceof Element)
      .flatMap(node => [...node.querySelectorAll("video")].slice(0, 4));
    for (const node of [...stacked, ...near]) {
      if (!(node instanceof Element) || node === document.body || node === document.documentElement) continue;
      if (view && node === view.host) return null;
      let candidate = null;
      if (node instanceof HTMLVideoElement) candidate = videoSource(node);
      else {
        const behind = node instanceof HTMLImageElement && videoBehind(node);
        if (behind) candidate = videoSource(behind);
        else {
          const still = node instanceof HTMLImageElement ? imageSource(node) : backgroundSource(node);
          const listed = still && listedVideo(still.fallback);
          if (listed && !listed.live && !listed.gif) still.video = { urls: [...listed.urls], live: false, gif: false, source: null };
          candidate = still?.video ? still : null;
        }
      }
      if (!clickOnly(candidate)) continue;
      const box = previewVisiblePictureRect(candidate.element);
      if (!box || !inside(box) || !worthPreview(candidate, box)) continue;
      const element = candidate.element;
      // Leave the page's own controls alone: a native control bar, and a
      // link-wrapped preview clip that leads to its own page.
      if (element instanceof HTMLVideoElement && element.controls && point.y > box.bottom - 48) return null;
      if (element.closest("a[href]") && !listedVideo(candidate.fallback) && !candidate.video.urls.length) continue;
      // A site control laid over the video (a carousel arrow, its own mute
      // or settings button) keeps its click. Only a play button counts as
      // the video.
      if (siteControl(point.path, element, box)) return null;
      return candidate;
    }
    return null;
  }

  const CONTROL = "button,[role=button],[role=link],[role=tab],[role=slider],a[href],input,select,textarea,label";
  const PLAY_LABEL = /play|播放|再生|재생|lecture|reproducir/i;
  function siteControl(path, video, box) {
    for (const node of path.slice(0, 8)) {
      if (!(node instanceof Element) || node === video || node.contains(video)) break;
      if (!node.matches(CONTROL)) continue;
      const label = [node.getAttribute("aria-label"), node.getAttribute("data-testid"), node.getAttribute("title"), String(node.className)].join(" ");
      if (PLAY_LABEL.test(label) && !/pause|暂停|mute|静音|sound|声音/i.test(label)) return false;
      // A control covering the whole video is the video's own surface.
      const own = node.getBoundingClientRect();
      if (overlap(own, box) * Math.min(own.width * own.height, box.width * box.height) >= box.width * box.height * 0.7) return false;
      // An unlabeled control in the middle of the video is its play button.
      const centered = Math.abs(own.left + own.width / 2 - (box.left + box.width / 2)) < box.width * 0.15 &&
        Math.abs(own.top + own.height / 2 - (box.top + box.height / 2)) < box.height * 0.15;
      if (centered && own.width < box.width * 0.5 && !node.getAttribute("aria-label")) return false;
      return true;
    }
    return false;
  }

  // A left click on a video opens it enlarged (or plays / pauses the one
  // already open). Returns true when the click is ours, so the page's player
  // never starts a second copy.
  function videoPress(event) {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return false;
    const candidate = videoAt({ x: event.clientX, y: event.clientY, path: event.composedPath() });
    if (!candidate) return false;
    if (active && samePicture(candidate, active.anchor)) {
      togglePlay();
      return true;
    }
    reset();
    open(candidate, { byClick: true });
    return true;
  }

  function clearPending() {
    clearTimeout(pending?.timer);
    pending = null;
  }

  function close() {
    if (!active) return;
    releaseVideo(active);
    active = null;
    view.stage.hidden = true;
    view.stage.classList.remove("paused");
    view.help.hidden = true;
    view.picture.replaceChildren(...overlays());
    wheelTotal = 0;
  }

  function reset() {
    pointer = null;
    clicked = false;
    cancelAnimationFrame(frame);
    frame = 0;
    clearPending();
    dismissed = null;
    close();
  }

  function updateHover() {
    frame = 0;
    // A video opened by a click stays while the pointer is on it.
    const candidate = active?.byClick && pointer && samePicture(videoAt(pointer), active.anchor) ? active.anchor : candidateAt(pointer);
    if ((settings.dismissUntilLeave || clicked) && dismissed && sameHoverPicture(dismissed, candidate)) return;
    dismissed = null;
    clicked = false;
    if (sameHoverPicture(candidate, active?.anchor)) return;
    close();
    if (!candidate) {
      clearPending();
      return;
    }
    if (sameHoverPicture(candidate, pending?.candidate) && (!settings.steadyHover ||
        Math.hypot(pointer.x - pending.x, pointer.y - pending.y) < MOVE_RADIUS)) return;
    if (!active && selectedText()) return;

    clearPending();
    pending = {
      candidate, x: pointer.x, y: pointer.y,
      timer: setTimeout(() => {
        clearPending();
        const current = candidateAt(pointer);
        if (sameHoverPicture(candidate, current)) open(current);
      }, settings.delay)
    };
  }

  function refreshInstagramHover() {
    if (isInstagram && pointer && !active && !frame) frame = requestAnimationFrame(updateHover);
  }

  function pointerMoved(next, currentSettings) {
    settings = currentSettings;
    pointer = next;
    if (active?.mode === "full") {
      if (settings.edgeExit && (next.x < 18 || next.x > window.innerWidth - 18)) {
        dismissed = active.anchor;
        close();
      }
      return;
    }
    // Floating: a long picture follows the pointer down the picture on the
    // page, top to bottom, so it can be skimmed without opening it.
    if (active?.longBox) {
      const box = active.anchor.element.getBoundingClientRect();
      if (box.height > 0) scrollLong(0, (next.y - box.top - box.height * 0.15) / (box.height * 0.7), true);
    }
    if (!frame) frame = requestAnimationFrame(updateHover);
  }

  // A click on the page while a floating preview is open closes it. The
  // clicked picture stays closed until the pointer leaves it, so it does not
  // pop up again over whatever the page opens.
  function pointerDown() {
    // Any picture under the pointer counts, open or not yet open.
    const anchor = active?.anchor || pending?.candidate || candidateAt(pointer) || dismissed;
    reset();
    if (anchor) {
      dismissed = anchor;
      clicked = true;
    }
  }

  function settingsChanged(next) {
    const previous = settings;
    settings = next;
    if (previous?.delay !== next.delay) clearPending();
    if (active) {
      if (previous?.mode !== next.mode) active.mode = next.mode;
      if (previous?.captionLayout !== next.captionLayout) active.plan = null;
      renderCaption();
      position();
    }
  }

  function ensureView() {
    if (view?.host.isConnected) return view;
    const host = document.createElement("div");
    host.id = "__zizai_overlay";
    host.style.setProperty("all", "initial", "important");
    host.style.setProperty("position", "fixed", "important");
    host.style.setProperty("inset", "0", "important");
    host.style.setProperty("z-index", "2147483647", "important");
    host.style.setProperty("pointer-events", "none", "important");
    const shadow = host.attachShadow({ mode: "open" });
    // A faint grain for the frosted card. Dark, smooth gradients under a
    // blur break into visible steps on 8-bit screens; a little noise
    // dithers them away. White grain on the dark card, black on the light.
    const grain = tone => "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'>" +
      "<filter id='g'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/>" +
      "<feColorMatrix values='0 0 0 0 " + tone + " 0 0 0 0 " + tone + " 0 0 0 0 " + tone + " 0 0 0 .07 0'/></filter>" +
      "<rect width='100%' height='100%' filter='url(%23g)'/></svg>\")";
    const styles = new CSSStyleSheet();
    styles.replaceSync([
      ".stage,.notice{font:14px/1.45 system-ui,sans-serif;color:#fff}",
      "[hidden]{display:none!important}",
      ".stage{position:absolute;inset:0}",
      // The page stays behind the full view, softly blurred and dimmed.
      ".stage.full{background:rgba(10,12,16,.7);backdrop-filter:blur(20px) saturate(1.3);pointer-events:auto}",
      ".picture{position:absolute;display:grid;place-items:center;overflow:hidden;border-radius:20px;background:#1b1d22;box-shadow:0 18px 50px #0009}",
      ".picture.joined-side{border-radius:20px 0 0 20px}",
      ".picture.joined-below{border-radius:20px 20px 0 0}",
      ".badge{position:absolute;top:10px;right:10px;padding:3px 9px;border-radius:100px;background:#000a;font-size:12px;font-variant-numeric:tabular-nums}",
      ".stage.full .picture{cursor:zoom-out;pointer-events:auto}",
      "img,video,.picture>canvas{display:block;width:100%;height:100%;object-fit:contain}",
      // The frame around a picture of other proportions is filled with a
      // blurred copy of it, so the panel never shows an empty band.
      ".picture>.backdrop{position:absolute;inset:-48px;width:calc(100% + 96px);height:calc(100% + 96px);object-fit:cover;",
      "filter:blur(40px) brightness(.5) saturate(1.15);pointer-events:none}",
      ".picture>.main{position:relative}",
      ".stage.full .picture.video{cursor:pointer}",
      // Video: a LIVE mark, a sound hint in the floating preview, and a
      // progress bar in the full page that fades with the other controls.
      ".live-mark{position:absolute;top:10px;left:10px;padding:2px 8px;border-radius:100px;background:#000a;font-size:11px;font-weight:600;letter-spacing:.06em}",
      ".sound{position:absolute;right:10px;bottom:10px;display:flex;align-items:center;gap:5px;padding:4px 9px;border-radius:100px;background:#000a;font-size:12px}",
      ".sound span:empty{display:none}.sicon{display:grid;width:16px;height:16px}",
      // Long pictures (comics, long posts) show at a readable width, top
      // first, and scroll inside the frame. A thin bar shows where you are.
      ".picture.long>.main{align-self:start;will-change:transform}",
      ".picture.long:not(.reading)>.main{transition:transform .14s ease-out}",
      // One rule for the pointer: where a click closes, it shows zoom-out
      // (the backdrop, a picture); a video shows a hand (a click pauses it).
      ".stage.full{cursor:zoom-out}",
      ".stage.full :is(.caption,.pager,.help,.vbar,.full-controls){cursor:default}",
      ".stage.full .picture.long.dragging{cursor:grabbing}",
      // Where you are in a long picture. In a set: a bright line across the
      // picture's thumbnail in the strip, moving down as you read. Alone:
      // a thin bar on the picture's right edge.
      ".lbar{position:absolute;z-index:2;top:14px;bottom:14px;right:7px;width:5px;border-radius:5px;background:#ffffff1f;pointer-events:none}",
      ".lthumb{position:absolute;left:0;right:0;min-height:24px;border-radius:5px;background:#ffffffd9;box-shadow:0 1px 3px #00000059}",
      ".tpos{position:absolute;inset:0;display:none;pointer-events:none;border-radius:inherit;overflow:hidden}",
      ".tpos i{position:absolute;left:3px;right:3px;min-height:9px;box-sizing:border-box;border:1.5px solid #fff;border-radius:4px;box-shadow:0 0 0 999px #00000073,0 0 0 1px #0000004d}",
      ".thumb[aria-current=true] .tpos.on{display:block}",
      ".light .lbar{background:#0000001a}.light .lthumb{background:#1d1d1fb3;box-shadow:none}",
      ".sicon svg,.vmute svg{width:100%;height:100%;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}",
      ".sicon .cone,.vmute .cone{fill:currentColor}",
      ".cross{display:none}.muted .cross{display:inline}.muted .wave{display:none}",
      // The slider opens to the left so the speaker stays under the pointer.
      ".vvol{flex:none;display:flex;flex-direction:row-reverse;align-items:center;gap:4px}",
      ".vmute{width:28px;height:28px;padding:4px;border:0;background:none;color:#fff;cursor:pointer;pointer-events:auto;filter:drop-shadow(0 1px 2px #0009)}",
      ".vmute:disabled{opacity:.5;cursor:default}",
      ".vslider{width:0;opacity:0;margin:0;accent-color:#fff;cursor:pointer;pointer-events:auto;transition:width .2s ease,opacity .2s ease}",
      ".vvol:hover .vslider,.vslider:focus-visible{width:72px;opacity:1}",
      ".vbar{position:absolute;left:14px;right:14px;bottom:10px;z-index:2;display:flex;align-items:center;gap:10px;padding:8px 0;",
      "cursor:pointer;pointer-events:auto;transition:opacity .3s ease}",
      ".vtrack{flex:1;height:4px;border-radius:4px;background:#ffffff45;overflow:hidden;box-shadow:0 1px 3px #0005}",
      ".vbar:hover .vtrack{height:6px}",
      ".vfill{height:100%;width:0;background:#fff}",
      ".vtime{flex:none;font-size:12px;font-variant-numeric:tabular-nums;color:#fff;text-shadow:0 1px 3px #000a}",
      ".vplay{flex:none;width:28px;height:28px;border:0;padding:0;background:none;cursor:pointer;display:grid;place-items:center;pointer-events:auto}",
      ".vplay::before{content:'';width:0;height:0;border-style:solid;border-width:7px 0 7px 12px;border-color:transparent transparent transparent #fff;",
      "margin-left:3px;filter:drop-shadow(0 1px 2px #0009)}",
      ".vplay.playing::before{width:4px;height:14px;border:0;margin:0 6px 0 0;background:#fff;box-shadow:7px 0 0 #fff}",
      ".vstate{position:absolute;left:50%;top:50%;z-index:1;width:64px;height:64px;margin:-32px 0 0 -32px;border-radius:50%;",
      "background:#000000a0;display:grid;place-items:center;pointer-events:none;opacity:0;transform:scale(.85);transition:opacity .2s ease,transform .2s ease}",
      ".vstate.on{opacity:1;transform:none}",
      ".vstate::before{content:'';width:0;height:0;border-style:solid;border-width:13px 0 13px 22px;border-color:transparent transparent transparent #fff;margin-left:5px}",
      ".vstate.loading{background:#0000007a}",
      ".vstate.loading::before{width:26px;height:26px;margin:0;border:3px solid #ffffff40;border-top-color:#fff;border-radius:50%;animation:zz-spin .8s linear infinite}",
      "@keyframes zz-spin{to{transform:rotate(360deg)}}",
      ".notice,.help{position:absolute;max-width:calc(100vw - 32px);background:#191c23;color:#fff;",
      "border-radius:16px;padding:10px 14px;box-shadow:0 6px 24px #0006;box-sizing:border-box;border:.5px solid #ffffff24}",
      ".help{padding:16px 18px}",
      // A short message is a pill, centred at the bottom.
      ".notice{bottom:18px;left:50%;transform:translateX(-50%);border-radius:100px;padding:9px 16px}",
      // Above a full-page video's progress bar.
      ".notice.raised{bottom:72px}",
      ".help{top:60px;right:24px;display:grid;grid-template-columns:auto 1fr;gap:8px 14px;align-items:center;z-index:3;font-size:13px}",
      ".help-title{grid-column:1/-1;font-weight:600;margin-bottom:2px}",
      ".help kbd{font:12px/1 system-ui,sans-serif;justify-self:end;padding:4px 7px;border-radius:5px;",
      "background:#ffffff14;border:1px solid #ffffff26;font-variant-numeric:tabular-nums}",
      // Post card: a header (avatar, name, account and time), the text, an
      // optional quoted post, and a link to the post at the bottom.
      ".caption{position:absolute;display:flex;flex-direction:column;overflow:hidden;box-sizing:border-box;",
      "border-radius:20px;color:#ececee;background:rgba(32,34,40,.9);backdrop-filter:blur(28px) saturate(1.3);",
      "border:1px solid #ffffff17;box-shadow:0 16px 48px #0007;pointer-events:auto}",
      ".head{flex:none;display:flex;align-items:center;gap:11px;padding:20px 22px 14px;min-width:0}",
      ".avatar{flex:none;width:38px;height:38px;border-radius:50%;object-fit:cover;background:#ffffff14}",
      ".initial{flex:none;width:38px;height:38px;border-radius:50%;display:grid;place-items:center;background:#ffffff14;font-size:15px;font-weight:600;color:#ffffffc0}",
      ".names{min-width:0;display:flex;flex-direction:column;gap:2px}",
      ".name{font-size:15px;font-weight:600;line-height:1.3;color:#fff;overflow:hidden;overflow-wrap:anywhere;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2}",
      ".meta{font-size:12.5px;line-height:1.3;color:#ffffff7a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".caption-content{flex:1;min-height:0;overflow:auto;padding:0 22px 20px;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#ffffff28 transparent}",
      ".w{white-space:nowrap}.post-body,.quote-body,.chain p{text-wrap:pretty}",
      ".post-body{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:15px;line-height:1.72;color:#e9e9ec;user-select:text}",
      ".quote{margin:14px 0 0;padding:12px 14px;border:1px solid #ffffff1a;border-radius:12px;background:#ffffff07;user-select:text}",
      ".quote-head{font-size:13px;font-weight:600;color:#fff;margin-bottom:4px}",
      ".quote-head span{font-weight:400;color:#ffffff70;margin-left:6px}",
      ".quote-body{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:13.5px;line-height:1.65;color:#d2d3d8}",
      ".chain{margin:12px 0 0;padding-left:12px;border-left:2px solid #ffffff1f}",
      ".chain p{margin:0 0 6px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:13.5px;line-height:1.6;color:#c6c7cc;user-select:text}",
      ".chain b{font-weight:600;color:#e6e6ea;margin-right:6px}",
      ".cut{margin:10px 0 0;font-size:12.5px;line-height:1.5;color:#eac48fcc}",
      ".quote .cut{margin-top:6px}",
      ".foot{flex:none;padding:12px 22px;border-top:1px solid #ffffff10}",
      ".post-link{color:#eac48f;text-decoration:none;font-size:12.5px}.post-link:hover{text-decoration:underline}",
      ".more{flex:none;margin:0;padding:0 22px 16px;font-size:12px;color:#ffffff70}",
      // Floating cards sit on the page itself, which may be white: solid
      // dark base, read-only, no link.
      ".caption.floating{pointer-events:none;background:#202228}",
      ".caption.floating .foot{display:none}",
      ".caption.floating .head{padding:16px 18px 10px}",
      ".caption.floating .caption-content{overflow:hidden;padding:0 18px 16px}",
      ".caption.floating .post-body{font-size:14px;line-height:1.68}",
      ".caption.floating .more{padding:0 18px 14px}",
      ".caption.floating.side{border-radius:0 20px 20px 0;border-left-color:#ffffff0c}",
      ".caption.floating.side.long .caption-content{-webkit-mask-image:linear-gradient(#000 calc(100% - 44px),transparent);mask-image:linear-gradient(#000 calc(100% - 44px),transparent)}",
      ".caption.floating.below{border-radius:0 0 20px 20px;border-top-color:#ffffff0c}",
      ".caption.floating.below .head{padding:12px 16px 6px}",
      ".caption.floating.below .avatar,.caption.floating.below .initial{width:28px;height:28px;font-size:12px}",
      ".caption.floating.below .name{font-size:13.5px}",
      ".caption.floating.below .caption-content{padding:0 16px 12px}",
      ".caption.floating.below .quote,.caption.floating.below .chain{display:none}",
      ".caption.floating.below .more{padding:0 16px 12px}",
      // Clamped previews run paragraphs together so blank lines do not eat the few lines shown.
      ".clamp .post-body,.caption.full.below:not(.open) .post-body{white-space:normal}",
      ".clamp .post-body{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden}",
      // Full page, beside: a column the height of the window.
      ".caption.full.side{border-radius:0 20px 20px 0;border-left-color:#ffffff0c}",
      ".caption.full.side .head{padding:24px 26px 16px}",
      ".caption.full.side .caption-content{padding:0 26px 22px}",
      ".caption.full.side .foot{padding:14px 26px 18px}",
      // Full page, below: a slim bar that opens upward over the picture
      // while the pointer is on it, so the picture keeps the window.
      ".caption.full.below{border-radius:0 0 20px 20px;border-top-color:#ffffff0c;transition:max-height .2s ease}",
      ".caption.full.below.open{border-radius:20px}",
      ".caption.full.below:not(.open){max-height:var(--bar)}",
      ".caption.full.below:not(.open) .post-body{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}",
      ".caption.full.below:not(.open) .quote,.caption.full.below:not(.open) .chain,.caption.full.below:not(.open) .foot{display:none}",
      ".caption.full.below.open{max-height:62vh}",
      // The open card lies over the bottom of the picture; the video bar,
      // the strip and the long-picture hint step aside until it closes.
      ".stage:has(.caption.full.below.open) :is(.vbar,.pager){opacity:0;pointer-events:none}",
      ".stage:has(.caption.full.below.open) :is(.vbar,.pager) *{pointer-events:none}",
      ".caption.full.below .head{padding:14px 20px 8px}",
      ".caption.full.below .caption-content{padding:0 20px 14px}",
      ".full-controls{display:flex;position:absolute;gap:8px;align-items:center;transition:opacity .3s ease}",
      ".act svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}",
      // Picture actions sit on the picture's top-right corner; copy text sits
      // on the post card's header. Each is next to what it acts on.
      ".img-acts{position:absolute;z-index:3;display:flex;gap:8px;transition:opacity .3s ease}",
      ".cap-act{flex:none;margin-left:auto;min-width:32px;min-height:32px;border-color:transparent;background:transparent;color:#ffffff8c}",
      ".cap-act:hover{color:#fff;background:#ffffff18}.light .caption .cap-act{color:#00000080;border-color:transparent;background:transparent}.light .cap-act:hover{color:#000;background:#0000000f}",
      ".caption.floating .cap-act{display:none}",
      "button{font:inherit;color:inherit;border:1px solid #ffffff26;background:#ffffff16;border-radius:100px;",
      "min-width:36px;min-height:36px;cursor:pointer;pointer-events:auto;display:grid;place-items:center}",
      "button:hover{background:#ffffff30}button:focus-visible,a:focus-visible{outline:2px solid #fff;outline-offset:3px}",
      // Every button floating over the viewer is the same glass circle:
      // one size (36px), one material, one icon weight.
      ".full-controls button,.img-acts button,.nav{width:36px;height:36px;min-width:36px;min-height:36px;padding:0;box-sizing:border-box;",
      "color:#fff;background:rgba(28,30,36,.52);backdrop-filter:blur(20px) saturate(1.8);border:.5px solid #ffffff38;",
      "box-shadow:0 4px 14px #00000038;transition:opacity .3s ease,background .15s}",
      ".full-controls button:hover,.img-acts button:hover,.nav:hover{background:rgba(28,30,36,.78)}",
      ".full-controls svg,.img-acts svg,.nav svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}",
      ".light :is(.full-controls button,.img-acts button,.nav){color:#1d1d1f;background:rgba(255,255,255,.72);border-color:#00000014;box-shadow:0 4px 14px #0000001f}",
      ".light :is(.full-controls button,.img-acts button,.nav):hover{background:rgba(255,255,255,.95)}",
      // Close is one red circle that changes size: a 36px button with an ×
      // when wanted (just opened, under the pointer, focused), a 12px dot
      // the rest of the time. Its centre never moves, so it grows and
      // shrinks in place, on the same 12px grid as the other buttons.
      ".stage .full-controls button.close,.stage .full-controls button.close:hover{background:none;border:0;box-shadow:none;backdrop-filter:none}",
      ".close .dot{width:36px;height:36px;border-radius:50%;display:grid;place-items:center;background:#ff5f57;color:#fff;",
      "box-shadow:inset 0 0 0 .5px #0000002e,0 0 0 1.5px #ffffff38,0 3px 10px #00000059;transform:scale(.3333);",
      "transition:transform .38s cubic-bezier(.32,.72,0,1)}",
      ".close .dot svg{opacity:0;transition:opacity .18s}",
      ".close:is(:hover,:focus-visible) .dot,.stage.peek-close .close .dot{transform:none}",
      ".close:is(:hover,:focus-visible) .dot svg,.stage.peek-close .close .dot svg{opacity:1;transition-delay:.06s}",
      ".close:active .dot{transform:scale(.92)}",
      // The LIVE mark steps right of the close button, centred on its line.
      ".stage.full .live-mark{top:21px;left:58px}",
      // Thumbnail strip: only the pictures, floating over the bottom of the
      // picture area. It fades out while the pointer rests.
      ".pager{position:absolute;transform:translateX(-50%);box-sizing:border-box;display:flex;padding:6px;",
      "border-radius:18px;background:rgba(28,30,36,.6);backdrop-filter:blur(20px) saturate(1.8);border:.5px solid #ffffff2e;box-shadow:0 4px 14px #00000038;",
      "transition:opacity .3s ease}",
      // Controls appear only where they are wanted (see LAYOUT.md): each has
      // a zone, and shows while the pointer is in it and moving. Hidden,
      // they stay clickable; the pointer is in their zone when it is there.
      // The × stays: closing is always one obvious click away, in the same place.
      ".stage.full :is(.img-acts,.nav,.pager,.vbar){opacity:0;transition:opacity .2s ease}",
      ".stage.full.z-acts:not(.idle) .img-acts,.stage.full.z-prev:not(.idle) .nav.prev,.stage.full.z-next:not(.idle) .nav.next,",
      ".stage.full.z-strip:not(.idle) .pager,.stage.full.peek-strip .pager,",
      ".stage.full.z-bar:not(.idle) .vbar,.stage.full.paused .vbar{opacity:1}",
      ".stage.full :is(.img-acts,.nav,.pager,.vbar):is(:hover,:focus-within){opacity:1}",
      // Turning pages with the wheel or keys shows where you are, nothing else.
      ".flash{position:absolute;z-index:3;transform:translateX(-50%);padding:5px 12px;border-radius:100px;font-size:13px;font-weight:500;",
      "font-variant-numeric:tabular-nums;color:#fff;background:rgba(28,30,36,.6);backdrop-filter:blur(20px) saturate(1.8);border:.5px solid #ffffff2e;",
      "opacity:0;transition:opacity .25s ease;pointer-events:none}",
      ".stage.full .flash.on{opacity:1}",
      ".light .flash{color:#1d1d1f;background:rgba(255,255,255,.72);border-color:#00000014}",
      // The strip and the "3 / 5" share one place at the bottom of the
      // picture, centred on the same line. Only one shows at a time: the
      // strip already has the count beside it, so while the strip is up
      // the little count steps aside. Each rises a few pixels as it fades
      // in and sinks as it fades out, so one hands over to the other.
      ".stage.full .pager{transform:translateX(-50%) translateY(8px) scale(.97);transform-origin:50% 100%;",
      "transition:opacity .28s ease,transform .34s cubic-bezier(.32,.72,0,1)}",
      ".stage.full.z-strip:not(.idle) .pager,.stage.full.peek-strip .pager,.stage.full .pager:is(:hover,:focus-within){transform:translateX(-50%)}",
      ".flash{transform:translateX(-50%) translateY(6px) scale(.94);transition:opacity .22s ease,transform .3s cubic-bezier(.32,.72,0,1)}",
      ".stage.full .flash.on{transform:translateX(-50%)}",
      ".stage.full:is(.z-strip:not(.idle),.peek-strip) .flash.on,.stage.full:has(.pager:is(:hover,:focus-within)) .flash.on{opacity:0;transform:translateX(-50%) translateY(6px) scale(.94)}",
      // Faded controls stay clickable: a click where a button was does what
      // the button does, never falls through to the backdrop and closes.
      ".thumbs{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;min-width:0}",
      ".pcount{flex:none;align-self:center;padding:0 8px 0 10px;font-size:12px;color:#ffffffb3;font-variant-numeric:tabular-nums;white-space:nowrap}",
      ".light .pcount{color:#00000099}",
      ".nav{position:absolute;z-index:3}",
      ".nav.next svg{transform:scaleX(-1)}",
      // Faded while the pointer rests, but still there: a click where an
      // arrow was turns the page, never falls through and closes.
      ".stage:has(.caption.full.below.open) .nav{opacity:0;pointer-events:none}",
      ".thumb{position:relative;flex:none;width:46px;height:46px;min-width:0;min-height:0;padding:0;border-radius:12px;overflow:hidden;border:0;",
      "background:#ffffff10;opacity:.45;outline:2px solid transparent;outline-offset:-2px;transition:opacity .15s}",
      ".thumb img{object-fit:cover}.thumb:hover{opacity:.85;background:#ffffff10}",
      ".thumb[aria-current=true]{opacity:1;outline-color:#fff}",
      ".thumb.video::after{content:'\\25B6';position:absolute;inset:0;display:grid;place-items:center;font-size:13px;color:#fff;text-shadow:0 1px 4px #000c}",
      // Light viewer: a neutral light grey, never white. The picture stays
      // the brightest thing on screen (backdrop dimmest, card one step up),
      // so the eye is not dazzled and the picture does not look dull.
      ".stage.light{color:#1d1d1f}",
      ".stage.light.full{background:rgba(242,242,245,.72);backdrop-filter:blur(20px) saturate(1.2)}",
      ".light .picture{background:#c4c4c9;box-shadow:0 10px 32px #00000024}",
      ".light .picture>.backdrop{filter:blur(40px) brightness(.92) saturate(1.05);opacity:.8}",
      ".light .badge,.light .live-mark,.light .sound{background:#ffffffd9;color:#1d1d1f}",
      ".light .caption{color:#1d1d1f;background:rgba(246,245,242,.92);border-color:#00000014;box-shadow:0 10px 32px #0000001c}",
      ".light .caption.floating{background:#f6f5f2}",
      ".light .caption.side{border-left-color:#0000000a}.light .caption.below{border-top-color:#0000000a}",
      ".light .avatar,.light .initial{background:#0000000d}.light .initial{color:#00000099}",
      ".light .name{color:#000}.light .meta{color:#00000080}.light .post-body{color:#1d1d1f}",
      ".light .caption-content{scrollbar-color:#00000030 transparent}",
      ".light .quote{border-color:#00000017;background:#00000005}",
      ".light .quote-head{color:#111}.light .quote-head span{color:#00000070}.light .quote-body{color:#3a3a3c}",
      ".light .chain{border-left-color:#0000001f}.light .chain p{color:#4a4a4f}.light .chain b{color:#1d1d1f}",
      ".light .cut{color:#a8600c}.light .foot{border-top-color:#00000012}.light .post-link{color:#b8680a}.light .more{color:#00000080}",
      ".light button{color:#1d1d1f;border-color:#0000001f;background:#0000000a}.light button:hover{background:#00000018}",
      ".light .pager{background:rgba(255,255,255,.78);border-color:#00000014}",
      ".light .thumb,.light .thumb:hover{background:#0000000a}.light .thumb[aria-current=true]{outline-color:#1d1d1f}",
      ".light .help,.notice.light{background:#fff;color:#1d1d1f;box-shadow:0 6px 24px #00000026}",
      ".light .help kbd{background:#0000000a;border-color:#0000001f}",
      // Full view: the post card is frosted glass over the blurred page.
      // No outline and no highlight: a soft shadow and a faint dark
      // hairline give the card its shape.
      // Saturation stays low so dark tones keep their steps small, and a
      // fine grain hides what is left of them.
      ".stage .caption.full{background:" + grain(1) + ",rgba(30,32,38,.66);backdrop-filter:blur(36px) saturate(1.2);-webkit-backdrop-filter:blur(36px) saturate(1.2);",
      "border-color:transparent;box-shadow:0 20px 60px #0000004d,0 0 0 .5px #00000040}",
      ".stage.light .caption.full{background:" + grain(0) + ",rgba(255,255,255,.66);border-color:transparent;box-shadow:0 14px 44px #0000001f,0 0 0 .5px #00000012}",
      // The picture's shadow stops at the edge it shares with the card, so
      // no dark gradient sits under the glass to be blurred into bands.
      ".stage.full .picture.joined-side{clip-path:inset(-90px 0 -90px -90px)}",
      ".stage.full .picture.joined-below{clip-path:inset(-90px -90px 0 -90px)}"
    ].join(""));
    shadow.adoptedStyleSheets = [styles];
    const make = (className, parent = shadow) => {
      const element = document.createElement("div");
      element.className = className;
      parent.append(element);
      return element;
    };
    const stage = make("stage");
    const picture = make("picture", stage);
    const caption = document.createElement("aside");
    caption.className = "caption";
    caption.setAttribute("aria-label", message("postCaption"));
    stage.append(caption);
    const el = (tag, className, parent) => {
      const element = document.createElement(tag);
      element.className = className;
      parent?.append(element);
      return element;
    };
    const head = el("div", "head", caption);
    const avatar = el("img", "avatar", head);
    avatar.alt = "";
    avatar.draggable = false;
    const initial = el("div", "initial", head);
    avatar.addEventListener("error", () => {
      avatar.hidden = true;
      initial.hidden = !initial.textContent;
    });
    avatar.addEventListener("load", () => {
      if (!avatar.naturalWidth) return;
      avatar.hidden = false;
      initial.hidden = true;
    });
    const names = el("div", "names", head);
    const author = el("div", "name", names);
    const meta = el("div", "meta", names);
    const captionContent = el("div", "caption-content", caption);
    const body = el("p", "post-body", captionContent);
    const chain = el("div", "chain", captionContent);
    // Shown when the page only gave the first part of a long post.
    const cut = el("p", "cut", captionContent);
    cut.textContent = message("captionTruncated");
    const quote = el("div", "quote", captionContent);
    const quoteHead = el("div", "quote-head", quote);
    const quoteBody = el("p", "quote-body", quote);
    const quoteCut = el("p", "cut", quote);
    quoteCut.textContent = message("captionTruncated");
    const foot = el("div", "foot", caption);
    const postLink = el("a", "post-link", foot);
    postLink.textContent = message("openPost");
    postLink.target = "_blank";
    postLink.rel = "noopener noreferrer";
    const more = el("p", "more", caption);
    // The slim bar under a full-page picture opens while the pointer is on it.
    caption.addEventListener("pointerenter", () => caption.classList.add("open"));
    caption.addEventListener("pointerleave", () => caption.classList.remove("open"));
    const controls = make("full-controls", stage);
    const controlButton = (label, text, parent, action) => {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("aria-label", message(label));
      button.textContent = text;
      // Only a real click counts: the page's own scripts cannot press these
      // (copy, save, close) for the reader.
      button.addEventListener("click", event => { if (event.isTrusted) action(event); });
      parent.append(button);
      return button;
    };
    // Keep what you found: copy the picture, save it, copy the post's text.
    const ICONS = {
      copyImage: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
      saveImage: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/>',
      copyText: '<path d="M6 5h12M6 9.5h12M6 14h12M6 18.5h7"/>'
    };
    const actionButtons = {};
    const imageActions = make("img-acts", stage);
    for (const [name, parent] of [["copyImage", imageActions], ["saveImage", imageActions], ["copyText", head]]) {
      const button = controlButton(name, "", parent, () => runAction(name));
      button.className = name === "copyText" ? "act cap-act" : "act";
      button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICONS[name] + "</svg>";
      actionButtons[name] = button;
    }
    // Close: a small red dot on the panel's top-left corner, like a Mac
    // window's; under the pointer it becomes the × button. The whole 36px
    // circle is clickable either way.
    const closeButton = controlButton("closePreview", "", controls, () => { dismissed = active?.anchor; close(); });
    closeButton.className = "close";
    closeButton.innerHTML = '<i class="dot" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg></i>';
    const pager = make("pager", stage);
    const thumbs = make("thumbs", pager);
    // Where you are in the set, beside the strip.
    const count = make("pcount", pager);
    // Previous / next, for reading with the mouse alone.
    const ARROW = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
    const prev = controlButton("prevImageLabel", "", stage, () => navigate(-1));
    const next = controlButton("nextImageLabel", "", stage, () => navigate(1));
    prev.className = "nav prev";
    next.className = "nav next";
    prev.innerHTML = next.innerHTML = ARROW;
    prev.hidden = next.hidden = true;
    // Shown for a moment when the page turns by wheel or key.
    const flash = make("flash", stage);
    // Each control shows in its own zone, while the pointer moves.
    stage.addEventListener("pointermove", event => {
      zones(event);
      wakeChrome();
    });
    stage.addEventListener("pointerleave", () => zones(null));
    const badge = make("badge", picture);
    const liveMark = make("live-mark", picture);
    liveMark.textContent = "LIVE";
    const sound = make("sound", picture);
    const soundIcon = document.createElement("span");
    soundIcon.className = "sicon";
    const soundText = document.createElement("span");
    sound.append(soundIcon, soundText);
    // Center of the video: a spinner while it loads, a play mark while
    // paused, and a short flash of play / pause when toggled.
    const state = make("vstate", picture);
    const longBar = make("lbar", picture);
    const longThumb = make("lthumb", longBar);
    const bar = make("vbar", picture);
    const playButton = document.createElement("button");
    playButton.type = "button";
    playButton.className = "vplay";
    playButton.addEventListener("click", () => togglePlay());
    bar.append(playButton);
    const track = make("vtrack", bar);
    const fill = make("vfill", track);
    const time = make("vtime", bar);
    // Sound: a speaker that mutes on click, and a volume slider beside it.
    const SPEAKER = '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="cone" d="M4 9h4l5-4v14l-5-4H4z"/>' +
      '<path class="wave" d="M16.5 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11"/><path class="cross" d="M16.5 9.5l5 5M21.5 9.5l-5 5"/></svg>';
    const volumeBox = make("vvol", bar);
    const muteButton = document.createElement("button");
    muteButton.type = "button";
    muteButton.className = "vmute";
    muteButton.innerHTML = SPEAKER;
    muteButton.addEventListener("click", () => toggleMute());
    const slider = document.createElement("input");
    slider.type = "range";
    slider.className = "vslider";
    slider.min = "0";
    slider.max = "1";
    slider.step = "0.05";
    slider.addEventListener("input", () => setVolume(Number(slider.value)));
    volumeBox.append(muteButton, slider);
    soundIcon.innerHTML = SPEAKER;
    // Seek where the track is pressed.
    track.addEventListener("pointerdown", event => {
      const media = active?.media;
      const box = track.getBoundingClientRect();
      if (!media || !Number.isFinite(media.duration) || !box.width) return;
      media.currentTime = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)) * media.duration;
      updateVideoChrome();
    });
    const help = make("help", stage);
    const notice = make("notice");
    notice.setAttribute("role", "status");
    liveMark.hidden = sound.hidden = bar.hidden = state.hidden = longBar.hidden = true;
    stage.hidden = badge.hidden = help.hidden = notice.hidden = caption.hidden = controls.hidden = imageActions.hidden = pager.hidden = true;
    stage.addEventListener("wheel", onWheel, { passive: false });
    // Full page: a click on the picture or the backdrop closes it, as long
    // as the pointer did not move (a drag or text selection is not a click).
    let pressed = null;
    stage.addEventListener("pointerdown", event => { pressed = event.button === 0 ? { x: event.clientX, y: event.clientY } : null; });
    // A long picture in the full page can also be dragged up and down.
    stage.addEventListener("pointermove", event => {
      if (!pressed || !(event.buttons & 1) || active?.mode !== "full" || !active.longBox) return;
      if (!event.composedPath().includes(picture)) return;
      picture.classList.add("dragging");
      scrollLong(-event.movementY);
    });
    stage.addEventListener("pointerup", () => picture.classList.remove("dragging"));
    stage.addEventListener("click", event => {
      const start = pressed;
      pressed = null;
      if (active?.mode !== "full" || event.button !== 0 || !start ||
          Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) return;
      const path = event.composedPath();
      if (path.includes(bar)) return;
      // A click on a playing video pauses it, like any player.
      if (active.media && path.includes(picture)) {
        togglePlay();
        return;
      }
      if (event.target === stage || path.includes(picture)) {
        dismissed = active.anchor;
        clicked = true;
        close();
      }
    });
    document.documentElement.append(host);
    view = { host, stage, picture, help, notice, caption, captionContent, more, avatar, initial, author, meta, body, chain, cut, quote, quoteHead, quoteBody, quoteCut, foot, postLink, controls, actionButtons, imageActions, flash, pager, thumbs, count, prev, next, badge, liveMark, sound, soundIcon, soundText, state, bar, longBar, longThumb, playButton, fill, time, muteButton, slider };
    return view;
  }

  // Full-page buttons and the thumbnail strip show while the pointer moves
  // and fade when it rests, unless the pointer is on them or help is open.
  let chromeTimer = 0;
  // Which control zones the pointer is in (full page only):
  // over the picture: copy and save; its left or right third: that arrow;
  // its bottom band: the strip and the video bar; the window's top-right
  // corner: ×. A control under the pointer counts as its own zone.
  function zones(event) {
    if (!view) return;
    const stage = view.stage;
    const on = {};
    if (event && active?.mode === "full") {
      const path = event.composedPath();
      const box = view.picture.getBoundingClientRect();
      const x = event.clientX, y = event.clientY;
      const inside = x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
      const many = active.gallery.length > 1;
      const third = (x - box.left) / Math.max(1, box.width);
      const bottom = inside && y >= box.bottom - Math.min(150, box.height * 0.3);
      on["z-acts"] = inside || path.includes(view.imageActions);
      on["z-prev"] = many && (inside && third < 1 / 3 || path.includes(view.prev));
      on["z-next"] = many && (inside && third > 2 / 3 || path.includes(view.next));
      on["z-strip"] = many && (bottom || path.includes(view.pager));
      on["z-bar"] = bottom || path.includes(view.bar);
    }
    for (const name of ["z-acts", "z-prev", "z-next", "z-strip", "z-bar"]) stage.classList.toggle(name, Boolean(on[name]));
  }

  // Shows one thing for a moment: the counter after a page turn, the strip
  // while a long picture in a set scrolls, × just after opening.
  const peeks = {};
  function peek(name, ms) {
    if (!view) return;
    view.stage.classList.add(name);
    clearTimeout(peeks[name]);
    peeks[name] = setTimeout(() => view.stage.classList.remove(name), ms);
  }
  function flashCount() {
    if (!view || active?.mode !== "full" || active.gallery.length < 2) return;
    view.flash.textContent = (active.index + 1) + " / " + active.gallery.length;
    // The strip is up and already says where you are: no second count.
    if (view.stage.matches(".z-strip:not(.idle),.peek-strip") || view.pager.matches(":hover,:focus-within")) {
      view.flash.classList.remove("on");
      return;
    }
    view.flash.classList.add("on");
    clearTimeout(peeks.flash);
    peeks.flash = setTimeout(() => view.flash.classList.remove("on"), 1200);
  }

  function wakeChrome() {
    if (!view || active?.mode !== "full") return;
    view.stage.classList.remove("idle");
    clearTimeout(chromeTimer);
    chromeTimer = setTimeout(() => {
      if (![view.controls, view.imageActions, view.pager, view.bar, view.prev, view.next].some(item => item.matches(":hover")) && view.help.hidden) view.stage.classList.add("idle");
      else wakeChrome();
    }, 2000);
  }

  const darkScheme = matchMedia("(prefers-color-scheme: dark)");
  const lightTheme = () => settings?.viewerTheme === "light" || (settings?.viewerTheme === "system" && !darkScheme.matches);
  // "Follow system" switches while a picture is open, too.
  darkScheme.addEventListener?.("change", () => { if (active && settings?.viewerTheme === "system") position(); });

  function toast(text) {
    const { notice } = ensureView();
    notice.classList.toggle("light", lightTheme());
    notice.classList.toggle("raised", Boolean(active?.media && active.mode === "full"));
    notice.textContent = text;
    notice.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { notice.hidden = true; }, 2200);
  }

  // Layout. One frame (the stage) is chosen for a whole post and kept while
  // switching through its pictures, so nothing jumps. Its proportions come
  // from the post's own pictures: the one that shows the set largest on
  // average. Pictures of other proportions sit centered inside it. The post
  // card is joined to the stage, beside it or under it; "below" moves beside
  // when that shows the pictures clearly larger (tall pictures). A floating
  // preview is a quick look at one picture: its frame follows the picture
  // under the pointer, never larger than that picture.
  function stagePlan(ratios, areaWidth, areaHeight, cardWidth, barHeight, withCaption, sideAllowed, layout, fill) {
    const box = (ratio, w, h) => w / h > ratio ? { width: h * ratio, height: h } : { width: w, height: w / ratio };
    const best = (w, h) => {
      // A set in the full page takes the whole room left by the card:
      // every picture then shows as large as it can, whatever its shape,
      // and the frame and card still never move.
      if (fill) {
        const score = ratios.reduce((sum, r) => { const shown = box(r, w, h); return sum + shown.width * shown.height; }, 0);
        return { width: Math.max(w, 1), height: Math.max(h, 1), score };
      }
      let pick = null;
      for (const ratio of ratios) {
        const stage = box(ratio, Math.max(w, 1), Math.max(h, 1));
        const score = ratios.reduce((sum, r) => {
          const shown = box(r, stage.width, stage.height);
          return sum + shown.width * shown.height;
        }, 0);
        if (!pick || score > pick.score) pick = { ...stage, score };
      }
      return pick;
    };
    if (!withCaption) return { layout: "none", ...best(areaWidth, areaHeight) };
    const below = best(areaWidth, areaHeight - barHeight);
    const side = sideAllowed ? best(areaWidth - cardWidth, areaHeight) : null;
    if (layout === "below" || layout === "side" && !side) return { layout: "below", ...below };
    if (layout === "side") return { layout: "side", ...side };
    // The picture comes first: the card goes where it costs the picture
    // least. The setting only decides when the two are within 10%.
    if (!side) return { layout: "below", ...below };
    if (side.score > below.score * 1.1) return { layout: "side", ...side };
    if (below.score > side.score * 1.1) return { layout: "below", ...below };
    return settings.captionLayout === "below" ? { layout: "below", ...below } : { layout: "side", ...side };
  }

  // A long picture: taller than about one and a half phone screenshots
  // (a phone screenshot is about 2.2 times as tall as wide; those show whole).
  const LONG_RATIO = 3.4;
  // The frame a long picture is read in: portrait, about a phone's shape
  // with room beside it for the small copy that shows where you are.
  const LONG_FRAME = 0.62;
  const frameRatio = ratio => ratio && ratio < 1 / LONG_RATIO ? LONG_FRAME : ratio;

  function position() {
    let [naturalWidth, naturalHeight] = mediaSize(active?.image);
    if (!naturalWidth || !naturalHeight) return;
    // A stand-in (a small copy, a video's cover) is laid out at the true
    // shape when that is known, so the frame does not change when the
    // full picture or the video arrives. The stand-in fits inside it.
    const shape = active.provisional && active.shape;
    if (shape && Math.abs(shape - naturalWidth / naturalHeight) > 0.01) {
      const pixels = naturalWidth * naturalHeight;
      naturalHeight = Math.sqrt(pixels / shape);
      naturalWidth = naturalHeight * shape;
    }
    const { image, anchor, mode } = active;
    const full = mode === "full";
    const width = window.innerWidth;
    const height = window.innerHeight;
    // The card is for the post's words. A post of pictures alone has no
    // card: the pictures take the room.
    const words = ((active.post.content || "") + (active.post.quote?.content || "")).trim();
    const hasPost = settings.showCaption && Boolean(words);
    // A line or two of text goes in a slim bar under the picture, never a
    // tall card beside it, so the picture keeps the width.
    const brief = !active.post.quote?.content && words.length <= 60 && (words.match(/\n/g) || []).length < 2;
    const hasCaption = hasPost && (full || width >= 760);
    const many = active.gallery.length > 1;
    const sideAllowed = width >= 760;
    // One card width for every post (per mode and window size): a short
    // post and a long one look like the same card. Whether the card sits
    // beside the picture or under it is what keeps the picture large.
    const cardWidth = full ? Math.min(380, Math.max(300, width * 0.26)) : Math.min(320, width * 0.26);
    // Full page: a click outside the picture closes it. A video's own
    // surface pauses it, so a video keeps a wider band of backdrop around it
    // to click.
    // The page keeps 40px of air on the sides and 56px above and below,
    // so the window's corner holds the ? and × buttons clear of the picture.
    // The same for the whole set, so switching never resizes the frame.
    const fullGap = full && active.gallery.some(item => item.video) ? 120 : 80;
    const area = full
      ? { width: width - fullGap, height: height - Math.max(fullGap, 112) }
      : { width: Math.min(1120, width * 0.62), height: height * 0.86 };
    // A provisional thumbnail is shown at the size the full image will
    // likely take, instead of its own small native size. Videos scale up
    // like any player.
    const grow = active.provisional || active.video ? 8 : 1;
    const key = [width, height, mode, settings.captionLayout, hasCaption, fullGap].join();
    let plan = active.plan?.key === key ? active.plan : null;
    if (!plan || !plan.locked) {
      const current = naturalWidth / naturalHeight;
      const known = active.ratios.filter(Boolean);
      // A long picture is read in a portrait frame, not fitted as a strip.
      const ratios = (full ? (known.length ? known : [current]) : [active.ratios[active.start] || current]).map(frameRatio);
      // The card's place (beside or below) is decided once per open and
      // kept, even if the picture's true shape arrives a moment later.
      const layout = active.layouts?.[mode];
      plan = { key, ...stagePlan(ratios, area.width, area.height, cardWidth, brief ? (full ? 80 : 76) : (full ? 120 : 110), hasCaption, sideAllowed, layout, full && many) };
      (active.layouts ||= {})[mode] = plan.layout;
      if (!full) {
        const scale = active.video ? 8 : 1;
        const [w, h] = frameRatio(naturalWidth / naturalHeight) === naturalWidth / naturalHeight
          ? [naturalWidth * scale, naturalHeight * scale] : [frameRatio(1) * 4000, 4000];
        Object.assign(plan, fitSizeWithinBox(w, h, plan.width, plan.height));
      }
      // Full page: the frame is set at open and kept for the whole set.
      // Floating: the size may follow the full picture, the layout not.
      plan.locked = full || !active.provisional;
      active.plan = plan;
    }
    const side = plan.layout === "side";
    const below = plan.layout === "below";
    let stage = { width: plan.width, height: plan.height };
    // A single picture is never enlarged past its own size.
    if (!many) {
      const frame = frameRatio(naturalWidth / naturalHeight);
      stage = frame === naturalWidth / naturalHeight
        ? fitSizeWithinBox(naturalWidth * grow, naturalHeight * grow, stage.width, stage.height)
        : fitSizeWithinBox(frame * 4000, 4000, stage.width, stage.height);
    }
    let pictureWidth = below ? Math.max(stage.width, 300) : stage.width;
    const pictureHeight = side ? Math.max(stage.height, 220) : stage.height;
    const shown = fitSizeWithinBox(naturalWidth * grow, naturalHeight * grow, pictureWidth, pictureHeight);
    // A long picture fitted whole is a strip too narrow to read. It shows
    // at a readable width instead, top first, and scrolls in its frame.
    // While the small copy stands in, the full picture's size is often
    // known already (read from its first bytes), so a long picture is
    // recognised before it finishes loading.
    const [trueWidth, trueHeight] = active.provisional && active.trueSize ? active.trueSize : [naturalWidth * grow, naturalHeight * grow];
    const tall = trueHeight / trueWidth;
    // Alone, a long picture keeps a slim gutter on the right for its bar.
    const barGutter = full && many ? 0 : 20;
    // A set reads inside its fixed frame; a single picture may widen its
    // frame up to the room beside the card.
    const longRoom = full && many ? pictureWidth : area.width - (side ? cardWidth : 0);
    const readWidth = Math.min(trueWidth, longRoom - barGutter, Math.max(380, pictureHeight * 0.7));
    const isVideo = Boolean(active.video || active.gallery[active.index]?.video);
    const long = !isVideo && tall >= LONG_RATIO && readWidth > fitSizeWithinBox(trueWidth, trueHeight, pictureWidth, pictureHeight).width * 1.3;
    if (long) {
      const imageHeight = readWidth * tall;
      // The stand-in shows the top of the picture until the full one is in.
      const early = active.provisional;
      active.longBox = { height: imageHeight, frame: pictureHeight, max: early ? 0 : Math.max(0, imageHeight - pictureHeight) };
      if (!many || !full) pictureWidth = Math.max(pictureWidth, readWidth + barGutter);
      image.style.marginRight = barGutter && pictureWidth - readWidth < 2 * barGutter ? barGutter + "px" : "";
      Object.assign(image.style, early
        ? { width: readWidth + "px", height: pictureHeight + "px", objectFit: "cover", objectPosition: "top", transform: "" }
        : { width: readWidth + "px", height: imageHeight + "px", objectFit: "", objectPosition: "" });
    } else {
      active.longBox = null;
      Object.assign(image.style, { width: shown.width + "px", height: shown.height + "px", transform: "", objectFit: "", objectPosition: "", marginRight: "" });
    }

    const caption = view.caption;
    const open = caption.classList.contains("open");
    caption.hidden = !hasCaption;
    caption.className = "caption " + settings.captionStyle + (full ? " full" : " floating") +
      (side ? " side" : "") + (below ? " below" : "") + (!full && below ? " clamp" : "") +
      (open ? " open" : "");
    view.picture.className = "picture" + (side ? " joined-side" : "") + (below ? " joined-below" : "") + (active.video ? " video" : "") + (long ? " long" : "");
    view.stage.classList.toggle("full", full);
    const light = lightTheme();
    view.stage.classList.toggle("light", light);
    view.notice.classList.toggle("light", light);
    view.stage.hidden = false;

    // The card under the picture is as wide as the picture; measure it.
    let barHeight = 0;
    if (below) {
      Object.assign(caption.style, { width: pictureWidth + "px", height: "", top: "auto", bottom: "auto" });
      if (full) {
        caption.style.setProperty("--bar", "none");
        if (!open) active.bar = Math.min(caption.offsetHeight, 140);
        caption.style.setProperty("--bar", (active.bar || 120) + "px");
        barHeight = active.bar || 120;
      } else {
        view.more.textContent = message("readFullPost", [keys.format(settings.shortcuts.toggleMode)]);
        view.more.hidden = !(view.body.scrollHeight > view.body.clientHeight + 2 || active.post.quote?.content);
        barHeight = caption.offsetHeight;
      }
    }
    const groupWidth = pictureWidth + (side ? cardWidth : 0);
    const groupHeight = pictureHeight + barHeight;
    let x;
    let y;
    if (full) {
      x = (width - groupWidth) / 2;
      y = Math.max(56, (height - groupHeight) / 2);
    } else {
      const box = anchor.element.getBoundingClientRect();
      const onRight = width - box.right - 12 >= groupWidth || width - box.right >= box.left;
      x = Math.max(8, Math.min(width - groupWidth - 8, onRight ? box.right + 12 : box.left - groupWidth - 12));
      y = Math.max(8, Math.min(height - groupHeight - 8, box.top + (box.height - groupHeight) / 2));
    }
    Object.assign(view.picture.style, { left: x + "px", top: y + "px", width: pictureWidth + "px", height: pictureHeight + "px" });
    if (side) {
      Object.assign(caption.style, {
        left: x + pictureWidth + "px", top: y + "px", bottom: "auto", width: cardWidth + "px", height: pictureHeight + "px"
      });
    } else if (below) {
      // Anchored at its bottom edge, so the full-page bar opens upward.
      Object.assign(caption.style, { left: x + "px", bottom: height - (y + groupHeight) + "px" });
    }

    if (full) {
      // The shortcut help opens in the window's top-right corner: 40px in
      // from the right (the panel's own outer margin), or lined up with the
      // panel's right edge when the panel comes close to it.
      const panelGap = width - (x + groupWidth);
      const cornerRight = panelGap < 72 ? Math.max(12, panelGap) : 40;
      // Close sits on the same 12px grid as the arrows and the picture's
      // buttons: its 36px circle starts 12px in from the panel's corner,
      // in line with the previous-picture arrow below it.
      Object.assign(view.controls.style, { left: x + 12 + "px", top: y + 12 + "px", right: "auto" });
      Object.assign(view.help.style, { right: cornerRight + "px", top: "56px" });
      // Copy and save sit on the picture's own top-right corner, at hand,
      // even when a narrow picture leaves room on either side of it.
      const contentWidth = long ? readWidth : Math.min(pictureWidth, shown.width);
      const contentHeight = long ? pictureHeight : Math.min(pictureHeight, shown.height);
      const gutterShift = long && image.style.marginRight ? parseFloat(image.style.marginRight) / 2 : 0;
      const contentRight = x + (pictureWidth + contentWidth) / 2 - gutterShift;
      Object.assign(view.imageActions.style, {
        right: width - contentRight + 12 + "px",
        top: y + (pictureHeight - contentHeight) / 2 + 12 + "px"
      });
      // The video bar spans the video, not the room beside it.
      const sideRoom = Math.max(0, (pictureWidth - contentWidth) / 2) + 14 + "px";
      Object.assign(view.bar.style, { left: sideRoom, right: sideRoom });
      // Side arrows, inside the picture's left and right edges.
      // Same 12px inset as the picture's buttons.
      const middle = y + pictureHeight / 2 - 18 + "px";
      Object.assign(view.prev.style, { left: x + 12 + "px", top: middle });
      Object.assign(view.next.style, { left: x + pictureWidth - 12 - 36 + "px", top: middle });
      // Bottom of the picture: the video bar, then the strip above it.
      const barSpace = active.media && !active.video.gif ? 70 : 14;
      Object.assign(view.pager.style, {
        left: x + pictureWidth / 2 + "px", top: "auto", transform: "",
        bottom: height - (y + pictureHeight) + barSpace + "px",
        maxWidth: pictureWidth - 24 + "px"
      });
      Object.assign(view.flash.style, { left: x + pictureWidth / 2 + "px", bottom: height - (y + pictureHeight) + barSpace + 14 + "px" });
      view.badge.hidden = true;
      view.more.hidden = true;
    } else {
      view.bar.style.left = view.bar.style.right = "";
      if (side) {
        // A floating card cannot scroll; cut text points to the full page.
        const content = view.captionContent;
        const long = content.scrollHeight > content.clientHeight + 2;
        caption.classList.toggle("long", long);
        view.more.hidden = !long;
        view.more.textContent = message("readFullPost", [keys.format(settings.shortcuts.toggleMode)]);
      } else if (!below) {
        view.more.hidden = true;
      }
      view.badge.hidden = !many;
    }
    // The strip, when it shows, carries the position; else the edge bar.
    view.longBar.hidden = !long || (full && many);
    if (long) applyLong();
    const chromeWasHidden = view.controls.hidden;
    view.controls.hidden = view.imageActions.hidden = !full;
    view.pager.hidden = !full || !many;
    view.prev.hidden = view.next.hidden = !full || !many;
    if (full && chromeWasHidden) {
      zones(null);
      wakeChrome();
      // Opened: the close button shows full size, then settles into its dot.
      peek("peek-close", 1400);
    }
    updateCount();
    updateVideoChrome();
    updateActions();
    requestFullText();
  }

  // The full page shows the whole post. When the page holds only the start
  // of a long post, ask (once) for the rest; the "only part shown" note
  // waits a moment for it.
  function requestFullText() {
    const post = active?.post;
    if (active?.mode !== "full" || active.askedText || !(post?.truncated || post?.quote?.truncated)) return;
    active.askedText = true;
    active.textPending = true;
    const current = active;
    setTimeout(() => { if (active === current) { current.textPending = false; renderCaption(); position(); } }, 4000);
    document.dispatchEvent(new CustomEvent("__zizai_longtext_request", {
      detail: JSON.stringify({ url: active.anchor.fallback || active.anchor.url })
    }));
    renderCaption();
  }

  // Where a long picture is scrolled to, kept as a share of the way down so
  // it holds when the frame or the picture's size changes.
  function applyLong() {
    const box = active?.longBox;
    if (!box) return;
    active.scrollFrac = Math.min(1, Math.max(0, active.scrollFrac || 0));
    active.image.style.transform = "translateY(" + -active.scrollFrac * box.max + "px)";
    const shown = Math.min(1, Math.max(0.08, box.frame / box.height));
    const place = { height: shown * 100 + "%", top: active.scrollFrac * (1 - shown) * 100 + "%" };
    Object.assign(view.longThumb.style, place);
    // Only the long picture's own thumbnail carries the mark.
    for (const other of view.thumbs.querySelectorAll(".tpos.on")) other.classList.remove("on");
    const thumb = view.thumbs.children[active.index];
    if (thumb) {
      let mark = thumb.querySelector(".tpos");
      if (!mark) {
        mark = document.createElement("span");
        mark.className = "tpos";
        mark.append(document.createElement("i"));
        thumb.append(mark);
      }
      mark.classList.add("on");
      // A clear window over the thumbnail: the part in view.
      Object.assign(mark.firstChild.style, place);
    }
  }

  // Scrolls by a number of pixels, or to a share of the way (0 to 1).
  // Returns whether it moved.
  function scrollLong(delta, to, smooth = false, byReader = true) {
    const box = active?.longBox;
    if (!box?.max) return false;
    const before = active.scrollFrac || 0;
    const next = to ?? before + delta / box.max;
    active.scrollFrac = Math.min(1, Math.max(0, Number.isFinite(next) ? next : before));
    view.picture.classList.toggle("reading", !smooth);
    applyLong();
    const moved = active.scrollFrac !== before;
    // In a set, the strip shows while reading: its thumbnail marks the place.
    if (moved && byReader && active.mode === "full" && active.gallery.length > 1) peek("peek-strip", 1200);
    if (moved && byReader && (!active.longMoved || active.mode === "full" && !active.longMovedFull)) {
      active.longMoved = true;
      if (active.mode === "full") active.longMovedFull = true;
    }
    return moved;
  }

  // What the corner buttons and keys can act on right now.
  function postText() {
    const post = active?.post;
    if (!post) return "";
    const body = [post.content, post.quote?.content && (post.quote.author ? "//@" + post.quote.author + ": " : "") + post.quote.content]
      .filter(Boolean).join("\n\n").trim();
    if (!body) return "";
    const source = [post.author || post.handle, post.url].filter(Boolean).join(" · ");
    return source ? body + "\n\n— " + source : body;
  }
  function actionTarget(name) {
    if (!active) return "";
    if (name === "copyText") return postText();
    if (name === "copyImage") return active.video ? active.gallery[active.index].fallback || "" : active.currentUrl || "";
    // A video is not saved as a picture.
    return active.video || active.gallery[active.index]?.video ? "" : active.currentUrl || "";
  }
  function updateActions() {
    for (const [name, button] of Object.entries(view.actionButtons)) {
      button.hidden = !actionTarget(name);
      const label = message(name);
      button.setAttribute("aria-label", label);
      button.title = label + " (" + keys.format(settings.shortcuts[name]) + ")";
    }
  }
  function runAction(name) {
    const target = actionTarget(name);
    if (!target) return;
    if (name === "copyImage") void copyImage(target);
    else if (name === "saveImage") void saveImage(target);
    else void copyText(target);
  }

  function updateCount() {
    view.badge.textContent = view.count.textContent = (active.index + 1) + " / " + active.gallery.length;
    [...view.thumbs.children].forEach((thumb, index) => thumb.setAttribute("aria-current", String(index === active.index)));
    const current = view.thumbs.children[active.index];
    if (current && !view.pager.hidden) {
      // Scroll the strip itself; scrollIntoView could scroll the page.
      const strip = view.thumbs;
      strip.scrollLeft = current.offsetLeft - (strip.clientWidth - current.offsetWidth) / 2;
    }
  }

  // The strip reuses the small copies the page already shows.
  function renderThumbs() {
    const thumbs = active.gallery.length > 1 ? active.gallery.map((item, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "thumb" + (item.video ? " video" : "");
      button.setAttribute("aria-label", (index + 1) + " / " + active.gallery.length);
      if (!item.url) {
        button.classList.add("pending-thumb");
        button.textContent = String(index + 1);
        button.disabled = !active.carousel?.buttons[index];
        button.addEventListener("click", () => selectGalleryIndex(index));
        return button;
      }
      const image = new Image();
      if (siteImages.platform()) image.referrerPolicy = "origin";
      image.alt = "";
      image.draggable = false;
      image.loading = "lazy";
      image.fetchPriority = "low";
      // Thumbnails also tell the proportions of every picture in the set.
      image.addEventListener("load", () => {
        // A video's cover may be cropped; it does not tell the video's shape.
        if (active?.thumbs !== thumbs || !image.naturalWidth || item.video) return;
        active.ratios[index] ||= image.naturalWidth / image.naturalHeight;
        if (!active.plan?.locked) position();
      });
      if (item.fallback || !item.video) image.src = item.fallback || item.url;
      button.append(image);
      button.addEventListener("click", () => selectGalleryIndex(index));
      return button;
    }) : [];
    active.thumbs = thumbs;
    view.thumbs.replaceChildren(...thumbs);
  }

  // A still on the page may stand for a video: the page's data lists one
  // for it, or it is one of X's video covers. It is then a video in the
  // gallery, never a picture (and never a long picture).
  const X_VIDEO_COVER = /\/(?:ext_tw_video_thumb|amplify_video_thumb)\//;
  function asVideo(item) {
    if (!item || item.video) return item;
    const listed = listedVideo(item.fallback);
    if (listed) item.video = { urls: [...listed.urls], live: listed.live, gif: listed.gif, source: null };
    else if (X_VIDEO_COVER.test(item.fallback)) item.video = { urls: [], live: false, gif: false, source: null };
    return item;
  }

  function galleryFor(anchor, context) {
    const group = context.root || anchor.element.closest(GALLERY);
    if (context.pictures.length) {
      const gallery = context.pictures.map(picture => {
        const original = mediaUrl(picture.url);
        if (!original) return null;
        if (siteImages.mediaKey(original) === siteImages.mediaKey(anchor.url)) return anchor;
        const urls = siteImages.candidates(original, picture.format);
        return { element: anchor.element, url: urls[0], urls, fallback: original, alt: "", video: picture.video ? { ...picture.video, source: null } : null };
      }).filter(Boolean);
      if (gallery.includes(anchor)) return gallery;
    }
    if (!group) return [anchor];
    const images = [...group.querySelectorAll("img,video")];
    if (images.length > 24) return [anchor];
    // One item per thing on screen: a video's cover picture, or a second
    // copy of the same picture, is not a second item. The hovered one wins.
    const key = item => siteImages.mediaKey(item.fallback || item.url);
    const kept = [{ item: anchor, box: anchor.element.getBoundingClientRect() }];
    const keys = new Set([key(anchor)]);
    for (const element of images) {
      if (element === anchor.element) continue;
      const box = element.getBoundingClientRect();
      if (Math.min(box.width, box.height) < 48 || element.closest("a[href*='/u/'],a[href*='/user/']")) continue;
      if (element instanceof HTMLImageElement && videoBehind(element)) continue;
      const item = element instanceof HTMLVideoElement ? videoSource(element) : imageSource(element);
      if (!item || keys.has(key(item)) || kept.some(other => overlap(other.box, box) >= 0.6)) continue;
      keys.add(key(item));
      kept.push({ item, box });
    }
    return kept.map(entry => asVideo(entry.item)).sort((a, b) =>
      a.element === b.element ? 0 : a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
  }

  function instagramGallery(anchor, context) {
    const { carousel, pictures, mediaCount } = context;
    const count = carousel?.buttons.length || mediaCount || pictures.length;
    const matches = url => [anchor.fallback, anchor.url].some(value =>
      value && siteImages.mediaKey(value) === siteImages.mediaKey(url));
    const match = pictures.findIndex(picture => matches(picture.url));
    const index = carousel?.index ?? (match >= 0 ? pictures[match].index ?? match : -1);
    if (index < 0 || index >= count || count > 24) return { gallery: [anchor], index: 0 };

    const gallery = Array.from({ length: count }, () => ({ url: "" }));
    if (carousel) {
      for (const { index, element } of posts.instagramSlides(carousel)) {
        const item = element instanceof HTMLVideoElement ? videoSource(element) : pictureSource(element);
        if (item) gallery[index] = item;
      }
    }
    gallery[index] = anchor;
    const cacheLinesUp = !carousel || gallery.every((item, slot) => {
      if (!item.url) return true;
      const keys = [item.fallback, item.url].filter(Boolean).map(siteImages.mediaKey);
      const found = pictures.filter(picture => keys.includes(siteImages.mediaKey(picture.url)));
      return !found.length || found.some(picture => (picture.index ?? pictures.indexOf(picture)) === slot);
    });
    if (cacheLinesUp && (!carousel || !mediaCount || mediaCount === count)) {
      for (const [offset, picture] of pictures.entries()) {
        const slot = picture.index ?? offset;
        const original = mediaUrl(picture.url);
        if (!original || !gallery[slot]) continue;
        const mounted = gallery[slot];
        const urls = [...new Set([...siteImages.candidates(original, picture.format), ...(mounted.urls || [])])];
        gallery[slot] = {
          element: mounted.element || anchor.element, url: urls[0], urls,
          fallback: mounted.fallback || original, alt: mounted.alt || "",
          video: picture.video ? { ...picture.video, source: mounted.video?.source || null } : mounted.video,
          ratio: picture.ratio
        };
      }
    }
    return { gallery, index };
  }

  function open(anchor, { byClick = false } = {}) {
    ensureView();
    const context = posts.contextFor(anchor);
    const matched = context.pictures.find(picture => siteImages.mediaKey(picture.url) === siteImages.mediaKey(anchor.url));
    const original = matched && mediaUrl(matched.url);
    if (original) anchor.urls = [...new Set([...siteImages.candidates(original, matched.format), ...anchor.urls])];
    if (context.video) {
      anchor.video = { ...context.video, urls: [...new Set([...context.video.urls, ...(anchor.video?.urls || [])])], source: anchor.video?.source || null };
    }
    const fromInstagram = siteImages.platform() === "instagram" ? instagramGallery(anchor, context) : null;
    const gallery = fromInstagram?.gallery || galleryFor(anchor, context);
    const index = fromInstagram?.index ?? gallery.indexOf(anchor);
    // A clicked video plays with sound. A video reached from a hovered
    // picture's gallery starts muted in the floating preview.
    active = { anchor, gallery, index, mode: settings.mode, image: null, currentUrl: "", post: context.post, carousel: context.carousel,
      ratios: gallery.map(pageRatio), plan: null, navigated: false, start: index, byClick,
      muted: soundMuted || (!byClick && settings.mode !== "full"), userMuted: false, video: null, media: null, player: null, mirror: null, linked: null };
    renderCaption();
    renderThumbs();
    renderImage();
  }

  // Chinese has no spaces, so a line may break inside a word ("收藏" split
  // over two lines). Each word of two to eight characters is kept on one
  // line; lines still break between words. Copying is unaffected.
  let wordSegmenter;
  function setWords(element, text) {
    if (!text || text.length > 20000 || typeof Intl.Segmenter !== "function" || !/[\u3400-\u9fff]/.test(text)) {
      element.textContent = text;
      return;
    }
    wordSegmenter ||= new Intl.Segmenter("zh", { granularity: "word" });
    const parts = [];
    let plain = "";
    for (const { segment, isWordLike } of wordSegmenter.segment(text)) {
      if (isWordLike && segment.length >= 2 && segment.length <= 8 && /^[\u3400-\u9fff]+$/.test(segment)) {
        if (plain) parts.push(plain);
        plain = "";
        const word = document.createElement("span");
        word.className = "w";
        word.textContent = segment;
        parts.push(word);
      } else plain += segment;
    }
    if (plain) parts.push(plain);
    element.replaceChildren(...parts);
  }

  function renderCaption() {
    if (!active) return;
    const post = active.post;
    view.author.textContent = post.author || post.handle || "";
    view.meta.textContent = [post.author && post.handle, post.time].filter(Boolean).join(" · ");
    view.meta.hidden = !view.meta.textContent;
    const avatar = mediaUrl(post.avatar);
    if (avatar) {
      if (siteImages.platform()) view.avatar.referrerPolicy = "origin";
      if (view.avatar.src !== avatar) view.avatar.src = avatar;
    } else view.avatar.removeAttribute("src");
    const avatarReady = Boolean(avatar && view.avatar.complete && view.avatar.naturalWidth);
    view.avatar.hidden = !avatarReady;
    view.initial.textContent = Array.from(view.author.textContent.replace(/^@/, ""))[0] || "";
    view.initial.hidden = avatarReady || !view.initial.textContent;
    view.author.parentElement.parentElement.hidden = !view.author.textContent;
    // Weibo forwards: "转发微博" alone says nothing, and "//@a: …//@b: …"
    // is a chain of earlier comments. Show the comment, then the chain as
    // one line per person.
    const quote = post.quote;
    const parts = (post.content || "").split(/\s*\/\/\s*(?=@[^:：\s]{1,40}\s*[:：])/);
    const comment = parts[0].trim();
    const bare = Boolean(quote?.content) && /^(转发微博|轉發微博|Repost)$/i.test(comment);
    setWords(view.body, bare ? "" : comment);
    view.body.hidden = bare || !comment;
    view.chain.replaceChildren(...parts.slice(1).map(part => {
      const line = document.createElement("p");
      const match = part.match(/^@([^:：\s]{1,40})\s*[:：]\s*/);
      const name = document.createElement("b");
      name.textContent = match ? match[1] : "";
      const words = document.createElement("span");
      setWords(words, part.slice(match ? match[0].length : 0).trim());
      line.append(name, words);
      return line;
    }));
    view.chain.hidden = parts.length < 2;
    view.cut.hidden = !post.truncated || Boolean(active.textPending);
    view.quote.hidden = !quote?.content;
    view.quoteHead.replaceChildren(quote?.author || "");
    if (quote?.handle) {
      const handle = document.createElement("span");
      handle.textContent = quote.handle;
      view.quoteHead.append(handle);
    }
    view.quoteHead.hidden = !quote?.author;
    setWords(view.quoteBody, quote?.content || "");
    view.quoteCut.hidden = !quote?.truncated || Boolean(active.textPending);
    view.foot.hidden = true;
    if (post.url) view.postLink.href = post.url;
  }

  function navigate(delta) {
    if (!active || active.gallery.length < 2) return;
    if (active.carousel) posts.refreshInstagramCarousel(active.carousel);
    const start = active.pendingSlide?.index ?? active.index;
    const count = active.gallery.length;
    for (let step = 1; step < count; step++) {
      const index = (start + step * delta + count) % count;
      if (active.gallery[index].url || active.carousel?.buttons[index]?.isConnected) {
        selectGalleryIndex(index);
        return;
      }
    }
    toast(message("previewUnavailable"));
  }

  function showGalleryIndex(index) {
    active.pendingSlide = null;
    active.index = index;
    active.navigated = true;
    updateCount();
    flashCount();
    renderImage();
  }

  function selectGalleryIndex(index) {
    if (!active || active.index === index && !active.pendingSlide) return;
    if (active.gallery[index]?.url) {
      if (active.index === index) active.pendingSlide = null;
      else showGalleryIndex(index);
      return;
    }
    const current = active;
    const carousel = current.carousel;
    if (carousel) posts.refreshInstagramCarousel(carousel);
    const button = carousel?.buttons[index];
    if (!button?.isConnected) {
      toast(message("previewUnavailable"));
      return;
    }
    if (current.pendingSlide?.index === index) return;
    const request = { index };
    current.pendingSlide = request;
    // Only follow a native carousel control when the reader asks to turn
    // to a slide Instagram has not loaded yet.
    button.click();
    const until = performance.now() + 4000;
    function waitForSlide() {
      if (active !== current || current.pendingSlide !== request) return;
      if (current.gallery[index]?.url) {
        showGalleryIndex(index);
        return;
      }
      if (posts.refreshInstagramCarousel(carousel) === index) {
        const element = posts.instagramSlides(carousel).find(slide => slide.index === index)?.element;
        const item = element instanceof HTMLVideoElement ? videoSource(element) : element && pictureSource(element);
        if (item) {
          current.gallery[index] = item;
          current.ratios[index] = pageRatio(item);
          renderThumbs();
          showGalleryIndex(index);
          return;
        }
      }
      if (performance.now() < until && carousel.root.isConnected) setTimeout(waitForSlide, 60);
      else {
        current.pendingSlide = null;
        toast(message("previewUnavailable"));
      }
    }
    waitForSlide();
  }

  function onWheel(event) {
    if (active?.mode !== "full" || event.composedPath().includes(view.caption)) return;
    event.preventDefault();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : 1);
    if (Math.abs(event.deltaX) > Math.abs(delta)) return;
    // A long picture scrolls first. Reaching its end stops there; only a
    // new turn of the wheel at the end moves on (or closes).
    const now = performance.now();
    if (now - lastWheelAt > 350) wheelScrolled = false;
    lastWheelAt = now;
    if (active.longBox?.max) {
      if (scrollLong(delta)) {
        wheelScrolled = true;
        wheelTotal = 0;
        return;
      }
      if (wheelScrolled) return;
    }
    if (active.gallery.length < 2) {
      if (settings.singleWheelClose && Math.abs(delta) > 24) { dismissed = active.anchor; close(); }
      return;
    }
    const intervals = { fast: 220, medium: 450, slow: 750 };
    if (performance.now() - lastWheelSwitch < intervals[settings.wheelSensitivity]) return;
    if (Math.sign(delta) !== Math.sign(wheelTotal)) wheelTotal = 0;
    wheelTotal += delta;
    if (Math.abs(wheelTotal) >= 80) {
      navigate(Math.sign(wheelTotal));
      wheelTotal = 0;
      lastWheelSwitch = performance.now();
    }
  }

  function overlays() {
    return [view.badge, view.liveMark, view.sound, view.state, view.bar, view.longBar];
  }

  // Keep the pixels the browser has already loaded for the page. No need
  // to wait for a second request before the preview can show them.
  function snapshotImage(item) {
    const source = item.element;
    if (!(source instanceof HTMLImageElement) || !source.complete || !source.naturalWidth ||
        !source.naturalHeight || mediaUrl(source.currentSrc) !== item.fallback) return null;
    const scale = Math.min(1, 2048 / Math.max(source.naturalWidth, source.naturalHeight));
    const snapshot = document.createElement("canvas");
    snapshot.width = Math.max(1, Math.round(source.naturalWidth * scale));
    snapshot.height = Math.max(1, Math.round(source.naturalHeight * scale));
    snapshot.setAttribute("role", "img");
    if (item.alt) snapshot.setAttribute("aria-label", item.alt);
    try {
      snapshot.getContext("2d").drawImage(source, 0, 0, snapshot.width, snapshot.height);
      return snapshot;
    } catch {
      return null;
    }
  }

  function renderImage() {
    const current = active;
    releaseVideo(current);
    current.scrollFrac = 0;
    // The last picture's long-reading state goes with it; otherwise a wheel
    // turn before the next picture loads would scroll and mark the wrong one.
    current.longBox = null;
    current.longMoved = false;
    current.longMovedFull = false;
    current.trueSize = null;
    current.metadata = null;
    const item = current.gallery[current.index];
    current.shape = listedRatio(item);
    if (current.shape) current.ratios[current.index] ||= current.shape;
    const token = {};
    current.loadToken = token;
    let finalShown = false;
    const live = () => active === current && current.loadToken === token;
    const makeImage = () => {
      const image = new Image();
      if (siteImages.platform()) image.referrerPolicy = "origin";
      image.alt = item.alt;
      image.draggable = false;
      image.decoding = "async";
      return image;
    };
    // Images load off-screen. The previous picture and the full-page
    // backdrop stay visible until the next one is ready, so switching
    // images never flashes the page underneath.
    // "load" fires before an async-decoded picture can paint; swapping it
    // in then shows an empty frame for a moment. Wait for the decode.
    const decoded = image => image.decode ? image.decode().catch(() => {}) : Promise.resolve();
    const urls = item.video ? [] : [...new Set([...(item.urls || [item.url]), item.fallback])].filter(Boolean);
    // The blurred fill uses the small copy the page already has (a video's poster).
    const fillSource = item.video ? item.fallback : item.fallback || urls[0];
    const backdrop = fillSource ? makeImage() : null;
    let backdropReady = false;
    let shown = null;
    if (backdrop) {
      backdrop.className = "backdrop";
      backdrop.alt = "";
      backdrop.fetchPriority = "low";
      backdrop.onload = () => decoded(backdrop).then(() => {
        if (!live()) return;
        backdropReady = true;
        if (shown?.parentElement === view.picture) view.picture.prepend(backdrop);
      });
    }
    const show = async (element, provisional) => {
      // A video's cover may be cropped to another shape. With no size from
      // the page's data, wait a moment for the video's own size (read from
      // its first bytes) before the frame is planned.
      if (provisional && item.video && !current.shape && current.metadata) await current.metadata;
      if (!live() || (provisional && finalShown)) return;
      const [width, height] = mediaSize(element);
      current.image = element;
      current.provisional = provisional;
      if (!provisional || !current.ratios[current.index]) current.ratios[current.index] = width / height;
      element.classList.add("main");
      // Swap only the picture when the fill is already in place.
      if (shown?.parentElement === view.picture) shown.replaceWith(element);
      else view.picture.replaceChildren(...(backdropReady ? [backdrop] : []), element, ...overlays());
      shown = element;
      position();
    };

    function loadStill() {
      if (!item.fallback) return;
      const thumbnail = makeImage();
      thumbnail.onload = () => decoded(thumbnail).then(() => { if (live() && !finalShown) show(thumbnail, true); });
      thumbnail.src = item.fallback;
    }
    if (item.video) {
      renderVideo(current, item, live, () => { finalShown = true; }, show);
      loadStill();
      if (backdrop) backdrop.src = fillSource;
      return;
    }

    let urlIndex = 0;
    current.currentUrl = urls[0];
    const image = makeImage();
    image.fetchPriority = "high";
    let pageImage = null;
    // The size is known from the first bytes, long before the picture has
    // loaded; use it to lay out the frame early.
    const sizeTimer = setInterval(() => {
      if (!live() || finalShown) return clearInterval(sizeTimer);
      if (!image.naturalWidth || !image.naturalHeight) return;
      clearInterval(sizeTimer);
      current.trueSize = [image.naturalWidth, image.naturalHeight];
      current.ratios[current.index] = image.naturalWidth / image.naturalHeight;
      if (current.image && current.provisional) position();
    }, 50);
    image.onload = async () => {
      if (!live()) return;
      finalShown = true;
      const loadedUrl = urls[urlIndex];
      await decoded(image);
      if (!live()) return;
      current.currentUrl = loadedUrl;
      show(image, false);
      pageImage = null;
      if (current.currentUrl === item.fallback && urls[0] !== item.fallback) toast(message("previewThumbnailFallback"));
      firstHint(current);
    };
    image.onerror = () => {
      if (!live()) return;
      if (urlIndex + 1 < urls.length) {
        image.src = urls[++urlIndex];
      } else if (pageImage) {
        current.currentUrl = item.fallback;
        show(pageImage, false);
        toast(message("previewThumbnailFallback"));
      } else {
        dismissed = current.anchor;
        close();
        toast(message("previewUnavailable"));
      }
    };
    image.src = urls[0];
    if (!image.complete || !image.naturalWidth) {
      pageImage = snapshotImage(item);
      if (pageImage) show(pageImage, true);
      else if (urls[0] !== item.fallback) loadStill();
    }
    if (backdrop) backdrop.src = fillSource;
  }

  function firstHint(current) {
    if (hintChecked) return;
    hintChecked = true;
    chrome.storage.local.get("hintSeen").then(({ hintSeen }) => {
      if (hintSeen || active !== current) return;
      toast(message("firstHint"));
      return chrome.storage.local.set({ hintSeen: true });
    }).catch(() => {});
  }

  // Video: play a file the page links to directly (the page's data, then the
  // page's own player source). A streamed video with no file is mirrored
  // from the page's player. With neither, the poster stays and a notice
  // points to the post.
  let mirrorNoted = false;
  function renderVideo(current, item, live, markFinal, show) {
    const listed = listedVideo(item.fallback || item.url);
    const urls = [...new Set([...(listed?.urls || []), ...item.video.urls])];
    current.video = { live: Boolean(item.video.live || listed?.live), gif: Boolean(item.video.gif || listed?.gif) };
    const player = document.createElement("video");
    player.playsInline = true;
    player.preload = "auto";
    player.controls = false;
    player.disablePictureInPicture = true;
    player.muted = current.muted;
    // Sites that autoplay silently often do it with volume 0 rather than
    // muting; copying the page's volume would leave the enlarged one silent.
    player.volume = volume;
    player.loop = loops(current);
    if (item.fallback) player.poster = item.fallback;
    current.player = player;
    current.currentUrl = urls[0] || "";
    // The video's own size arrives with its first bytes.
    current.metadata = Promise.race([
      new Promise(resolve => player.addEventListener("loadedmetadata", resolve, { once: true })),
      new Promise(resolve => setTimeout(resolve, 400))
    ]);
    player.addEventListener("loadedmetadata", () => {
      if (!live() || !player.videoWidth || !player.videoHeight) return;
      const ratio = player.videoWidth / player.videoHeight;
      current.shape = ratio;
      current.ratios[current.index] = ratio;
      if (current.image && current.provisional) position();
    }, { once: true });
    // The page's own copy pauses while the enlarged one plays, so only one
    // sound is heard; the enlarged one picks up where the page was.
    // Everything else on the page falls silent too; muteOthers keeps it so
    // while the preview is open, even if the site starts a player again.
    const source = item.video.source?.isConnected ? item.video.source : null;
    current.resume = silencePage(item.video.source);
    if (urls.length && source) {
      current.linked = { source, start: source.currentTime || 0 };
      player.addEventListener("loadedmetadata", () => {
        const start = current.linked?.start || 0;
        if (start > 0.3 && !current.video?.live && Number.isFinite(player.duration) && start < player.duration - 0.5) {
          player.currentTime = start;
        }
      }, { once: true });
    }
    let urlIndex = 0;
    let settled = false;
    const unavailable = () => {
      if (!live() || settled) return;
      settled = true;
      if (!item.fallback) {
        dismissed = current.anchor;
        close();
      }
      current.unplayable = true;
      updateVideoChrome();
      toast(message("videoUnavailable"));
    };
    const mirror = () => {
      const source = item.video.source;
      let stream = null;
      try {
        if (source?.isConnected && typeof source.captureStream === "function") stream = source.captureStream();
      } catch {}
      if (!stream) return unavailable();
      current.linked = null;
      current.mirror = { source, stream, muted: source.muted, volume: source.volume };
      // The page's player picks its quality for its own small size; say so
      // once rather than leave a soft picture unexplained.
      if (!mirrorNoted) {
        mirrorNoted = true;
        toast(message("videoMirrored"));
      }
      current.currentUrl = "";
      player.removeAttribute("src");
      player.srcObject = stream;
      // The page's player keeps the sound; the copy here is only the picture.
      player.muted = true;
      source.muted = current.muted;
      source.volume = volume;
      source.play().catch(() => {});
    };
    player.addEventListener("loadeddata", () => {
      if (!live() || settled) return;
      settled = true;
      markFinal();
      current.media = current.mirror?.source || player;
      current.media.addEventListener("ended", onVideoEnded);
      current.media.addEventListener("play", updateVideoChrome);
      current.media.addEventListener("pause", updateVideoChrome);
      show(player, false);
      // A mirror shows the page player's frames; it must run to show them.
      if (current.mirror) player.play().catch(() => {});
      else player.addEventListener("timeupdate", checkAudio);
      playMedia();
      firstHint(current);
    });
    // Some listed files carry the picture only (the sound is a separate
    // stream). After a second of playing with sound on, a file that has
    // decoded no audio at all is swapped for the next one, from the same
    // spot. When none has sound, the toolbar says so.
    let heardFrom = null;
    let silentIndex = -1;
    let swapTime = 0;
    const checkAudio = () => {
      if (!live() || current.media !== player || player.seeking) return;
      if (player.muted || player.paused) { heardFrom = null; return; }
      if (heardFrom === null) { heardFrom = player.currentTime; return; }
      if (player.currentTime - heardFrom < 1) return;
      player.removeEventListener("timeupdate", checkAudio);
      const audio = player.webkitAudioDecodedByteCount;
      if (typeof audio !== "number" || audio > 0 || !(player.webkitVideoDecodedByteCount > 0)) return;
      if (silentIndex < 0) silentIndex = urlIndex;
      swapTime = player.currentTime;
      if (urlIndex + 1 < urls.length) swapTo(urlIndex + 1, swapTime, true);
      else noAudio();
    };
    const noAudio = () => {
      current.noAudio = true;
      updateVideoChrome();
      toast(message("videoNoAudio"));
    };
    const swapTo = (index, time, check) => {
      urlIndex = index;
      heardFrom = null;
      current.currentUrl = urls[index];
      player.src = urls[index];
      player.addEventListener("loadedmetadata", () => {
        try { if (Number.isFinite(time) && time < player.duration) player.currentTime = time; } catch {}
        playMedia();
        if (check) player.addEventListener("timeupdate", checkAudio);
      }, { once: true });
    };
    player.addEventListener("error", () => {
      if (!live() || player.srcObject) return;
      if (settled) {
        // A file tried for its sound failed: try the next, or go back to
        // the one that played.
        if (silentIndex < 0 || current.media !== player) return;
        if (urlIndex + 1 < urls.length) swapTo(urlIndex + 1, swapTime, true);
        else { const index = silentIndex; silentIndex = -1; swapTo(index, swapTime, false); noAudio(); }
        return;
      }
      if (urlIndex + 1 < urls.length) player.src = urls[++urlIndex];
      else mirror();
    });
    if (urls.length) player.src = urls[0];
    else mirror();
    // A stalled video leaves the poster up with the same notice.
    setTimeout(() => { if (!current.media) unavailable(); }, 12000);
  }

  // While a video is open, the page plays nothing else: no second copy of
  // the same video, and no other clip talking over it.
  // Silent clips the site was autoplaying start again on close; the
  // enlarged video itself stays paused where it was left.
  function silencePage(except) {
    const resume = [];
    for (const media of document.querySelectorAll("video,audio")) {
      if (media.paused) continue;
      if (media !== except && media.muted) resume.push(media);
      media.pause();
    }
    return resume;
  }

  document.addEventListener("play", event => {
    const media = event.target;
    if (!active?.player || !(media instanceof HTMLMediaElement) || media === active.player || media === active.mirror?.source) return;
    media.pause();
  }, true);

  // While a video is open its sound setting is ours: a site that flips the
  // mute on its own player (X keeps its own mute state) is set back.
  document.addEventListener("volumechange", event => {
    const media = active?.media;
    if (!media || event.target !== media || media.muted === active.muted) return;
    media.muted = active.muted;
  }, true);

  function loops(current) {
    return !current.video?.live && (current.mode !== "full" || Boolean(current.video?.gif));
  }

  function onVideoEnded() {
    // A Live Photo plays once and rests on its first frame.
    const media = active?.media;
    if (media && active.video?.live) media.currentTime = 0;
    updateVideoChrome();
  }

  function playMedia() {
    const media = active?.media;
    if (!media) return;
    media.muted = active.muted;
    media.play().catch(() => {
      // Sound needs a recent key press or click; fall back to muted.
      if (active?.media !== media || media.muted) return;
      active.muted = media.muted = true;
      updateVideoChrome();
      toast(message("videoAutoMuted", [keys.format(settings.shortcuts.toggleMute)]));
      media.play().catch(() => {});
    });
  }

  function togglePlay() {
    const media = active?.media;
    if (!media) return;
    if (media.paused || media.ended) playMedia();
    else media.pause();
    updateVideoChrome();
  }

  // Sliding to 0 mutes this video; the remembered volume is kept, so the
  // next video still opens with sound.
  function setVolume(value) {
    if (!active?.media) return;
    const level = Math.min(1, Math.max(0, value));
    active.muted = level === 0;
    active.userMuted = true;
    rememberMute(active.muted);
    if (level > 0) {
      volume = level;
      chrome.storage.local.set({ videoVolume: volume }).catch(() => {});
    }
    active.media.volume = volume;
    active.media.muted = active.muted;
    updateVideoChrome();
  }

  function toggleMute() {
    if (!active?.media || active.noAudio) return;
    active.muted = !active.muted;
    active.userMuted = true;
    rememberMute(active.muted);
    if (!active.muted && volume === 0) volume = 1;
    active.media.volume = volume;
    active.media.muted = active.muted;
    if (!active.muted && active.media.paused) playMedia();
    toast(message(active.muted ? "videoMuted" : "videoUnmuted"));
    updateVideoChrome();
  }

  function releaseVideo(current) {
    if (!current) return;
    clearInterval(current.videoTimer);
    const { player, mirror, media, linked } = current;
    media?.removeEventListener("ended", onVideoEnded);
    media?.removeEventListener("play", updateVideoChrome);
    media?.removeEventListener("pause", updateVideoChrome);
    // Closing leaves the page's video paused where the enlarged one stopped.
    if (linked) {
      const time = player?.currentTime;
      try { if (time > 0 && Number.isFinite(time)) linked.source.currentTime = time; } catch {}
      linked.source.pause();
    }
    if (player) {
      player.pause();
      player.removeAttribute("src");
      player.srcObject = null;
      try { player.load(); } catch {}
    }
    if (mirror) {
      for (const track of mirror.stream.getTracks()) track.stop();
      // The page's player keeps its sound setting and stays paused.
      mirror.source.muted = mirror.muted;
      try { mirror.source.volume = mirror.volume; } catch {}
      mirror.source.pause();
    }
    const resume = current.resume || [];
    Object.assign(current, { player: null, mirror: null, linked: null, media: null, video: null, videoTimer: 0, resume: null, noAudio: false, unplayable: false });
    for (const media of resume) if (media.isConnected && media.muted) media.play().catch(() => {});
  }

  function clock(seconds) {
    const whole = Math.max(0, Math.floor(seconds || 0));
    return Math.floor(whole / 60) + ":" + String(whole % 60).padStart(2, "0");
  }

  function updateVideoChrome() {
    if (!active || !view) return;
    const full = active.mode === "full";
    const media = active.media;
    view.liveMark.hidden = !active.video?.live;
    // The floating preview always shows whether sound is on; muted, it
    // names the key that turns it on. The full page has a speaker button
    // and volume slider on the bar.
    const silent = active.muted || active.noAudio || volume === 0 || Boolean(media && (media.muted || media.volume === 0));
    view.sound.hidden = !media || full || active.video.live || active.video.gif;
    view.sound.classList.toggle("muted", silent);
    view.soundText.textContent = active.noAudio ? message("videoNoAudio") :
      silent ? message("videoSoundHint", [keys.format(settings.shortcuts.toggleMute)]) : "";
    view.bar.hidden = !media || !full || active.video.gif;
    // A paused video is the moment to leave: the close button stays.
    view.stage.classList.toggle("paused", Boolean(full && media && (media.paused || media.ended)));
    view.muteButton.classList.toggle("muted", silent);
    view.muteButton.disabled = Boolean(active.noAudio);
    view.muteButton.setAttribute("aria-label", message(active.noAudio ? "videoNoAudio" : "toggleMute"));
    view.muteButton.title = message(active.noAudio ? "videoNoAudio" : "toggleMute") + (active.noAudio ? "" : " (" + keys.format(settings.shortcuts.toggleMute) + ")");
    view.slider.hidden = Boolean(active.noAudio);
    view.slider.value = String(active.muted ? 0 : volume);
    view.slider.setAttribute("aria-label", message("videoVolume"));
    const loading = Boolean(active.player) && !media && !active.unplayable;
    const playing = Boolean(media) && !media.paused && !media.ended;
    view.state.hidden = !active.player || Boolean(active.unplayable);
    view.state.classList.toggle("loading", loading);
    view.state.classList.toggle("on", loading || Boolean(media) && !playing && !active.video?.live);
    view.playButton.classList.toggle("playing", playing);
    view.playButton.setAttribute("aria-label", message("playPause"));
    if (active.player) active.player.loop = loops(active);
    clearInterval(active.videoTimer);
    if (view.bar.hidden) return;
    const tick = () => {
      if (!active?.media) return;
      const duration = active.media.duration;
      const ratio = Number.isFinite(duration) && duration > 0 ? active.media.currentTime / duration : 0;
      view.fill.style.width = ratio * 100 + "%";
      view.time.textContent = clock(active.media.currentTime) + (Number.isFinite(duration) ? " / " + clock(duration) : "");
    };
    tick();
    active.videoTimer = setInterval(tick, 250);
  }

  function selectedText() {
    return Boolean(window.getSelection()?.toString());
  }

  async function readImage(url) {
    if (/^https?:/.test(url)) {
      const result = await chrome.runtime.sendMessage({ type: "fetchImageBytes", url });
      if (!result?.ok) throw new Error("Image unavailable");
      const binary = atob(result.base64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
      return new Blob([bytes], { type: result.mime });
    }
    const response = await fetch(url, { credentials: "omit" });
    const blob = await response.blob();
    if (!response.ok || blob.size > MAX_IMAGE_BYTES || !blob.type.startsWith("image/")) throw new Error("Image unavailable");
    return blob;
  }

  async function encodePng(blob) {
    if (blob.type === "image/png") return blob;
    const bitmap = await createImageBitmap(blob);
    try {
      if (bitmap.width * bitmap.height > MAX_IMAGE_PIXELS) throw new Error("Image exceeds pixel limit");
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      canvas.getContext("2d").drawImage(bitmap, 0, 0);
      return await canvas.convertToBlob({ type: "image/png" });
    } finally {
      bitmap.close();
    }
  }

  async function copyImage(url) {
    if (copying) return;
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
      toast(message("copyUnavailable"));
      return;
    }
    copying = true;
    toast(message("copyProgress"));
    let isGif = false;
    try {
      const png = readImage(url).then(blob => {
        isGif = blob.type === "image/gif";
        return encodePng(blob);
      });
      // The browser may reject clipboard access before consuming this promise.
      void png.catch(() => {});
      // Attach the conversion to the clipboard write while the keypress still
      // grants activation, even if the source image takes time to fetch.
      const item = new ClipboardItem({ "image/png": png });
      await navigator.clipboard.write([item]);
      toast(message(isGif ? "copyGif" : "copySuccess"));
    } catch {
      toast(message("copyFailure"));
    } finally {
      copying = false;
    }
  }

  // Saves the picture as a file named after the post: author_date_number.
  let saving = false;
  async function saveImage(url) {
    if (saving) return;
    saving = true;
    toast(message("saveProgress"));
    try {
      const blob = await readImage(url);
      const ext = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp", "image/avif": "avif" }[blob.type] || "jpg";
      const post = active?.post || {};
      const now = new Date();
      const day = String(now.getFullYear()) + String(now.getMonth() + 1).padStart(2, "0") + String(now.getDate()).padStart(2, "0");
      const name = [post.author || post.handle || location.hostname, day, (active?.index ?? 0) + 1]
        .join("_").replace(/[\\/:*?"<>|\s]+/g, "-").slice(0, 80) + "." + ext;
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 30000);
      toast(message("saveSuccess", [name]));
    } catch {
      toast(message("saveFailure"));
    } finally {
      saving = false;
    }
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast(message("copyTextSuccess"));
    } catch {
      toast(message("copyFailure"));
    }
  }

  function toggleHelp(shortcuts) {
    view.help.hidden = !view.help.hidden;
    if (view.help.hidden) return;
    const helpActions = ["prevImage", "nextImage", "toggleMode", "playPause", "toggleMute", "openOriginal", "copyImage", "saveImage", "copyText", "holdToSuppress", "toggleSite"];
    const title = document.createElement("div");
    title.className = "help-title";
    title.textContent = message("helpTitle");
    const rows = [...helpActions.map(action => [keys.format(shortcuts[action]), message(action)]),
      ["Esc", message("closePreview")]];
    view.help.replaceChildren(title, ...rows.flatMap(([key, label]) => {
      const kbd = document.createElement("kbd");
      kbd.textContent = key;
      const text = document.createElement("span");
      text.textContent = label;
      return [kbd, text];
    }));
  }

  function keydown(event, { shortcuts }) {
    if (!active || view.stage.hidden) return;
    // Full page, long picture: the reading keys scroll it (held keys repeat).
    if (active.mode === "full" && active.longBox?.max && !event.altKey && !event.ctrlKey && !event.metaKey) {
      const page = active.longBox.frame * 0.85;
      const step = { ArrowDown: 120, ArrowUp: -120, PageDown: page, PageUp: -page, " ": event.shiftKey ? -page : page }[event.key];
      const to = { Home: 0, End: 1 }[event.key];
      if (step !== undefined || to !== undefined) {
        event.preventDefault();
        event.stopImmediatePropagation();
        scrollLong(step || 0, to, !event.repeat);
        return;
      }
    }
    if (event.repeat) return;
    let action;
    if (event.key === "Escape") action = "close";
    else if (event.key === "?" && !event.altKey && !event.ctrlKey && !event.metaKey) action = "help";
    else action = ["prevImage", "nextImage", "toggleMode", "openOriginal", "copyImage", "saveImage", "copyText", "playPause", "toggleMute"]
      .find(name => keys.matches(event, shortcuts[name]));

    // Video keys only act on a video; otherwise Space scrolls the page as usual.
    const copyUrl = active.video ? active.gallery[active.index].fallback : active.currentUrl;
    if (!action || action === "copyImage" && (selectedText() || !copyUrl) ||
        (action === "playPause" || action === "toggleMute") && !active.media ||
        action === "openOriginal" && !/^https?:/.test(active.currentUrl) ||
        (action === "saveImage" || action === "copyText") && !actionTarget(action) ||
        (action === "prevImage" || action === "nextImage") && active.gallery.length < 2 && !active.media) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (action === "close") {
      dismissed = active.anchor;
      close();
    } else if (action === "help") {
      toggleHelp(shortcuts);
    } else if (action === "toggleMode") {
      active.mode = active.mode === "full" ? "float" : "full";
      // The full page plays with sound unless the reader chose otherwise.
      if (active.media && !active.userMuted && !active.byClick) {
        active.muted = soundMuted || active.mode !== "full";
        playMedia();
      }
      position();
    } else if (action === "playPause") {
      togglePlay();
    } else if (action === "toggleMute") {
      toggleMute();
    } else if (action === "openOriginal") {
      window.open(active.currentUrl, "_blank", "noopener,noreferrer");
    } else if (action === "copyImage") {
      void copyImage(copyUrl);
    } else if (action === "saveImage" || action === "copyText") {
      runAction(action);
    } else {
      const delta = action === "nextImage" ? 1 : -1;
      // A single video: the arrows skip 5 seconds, like a player.
      if (active.gallery.length < 2) {
        const media = active.media;
        if (Number.isFinite(media.duration)) media.currentTime = Math.min(media.duration, Math.max(0, media.currentTime + delta * 5));
        updateVideoChrome();
      } else navigate(delta);
    }
  }

  function ownsEvent(event) {
    return active?.mode === "full" && event.composedPath().includes(view.host);
  }

  function refreshInstagramGallery(context) {
    const current = active;
    const { gallery, index } = instagramGallery(current.anchor, context);
    if (gallery.length < current.gallery.length) return;
    const sameSlots = current.start === index && current.gallery.length === gallery.length;
    if (sameSlots) {
      // A native slide can be unmounted again when Instagram moves ahead.
      // Keep its already discovered address until the preview closes.
      for (const [slot, item] of gallery.entries()) {
        if (!item.url) gallery[slot] = current.gallery[slot];
      }
    }
    const before = current.gallery[current.index];
    const selected = sameSlots && current.carousel ? current.index : current.index === current.start ? index : gallery.findIndex(item =>
      item.url && before?.url && siteImages.mediaKey(item.url) === siteImages.mediaKey(before.url));
    if (selected < 0 && !sameSlots) return;
    const next = selected < 0 ? current.index : selected;
    const item = gallery[next];
    if (!item?.url) return;
    const changed = !sameSlots || gallery.some((entry, slot) =>
      entry.url !== current.gallery[slot]?.url || entry.video?.urls?.[0] !== current.gallery[slot]?.video?.urls?.[0]);
    if (!changed) return;
    current.carousel = context.carousel;
    current.gallery = gallery;
    current.index = next;
    current.start = index;
    current.ratios = gallery.map((entry, slot) => pageRatio(entry) || (sameSlots ? current.ratios[slot] : 0));
    renderThumbs();
    updateCount();
    if (item.url !== before?.url || item.video?.urls?.[0] !== before?.video?.urls?.[0]) renderImage();
  }

  document.addEventListener("__zizai_posts_updated", () => {
    videoMemo = { url: "", at: 0, value: null };
    refreshInstagramHover();
    if (!active) return;
    const context = posts.contextFor(active.anchor, active.carousel);
    if (siteImages.platform() === "instagram") refreshInstagramGallery(context);
    // The page's data for this post may arrive after the preview opened:
    // a Live Photo first taken for a plain picture becomes one.
    const item = active.gallery[active.index];
    if (item && !item.video && asVideo(item).video) {
      renderThumbs();
      renderImage();
    }
    active.post = context.post;
    renderCaption();
    position();
  });
  globalThis.__zizai_runtime = { pointerMoved, pointerDown, videoPress, settingsChanged, reset, keydown, ownsEvent, isOpen: () => Boolean(active), isFull: () => active?.mode === "full", notify: toast };
})();
