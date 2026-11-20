(() => {
  function parentElement(node) {
    return node.parentElement || node.getRootNode()?.host || null;
  }

  const PREVIEW_HIT_INSET = 6;
  const PREVIEW_PAGE_CONTROL_SELECTOR = 'button, [role="button"], [role="menuitem"], [role="tab"], [role="checkbox"], [role="switch"], input, select, textarea, summary, label, [contenteditable=""], [contenteditable="true"]';

  function previewRect(left, top, right, bottom) {
    return { left, top, right, bottom, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
  }

  function previewIntersectRect(a, b) {
    if (!a || !b) {
      return null;
    }
    const left = Math.max(a.left, b.left);
    const top = Math.max(a.top, b.top);
    const right = Math.min(a.right, b.right);
    const bottom = Math.min(a.bottom, b.bottom);
    return right - left >= 1 && bottom - top >= 1 ? previewRect(left, top, right, bottom) : null;
  }

  function previewHitInsetFor(rect) {
    if (!rect) {
      return 0;
    }
    // Small pictures keep most of their area hoverable: never more than 1/6 per side.
    return Math.max(0, Math.min(PREVIEW_HIT_INSET, rect.width / 6, rect.height / 6));
  }

  function previewInsetRect(rect, inset) {
    if (!rect) {
      return null;
    }
    const d = Math.max(0, Number(inset) || 0);
    return previewRect(rect.left + d, rect.top + d, rect.right - d, rect.bottom - d);
  }

  function previewPointInRect(point, rect) {
    return Boolean(point && rect
      && point.x >= rect.left && point.x <= rect.right
      && point.y >= rect.top && point.y <= rect.bottom);
  }

  function previewParsePositionAxis(token, free) {
    const value = String(token || "50%").trim();
    if (value === "left" || value === "top") {
      return 0;
    }
    if (value === "right" || value === "bottom") {
      return free;
    }
    if (value === "center") {
      return free / 2;
    }
    if (value.endsWith("%")) {
      return free * (parseFloat(value) / 100 || 0);
    }
    const px = parseFloat(value);
    return Number.isFinite(px) ? px : free / 2;
  }

  // Where the picture's pixels are drawn inside its content box for object-fit.
  function previewObjectFitRect(box, naturalWidth, naturalHeight, fit = "fill", position = "50% 50%") {
    if (!box || !(naturalWidth > 0) || !(naturalHeight > 0)) {
      return box;
    }
    const mode = String(fit || "fill").trim();
    if (mode !== "contain" && mode !== "scale-down" && mode !== "none") {
      return box; // fill / cover paint the whole box (cover crops, still edge to edge)
    }
    const containScale = Math.min(box.width / naturalWidth, box.height / naturalHeight);
    let scale = containScale;
    if (mode === "none") {
      scale = 1;
    } else if (mode === "scale-down") {
      scale = Math.min(1, containScale);
    }
    const width = naturalWidth * scale;
    const height = naturalHeight * scale;
    const parts = String(position || "50% 50%").trim().split(/\s+/);
    let xToken = parts[0] || "50%";
    let yToken = parts[1] || "50%";
    if (xToken === "top" || xToken === "bottom") {
      [xToken, yToken] = [yToken || "50%", xToken];
    }
    const left = box.left + previewParsePositionAxis(xToken, box.width - width);
    const top = box.top + previewParsePositionAxis(yToken, box.height - height);
    return previewIntersectRect(box, previewRect(left, top, left + width, top + height));
  }

  function previewElementBoxes(element, style) {
    const rect = element.getBoundingClientRect();
    const n = (value) => parseFloat(value) || 0;
    const border = previewRect(rect.left, rect.top, rect.right, rect.bottom);
    const padding = previewRect(
      rect.left + n(style.borderLeftWidth),
      rect.top + n(style.borderTopWidth),
      rect.right - n(style.borderRightWidth),
      rect.bottom - n(style.borderBottomWidth)
    );
    const content = previewRect(
      padding.left + n(style.paddingLeft),
      padding.top + n(style.paddingTop),
      padding.right - n(style.paddingRight),
      padding.bottom - n(style.paddingBottom)
    );
    return { border, padding, content };
  }

  // The box an element itself paints a picture into, or null if it paints none.
  function previewOwnPictureBox(element) {
    if (!(element instanceof Element)) {
      return null;
    }
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") {
      return null;
    }
    const boxes = previewElementBoxes(element, style);
    if (element instanceof HTMLImageElement) {
      return previewObjectFitRect(boxes.content, element.naturalWidth, element.naturalHeight, style.objectFit, style.objectPosition);
    }
    // A video paints its frames (or poster) letterboxed in its box; before
    // its size is known, the whole box counts.
    if (typeof HTMLVideoElement === "function" && element instanceof HTMLVideoElement) {
      return element.videoWidth
        ? previewObjectFitRect(boxes.content, element.videoWidth, element.videoHeight, style.objectFit || "contain", style.objectPosition)
        : boxes.content;
    }
    if (/url\(/i.test(style.backgroundImage || "")) {
      const clip = String(style.backgroundClip || "border-box");
      if (clip.includes("content-box")) {
        return boxes.content;
      }
      return clip.includes("padding-box") ? boxes.padding : boxes.border;
    }
    return null;
  }

  // For a wrapper (link, grid cell, <picture>): the largest picture painted inside it.
  // overflow ancestor and by the viewport.
  function previewVisiblePictureRect(element) {
    let visible = previewOwnPictureBox(element);
    let node = parentElement(element);
    for (let depth = 0; node && visible && depth < 32; depth += 1) {
      if (node === document.body || node === document.documentElement) {
        break;
      }
      const style = window.getComputedStyle(node);
      const clipX = style.overflowX && style.overflowX !== "visible";
      const clipY = style.overflowY && style.overflowY !== "visible";
      if (clipX || clipY) {
        const pad = previewElementBoxes(node, style).padding;
        visible = previewIntersectRect(visible, previewRect(
          clipX ? pad.left : -Infinity,
          clipY ? pad.top : -Infinity,
          clipX ? pad.right : Infinity,
          clipY ? pad.bottom : Infinity
        ));
      }
      if (style.position === "fixed") {
        break;
      }
      node = parentElement(node);
    }
    const viewport = previewRect(0, 0, window.innerWidth || 0, window.innerHeight || 0);
    return previewIntersectRect(visible, viewport);
  }

  function previewPointOverPageControl(point, element, isPictureSurface) {
    if (!point || typeof document.elementFromPoint !== "function") {
      return false;
    }
    const top = document.elementFromPoint(point.x, point.y);
    if (!(top instanceof Element) || top.id === "__zizai_overlay") {
      return false;
    }
    const control = top.closest(PREVIEW_PAGE_CONTROL_SELECTOR);
    return Boolean(control && !control.contains(element) && !isPictureSurface?.(control, element));
  }

  // "inside" → may open; "edge" → on the picture but within the inset band
  // (keeps an already-open preview of it, never opens); "control" → a page button
  // is on top; "outside" → not on the picture's pixels at all.
  function previewPointerPictureHit(element, point, isPictureSurface) {
    if (!point) {
      return "inside";
    }
    if (!(element instanceof Element)) {
      return "outside";
    }
    const visible = previewVisiblePictureRect(element);
    if (!visible || !previewPointInRect(point, visible)) {
      return "outside";
    }
    if (previewPointOverPageControl(point, element, isPictureSurface)) {
      return "control";
    }
    const inner = previewInsetRect(visible, previewHitInsetFor(visible));
    return previewPointInRect(point, inner) ? "inside" : "edge";
  }
  function fitSizeWithinBox(width, height, maxWidth, maxHeight) {
    const safeWidth = Math.max(width, 1);
    const safeHeight = Math.max(height, 1);
    const scale = Math.min(maxWidth / safeWidth, maxHeight / safeHeight, 1);
    return {
      width: safeWidth * scale,
      height: safeHeight * scale
    };
  }

  globalThis.__zizai_geometry = { previewPointerPictureHit, previewVisiblePictureRect, fitSizeWithinBox };
})();
