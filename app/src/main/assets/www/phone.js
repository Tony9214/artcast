// ArtCast phone page: upload, mode control, history.

const $ = (s) => document.querySelector(s);
const file = $('#file'), preview = $('#preview');
let state = null;

async function jget(u) { return (await fetch(u)).json(); }
async function jpost(u, body) {
  return fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

async function refresh() {
  state = await jget('/api/state');
  renderState();
  renderHistory(await jget('/api/history'));
}

function renderState() {
  document.querySelectorAll('#modes button').forEach((b) =>
    b.classList.toggle('active', b.dataset.mode === state.mode));
  $('#grid').textContent = `网格 ${state.grid.on ? '开' : '关'}`;
  $('#grid').classList.toggle('active', state.grid.on);
  $('#invert').textContent = `反色 ${state.invert ? '开' : '关'}`;
  $('#invert').classList.toggle('active', state.invert);
  $('#grid-n').textContent = `网格密度 ${state.grid.n}`;
}

async function upload(f) {
  preview.style.backgroundImage = `url(${URL.createObjectURL(f)})`;
  preview.classList.add('has-img');
  preview.textContent = '上传中…';
  const r = await fetch(`/api/image?name=${encodeURIComponent(f.name)}`, { method: 'PUT', body: f });
  preview.textContent = r.ok ? '' : '上传失败';
  refresh();
}

preview.addEventListener('click', () => file.click());
file.addEventListener('change', () => file.files[0] && upload(file.files[0]));
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => { e.preventDefault(); e.dataTransfer.files[0] && upload(e.dataTransfer.files[0]); });

document.querySelectorAll('#modes button').forEach((b) =>
  b.addEventListener('click', () => jpost('/api/state', { mode: b.dataset.mode }).then(refresh)));

$('#grid').addEventListener('click', () => jpost('/api/state', { grid: { ...state.grid, on: !state.grid.on } }).then(refresh));
$('#invert').addEventListener('click', () => jpost('/api/state', { invert: !state.invert }).then(refresh));
$('#grid-n').addEventListener('click', () => {
  const n = state.grid.n >= 10 ? 2 : state.grid.n + 1;
  jpost('/api/state', { grid: { ...state.grid, n } }).then(refresh);
});
$('#reset').addEventListener('click', () =>
  jpost('/api/state', { corners: [[0, 0], [1, 0], [1, 1], [0, 1]] }).then(refresh));

function renderHistory(list) {
  const box = $('#history');
  box.innerHTML = '';
  if (!list.length) {
    box.innerHTML = '<div class="empty">暂无历史</div>';
    return;
  }
  for (const item of list) {
    const d = document.createElement('div');
    d.className = 'hist' + (item.id === state.imageId ? ' current' : '');
    d.innerHTML = `<img src="/api/image/${item.id}" loading="lazy"><button class="del">×</button>`;
    d.querySelector('img').addEventListener('click', () =>
      jpost('/api/state', { imageId: item.id }).then(refresh));
    d.querySelector('.del').addEventListener('click', async (e) => {
      e.stopPropagation();
      await fetch(`/api/history/${item.id}`, { method: 'DELETE' });
      refresh();
    });
    box.appendChild(d);
  }
}

refresh();
setInterval(refresh, 3000);
