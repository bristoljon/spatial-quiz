#!/usr/bin/env node
// Step 1 of building the "Oops!" round: pick candidate clips from the Oops!
// dataset, keep the ones filmed from a still camera, trim each around its
// fail moment, and write a picker page to choose clips and mark answers in.
//
//   node tools/oops/prepare.js --oops ~/data/oops_dataset [--count 30] [--scan 600]
//
// --oops       the extracted dataset (any layout: annotation JSON and .mp4s
//              are found by searching the folder)
// --count      how many still-camera candidates to collect (default 30)
// --scan       give up after checking this many annotated clips (default 600)
// --min-static 0..1, how much of the frame must stay put (default 0.75)
// --lead/--tail seconds kept before/after the fail moment (default 5 / 4)
// --seed       shuffle seed, change it for a different batch (default 1)
// --work       output folder (default tools/oops/work, gitignored)
//
// Needs ffmpeg and ffprobe on the PATH. Then open <work>/picker.html, and run
// build-round.js on the picks it exports.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = parseArgs(process.argv.slice(2));
if (!args.oops) {
  console.error('Usage: node tools/oops/prepare.js --oops <extracted Oops! dataset folder> [--count 30]');
  process.exit(1);
}
const opt = {
  oops: expand(args.oops),
  work: path.resolve(args.work ?? path.join(here, 'work')),
  count: Number(args.count ?? 30),
  scan: Number(args.scan ?? 600),
  minStatic: Number(args['min-static'] ?? 0.75),
  lead: Number(args.lead ?? 5),
  tail: Number(args.tail ?? 4),
  seed: Number(args.seed ?? 1),
  jobs: Number(args.jobs ?? 4),
};

// --- find annotations and videos -------------------------------------------

const files = walk(opt.oops);
const annFiles = files.filter((f) => /transition_times.*\.json$/i.test(path.basename(f)));
const videos = new Map(files.filter((f) => /\.mp4$/i.test(f)).map((f) => [path.basename(f, path.extname(f)), f]));
if (!annFiles.length) fail(`No transition_times*.json under ${opt.oops}. Is that the extracted dataset?`);
if (!videos.size) fail(`No .mp4 files under ${opt.oops}.`);

// { name: { t: [annotator times, -1 = not found], rel_t: [...], len } }
const anns = Object.assign({}, ...annFiles.map((f) => JSON.parse(fs.readFileSync(f, 'utf8'))));
const pool = [];
for (const [name, a] of Object.entries(anns)) {
  const file = videos.get(name);
  const ts = (a?.t ?? []).filter((t) => typeof t === 'number' && t >= 0);
  if (!file || ts.length < 2) continue;
  // Annotators must agree on the moment, and it mustn't be at the very edge.
  if (Math.max(...ts) - Math.min(...ts) > 1) continue;
  const rel = median((a.rel_t ?? []).filter((r) => r >= 0));
  if (Number.isFinite(rel) && (rel < 0.01 || rel > 0.99)) continue;
  pool.push({ name, file, t: median(ts) });
}
console.log(`${Object.keys(anns).length} annotated clips, ${videos.size} videos, ${pool.length} usable.`);
shuffle(pool, opt.seed);

// --- check, trim and grab frames -------------------------------------------

fs.mkdirSync(path.join(opt.work, 'clips'), { recursive: true });
fs.mkdirSync(path.join(opt.work, 'frames'), { recursive: true });
const found = [];
let checked = 0;
let next = 0;
await Promise.all(Array.from({ length: opt.jobs }, worker));

async function worker() {
  while (found.length < opt.count && next < Math.min(pool.length, opt.scan)) {
    const c = pool[next++];
    const n = ++checked;
    try {
      const dur = await duration(c.file);
      const start = Math.max(0, c.t - opt.lead);
      const end = Math.min(dur, c.t + opt.tail);
      if (c.t - start < 1.5 || end - c.t < 1.5) continue; // needs a run-up and an aftermath
      const score = await stillness(c.file, start, end - start);
      const verdict = score >= opt.minStatic ? 'keep' : 'moving';
      console.log(`[${n}] ${verdict.padEnd(6)} ${score.toFixed(2)}  ${c.name}`);
      if (verdict !== 'keep' || found.length >= opt.count) continue;
      const id = slug(c.name);
      const clip = path.join(opt.work, 'clips', `${id}.mp4`);
      await encode(c.file, start, end - start, clip);
      const { width, height, duration: len } = await probe(clip);
      const pauseAt = round1(Math.max(0.5, c.t - start - 0.3));
      await frame(clip, pauseAt, path.join(opt.work, 'frames', `${id}-pause.jpg`));
      await frame(clip, null, path.join(opt.work, 'frames', `${id}-end.jpg`));
      found.push({ id, source: c.name, still: round2(score), width, height, duration: round1(len), pauseAt });
    } catch (e) {
      console.warn(`[${n}] skip   ${c.name}: ${e.message.split('\n')[0]}`);
    }
  }
}

found.sort((a, b) => a.id.localeCompare(b.id));
fs.writeFileSync(path.join(opt.work, 'candidates.json'), JSON.stringify(found, null, 2));
const tpl = fs.readFileSync(path.join(here, 'picker.html'), 'utf8');
fs.writeFileSync(path.join(opt.work, 'picker.html'), tpl.replace('/*CANDIDATES*/[]', JSON.stringify(found)));
console.log(`\n${found.length} candidates from ${checked} checked, in ${opt.work}`);
console.log(`Next: open ${path.join(opt.work, 'picker.html')}, mark the answers, export picks.json, then`);
console.log(`      node tools/oops/build-round.js --picks <path to picks.json>`);

// --- the still-camera test --------------------------------------------------
//
// Decode the clip tiny and grey, take each pixel's median over time as the
// background, and ask what share of the frame matches it in a typical frame.
// A tripod or doorbell shot keeps most of the frame on its background while
// the action happens; a handheld or panning shot doesn't. Near-black pixels
// (letterbox bars) are left out so they can't make a moving shot look still.
async function stillness(file, start, len) {
  const W = 96, H = 54, N = W * H;
  const raw = await run('ffmpeg', ['-v', 'error', '-ss', String(start), '-t', String(len), '-i', file,
    '-vf', `fps=5,scale=${W}:${H},format=gray`, '-f', 'rawvideo', '-'], true);
  const frames = Math.floor(raw.length / N);
  if (frames < 5) throw new Error('too few frames');
  const med = new Uint8Array(N);
  const col = new Uint8Array(frames);
  for (let i = 0; i < N; i++) {
    for (let f = 0; f < frames; f++) col[f] = raw[f * N + i];
    col.sort();
    med[i] = col[frames >> 1];
  }
  const mask = [];
  for (let i = 0; i < N; i++) if (med[i] > 16) mask.push(i);
  if (mask.length < N * 0.3) return 0;
  const shares = [];
  for (let f = 0; f < frames; f++) {
    let ok = 0;
    for (const i of mask) if (Math.abs(raw[f * N + i] - med[i]) <= 12) ok++;
    shares.push(ok / mask.length);
  }
  return median(shares);
}

// Small enough that every phone can preload it: <= 854 wide, no letterbox
// change, faststart for streaming, quiet audio kept for the big screen.
function encode(file, start, len, out) {
  return run('ffmpeg', ['-v', 'error', '-y', '-ss', String(start), '-t', String(len), '-i', file,
    '-vf', "scale='min(854,iw)':-2", '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '64k', '-ac', '1', '-movflags', '+faststart', out]);
}

function frame(clip, at, out) {
  const seek = at == null ? ['-sseof', '-0.15'] : ['-ss', String(at)];
  return run('ffmpeg', ['-v', 'error', '-y', ...seek, '-i', clip, '-frames:v', '1', '-q:v', '3', out]);
}

async function duration(file) {
  return (await probe(file)).duration;
}

async function probe(file) {
  const out = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', file]);
  const j = JSON.parse(out);
  return { width: j.streams[0].width, height: j.streams[0].height, duration: Number(j.format.duration) };
}

// --- helpers -----------------------------------------------------------------

function run(cmd, argv, binary = false) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, argv);
    const out = [];
    let err = '';
    p.stdout.on('data', (d) => out.push(d));
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => reject(e.code === 'ENOENT' ? new Error(`${cmd} not found: install ffmpeg`) : e));
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(err || `${cmd} exited ${code}`));
      const buf = Buffer.concat(out);
      resolve(binary ? buf : buf.toString('utf8'));
    });
  });
}

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') ? 'true' : argv[++i];
  return o;
}

function median(xs) {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function shuffle(xs, seed) {
  let s = seed >>> 0 || 1;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [xs[i], xs[j]] = [xs[j], xs[i]];
  }
}

function slug(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return `${base}-${h.toString(36).slice(0, 5)}`;
}

function expand(p) {
  return path.resolve(p.replace(/^~(?=$|\/)/, process.env.HOME ?? '~'));
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function round1(x) { return Math.round(x * 10) / 10; }
function round2(x) { return Math.round(x * 100) / 100; }
