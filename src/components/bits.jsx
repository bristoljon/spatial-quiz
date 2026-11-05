import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { secondsLeft, useTick } from '../api.js';

export const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

export function Stars({ n }) {
  if (n == null) return null;
  return (
    <span className="stars" aria-label={`${n} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => <span key={i} className={i <= n ? 'on' : ''}>★</span>)}
    </span>
  );
}

export function Quote({ quote, big }) {
  if (!quote) return null;
  return (
    <figure className={`quote ${big ? 'big' : ''}`}>
      <Stars n={quote.stars} />
      <blockquote>“{quote.text}”</blockquote>
      <figcaption>— a real online review</figcaption>
    </figure>
  );
}

export function Timer({ state, compact }) {
  useTick(200);
  const total = state?.question?.timeLimit || 30;
  const left = secondsLeft(state);
  if (state?.phase !== 'question') return null;
  const frac = Math.max(0, Math.min(1, left / total));
  const urgent = left <= 5;
  return (
    <div className={`timer ${compact ? 'compact' : ''} ${urgent ? 'urgent' : ''}`}>
      <div className="timer-bar"><div style={{ transform: `scaleX(${frac})` }} /></div>
      <span className="timer-num">{Math.ceil(left)}</span>
    </div>
  );
}

export function QR({ text, size = 220 }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    QRCode.toString(text, { type: 'svg', margin: 1, color: { dark: '#0c1d16', light: '#f4f1e8' } })
      .then(setSvg).catch(() => setSvg(''));
  }, [text]);
  return <div className="qr" style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: svg }} />;
}

export function Fmt({ v, unit }) {
  const n = Number(v);
  const s = Number.isInteger(n) ? String(n) : n.toFixed(1);
  return <>{s}{unit}</>;
}

export function Hills() {
  // the five valleys, abstractly
  return (
    <svg className="hills" viewBox="0 0 1600 300" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0 220 C200 140 320 250 520 180 S860 120 1000 200 S1350 150 1600 210 V300 H0Z" fill="#163a2a" />
      <path d="M0 250 C180 200 360 280 600 230 S950 190 1150 250 S1450 220 1600 250 V300 H0Z" fill="#1d4a35" />
      <path d="M0 280 C260 250 420 300 700 270 S1100 250 1300 280 S1500 270 1600 285 V300 H0Z" fill="#256044" />
    </svg>
  );
}
