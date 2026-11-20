// Image URL handling follows the established preview rules for each image host.
(() => {
  const isHost = (host, suffix) => host === suffix || host.endsWith("." + suffix);
  function platform(host = location.hostname) {
    if (isHost(host, "okjike.com")) return "jike";
    if (isHost(host, "weibo.com") || isHost(host, "weibo.cn")) return "weibo";
    if (isHost(host, "x.com") || isHost(host, "twitter.com")) return "x";
    if (isHost(host, "instagram.com")) return "instagram";
    return "";
  }
  function mediaKey(value) {
    try {
      const url = new URL(value, location.href);
      const name = (url.pathname.split("/").pop() || "").replace(/@.*$/, "").replace(/\.[a-z0-9]+$/i, "");
      // Instagram's copies of one picture differ only by size marks in the
      // name (_s640x640, _p1080x1080, _e35); page-media.js uses the same rule.
      return isHost(url.hostname, "cdninstagram.com") || isHost(url.hostname, "fbcdn.net")
        ? name.replace(/_[esp]\d+(?:x\d+)?/g, "").replace(/_n$/, "") || name : name;
    } catch {
      return "";
    }
  }
  function candidates(value, format = "") {
    try {
      const url = new URL(value, location.href);
      if (!/^https?:$/.test(url.protocol)) return [url.href];
      if (isHost(url.hostname, "sinaimg.cn") || isHost(url.hostname, "sinaimg.com")) {
        const original = new URL(url.href);
        original.pathname = original.pathname.replace(
          /\/(?:thumb\d*|thumbnail|orj\d+|mw\d+|bmiddle|small|ssmw\d*|large|oslarge|square|original)\//i,
          "/original/"
        );
        const large = new URL(original.href);
        large.pathname = large.pathname.replace("/original/", "/large/");
        return [...new Set([original.href, large.href, url.href])];
      }
      // X serves every size of a photo from one path; name= picks the size.
      if (url.hostname === "pbs.twimg.com" && url.pathname.startsWith("/media/")) {
        const sized = name => {
          const next = new URL(url.href);
          next.searchParams.set("name", name);
          return next.href;
        };
        return [...new Set([sized("orig"), sized("4096x4096"), sized("large"), url.href])];
      }
      // Douban serves each picture in named sizes; "l" is the large one
      // (a poster: 270 wide on the page, 1080 at "l").
      if (isHost(url.hostname, "doubanio.com") && /^\/view\/[a-z_]+\/(?!l\/|raw\/)[a-z_]+\/(?:public|raw)\//.test(url.pathname)) {
        const large = new URL(url.href);
        large.pathname = large.pathname.replace(/^(\/view\/[a-z_]+\/)[a-z_]+\/(?:public|raw)\//, "$1l/public/");
        return [...new Set([large.href, url.href])];
      }
      // Pinterest: the width is the first folder; "originals" is the upload.
      if (url.hostname === "i.pinimg.com" && /^\/\d+x\d*\//.test(url.pathname)) {
        const sized = folder => {
          const next = new URL(url.href);
          next.pathname = next.pathname.replace(/^\/\d+x\d*\//, "/" + folder + "/");
          return next.href;
        };
        return [...new Set([sized("originals"), sized("736x"), url.href])];
      }
      if (["ruguoapp.com", "okjike.com", "jellow.club", "qiniu.com", "qiniucdn.com", "clouddn.com"]
          .some(suffix => isHost(url.hostname, suffix))) {
        const original = new URL(url.href);
        original.pathname = original.pathname.replace(/@[^/]+$/, "")
          .replace(/\/(?:thumbnail|resize|imageview2|imagemogr2|imagemogr)\/.*$/i, "");
        if (/(?:imageview2|imagemogr2|imagemogr|x-oss-process|thumbnail|resize)/i.test(original.search)) {
          original.search = "";
        } else {
          for (const key of ["w", "h", "width", "height", "resize", "quality", "q", "format", "auto", "crop", "fit"]) {
            original.searchParams.delete(key);
          }
        }
        const jpeg = new URL(original.href);
        jpeg.search = "imageMogr2/auto-orient/heic-exif/1/format/jpeg/quality/100";
        const heic = /heic/i.test(format + " " + url.pathname + url.search);
        return [...new Set(heic ? [jpeg.href, original.href, url.href] : [original.href, jpeg.href, url.href])];
      }
      return [url.href];
    } catch {
      return [value];
    }
  }
  // The largest picture a srcset lists ("a.jpg 808w, b.jpg 404w" or
  // "a.jpg 2x"), with its width or density. Commas inside an address
  // (some image hosts use them) stay part of the address.
  function largestInSrcset(text) {
    let best = null;
    for (const part of String(text || "").split(/,\s+(?=\S)/).slice(0, 24)) {
      const match = /^(\S+)(?:\s+(\d+(?:\.\d+)?)([wx]))?\s*$/.exec(part.trim());
      if (!match) continue;
      const size = Number(match[2] || 1);
      const unit = match[3] || "x";
      if (!best || unit === best.unit && size > best.size || unit === "w" && best.unit === "x") best = { url: match[1], size, unit };
    }
    return best;
  }
  globalThis.__zizai_site_images = { platform, mediaKey, candidates, isHost, largestInSrcset };
})();
