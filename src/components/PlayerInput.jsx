// Phone answer controls, one per question type.
import { useEffect, useMemo, useState } from 'react';
import { LETTERS, Quote, Fmt } from './bits.jsx';

export default function PlayerInput({ q, sent, busy, onSubmit }) {
  switch (q.type) {
    case 'choice': return <Choice q={q} sent={sent} busy={busy} onSubmit={onSubmit} />;
    case 'multi': return <Multi q={q} sent={sent} busy={busy} onSubmit={onSubmit} />;
    case 'order': return <Order q={q} sent={sent} busy={busy} onSubmit={onSubmit} />;
    case 'match': return <Match q={q} sent={sent} busy={busy} onSubmit={onSubmit} />;
    case 'blanks': return <Blanks q={q} sent={sent} busy={busy} onSubmit={onSubmit} />;
    case 'slider': return <Slider q={q} sent={sent} busy={busy} onSubmit={onSubmit} />;
    case 'text': return <TextIn q={q} sent={sent} busy={busy} onSubmit={onSubmit} />;
    case 'reveal': return <Reveal q={q} sent={sent} busy={busy} onSubmit={onSubmit} />;
    default: return <p>Unsupported question type</p>;
  }
}

function Submit({ busy, sent, disabled, onClick, label = 'Lock it in' }) {
  return (
    <button className="btn primary block submit" disabled={busy || disabled} onClick={onClick}>
      {busy ? 'Sending…' : sent !== undefined && sent !== null ? 'Update answer' : label}
    </button>
  );
}

function ChoiceButtons({ q, picked, onPick, disabled }) {
  const hasImages = q.options.some((o) => o.image);
  return (
    <div className={`p-options ${hasImages ? 'images' : ''}`}>
      {q.options.map((o, i) => {
        const on = Array.isArray(picked) ? picked.includes(o.id) : picked === o.id;
        return (
          <button key={o.id} className={`p-opt c${i % 6} ${on ? 'on' : ''}`} disabled={disabled} onClick={() => onPick(o.id)} aria-pressed={on}>
            {o.image && <img src={o.image} alt="" />}
            <span className="letter">{LETTERS[i]}</span>
            {!o.image && <span className="opt-text">{o.text}</span>}
          </button>
        );
      })}
    </div>
  );
}

function Choice({ q, sent, busy, onSubmit }) {
  return (
    <>
      <Quote quote={q.quote} />
      <ChoiceButtons q={q} picked={sent} onPick={(id) => onSubmit(id)} disabled={busy} />
      <p className="hint">{sent ? 'Locked in. You can change it until time runs out.' : 'Tap to answer'}</p>
    </>
  );
}

function Multi({ q, sent, busy, onSubmit }) {
  const [picked, setPicked] = useState(sent || []);
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  return (
    <>
      <Quote quote={q.quote} />
      <ChoiceButtons q={q} picked={picked} onPick={toggle} disabled={busy} />
      <p className="hint">Pick all that apply. Wrong picks cost points.</p>
      <Submit busy={busy} sent={sent} disabled={!picked.length} onClick={() => onSubmit(picked)} />
    </>
  );
}

function Order({ q, sent, busy, onSubmit }) {
  const [list, setList] = useState(() => sent || q.items.map((i) => i.id));
  const byId = useMemo(() => Object.fromEntries(q.items.map((i) => [i.id, i])), [q.items]);
  const move = (idx, d) => setList((l) => {
    const j = idx + d;
    if (j < 0 || j >= l.length) return l;
    const n = l.slice();
    [n[idx], n[j]] = [n[j], n[idx]];
    return n;
  });
  return (
    <>
      {q.labels && <p className="hint top">{q.labels.first} at the top</p>}
      <ol className="p-order">
        {list.map((id, i) => (
          <li key={id}>
            <span className="rank">{i + 1}</span>
            <span className="txt">{byId[id]?.text}</span>
            <button className="mini" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">▲</button>
            <button className="mini" onClick={() => move(i, 1)} disabled={i === list.length - 1} aria-label="Move down">▼</button>
          </li>
        ))}
      </ol>
      {q.labels && <p className="hint">{q.labels.last} at the bottom</p>}
      <Submit busy={busy} sent={sent} onClick={() => onSubmit(list)} />
    </>
  );
}

const PAIR_COLORS = ['#ff7a6b', '#6bc6ff', '#ffd166', '#c49bff', '#9be15d', '#ff9fd2', '#5ee0c9', '#ffa94d'];

function Match({ q, sent, busy, onSubmit }) {
  const [pairs, setPairs] = useState(sent || {});
  const [sel, setSel] = useState(null);
  const colorOf = (leftId) => PAIR_COLORS[q.left.findIndex((l) => l.id === leftId) % PAIR_COLORS.length];
  const rightOwner = (rid) => Object.keys(pairs).find((k) => pairs[k] === rid);
  const pickRight = (rid) => {
    if (!sel) {
      // tapping a paired right item un-pairs it
      const owner = rightOwner(rid);
      if (owner) setPairs((p) => { const n = { ...p }; delete n[owner]; return n; });
      return;
    }
    setPairs((p) => {
      const n = { ...p };
      const owner = Object.keys(n).find((k) => n[k] === rid);
      if (owner) delete n[owner];
      n[sel] = rid;
      return n;
    });
    // auto-advance to next unpaired left item
    const nextFree = q.left.find((l) => l.id !== sel && !pairs[l.id]);
    setSel(nextFree ? nextFree.id : null);
  };
  useEffect(() => { if (!sent) setSel(q.left[0]?.id); }, [q.id]); // eslint-disable-line
  const done = q.left.every((l) => pairs[l.id]);
  return (
    <>
      <p className="hint top">Tap a left item, then its match</p>
      <div className="p-match">
        <div>
          {q.left.map((l) => (
            <button key={l.id} className={`m-item ${sel === l.id ? 'sel' : ''} ${pairs[l.id] ? 'paired' : ''}`}
              style={pairs[l.id] || sel === l.id ? { borderColor: colorOf(l.id), '--pc': colorOf(l.id) } : undefined}
              onClick={() => setSel(l.id)}>
              {l.text}
            </button>
          ))}
        </div>
        <div>
          {q.right.map((r) => {
            const owner = rightOwner(r.id);
            return (
              <button key={r.id} className={`m-item ${owner ? 'paired' : ''}`}
                style={owner ? { borderColor: colorOf(owner), '--pc': colorOf(owner) } : undefined}
                onClick={() => pickRight(r.id)}>
                {r.text}
              </button>
            );
          })}
        </div>
      </div>
      <Submit busy={busy} sent={sent} disabled={!done} onClick={() => onSubmit(pairs)} />
    </>
  );
}

function Blanks({ q, sent, busy, onSubmit }) {
  const [vals, setVals] = useState(sent || q.blanks.map(() => ''));
  const parts = q.text.split(/(\{\d+\})/g);
  const set = (k, v) => setVals((a) => { const n = a.slice(); n[k] = v; return n; });
  return (
    <>
      <p className="p-sentence">
        {parts.map((p, i) => {
          const m = p.match(/^\{(\d+)\}$/);
          if (!m) return <span key={i}>{p}</span>;
          const k = Number(m[1]);
          const b = q.blanks[k];
          return b.options ? (
            <select key={i} className="gap-in" value={vals[k]} onChange={(e) => set(k, e.target.value)}>
              <option value="">choose…</option>
              {b.options.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : (
            <input key={i} className="gap-in" value={vals[k]} onChange={(e) => set(k, e.target.value)}
              placeholder={`blank ${k + 1}`} autoCapitalize="none" autoComplete="off" maxLength={40} />
          );
        })}
      </p>
      <Submit busy={busy} sent={sent} disabled={vals.some((v) => !v.trim())} onClick={() => onSubmit(vals)} />
    </>
  );
}

function Slider({ q, sent, busy, onSubmit }) {
  const mid = Math.round(((q.min + q.max) / 2) / q.step) * q.step;
  const [v, setV] = useState(sent ?? mid);
  const nudge = (d) => setV((x) => Math.min(q.max, Math.max(q.min, +(x + d * q.step).toFixed(2))));
  return (
    <div className="p-slider">
      <div className="slider-val"><Fmt v={v} unit={q.unit} /></div>
      <input type="range" min={q.min} max={q.max} step={q.step} value={v} onChange={(e) => setV(Number(e.target.value))} />
      <div className="slider-ends"><span><Fmt v={q.min} unit={q.unit} /></span><span><Fmt v={q.max} unit={q.unit} /></span></div>
      <div className="nudge">
        <button className="btn ghost" onClick={() => nudge(-1)} aria-label="Decrease">−</button>
        <button className="btn ghost" onClick={() => nudge(1)} aria-label="Increase">+</button>
      </div>
      <Submit busy={busy} sent={sent} onClick={() => onSubmit(v)} />
    </div>
  );
}

function TextIn({ sent, busy, onSubmit }) {
  const [v, setV] = useState(sent || '');
  return (
    <form className="p-text" onSubmit={(e) => { e.preventDefault(); if (v.trim()) onSubmit(v.trim()); }}>
      <input value={v} onChange={(e) => setV(e.target.value)} placeholder="Your answer" maxLength={60} autoComplete="off" />
      <Submit busy={busy} sent={sent} disabled={!v.trim()} onClick={() => v.trim() && onSubmit(v.trim())} />
    </form>
  );
}

function Reveal({ q, sent, busy, onSubmit }) {
  const [v, setV] = useState('');
  const pts = Math.round(q.points * Math.max(0.3, (q.stages - q.stage) / q.stages));
  const locked = sent !== undefined && sent !== null;
  return (
    <>
      {q.src && <img className="p-reveal" key={q.src} src={q.src} alt="Mystery photo, zoomed in" />}
      <p className="hint top">{locked ? 'Locked in! No changes on photo rounds.' : `Answer now for ${pts} pts. Wait for more zoom and it's worth less.`}</p>
      {q.options ? (
        <ChoiceButtons q={q} picked={sent} onPick={(id) => !locked && onSubmit(id)} disabled={busy || locked} />
      ) : locked ? (
        <div className="locked-answer">“{sent}”</div>
      ) : (
        <form className="p-text" onSubmit={(e) => { e.preventDefault(); if (v.trim()) onSubmit(v.trim()); }}>
          <input value={v} onChange={(e) => setV(e.target.value)} placeholder="What is it?" maxLength={60} autoComplete="off" />
          <Submit busy={busy} sent={undefined} disabled={!v.trim()} onClick={() => v.trim() && onSubmit(v.trim())} label={`Lock in for ${pts}`} />
        </form>
      )}
    </>
  );
}
