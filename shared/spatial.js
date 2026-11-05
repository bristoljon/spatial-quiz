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
