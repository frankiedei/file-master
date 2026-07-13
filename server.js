const express = require('express');
const sharp = require('sharp');
const multer = require('multer');
const archiver = require('archiver');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const app = express();
const PORT = Number(process.env.PORT) || 3456;

const WORK_DIR = path.join(os.tmpdir(), 'file-master');
fs.mkdirSync(WORK_DIR, { recursive: true });
const PID_FILE = path.join(WORK_DIR, `server-${PORT}.pid`);

const upload = multer({
  dest: path.join(WORK_DIR, 'uploads'),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 },
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// id -> { path, name } for converted files awaiting download/zip
const files = new Map();

const FORMATS = {
  audio: ['mp3', 'm4a', 'wav', 'flac', 'aac', 'ogg', 'opus', 'aiff', 'wma'],
  video: ['mp4', 'webm', 'mov', 'mkv', 'avi', 'gif'],
  image: ['jpg', 'png', 'webp', 'gif', 'bmp', 'tiff', 'avif'],
  text: ['md', 'html', 'docx', 'txt', 'rtf', 'odt', 'epub', 'tex', 'json', 'rst'],
};

const EXT_TYPE = {};
for (const [type, exts] of Object.entries(FORMATS)) {
  for (const ext of exts) EXT_TYPE[ext] = type;
}
Object.assign(EXT_TYPE, {
  jpeg: 'image', heic: 'image', ico: 'image', svg: 'image',
  mpeg: 'video', mpg: 'video', wmv: 'video', flv: 'video', ts: 'video', m4v: 'video', '3gp': 'video',
  oga: 'audio', mka: 'audio', amr: 'audio', ac3: 'audio',
  markdown: 'text', htm: 'text', tex: 'text', org: 'text', textile: 'text', csv: 'text',
});

function extOf(name) {
  return path.extname(name).slice(1).toLowerCase();
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, opts);
    let err = '';
    p.stderr.on('data', d => { err += d; });
    p.on('error', reject);
    p.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with ${code}:\n${err.slice(-2000)}`));
    });
  });
}

function runOut(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let out = '', err = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err += d; });
    p.on('error', reject);
    p.on('close', code => {
      if (code === 0) resolve(out);
      else reject(new Error(`${cmd} exited with ${code}:\n${err.slice(-2000)}`));
    });
  });
}

function newId() {
  return crypto.randomBytes(8).toString('hex');
}

function register(filePath, name) {
  const id = newId();
  files.set(id, { path: filePath, name });
  return id;
}

async function convertFile(inputPath, originalName, target) {
  const srcExt = extOf(originalName);
  const type = EXT_TYPE[srcExt];
  if (!type) throw new Error(`Unsupported input format: .${srcExt}`);

  const base = path.basename(originalName, path.extname(originalName));
  const outName = `${base}.${target}`;
  const outPath = path.join(WORK_DIR, `${newId()}.${target}`);

  if (type === 'text') {
    const from = { md: 'markdown', txt: 'markdown', htm: 'html' }[srcExt];
    const to = { md: 'markdown', txt: 'plain' }[target];
    const args = [inputPath, '-o', outPath, '--standalone'];
    if (from) args.push('-f', from);
    if (to) args.push('-t', to);
    await run('pandoc', args);
  } else if (type === 'image' && ['webp', 'avif'].includes(target)) {
    // this ffmpeg build has no webp/avif encoder — use sharp
    let src = inputPath;
    if (srcExt === 'heic' || srcExt === 'heif') {
      src = inputPath + '.png';
      await run('sips', ['-s', 'format', 'png', inputPath, '--out', src]);
    }
    await sharp(src).toFormat(target).toFile(outPath);
  } else {
    let src = inputPath;
    if (srcExt === 'heic' || srcExt === 'heif') {
      src = inputPath + '.png'; // ffmpeg can't decode HEIC; macOS sips can
      await run('sips', ['-s', 'format', 'png', inputPath, '--out', src]);
    }
    const args = ['-y', '-i', src];
    if (target === 'gif' && (type === 'video')) {
      args.push('-vf', 'fps=12,scale=640:-1:flags=lanczos', '-loop', '0');
    } else if (type === 'video' && EXT_TYPE[target] === 'audio') {
      args.push('-vn'); // extract audio track from video
    }
    if (target === 'jpg' || target === 'jpeg') args.push('-q:v', '2');
    args.push(outPath);
    try {
      await run('ffmpeg', args);
    } catch (e) {
      if (e.message.includes('does not contain any stream')) {
        throw new Error('This video has no audio track to extract');
      }
      throw e;
    }
  }

  return { id: register(outPath, outName), name: outName };
}

// --- Convert an uploaded file ---
app.post('/api/convert', upload.single('file'), async (req, res) => {
  try {
    const { target } = req.body;
    if (!req.file || !target) return res.status(400).json({ error: 'Missing file or target format' });
    const result = await convertFile(req.file.path, req.file.originalname, target);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    if (req.file) fs.unlink(req.file.path, () => {});
  }
});

// --- Convert from a URL ---
app.post('/api/convert-url', async (req, res) => {
  try {
    const { url, target } = req.body;
    if (!url || !target) return res.status(400).json({ error: 'Missing url or target format' });
    const parsed = new URL(url);
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Fetch failed: ${resp.status}`);
    let name = path.basename(parsed.pathname) || 'download';
    if (!extOf(name)) {
      const ct = (resp.headers.get('content-type') || '').split(';')[0];
      const guess = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/webm': 'webm', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'text/html': 'html', 'text/markdown': 'md', 'text/plain': 'txt' }[ct];
      if (!guess) throw new Error(`Can't determine file type from URL (content-type: ${ct || 'unknown'})`);
      name += '.' + guess;
    }
    const tmpPath = path.join(WORK_DIR, newId() + path.extname(name));
    fs.writeFileSync(tmpPath, Buffer.from(await resp.arrayBuffer()));
    try {
      const result = await convertFile(tmpPath, name, target);
      res.json(result);
    } finally {
      fs.unlink(tmpPath, () => {});
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Download a converted file ---
app.get('/api/file/:id', (req, res) => {
  const f = files.get(req.params.id);
  if (!f || !fs.existsSync(f.path)) return res.status(404).json({ error: 'File not found' });
  res.download(f.path, f.name);
});

// --- ZIP files in a user-chosen order, numbered ---
app.post('/api/zip', (req, res) => {
  const { ids } = req.body; // ordered array of file ids
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'No files' });
  const entries = ids.map(id => files.get(id)).filter(f => f && fs.existsSync(f.path));
  if (entries.length === 0) return res.status(404).json({ error: 'Files not found' });

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="converted.zip"');
  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.pipe(res);
  const pad = String(entries.length).length;
  entries.forEach((f, i) => {
    const num = String(i + 1).padStart(pad, '0');
    archive.file(f.path, { name: `${num}. ${f.name}` });
  });
  archive.finalize();
});

// --- Song search via iTunes (no API key needed) ---
app.get('/api/search', async (req, res) => {
  try {
    const { artist = '', song = '' } = req.query;
    const term = `${artist} ${song}`.trim();
    if (!term) return res.status(400).json({ error: 'Empty search' });
    // Query Deezer (better structured artist+track search, keyless) and
    // iTunes in parallel, then merge — either catalog alone has gaps, and a
    // combined artist+song term on iTunes often buries the original under
    // remixes/covers.
    const deezerQ = artist && song ? `artist:"${artist}" track:"${song}"` : term;
    const itunesBase = 'https://itunes.apple.com/search?media=music&entity=song&limit=25';
    const grab = u => fetch(u).then(r => r.json()).catch(() => ({}));
    const [dz, it1, it2] = await Promise.all([
      grab(`https://api.deezer.com/search?limit=25&q=${encodeURIComponent(deezerQ)}`),
      grab(`${itunesBase}&term=${encodeURIComponent(term)}`),
      artist && song ? grab(`${itunesBase}&term=${encodeURIComponent(song)}&attribute=songTerm`) : {},
    ]);

    const norm = r => ({
      track: r.track, artist: r.artist, album: r.album, year: r.year || '',
      cover: r.cover, duration: r.duration,
    });
    const merged = [];
    const seen = new Set();
    const push = r => {
      const key = `${(r.artist || '').toLowerCase()}|${(r.track || '').toLowerCase()}`;
      if (seen.has(key)) return;
      seen.add(key);
      merged.push(norm(r));
    };
    for (const r of dz.data || []) {
      push({ track: r.title, artist: r.artist?.name, album: r.album?.title,
        cover: r.album?.cover_xl || r.album?.cover_big, duration: r.duration });
    }
    for (const r of [...(it1.results || []), ...(it2.results || [])]) {
      push({ track: r.trackName, artist: r.artistName, album: r.collectionName,
        year: r.releaseDate ? r.releaseDate.slice(0, 4) : '',
        cover: r.artworkUrl100 ? r.artworkUrl100.replace('100x100', '600x600') : null,
        duration: r.trackTimeMillis ? Math.round(r.trackTimeMillis / 1000) : null });
    }

    const a = artist.toLowerCase();
    const s = song.toLowerCase();
    const score = r => {
      const ra = (r.artist || '').toLowerCase();
      const rt = (r.track || '').toLowerCase();
      const artistSc = a ? (ra === a ? 2 : ra.includes(a) || a.includes(ra) ? 1 : 0) : 1;
      const titleSc = s ? (rt === s ? 2 : rt.startsWith(s) || rt.includes(s) ? 1 : 0) : 1;
      return artistSc * 3 + titleSc * 2;
    };
    const results = merged.sort((x, y) => score(y) - score(x)).slice(0, 16);
    res.json({ results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Words that signal the video is NOT the studio recording we want
const BAD_WORDS = [
  'cover', 'live', 'remix', 'karaoke', 'instrumental', 'reaction', 'acoustic',
  'sped up', 'slowed', '8d audio', 'reverb', 'nightcore', 'loop', '1 hour',
  'definition', 'meaning', 'pronunciation', 'pronounce', 'vocabulary',
  'tutorial', 'lesson', 'review', 'trailer', 'teaser', 'interview',
];

// Search YouTube for the track and score candidates instead of trusting the
// first hit — duration (known from Deezer/iTunes) is the strongest signal.
// Returns watch URLs, best first, so the caller can retry on blocked videos.
async function rankVideos({ artist, track, duration }) {
  const query = `${artist || ''} ${track} audio`.trim();
  let candidates;
  try {
    const out = await runOut('yt-dlp', [`ytsearch8:${query}`, '--dump-json', '--flat-playlist']);
    candidates = out.trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  } catch {
    return []; // fall back to ytsearch1
  }
  const t = track.toLowerCase();
  const a = (artist || '').toLowerCase();
  const scored = [];
  for (const v of candidates) {
    if (!v.id) continue;
    const title = (v.title || '').toLowerCase();
    const chan = (v.uploader || v.channel || '').toLowerCase();
    let s = 0;
    if (duration && v.duration) {
      const diff = Math.abs(v.duration - duration);
      if (diff <= 3) s += 30;
      else if (diff <= 10) s += 15;
      else if (diff > Math.max(45, duration * 0.25)) s -= 25;
    }
    if (title.includes(t)) s += 10;
    if (a && (title.includes(a) || chan.includes(a))) s += 8;
    if (chan.endsWith(' - topic')) s += 12; // auto-generated official audio channel
    if (/official (audio|video|music video)/.test(title)) s += 5;
    for (const w of BAD_WORDS) {
      if ((title.includes(w) || chan.includes(w)) && !t.includes(w)) s -= 12;
    }
    scored.push({ s, url: `https://www.youtube.com/watch?v=${v.id}` });
  }
  return scored.sort((x, y) => y.s - x.s).map(v => v.url);
}

// --- Download a song as mp3/m4a/wav via yt-dlp, with cover + tags embedded ---
app.post('/api/song', async (req, res) => {
  try {
    const { artist, track, album, cover, duration, format } = req.body;
    if (!track || !['mp3', 'm4a', 'wav'].includes(format)) {
      return res.status(400).json({ error: 'Missing track or bad format' });
    }
    const jobDir = path.join(WORK_DIR, 'job-' + newId());
    fs.mkdirSync(jobDir);
    const query = `${artist || ''} ${track} audio`.trim();
    // Try the ranked candidates in order — some videos 403 or are region-locked
    const sources = (await rankVideos({ artist, track, duration })).slice(0, 3);
    sources.push(`ytsearch1:${query}`);
    let lastErr;
    let produced;
    for (const source of sources) {
      console.log(`song: "${query}" (${duration || '?'}s) -> ${source}`);
      try {
        await run('yt-dlp', [
          source,
          '-x', '--audio-format', format, '--audio-quality', '0',
          '--no-playlist', '--max-filesize', '100M',
          '-o', path.join(jobDir, 'out.%(ext)s'),
        ]);
        produced = fs.readdirSync(jobDir).find(f => f.startsWith('out.'));
        if (produced) break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (!produced) throw lastErr || new Error('yt-dlp produced no file');
    let outPath = path.join(jobDir, produced);

    // Embed metadata + cover art (wav can't hold cover art)
    const tagged = path.join(jobDir, `tagged.${format}`);
    const meta = [
      '-metadata', `title=${track}`,
      '-metadata', `artist=${artist || ''}`,
      '-metadata', `album=${album || ''}`,
    ];
    if (cover && format !== 'wav') {
      const coverPath = path.join(jobDir, 'cover.jpg');
      const cResp = await fetch(cover);
      fs.writeFileSync(coverPath, Buffer.from(await cResp.arrayBuffer()));
      await run('ffmpeg', ['-y', '-i', outPath, '-i', coverPath,
        '-map', '0:a', '-map', '1', '-c', 'copy', ...meta,
        '-disposition:v', 'attached_pic', tagged]);
    } else {
      await run('ffmpeg', ['-y', '-i', outPath, '-c', 'copy', ...meta, tagged]);
    }
    outPath = tagged;

    const safe = `${artist ? artist + ' - ' : ''}${track}`.replace(/[\/\\:*?"<>|]/g, '_');
    res.json({ id: register(outPath, `${safe}.${format}`), name: `${safe}.${format}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/formats', (_req, res) => res.json(FORMATS));

// --- Shut the server down (used by the UI power button and `file-master stop`) ---
app.post('/api/shutdown', (_req, res) => {
  res.json({ ok: true });
  console.log('Shutdown requested, stopping server');
  setTimeout(shutdown, 100); // let the response flush first
});

const server = app.listen(PORT, () => {
  fs.writeFileSync(PID_FILE, String(process.pid));
  console.log(`File Master running at http://localhost:${PORT}`);
});

function shutdown() {
  fs.rmSync(PID_FILE, { force: true });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref(); // don't hang on open connections
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
