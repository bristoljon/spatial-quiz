import { useRef, useState, useEffect, useCallback } from 'react';
import Avatar from './Avatar.jsx';
import { describe, fmt } from '../format.js';
import { zonesFor, rangeX, xyPosition, RANGE_PAD, XY_PAD, WAGER_FULL_AT, BOARD_ASPECT } from '../../../shared/spatial.js';

const SEND_EVERY_MS = 70;

// The playing surface. Draws the question's geometry, every player's avatar,
// and (when interactive) lets this player drag their own avatar around.
export default function Board({ question: q, players, meId, reveal, interactive = false, onMove, size = 'md' }) {
  const ref = useRef(null);
  const [drag, setDrag] = useState(null); // local optimistic position while dragging
  const lastSent = useRef(0);
  const pending = useRef(null);

  useEffect(() => setDrag(null), [q?.id, reveal]);

  const toBoard = useCallback((ev) => {
    const r = ref.current.getBoundingClientRect();
    return { x: clamp((ev.clientX - r.left) / r.width), y: clamp((ev.clientY - r.top) / r.height) };
  }, []);

  const push = (p, force) => {
    const t = performance.now();
    if (force || t - lastSent.current >= SEND_EVERY_MS) {
      lastSent.current = t;
      pending.current = null;
      onMove?.(p);
    } else {
      pending.current = p;
    }
  };

  const onPointerDown = (ev) => {
    if (!interactive) return;
    ev.currentTarget.setPointerCapture(ev.pointerId);
    const p = toBoard(ev);
    setDrag(p);
    push(p, true);
  };
  const onPointerMove = (ev) => {
    if (!interactive || !ev.currentTarget.hasPointerCapture(ev.pointerId)) return;
    const p = toBoard(ev);
    setDrag(p);
    push(p, false);
  };
  const onPointerUp = (ev) => {
    if (!interactive) return;
    ev.currentTarget.releasePointerCapture(ev.pointerId);
    const p = toBoard(ev);
    setDrag(p);
    push(p, true);
  };

  // Flush a throttled move so the last position always lands.
  useEffect(() => {
    const id = setInterval(() => { if (pending.current) push(pending.current, true); }, SEND_EVERY_MS);
    return () => clearInterval(id);
  }, [onMove]);

  if (!q) return <div className={`board ${size} empty`} ref={ref} />;

  const me = players.find((p) => p.id === meId);
  const shown = players.map((p) => (p.id === meId && drag ? { ...p, x: drag.x, y: drag.y } : p)).filter((p) => p.x !== null && p.x !== undefined);
  const myPos = me ? (drag ?? (me.x !== null ? { x: me.x, y: me.y } : null)) : null;

  return (
    <div
      ref={ref}
      className={`board ${size} ${q.type} ${interactive ? 'interactive' : ''} ${reveal ? 'revealed' : ''}`}
      style={{ aspectRatio: `${BOARD_ASPECT}` }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {q.type === 'choice' && <ChoiceLayer q={q} reveal={reveal} />}
      {q.type === 'range' && <RangeLayer q={q} reveal={reveal} />}
      {q.type === 'xy' && <XyLayer q={q} reveal={reveal} />}
      {q.type === 'wager' && <WagerLayer q={q} reveal={reveal} />}

      <div className="avatars">
        {shown.map((p) => (
          <Avatar
            key={p.id}
            player={p}
            me={p.id === meId}
            size={size === 'lg' ? 'md' : 'sm'}
            dim={!!reveal && p.result && !p.result.correct && p.result.delta <= 0}
            badge={reveal && p.result ? p.result.delta : null}
            style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
          />
        ))}
      </div>

      {interactive && !reveal && (
        <div className="readout">{myPos ? describe(q, myPos) : 'Drag anywhere to place yourself'}</div>
      )}
    </div>
  );
}

function ChoiceLayer({ q, reveal }) {
  const zones = zonesFor(q.options);
  return (
    <div className="layer">
      {zones.map((z) => {
        const opt = q.options.find((o) => o.id === z.id);
        const cls = reveal ? (reveal.answer === z.id ? 'correct' : 'wrong') : '';
        return (
          <div key={z.id} className={`zone ${cls}`} style={{ left: pct(z.x), top: pct(z.y), width: pct(z.w), height: pct(z.h) }}>
            <span>{opt.text}</span>
          </div>
        );
      })}
    </div>
  );
}

function RangeLayer({ q, reveal }) {
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => ({ t, v: q.min + t * (q.max - q.min) }));
  return (
    <div className="layer">
      <div className="range-line" style={{ left: pct(RANGE_PAD), right: pct(RANGE_PAD) }} />
      {ticks.map(({ t, v }) => (
        <div key={t} className="tick" style={{ left: pct(RANGE_PAD + t * (1 - 2 * RANGE_PAD)) }}>
          <i /><span>{fmt(v, q.unit)}</span>
        </div>
      ))}
      {reveal && (
        <>
          {reveal.zeroAt > 0 && <div className="band zero" style={{ left: pct(rangeX(q, reveal.answer - reveal.zeroAt)), width: pct(rangeX(q, reveal.answer + reveal.zeroAt) - rangeX(q, reveal.answer - reveal.zeroAt)) }} />}
          {reveal.exact > 0 && <div className="band exact" style={{ left: pct(rangeX(q, reveal.answer - reveal.exact)), width: pct(rangeX(q, reveal.answer + reveal.exact) - rangeX(q, reveal.answer - reveal.exact)) }} />}
          <div className="answer-marker" style={{ left: pct(rangeX(q, reveal.answer)) }}>
            <span>{fmt(reveal.answer, q.unit)}</span>
          </div>
        </>
      )}
    </div>
  );
}

function XyLayer({ q, reveal }) {
  const { x: ax, y: ay } = q.axes;
  const target = reveal ? xyPosition(q, reveal.answer) : null;
  return (
    <div className="layer">
      <div className="xy-frame" style={{ left: pct(XY_PAD.x), top: pct(XY_PAD.y), right: pct(XY_PAD.x), bottom: pct(XY_PAD.y) }}>
        {ticksFor(ax).map(({ t, v }) => (
          <div key={`v${v}`} className="grid v" style={{ left: pct(t) }}>
            <span>{fmt(v)}</span>
          </div>
        ))}
        {ticksFor(ay).map(({ t, v }) => (
          <div key={`h${v}`} className="grid h" style={{ top: pct(1 - t) }}>
            <span>{fmt(v)}</span>
          </div>
        ))}
        <div className="axis-label x">{ax.label} →</div>
        <div className="axis-label y">↑ {ay.label}</div>
      </div>
      {target && (
        <>
          <Ring cx={target.x} cy={target.y} r={reveal.zeroAt} cls="zero" />
          <Ring cx={target.x} cy={target.y} r={reveal.exact} cls="exact" />
          <div className="target" style={{ left: pct(target.x), top: pct(target.y) }}>
            <span>{fmt(reveal.answer.x)} · {fmt(reveal.answer.y)}</span>
          </div>
        </>
      )}
    </div>
  );
}

// Five gridlines at values snapped to the axis step, so a year axis reads
// 2000 · 2004 · 2008 rather than 2003.75.
function ticksFor(axis) {
  const span = axis.max - axis.min;
  const step = axis.step || span / 100;
  const out = [];
  for (let i = 0; i <= 4; i++) {
    const v = Math.round((axis.min + (span * i) / 4) / step) * step;
    if (!out.some((o) => o.v === v)) out.push({ v, t: (v - axis.min) / span });
  }
  return out;
}

// A circle of radius r (board-width fraction) that stays round on a 16:10 board.
function Ring({ cx, cy, r, cls }) {
  return <div className={`ring ${cls}`} style={{ left: pct(cx), top: pct(cy), width: pct(2 * r), height: pct(2 * r * BOARD_ASPECT) }} />;
}

function WagerLayer({ q, reveal }) {
  const side = (which) => {
    const cls = reveal ? (reveal.answer === which ? 'correct' : 'wrong') : '';
    return (
      <div className={`half ${which} ${cls}`}>
        <span className="text">{q[which].text}</span>
      </div>
    );
  };
  return (
    <div className="layer wager-layer">
      {side('left')}
      {side('right')}
      <div className="centre-line" />
      <div className="stake-label l" style={{ left: pct(0.5 - WAGER_FULL_AT) }}>100%</div>
      <div className="stake-label c">0%</div>
      <div className="stake-label r" style={{ left: pct(0.5 + WAGER_FULL_AT) }}>100%</div>
      <div className="hint">Further from the middle = bigger stake</div>
    </div>
  );
}

const pct = (v) => `${v * 100}%`;
const clamp = (v) => Math.max(0, Math.min(1, v));
