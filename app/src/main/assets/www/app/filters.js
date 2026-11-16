// Canvas image filters for tracing modes: original | sketch | edge | (+invert flag).
// All operate on a normalized copy of the source image.

const Filters = (() => {
  function toCanvas(img, maxDim) {
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c;
  }

  function grayscale(d) {
    const p = d.data;
    for (let i = 0; i < p.length; i += 4) {
      const g = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
      p[i] = p[i + 1] = p[i + 2] = g;
    }
    return d;
  }

  // separable box blur on a single-channel Float32 array
  function blur(gray, w, h, r) {
    const tmp = new Float32Array(gray.length);
    const out = new Float32Array(gray.length);
    const n = 2 * r + 1;
    for (let y = 0; y < h; y++) {
      let acc = 0;
      const row = y * w;
      for (let x = -r; x <= r; x++) acc += gray[row + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        tmp[row + x] = acc / n;
        acc += gray[row + Math.min(w - 1, x + r + 1)] - gray[row + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = acc / n;
        acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
      }
    }
    return out;
  }

  function grayOf(d) {
    const p = d.data;
    const g = new Float32Array(p.length / 4);
    for (let i = 0, j = 0; i < p.length; i += 4, j++)
      g[j] = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
    return g;
  }

  // Pencil sketch: color-dodge of grayscale over inverted blurred grayscale.
  function sketch(srcCanvas) {
    const w = srcCanvas.width, h = srcCanvas.height;
    const ctx = srcCanvas.getContext('2d');
    const d = ctx.getImageData(0, 0, w, h);
    const g = grayOf(d);
    const inv = new Float32Array(g.length);
    for (let i = 0; i < g.length; i++) inv[i] = 255 - g[i];
    const b = blur(inv, w, h, Math.max(2, Math.round(w / 400)));
    const p = d.data;
    for (let i = 0, j = 0; i < p.length; i += 4, j++) {
      const v = Math.min(255, (g[j] * 255) / Math.max(1, 255 - b[j]));
      p[i] = p[i + 1] = p[i + 2] = v;
    }
    ctx.putImageData(d, 0, 0);
    return srcCanvas;
  }

  // Edge lines: slight blur -> Sobel magnitude -> threshold -> white lines on black.
  function edge(srcCanvas) {
    const w = srcCanvas.width, h = srcCanvas.height;
    const ctx = srcCanvas.getContext('2d');
    const d = ctx.getImageData(0, 0, w, h);
    const g = blur(grayOf(d), w, h, 1);
    const p = d.data;
    let max = 0;
    const mag = new Float32Array(g.length);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const gx =
          -g[i - w - 1] - 2 * g[i - 1] - g[i + w - 1] +
          g[i - w + 1] + 2 * g[i + 1] + g[i + w + 1];
        const gy =
          -g[i - w - 1] - 2 * g[i - w] - g[i - w + 1] +
          g[i + w - 1] + 2 * g[i + w] + g[i + w + 1];
        const m = Math.sqrt(gx * gx + gy * gy);
        mag[i] = m;
        if (m > max) max = m;
      }
    }
    const t = Math.max(40, max * 0.18);
    for (let i = 0, j = 0; i < p.length; i += 4, j++) {
      const v = mag[j] > t ? 255 : 0;
      p[i] = p[i + 1] = p[i + 2] = v;
    }
    ctx.putImageData(d, 0, 0);
    return srcCanvas;
  }

  function invert(srcCanvas) {
    const ctx = srcCanvas.getContext('2d');
    const d = ctx.getImageData(0, 0, srcCanvas.width, srcCanvas.height);
    const p = d.data;
    for (let i = 0; i < p.length; i += 4) {
      p[i] = 255 - p[i];
      p[i + 1] = 255 - p[i + 1];
      p[i + 2] = 255 - p[i + 2];
    }
    ctx.putImageData(d, 0, 0);
    return srcCanvas;
  }

  // mode: original|sketch|edge ; invert flag flips the final result.
  function render(img, mode, doInvert, maxDim = 1920) {
    const c = toCanvas(img, maxDim);
    if (mode === 'sketch') sketch(c);
    else if (mode === 'edge') edge(c);
    if (doInvert) invert(c);
    return c;
  }

  return { render };
})();
