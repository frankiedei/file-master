let FORMATS = {};
const EXT_TYPE = {};

fetch('/api/formats').then(r => r.json()).then(f => {
  FORMATS = f;
  for (const [type, exts] of Object.entries(f)) exts.forEach(e => { EXT_TYPE[e] = type; });
  Object.assign(EXT_TYPE, {
    jpeg: 'image', heic: 'image', ico: 'image', svg: 'image',
    mpeg: 'video', mpg: 'video', wmv: 'video', flv: 'video', ts: 'video', m4v: 'video', '3gp': 'video',
    oga: 'audio', mka: 'audio', amr: 'audio', ac3: 'audio',
    markdown: 'text', htm: 'text', org: 'text', textile: 'text', csv: 'text',
  });
});

const $ = s => document.querySelector(s);

// ---------- tabs ----------
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.tab-panel').forEach(p =>
      p.classList.toggle('active', p.id === 'tab-' + btn.dataset.tab));
  });
});

// ---------- converter queue ----------
const queue = []; // { key, name, type, source: File|url, target, state, resultId, resultName, error }
let keySeq = 0;

const dropzone = $('#dropzone');
const fileInput = $('#fileInput');

dropzone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => { addFiles([...fileInput.files]); fileInput.value = ''; });
['dragover', 'dragenter'].forEach(ev => dropzone.addEventListener(ev, e => {
  e.preventDefault(); dropzone.classList.add('over');
}));
['dragleave', 'drop'].forEach(ev => dropzone.addEventListener(ev, e => {
  e.preventDefault(); dropzone.classList.remove('over');
}));
dropzone.addEventListener('drop', e => addFiles([...e.dataTransfer.files]));

$('#urlAdd').addEventListener('click', addUrl);
$('#urlInput').addEventListener('keydown', e => { if (e.key === 'Enter') addUrl(); });

function extOf(name) {
  const m = name.match(/\.([a-z0-9]+)(?:\?.*)?$/i);
  return m ? m[1].toLowerCase() : '';
}

function addFiles(list) {
  for (const f of list) {
    const type = EXT_TYPE[extOf(f.name)];
    queue.push({
      key: ++keySeq, name: f.name, type: type || null, source: f,
      target: type ? defaultTarget(type, extOf(f.name)) : null,
      state: type ? 'ready' : 'unsupported',
    });
  }
  render();
}

function addUrl() {
  const url = $('#urlInput').value.trim();
  if (!url) return;
  let name;
  try { name = decodeURIComponent(new URL(url).pathname.split('/').pop()) || url; }
  catch { alert('That doesn’t look like a valid URL'); return; }
  const type = EXT_TYPE[extOf(name)] || null;
  queue.push({
    key: ++keySeq, name, type, source: url,
    target: type ? defaultTarget(type, extOf(name)) : (FORMATS.image ? 'png' : null),
    state: 'ready', isUrl: true,
  });
  $('#urlInput').value = '';
  render();
}

function defaultTarget(type, srcExt) {
  const prefs = { audio: 'mp3', video: 'mp4', image: 'png', text: 'docx' };
  let t = prefs[type];
  if (t === srcExt) t = FORMATS[type].find(f => f !== srcExt);
  return t;
}

function targetOptions(item) {
  // URL items with unknown type get every format to choose from
  const types = item.type ? [item.type] : Object.keys(FORMATS);
  let html = '';
  for (const t of types) {
    const opts = FORMATS[t].filter(f => f !== extOf(item.name))
      .map(f => `<option value="${f}" ${f === item.target ? 'selected' : ''}>${f.toUpperCase()}</option>`).join('');
    html += types.length > 1 ? `<optgroup label="${t}">${opts}</optgroup>` : opts;
  }
  return html;
}

function render() {
  const q = $('#queue');
  q.innerHTML = '';
  queue.forEach((item, i) => {
    const el = document.createElement('div');
    el.className = 'glass qitem';
    el.draggable = true;
    el.dataset.key = item.key;

    const statusIc =
      item.state === 'working' ? '<span class="spin"></span>' :
      item.state === 'done' ? '✅' :
      item.state === 'error' ? '❌' :
      item.state === 'unsupported' ? '🚫' : '';

    el.innerHTML = `
      <span class="grip" title="Drag to reorder">⠿</span>
      <span class="num">${i + 1}</span>
      <div class="info">
        <div class="fname">${esc(item.state === 'done' ? item.resultName : item.name)}</div>
        <div class="fmeta">${item.state === 'error' ? esc(item.error) :
          item.state === 'unsupported' ? 'Unsupported file type' :
          item.isUrl ? 'from link' : item.type || ''}</div>
      </div>
      ${item.type || item.isUrl ? `<span class="badge">${item.type || '?'}</span>` : ''}
      ${item.state === 'ready' || item.state === 'error'
        ? `<select class="fmt-select" data-key="${item.key}">${targetOptions(item)}</select>` : ''}
      <span class="status-ic">${statusIc}</span>
      ${item.state === 'done' ? `<a class="dl" href="/api/file/${item.resultId}" download>Download</a>` : ''}
      <button class="remove" data-key="${item.key}" title="Remove">×</button>
    `;
    q.appendChild(el);
  });

  q.querySelectorAll('.fmt-select').forEach(sel => sel.addEventListener('change', () => {
    const item = queue.find(x => x.key == sel.dataset.key);
    if (item) item.target = sel.value;
  }));
  q.querySelectorAll('.remove').forEach(btn => btn.addEventListener('click', () => {
    const idx = queue.findIndex(x => x.key == btn.dataset.key);
    if (idx >= 0) queue.splice(idx, 1);
    render();
  }));

  // drag-to-reorder
  q.querySelectorAll('.qitem').forEach(el => {
    el.addEventListener('dragstart', e => {
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    el.addEventListener('dragend', () => { el.classList.remove('dragging'); syncOrder(); });
    el.addEventListener('dragover', e => {
      e.preventDefault();
      const dragging = q.querySelector('.dragging');
      if (!dragging || dragging === el) return;
      const rect = el.getBoundingClientRect();
      const after = e.clientY > rect.top + rect.height / 2;
      q.insertBefore(dragging, after ? el.nextSibling : el);
    });
  });

  const actions = $('#queueActions');
  actions.hidden = queue.length === 0;
  const doneCount = queue.filter(x => x.state === 'done').length;
  $('#downloadZip').hidden = doneCount < 1;
  $('#convertAll').disabled = !queue.some(x => x.state === 'ready' || x.state === 'error');
}

function syncOrder() {
  const orderedKeys = [...$('#queue').children].map(el => Number(el.dataset.key));
  queue.sort((a, b) => orderedKeys.indexOf(a.key) - orderedKeys.indexOf(b.key));
  render();
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

$('#clearQueue').addEventListener('click', () => { queue.length = 0; render(); });

$('#convertAll').addEventListener('click', async () => {
  const pending = queue.filter(x => x.state === 'ready' || x.state === 'error');
  pending.forEach(x => { x.state = 'working'; x.error = null; });
  render();
  await Promise.all(pending.map(convertOne));
  render();
});

async function convertOne(item) {
  try {
    let resp;
    if (item.isUrl) {
      resp = await fetch('/api/convert-url', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: item.source, target: item.target }),
      });
    } else {
      const fd = new FormData();
      fd.append('file', item.source);
      fd.append('target', item.target);
      resp = await fetch('/api/convert', { method: 'POST', body: fd });
    }
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Conversion failed');
    item.state = 'done';
    item.resultId = data.id;
    item.resultName = data.name;
  } catch (e) {
    item.state = 'error';
    item.error = e.message;
  }
  render();
}

$('#downloadZip').addEventListener('click', async () => {
  const ids = queue.filter(x => x.state === 'done').map(x => x.resultId);
  if (!ids.length) return;
  const resp = await fetch('/api/zip', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  const blob = await resp.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'converted.zip';
  a.click();
  URL.revokeObjectURL(a.href);
});

// ---------- song finder ----------
$('#searchBtn').addEventListener('click', searchSongs);
['#artistInput', '#songInput'].forEach(s =>
  $(s).addEventListener('keydown', e => { if (e.key === 'Enter') searchSongs(); }));

function setStatus(msg, isError = false) {
  const el = $('#songStatus');
  if (!msg) { el.hidden = true; return; }
  el.hidden = false;
  el.className = 'status' + (isError ? ' error' : '');
  el.innerHTML = msg;
}

async function searchSongs() {
  const artist = $('#artistInput').value.trim();
  const song = $('#songInput').value.trim();
  if (!artist && !song) return;
  setStatus('<span class="spin"></span>Searching…');
  $('#results').innerHTML = '';
  try {
    const resp = await fetch(`/api/search?artist=${encodeURIComponent(artist)}&song=${encodeURIComponent(song)}`);
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Search failed');
    if (!data.results.length) { setStatus('No results found.'); return; }
    setStatus(null);
    renderResults(data.results);
  } catch (e) {
    setStatus('Search failed: ' + esc(e.message), true);
  }
}

function renderResults(results) {
  const grid = $('#results');
  grid.innerHTML = '';
  results.forEach(r => {
    const card = document.createElement('div');
    card.className = 'glass card';
    const dur = r.duration ? `${Math.floor(r.duration / 60)}:${String(r.duration % 60).padStart(2, '0')}` : '';
    card.innerHTML = `
      ${r.cover ? `<img src="${esc(r.cover)}" alt="" loading="lazy">` : ''}
      <div class="cbody">
        <div class="ctitle">${esc(r.track)}</div>
        <div class="cmeta">${esc(r.artist)}${r.album ? ' · ' + esc(r.album) : ''}${r.year ? ' · ' + r.year : ''}${dur ? ' · ' + dur : ''}</div>
        <div class="cdl">↓ Download ${$('#songFormat').value.toUpperCase()}</div>
      </div>`;
    card.addEventListener('click', e => {
      if (e.target.closest('a')) return; // let the "check video" link work
      downloadSong(r, card);
    });
    grid.appendChild(card);
  });
}

async function downloadSong(r, card) {
  const format = $('#songFormat').value;
  card.classList.add('busy');
  const dl = card.querySelector('.cdl');
  dl.innerHTML = '<span class="spin"></span>Downloading…';
  try {
    const resp = await fetch('/api/song', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ artist: r.artist, track: r.track, album: r.album, cover: r.cover,
        duration: r.duration, url: $('#ytUrl').value.trim() || undefined, format }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Download failed');
    $('#ytUrl').value = ''; // the link override is one-shot
    const a = document.createElement('a');
    a.href = `/api/file/${data.id}`;
    a.download = data.name;
    a.click();
    dl.innerHTML = '✅ Downloaded' + (data.via
      ? ` · <a href="${esc(data.via.url)}" target="_blank" title="${esc(data.via.title || '')} — ${esc(data.via.channel || '')}">check video</a>`
      : '');
  } catch (e) {
    dl.textContent = '❌ ' + e.message;
  } finally {
    card.classList.remove('busy');
  }
}

// ---------- bulk download ----------
const bulkIds = [];

$('#bulkBtn').addEventListener('click', async () => {
  const lines = $('#bulkInput').value.split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return;
  const format = $('#songFormat').value;
  const list = $('#bulkList');
  list.innerHTML = '';
  bulkIds.length = 0;
  $('#bulkZipBtn').hidden = true;
  $('#bulkBtn').disabled = true;

  const rows = lines.map(line => {
    const row = document.createElement('div');
    row.className = 'bulk-row';
    row.innerHTML = '<span class="bl-name"></span><span class="bl-status">Queued</span>';
    row.querySelector('.bl-name').textContent = line;
    list.appendChild(row);
    return row;
  });

  for (let i = 0; i < lines.length; i++) {
    const status = rows[i].querySelector('.bl-status');
    // Optional "| YouTube link" at the end forces that exact video
    const urlMatch = lines[i].match(/https?:\/\/\S+/);
    const url = urlMatch ? urlMatch[0] : undefined;
    const meta = lines[i].replace(/https?:\/\/\S+/, '').replace(/\|/g, '').trim();
    // "Artist - Title" (also – or —); no separator = treat the line as a title
    const parts = meta.split(/\s+[-–—]\s+/);
    const artist = parts.length > 1 ? parts[0] : '';
    const song = parts.length > 1 ? parts.slice(1).join(' - ') : meta;
    try {
      if (!meta) throw new Error('Add "Artist - Title" before the link');
      status.innerHTML = '<span class="spin"></span>Searching…';
      const sr = await fetch(`/api/search?artist=${encodeURIComponent(artist)}&song=${encodeURIComponent(song)}`)
        .then(r => r.json());
      const hit = (sr.results && sr.results[0]) || { artist, track: song };
      status.innerHTML = '<span class="spin"></span>Downloading…';
      const resp = await fetch('/api/song', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artist: hit.artist, track: hit.track, album: hit.album,
          cover: hit.cover, duration: hit.duration, url, format }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Download failed');
      bulkIds.push(data.id);
      status.innerHTML = `✅ <a href="/api/file/${data.id}" download>${data.name}</a>`;
      if (data.via) {
        const via = document.createElement('div');
        via.className = 'bl-via';
        via.innerHTML = `via <a href="${esc(data.via.url)}" target="_blank"></a>`;
        via.querySelector('a').textContent =
          `${data.via.title || data.via.url}${data.via.channel ? ' — ' + data.via.channel : ''}`;
        rows[i].appendChild(via);
      }
    } catch (e) {
      status.textContent = '❌ ' + e.message;
    }
  }

  $('#bulkBtn').disabled = false;
  $('#bulkZipBtn').hidden = bulkIds.length === 0;
});

$('#bulkZipBtn').addEventListener('click', async () => {
  const resp = await fetch('/api/zip', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: bulkIds }),
  });
  const blob = await resp.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'songs.zip';
  a.click();
  URL.revokeObjectURL(a.href);
});

// ---------- power button: shut down the backend ----------
$('#powerBtn').addEventListener('click', async () => {
  if (!confirm('Shut down the File Master server?')) return;
  try { await fetch('/api/shutdown', { method: 'POST' }); } catch {}
  document.body.innerHTML = `
    <div class="bg"><div class="blob b1"></div><div class="blob b2"></div><div class="blob b3"></div></div>
    <main><div class="glass off-screen">
      <h1>Server stopped</h1>
      <p>File Master has shut down. Run <code>file-master</code> (or <code>npm start</code>) to start it again.</p>
    </div></main>`;
});
