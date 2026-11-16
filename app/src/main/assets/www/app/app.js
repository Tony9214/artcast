// ArtCast projector page: state sync, keystone warp, filters, D-pad editing.

const $ = (s) => document.querySelector(s);
const view = $('#view'), gridCv = $('#grid'), overlay = $('#overlay');
const stage = $('#stage'), qrScreen = $('#qr'), help = $('#help');

const api = {
  async info() { return (await fetch('/api/info')).json(); },
  async state() { return (await fetch('/api/state')).json(); },
  async patch(patch) {
    return fetch('/api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
  },
};

const DEFAULT_CORNERS = [[0, 0], [1, 0], [1, 1], [0, 1]];

let state = null;          // server state
let img = null;            // HTMLImageElement of current image
let imgId = null;
const filterCache = {};    // `${mode}|${inv}` -> canvas
let selCorner = 0;
let editing = false;       // show handles/help
let hideTimer = 0;
let lastKey = '', lastKeyTime = 0, repeat = 0;
let dirtyCorners = false, saveTimer = 0;

// ---------- rendering ----------

function applyWarp() {
  if (!img) return;
  const vw = stage.clientWidth, vh = stage.clientHeight;
  const t = cssWarp(view.width, view.height, state.corners, vw, vh);
  view.style.transform = t;
  gridCv.style.transform = t;
  drawOverlay();
}

function drawOverlay() {
  const vw = stage.clientWidth, vh = stage.clientHeight;
  overlay.width = vw; overlay.height = vh;
  const ctx = overlay.getContext('2d');
  ctx.clearRect(0, 0, vw, vh);
  if (!img || !editing) return;
  const pts = state.corners.map(([x, y]) => [x * vw, y * vh]);
  ctx.strokeStyle = 'rgba(255,215,110,.7)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(...pts[0]);
  pts.slice(1).forEach((p) => ctx.lineTo(...p));
  ctx.closePath();
  ctx.stroke();
  pts.forEach(([x, y], i) => {
    const sel = i === selCorner;
    ctx.beginPath();
    ctx.arc(x, y, sel ? 14 : 8, 0, Math.PI * 2);
    ctx.fillStyle = sel ? 'rgba(255,80,60,.9)' : 'rgba(255,255,255,.85)';
    ctx.fill();
    ctx.fillStyle = '#000';
    ctx.font = `bold ${sel ? 14 : 10}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), x, y);
  });
}

function drawGrid() {
  const ctx = gridCv.getContext('2d');
  ctx.clearRect(0, 0, gridCv.width, gridCv.height);
  if (!state.grid.on) return;
  const w = gridCv.width, h = gridCv.height, n = state.grid.n;
  ctx.lineWidth = Math.max(1, w / 800);
  const line = (x1, y1, x2, y2) => {
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(0,0,0,.8)'; ctx.lineWidth *= 1; ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  };
  for (let i = 1; i < n; i++) {
    const x = (w * i) / n, y = (h * i) / n;
    // black underlay then white line for contrast on any image
    ctx.strokeStyle = 'rgba(0,0,0,.9)'; ctx.lineWidth = Math.max(2, w / 500);
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = Math.max(1, w / 1000);
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }
}

async function loadImage(id) {
  const el = new Image();
  el.src = `/api/image/${id}`;
  await el.decode();
  img = el; imgId = id;
  for (const k of Object.keys(filterCache)) delete filterCache[k];
}

function renderMode() {
  if (!img) { view.style.display = 'none'; return; }
  view.style.display = 'block';
  const key = `${state.mode}|${state.invert ? 1 : 0}`;
  if (!filterCache[key]) filterCache[key] = Filters.render(img, state.mode, state.invert);
  const c = filterCache[key];
  view.width = c.width; view.height = c.height;
  view.getContext('2d').drawImage(c, 0, 0);
  gridCv.width = c.width; gridCv.height = c.height;
  drawGrid();
  applyWarp();
}

// ---------- state sync ----------

function stateEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

async function syncNow() {
  let s;
  try { s = await api.state(); } catch { return; }
  const prev = state;
  if (prev && stateEqual(prev, s)) return;
  const editingCorners = editing && Date.now() - lastKeyTime < 1200;
  if (prev && editingCorners && stateEqual({ ...prev, corners: 0 }, { ...s, corners: 0 })) {
    // only corners changed remotely while user is editing: keep ours
    s.corners = prev.corners;
  }
  state = s;
  if (s.imageId && s.imageId !== imgId) await loadImage(s.imageId);
  if (!s.imageId) { img = null; imgId = null; }
  renderMode();
  updateQrVisibility();
}

function updateQrVisibility() {
  qrScreen.style.display = (!img || qrForced) ? 'flex' : 'none';
}

let qrForced = false;

// ---------- input ----------

function showEditing() {
  editing = true;
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => { editing = false; drawOverlay(); help.style.opacity = 0; }, 5000);
  help.style.opacity = 1;
  drawOverlay();
}

function nudge(dx, dy) {
  if (!img) return;
  const now = Date.now();
  const key = `${dx},${dy}`;
  if (key === lastKey && now - lastKeyTime < 400) repeat = Math.min(repeat + 1, 60);
  else repeat = 0;
  lastKey = key; lastKeyTime = now;
  const step = 1 + Math.floor(repeat / 6); // accelerate while held
  const vw = stage.clientWidth, vh = stage.clientHeight;
  const c = state.corners[selCorner];
  c[0] = Math.min(1.5, Math.max(-0.5, c[0] + (dx * step) / vw));
  c[1] = Math.min(1.5, Math.max(-0.5, c[1] + (dy * step) / vh));
  dirtyCorners = true;
  showEditing();
  applyWarp();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persistCorners, 600);
}

async function persistCorners() {
  if (!dirtyCorners) return;
  dirtyCorners = false;
  await api.patch({ corners: state.corners }).catch(() => { dirtyCorners = true; });
}

window.addEventListener('keydown', (e) => {
  const k = e.key;
  if (k.startsWith('Arrow')) {
    e.preventDefault();
    const d = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[k];
    const mult = e.shiftKey ? 20 : 1;
    nudge(d[0] * mult, d[1] * mult);
    return;
  }
  switch (k) {
    case 'Enter':
      selCorner = (selCorner + 1) % 4;
      lastKeyTime = Date.now();
      showEditing();
      break;
    case '1': setMode('original'); break;
    case '2': setMode('sketch'); break;
    case '3': setMode('edge'); break;
    case 'g': case 'G': patchLocal({ grid: { ...state.grid, on: !state.grid.on } }); break;
    case 'i': case 'I': patchLocal({ invert: !state.invert }); break;
    case 'r': case 'R':
      state.corners = DEFAULT_CORNERS.map((p) => [...p]);
      dirtyCorners = true; persistCorners(); applyWarp(); showEditing();
      break;
    case 'q': case 'Q':
      qrForced = !qrForced; updateQrVisibility();
      break;
    case 'h': case 'H':
      editing = !editing;
      if (editing) showEditing(); else { drawOverlay(); help.style.opacity = 0; }
      break;
    case 'f': case 'F':
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen?.();
      break;
  }
});

async function setMode(mode) {
  if (!state) return;
  patchLocal({ mode });
}

async function patchLocal(patch) {
  Object.assign(state, patch);
  if (patch.grid) state.grid = patch.grid;
  renderMode();
  await api.patch(patch).catch(() => {});
}

// ---------- QR / boot ----------

async function initQr() {
  try {
    const info = await api.info();
    const url = info.uploadUrl;
    const q = qrcode(0, 'M');
    q.addData(url); q.make();
    $('#qr-img').innerHTML = q.createSvgTag(6, 2);
    $('#qr-url').textContent = url;
  } catch {
    $('#qr-url').textContent = 'server unavailable';
  }
}

window.__artcastNotify = () => syncNow();
window.addEventListener('resize', applyWarp);

(async () => {
  await initQr();
  await syncNow();
  setInterval(syncNow, 1500);
  // allow drag&drop for desktop dev
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (!f) return;
    await fetch(`/api/image?name=${encodeURIComponent(f.name)}`, { method: 'PUT', body: f });
    syncNow();
  });
})();
