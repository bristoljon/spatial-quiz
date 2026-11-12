// Spatial geometry shared by the server (scoring) and the browser (rendering).
// Everything works in normalised board coordinates: x and y in 0..1, with
// (0,0) top-left. The board is a fixed 16:10 rectangle on every device, so a
// normalised position means the same thing on a phone and on the big screen.

export const BOARD_ASPECT = 16 / 10;

export const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));

// --- choice: options become zones laid out on a grid --------------------

const GRID_FOR = { 1: [1, 1], 2: [2, 1], 3: [3, 1], 4: [2, 2], 5: [3, 2], 6: [3, 2], 7: [4, 2], 8: [4, 2], 9: [3, 3] };
const GAP = 0.03;

export function zonesFor(options) {
  const n = options.length;
  const [cols, rows] = GRID_FOR[Math.min(9, Math.max(1, n))];
  const w = (1 - GAP * (cols + 1)) / cols;
  const h = (1 - GAP * (rows + 1)) / rows;
  return options.map((opt, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    // Centre a short final row.
    const inRow = r === rows - 1 ? n - r * cols : cols;
    const offset = ((cols - inRow) * (w + GAP)) / 2;
    return { id: opt.id, x: GAP + c * (w + GAP) + offset, y: GAP + r * (h + GAP), w, h };
  });
}

export function zoneAt(zones, p) {
  return zones.find((z) => p.x >= z.x && p.x <= z.x + z.w && p.y >= z.y && p.y <= z.y + z.h) || null;
}

// --- range: a horizontal number line ------------------------------------

export const RANGE_PAD = 0.08; // horizontal padding so the ends are reachable

export function rangeValue(q, p) {
  const t = clamp01((p.x - RANGE_PAD) / (1 - 2 * RANGE_PAD));
  const raw = q.min + t * (q.max - q.min);
  const step = q.step || 1;
  return Math.round(raw / step) * step;
}

export function rangeX(q, value) {
  const t = (value - q.min) / (q.max - q.min);
  return RANGE_PAD + clamp01(t) * (1 - 2 * RANGE_PAD);
}

// --- xy: two axes, y increases upwards -----------------------------------

export const XY_PAD = { x: 0.08, y: 0.08 };

export function xyValue(q, p) {
  const tx = clamp01((p.x - XY_PAD.x) / (1 - 2 * XY_PAD.x));
  const ty = clamp01((p.y - XY_PAD.y) / (1 - 2 * XY_PAD.y));
  const { x: ax, y: ay } = q.axes;
  return {
    x: round(ax.min + tx * (ax.max - ax.min), ax.step),
    y: round(ay.max - ty * (ay.max - ay.min), ay.step),
  };
}

export function xyPosition(q, value) {
  const { x: ax, y: ay } = q.axes;
  return {
    x: XY_PAD.x + clamp01((value.x - ax.min) / (ax.max - ax.min)) * (1 - 2 * XY_PAD.x),
    y: XY_PAD.y + clamp01((ay.max - value.y) / (ay.max - ay.min)) * (1 - 2 * XY_PAD.y),
  };
}

// --- image / video: a picture letterboxed into the board, the answer is a point or box

// The picture (q.image, or the frame of q.video) is scaled to fit the 16:10
// board, centred, never cropped or stretched, so a normalised board position
// lands on the same pixel on every device. `width`/`height` (pixels) give its
// shape; the server never loads the file.
//
// Positions on the picture are fractions 0..1 of its width and height. An
// answer can be given as fractions {x,y}, pixels {px,py}, or, when the picture
// is an equirectangular map with `bounds`, as {lat,lon}. A box answer is
// { box: {px,py,w,h} } in pixels or { box: {x,y,w,h} } in fractions: full
// points anywhere inside, falling off with distance from its edge.

export const media = (q) => q.image ?? q.video;

export function imageRect(q) {
  const { width, height } = media(q);
  const aspect = width && height ? width / height : BOARD_ASPECT;
  if (aspect >= BOARD_ASPECT) {
    const h = BOARD_ASPECT / aspect; // full width, letterboxed top and bottom
    return { x: 0, y: (1 - h) / 2, w: 1, h };
  }
  const w = aspect / BOARD_ASPECT;   // full height, pillarboxed left and right
  return { x: (1 - w) / 2, y: 0, w, h: 1 };
}

// Any accepted answer form -> fractions of the picture. A box gives its centre.
export function imageFraction(q, a) {
  if (!a) return { x: 0.5, y: 0.5 };
  if (a.box) { const b = boxFraction(q, a.box); return { x: b.x + b.w / 2, y: b.y + b.h / 2 }; }
  if (typeof a.lat === 'number' && typeof a.lon === 'number') {
    const b = media(q).bounds ?? { north: 90, south: -90, west: -180, east: 180 };
    return { x: (a.lon - b.west) / (b.east - b.west), y: (b.north - a.lat) / (b.north - b.south) };
  }
  if (typeof a.px === 'number' && typeof a.py === 'number') {
    const m = media(q);
    return { x: a.px / m.width, y: a.py / m.height };
  }
  return { x: Number(a.x) || 0, y: Number(a.y) || 0 };
}

function boxFraction(q, b) {
  if (typeof b.px === 'number') {
    const m = media(q);
    return { x: b.px / m.width, y: b.py / m.height, w: b.w / m.width, h: b.h / m.height };
  }
  return { x: Number(b.x) || 0, y: Number(b.y) || 0, w: Number(b.w) || 0, h: Number(b.h) || 0 };
}

// Board position of a point on the picture (given in any answer form).
export function imagePosition(q, a) {
  const r = imageRect(q);
  const f = imageFraction(q, a);
  return { x: r.x + f.x * r.w, y: r.y + f.y * r.h };
}

// Board rectangle of a box answer, or null for a point.
export function imageBox(q, a) {
  if (!a || !a.box) return null;
  const r = imageRect(q);
  const b = boxFraction(q, a.box);
  return { x: r.x + b.x * r.w, y: r.y + b.y * r.h, w: b.w * r.w, h: b.h * r.h };
}

// How far a board position is from the answer, in board widths: 0 inside a
// box or on the point.
export function answerDistance(q, a, p) {
  const box = imageBox(q, a);
  if (!box) return boardDistance(p, imagePosition(q, a));
  const dx = Math.max(box.x - p.x, 0, p.x - (box.x + box.w));
  const dy = Math.max(box.y - p.y, 0, p.y - (box.y + box.h));
  return Math.hypot(dx, dy / BOARD_ASPECT);
}

// Board position -> where on the image it is. Fractions may fall outside
// 0..1 when the avatar is in the letterbox; `inside` says so. With `bounds`
// the point also comes back as lat/lon.
export function imageValue(q, p) {
  const r = imageRect(q);
  const x = (p.x - r.x) / r.w;
  const y = (p.y - r.y) / r.h;
  const out = { x: round3(x), y: round3(y), inside: x >= 0 && x <= 1 && y >= 0 && y <= 1 };
  const b = media(q).bounds;
  if (b) {
    out.lat = round3(b.north - y * (b.north - b.south));
    out.lon = round3(b.west + x * (b.east - b.west));
  }
  return out;
}

// Distance between two board positions as a fraction of the board's width,
// so a circle of this radius is round on screen (see Ring in Board.jsx).
export function boardDistance(a, b) {
  return Math.hypot(a.x - b.x, (a.y - b.y) / BOARD_ASPECT);
}

const round3 = (v) => Math.round(v * 1000) / 1000;

// --- wager: two halves, distance from the centre line is the stake --------

export const WAGER_FULL_AT = 0.42; // |x - 0.5| at which the stake is 100%

export function wagerValue(p) {
  const side = p.x < 0.5 ? 'left' : 'right';
  const stake = Math.min(1, Math.abs(p.x - 0.5) / WAGER_FULL_AT);
  return { side, stake };
}

function round(v, step) {
  if (!step) return Math.round(v * 100) / 100;
  return Math.round(v / step) * step;
}
