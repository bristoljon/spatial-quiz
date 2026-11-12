import { useRef, useState, useEffect, useCallback } from 'react';
import Avatar from './Avatar.jsx';
import { describe, describePoint, fmt } from '../format.js';
import { zonesFor, rangeX, rangeValue, xyPosition, imageRect, imagePosition, imageBox, media, RANGE_PAD, XY_PAD, WAGER_FULL_AT, BOARD_ASPECT } from '../../../shared/spatial.js';

const SEND_EVERY_MS = 70;
const LABELLED = new Set(['range', 'xy']); // types with a numeric value worth labelling

// The playing surface. Draws the question's geometry, every player's avatar,
// and (when interactive) lets this player drag their own avatar around.
// controlId: whose avatar my drags move (myself, or someone I'm possessing).
// targeting: when set, clicking another avatar calls onTarget(id) instead of moving.
// fx: transient effects to draw, e.g. [{ key, type: 'bump', x, y }].
// video: the room's video state to follow; videoRef: given by the host, whose
// element is the one everyone else follows. now: server-clock function.
// sources: preloaded clips as { src: objectUrl } (see usePreload).
export default function Board({ question: q, players, meId, controlId = meId, reveal, hint = null, interactive = false, onMove, targeting = false, onTarget, fx = [], size = 'md', video = null, videoRef = null, now = Date.now, sources = {} }) {
  const ref = useRef(null);
  const [drag, setDrag] = useState(null);   // optimistic own position while the pointer is down
  const [hover, setHover] = useState(null); // desktop: value under the cursor before clicking
  const dragging = useRef(false);
  const lastSent = useRef(0);
  const pending = useRef(null);

  const me = players.find((p) => p.id === meId);
  const ctl = players.find((p) => p.id === controlId) ?? me;
  useEffect(() => { setDrag(null); setHover(null); }, [q?.id, reveal, controlId]);
  // Once the server echoes the final position, drop the optimistic override.
  useEffect(() => { if (!dragging.current) setDrag(null); }, [ctl?.x, ctl?.y]);

  const toBoard = useCallback((ev) => {
    const r = ref.current.getBoundingClientRect();
    return { x: clamp((ev.clientX - r.left) / r.width), y: clamp((ev.clientY - r.top) / r.height) };
  }, []);

  const push = (p, force, release = false) => {
    const t = performance.now();
    if (force || t - lastSent.current >= SEND_EVERY_MS) {
      lastSent.current = t;
      pending.current = null;
      onMove?.(p, release);
    } else {
      pending.current = p;
    }
  };

  const onPointerDown = (ev) => {
    if (!interactive || ev.button > 0) return;
    if (targeting) {
      const hit = ev.target.closest?.('.avatar[data-id]');
      if (hit && hit.dataset.id !== meId) onTarget?.(hit.dataset.id);
      else onTarget?.(null); // clicked empty board: cancel
      return;
    }
    ev.currentTarget.setPointerCapture(ev.pointerId);
    dragging.current = true;
    const p = toBoard(ev);
    setDrag(p); setHover(null);
    push(p, true);
  };
  const onPointerMove = (ev) => {
    if (!interactive) return;
    const p = toBoard(ev);
    if (dragging.current) { setDrag(p); push(p, false); }
    else if (ev.pointerType === 'mouse') setHover(p);
  };
  const onPointerUp = (ev) => {
    if (!interactive || !dragging.current) return;
    ev.currentTarget.releasePointerCapture(ev.pointerId);
    dragging.current = false;
    const p = toBoard(ev);
    setDrag(p);
    push(p, true, true); // release: if possessing someone, this drops them
  };
  const onPointerLeave = () => setHover(null);

  // Flush a throttled move so the last position always lands.
  useEffect(() => {
    const id = setInterval(() => { if (pending.current) push(pending.current, true); }, SEND_EVERY_MS);
    return () => clearInterval(id);
  }, [onMove]);

  if (!q) return <div className={`board ${size} empty`} ref={ref} />;

  const shown = players
    .map((p) => (p.id === controlId && drag ? { ...p, x: drag.x, y: drag.y } : p))
    .filter((p) => p.x !== null && p.x !== undefined);
  const myPos = ctl ? (drag ?? (ctl.x !== null ? { x: ctl.x, y: ctl.y } : null)) : null;
  // Live: only your own value (others' numbers would be noisy and easy to copy).
  // Reveal: everyone's value, next to their score badge.
  const labelFor = (p) => {
    if (!LABELLED.has(q.type)) return null;
    if (reveal) return describe(q, p);
    if (p.id === controlId && interactive && q.type !== 'range') return describe(q, p); // range shows the line marker instead
    return null;
  };

  return (
    <div
      ref={ref}
      className={`board ${size} ${q.type} ${interactive ? 'interactive' : ''} ${reveal ? 'revealed' : ''} ${targeting ? 'targeting' : ''}`}
      style={{ aspectRatio: `${BOARD_ASPECT}` }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={onPointerLeave}
    >
      {q.type === 'choice' && <ChoiceLayer q={q} reveal={reveal} hint={hint} />}
      {q.type === 'range' && <RangeLayer q={q} reveal={reveal} hint={hint} mine={interactive && !reveal ? myPos : null} hover={hover} />}
      {q.type === 'xy' && <XyLayer q={q} reveal={reveal} hint={hint} />}
      {q.type === 'wager' && <WagerLayer q={q} reveal={reveal} hint={hint} />}
      {q.type === 'image' && <ImageLayer q={q} reveal={reveal} hint={hint} />}
      {q.type === 'video' && <VideoLayer key={q.id} q={q} reveal={reveal} hint={hint} video={video} videoRef={videoRef} now={now} sources={sources} />}

      <div className="fx">
        {fx.map((f) => <div key={f.key} className={`fx-${f.type}`} style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%` }} />)}
      </div>

      <div className="avatars">
        {shown.map((p) => (
          <Avatar
            key={p.id}
            player={p}
            me={p.id === meId}
            steered={p.id === controlId && controlId !== meId}
            dataId={p.id}
            size="sm"
            dim={!!reveal && p.result && !p.result.correct && p.result.delta <= 0}
            badge={reveal && p.result ? p.result.delta : null}
            label={labelFor(p)}
            ghost={!reveal && p.id === meId && (p.powers || []).includes('invisible')}
            powers={p.powers}
            style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
          />
        ))}
      </div>

      {interactive && !reveal && hover && !drag && q.type !== 'range' && (
        <div className="hover-readout" style={{ left: `${hover.x * 100}%`, top: `${hover.y * 100}%` }}>{describe(q, hover)}</div>
      )}
      {interactive && !reveal && (
        <div className="readout">
          {targeting ? 'Click someone to possess them'
            : myPos ? `${controlId !== meId ? `${ctl?.name}: ` : ''}${describe(q, myPos, { double: controlId === meId && (me?.powers || []).includes('double') })}`
            : controlId !== meId ? `Drag to move ${ctl?.name}` : 'Click or drag anywhere to place yourself'}
        </div>
      )}
    </div>
  );
}

function ChoiceLayer({ q, reveal, hint }) {
  const zones = zonesFor(q.options);
  return (
    <div className="layer">
      {zones.map((z) => {
        const opt = q.options.find((o) => o.id === z.id);
        const cls = reveal ? (reveal.answer === z.id ? 'correct' : 'wrong') : hint && hint.answer === z.id ? 'hinted' : '';
        return (
          <div key={z.id} className={`zone ${cls}`} style={{ left: pct(z.x), top: pct(z.y), width: pct(z.w), height: pct(z.h) }}>
            <span>{opt.text}</span>
          </div>
        );
      })}
    </div>
  );
}

function RangeLayer({ q, reveal, hint, mine, hover }) {
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => ({ t, v: q.min + t * (q.max - q.min) }));
  const marker = (p, cls) => (
    <div className={`my-marker ${cls}`} style={{ left: pct(rangeX(q, rangeValue(q, p))) }}>
      <span>{fmt(rangeValue(q, p), q.unit)}</span>
    </div>
  );
  return (
    <div className="layer">
      <div className="range-line" style={{ left: pct(RANGE_PAD), right: pct(RANGE_PAD) }} />
      {ticks.map(({ t, v }) => (
        <div key={t} className="tick" style={{ left: pct(RANGE_PAD + t * (1 - 2 * RANGE_PAD)) }}>
          <i /><span>{fmt(v, q.unit)}</span>
        </div>
      ))}
      {hover && !mine && marker(hover, 'ghost')}
      {hover && mine && marker(hover, 'ghost')}
      {mine && marker(mine, '')}
      {hint && !reveal && (
        <div className="answer-marker hinted" style={{ left: pct(rangeX(q, hint.answer)) }}>
          <span>🔍 {fmt(hint.answer, q.unit)}</span>
        </div>
      )}
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

function XyLayer({ q, reveal, hint }) {
  const { x: ax, y: ay } = q.axes;
  const target = reveal ? xyPosition(q, reveal.answer) : null;
  const hinted = hint && !reveal ? xyPosition(q, hint.answer) : null;
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
      {hinted && (
        <div className="target hinted" style={{ left: pct(hinted.x), top: pct(hinted.y) }}>
          <span>🔍 {fmt(hint.answer.x)} · {fmt(hint.answer.y)}</span>
        </div>
      )}
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

// The picture, letterboxed to the same rectangle on every device, with the
// answer (and its scoring rings) drawn over it at the reveal.
function ImageLayer({ q, reveal, hint }) {
  const r = imageRect(q);
  return (
    <div className="layer image-layer">
      <img src={q.image.src} alt="" draggable={false} onLoad={(ev) => checkSize(q, ev.currentTarget.naturalWidth, ev.currentTarget.naturalHeight)} style={rectStyle(r)} />
      <PictureOverlay q={q} reveal={reveal} hint={hint} />
    </div>
  );
}

// A clip in the same rectangle. The host's element (videoRef) is the master;
// everyone else follows the room's video state: seek to where the host is,
// play or pause as the host did. Phones are muted so they can autoplay.
function VideoLayer({ q, reveal, hint, video, videoRef, now, sources }) {
  const own = useRef(null);
  const ref = videoRef ?? own;
  const master = !!videoRef;
  const [blocked, setBlocked] = useState(false); // autoplay refused: needs a tap
  // Preloaded copy if we have one, else stream it. Chosen once per question
  // (the layer is keyed on q.id) so a late-arriving preload can't restart playback.
  const [src] = useState(() => sources[q.video.src] ?? q.video.src);
  const r = imageRect(q);

  const sync = useCallback(() => {
    const el = ref.current;
    if (!el || master || !video) return;
    const target = video.playing ? video.t + (now() - video.at) / 1000 : video.t;
    try { if (Math.abs(el.currentTime - target) > 0.3) el.currentTime = target; } catch {}
    if (video.playing) {
      if (el.paused) el.play().then(() => setBlocked(false)).catch(() => setBlocked(true));
    } else if (!el.paused) {
      el.pause();
    }
  }, [ref, master, video, now]);

  useEffect(() => {
    sync();
    if (master || !video?.playing) return;
    const id = setInterval(sync, 2000); // correct drift while playing
    return () => clearInterval(id);
  }, [sync, master, video?.playing]);

  return (
    <div className="layer video-layer">
      <video
        ref={ref}
        src={src}
        muted={!master}
        playsInline
        preload="auto"
        disablePictureInPicture
        onLoadedMetadata={(ev) => { checkSize(q, ev.currentTarget.videoWidth, ev.currentTarget.videoHeight); sync(); }}
        onCanPlay={sync}
        style={rectStyle(r)}
      />
      {blocked && !master && (
        <button type="button" className="tap-to-play" onClick={() => ref.current?.play().then(() => setBlocked(false)).catch(() => {})}>▶ Tap to play the video</button>
      )}
      <PictureOverlay q={q} reveal={reveal} hint={hint} />
    </div>
  );
}

// Hint and reveal markers for a picture: a point with rings, or a box.
function PictureOverlay({ q, reveal, hint }) {
  const box = reveal ? imageBox(q, reveal.answer) : null;
  const target = reveal && !box ? imagePosition(q, reveal.answer) : null;
  const hintBox = hint && !reveal ? imageBox(q, hint.answer) : null;
  const hinted = hint && !reveal && !hintBox ? imagePosition(q, hint.answer) : null;
  return (
    <>
      {hintBox && <div className="answer-box hinted" style={rectStyle(hintBox)}><span>🔍 {describePoint(q, hint.answer)}</span></div>}
      {hinted && (
        <div className="target hinted" style={{ left: pct(hinted.x), top: pct(hinted.y) }}>
          <span>🔍 {describePoint(q, hint.answer)}</span>
        </div>
      )}
      {box && <div className="answer-box" style={rectStyle(box)}><span>{describePoint(q, reveal.answer)}</span></div>}
      {target && (
        <>
          <Ring cx={target.x} cy={target.y} r={reveal.zeroAt} cls="zero" />
          <Ring cx={target.x} cy={target.y} r={reveal.exact} cls="exact" />
          <div className="target" style={{ left: pct(target.x), top: pct(target.y) }}>
            <span>{describePoint(q, reveal.answer)}</span>
          </div>
        </>
      )}
    </>
  );
}

// The declared size is what positions are scored against, so shout if the file disagrees.
function checkSize(q, w, h) {
  const m = media(q);
  if (w && h && Math.abs(w / h - m.width / m.height) > 0.01) {
    console.warn(`Question ${q.id}: file is ${w}×${h} but the quiz says ${m.width}×${m.height}; answers will be off`);
  }
}

const rectStyle = (r) => ({ left: pct(r.x), top: pct(r.y), width: pct(r.w), height: pct(r.h) });

function WagerLayer({ q, reveal, hint }) {
  const side = (which) => {
    const cls = reveal ? (reveal.answer === which ? 'correct' : 'wrong') : hint && hint.answer === which ? 'hinted' : '';
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
      <div className="stake-label l" style={{ left: pct(0.5 - WAGER_FULL_AT) }}>±{q.points}</div>
      <div className="stake-label c">0</div>
      <div className="stake-label r" style={{ left: pct(0.5 + WAGER_FULL_AT) }}>±{q.points}</div>
      <div className="hint">Further from the middle = more points staked</div>
    </div>
  );
}

const pct = (v) => `${v * 100}%`;
const clamp = (v) => Math.max(0, Math.min(1, v));
