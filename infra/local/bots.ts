// Simulated players. They join over the real WebSocket, so the server treats
// them exactly like phones. Each bot has a personality: accuracy, how early
// it settles, how much it fidgets, whether it copies someone, and how often it
// uses power-ups. Bots know the answers (they import the quiz), and their
// accuracy decides how close they land.
//
//   npm run bots -- --code ABCD                 # 4 bots against localhost:8787
//   npm run bots -- --code ABCD --n 8 --url wss://xyz.ngrok.app/ws
//   npm run bots -- --code ABCD --url wss://<api-id>.execute-api.eu-west-2.amazonaws.com/prod
import WebSocket from 'ws';
import { questions } from '../../shared/quiz.js';
import { zonesFor, rangeX, xyPosition, WAGER_FULL_AT, clamp01 } from '../../shared/spatial.js';
import { COLORS, initialsOf } from '../../shared/avatar.js';
import { POWER_IDS } from '../../shared/powers.js';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1] ?? 'true'] : [])).filter((x) => x.length));
const CODE = String(args.code || '').toUpperCase();
const N = Number(args.n || 4);
const URL = String(args.url || 'ws://localhost:8787/ws');
if (!CODE) { console.error('Usage: bots --code ABCD [--n 4] [--url ws://localhost:8787/ws]'); process.exit(1); }

const NAMES = ['Grace Hopper', 'Alan Turing', 'Ada Byron', 'Linus T', 'Margaret H', 'Dennis R', 'Barbara L', 'Ken T', 'Radia P', 'Tim BL', 'Hedy L', 'Guido vR'];
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5; // roughly -1..1, centred

interface Personality {
  accuracy: number;   // 0..1: how close to the real answer it lands
  settleAt: number;   // fraction of the clock at which it stops moving
  fidget: number;     // how many wrong places it visits first
  copycat: boolean;   // follows another avatar instead of thinking
  powerLust: number;  // chance per question to fire a power-up
}

class Bot {
  ws!: WebSocket;
  playerId: string | null = null;
  qIndex = -1;
  timers: NodeJS.Timeout[] = [];
  others = new Map<string, { x: number; y: number }>();
  followId: string | null = null;
  me = { x: 0.5, y: 0.5 };
  placed = false;
  constructor(public name: string, public tag: string, public color: string, public p: Personality) {}

  start() {
    this.ws = new WebSocket(URL);
    this.ws.on('open', () => this.send({ type: 'player:join', code: CODE, name: this.name, color: this.color, playerId: this.playerId ?? undefined }));
    this.ws.on('message', (d) => this.onMessage(JSON.parse(d.toString())));
    this.ws.on('close', () => { this.clear(); setTimeout(() => this.start(), 1500); });
    this.ws.on('error', (e) => console.error(`${this.name}: ${e.message}`));
  }
  send(m: object) { if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m)); }
  clear() { this.timers.forEach(clearTimeout); this.timers = []; }
  after(ms: number, fn: () => void) { this.timers.push(setTimeout(fn, ms)); }

  onMessage(m: any) {
    if (m.type === 'player:ok') { this.playerId = m.playerId; log(`${this.name} joined as ${this.tag}`); return; }
    if (m.type === 'error') { log(`${this.name}: ⚠ ${m.message}`); return; }
    if (m.type === 'pos' && m.id !== this.playerId) { this.others.set(m.id, { x: m.x, y: m.y }); return; }
    if (m.type !== 'state') return;
    for (const p of m.players) if (p.id !== this.playerId && p.x !== null) this.others.set(p.id, { x: p.x, y: p.y });
    if (m.room.phase === 'question' && m.room.qIndex !== this.qIndex) {
      this.qIndex = m.room.qIndex;
      this.others.clear();
      this.followId = this.p.copycat ? pick(m.players.filter((p: any) => p.id !== this.playerId).map((p: any) => p.id)) ?? null : null;
      this.placed = false;
      this.playQuestion(m.question, m.room.endsAt - m.serverNow);
    }
    if (m.room.phase === 'reveal' && m.room.qIndex === this.qIndex) {
      this.clear();
      const mine = m.players.find((p: any) => p.id === this.playerId);
      if (mine?.result) log(`${this.name.padEnd(14)} ${String(mine.result.delta).padStart(3)} ${mine.result.fastest ? '🏁' : '  '} total ${mine.score}`);
      this.qIndex = -1;
    }
    if (m.room.phase !== 'question') this.clear();
  }

  playQuestion(q: any, msLeft: number) {
    this.clear();
    const full = questions.find((x) => x.id === q.id) as any;
    const target = full ? this.aimFor(full) : { x: Math.random(), y: Math.random() };
    const settle = msLeft * this.p.settleAt;
    // Wander through a few wrong spots, then head for the target.
    const stops = Array.from({ length: this.p.fidget }, () => ({ x: Math.random(), y: Math.random() }));
    stops.push(target);
    stops.forEach((stop, i) => this.after((settle * (i + 1)) / stops.length - rnd(200, 600), () => this.glideTo(stop)));
    // Copycats keep re-aiming at their victim until the clock runs out.
    if (this.followId) {
      const tick = () => {
        const v = this.others.get(this.followId!);
        if (v) this.glideTo({ x: clamp01(v.x + gauss() * 0.03), y: clamp01(v.y + gauss() * 0.03) });
        if (msLeft > 600) this.after(900, tick);
        msLeft -= 900;
      };
      this.after(settle * 0.6, tick);
    }
    if (Math.random() < this.p.powerLust) {
      this.after(rnd(500, Math.max(600, settle)), () => {
        const power = pick(POWER_IDS.filter((id) => id !== 'bump' || this.placed));
        const target = power === 'possess' ? pick([...this.others.keys()]) : undefined;
        if (power === 'possess' && !target) return;
        log(`${this.name} uses ${power}${target ? ' on someone' : ''}`);
        this.send({ type: 'player:power', power, target });
      });
    }
  }

  // Where a bot of this accuracy ends up for a question it "knows".
  aimFor(q: any) {
    const err = (1 - this.p.accuracy) * Math.abs(gauss()) * 1.5; // 0 = perfect
    switch (q.type) {
      case 'choice': {
        const zones = zonesFor(q.options);
        const right = zones.find((z: any) => z.id === q.answer)!;
        const z = Math.random() < this.p.accuracy ? right : pick(zones.filter((z: any) => z.id !== q.answer)) ?? right;
        return { x: z.x + z.w * rnd(0.2, 0.8), y: z.y + z.h * rnd(0.2, 0.8) };
      }
      case 'range': {
        const value = q.answer + gauss() * err * (q.max - q.min) * 0.5;
        return { x: rangeX(q, Math.max(q.min, Math.min(q.max, value))), y: rnd(0.25, 0.75) };
      }
      case 'xy': {
        const { x: ax, y: ay } = q.axes;
        const v = { x: q.answer.x + gauss() * err * (ax.max - ax.min) * 0.5, y: q.answer.y + gauss() * err * (ay.max - ay.min) * 0.5 };
        return xyPosition(q, v);
      }
      case 'wager': {
        const side = Math.random() < this.p.accuracy ? q.answer : q.answer === 'left' ? 'right' : 'left';
        const stake = rnd(0.1, 1) * this.p.accuracy;
        return { x: 0.5 + (side === 'left' ? -1 : 1) * stake * WAGER_FULL_AT, y: rnd(0.3, 0.7) };
      }
      default: return { x: Math.random(), y: Math.random() };
    }
  }

  // Move in a few steps so it looks like a drag, not a teleport.
  glideTo(to: { x: number; y: number }) {
    const from = { ...this.me };
    const steps = 6;
    for (let i = 1; i <= steps; i++) {
      this.after(i * 70, () => {
        const t = i / steps;
        this.me = { x: clamp01(from.x + (to.x - from.x) * t + gauss() * 0.004), y: clamp01(from.y + (to.y - from.y) * t + gauss() * 0.004) };
        this.placed = true;
        this.send({ type: 'player:move', x: this.me.x, y: this.me.y, release: i === steps });
      });
    }
  }
}

const log = (s: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${s}`);

const names = [...NAMES].sort(() => Math.random() - 0.5).slice(0, N);
names.forEach((name, i) => {
  const tag = initialsOf(name);
  const p: Personality = {
    accuracy: rnd(0.3, 0.95),
    settleAt: rnd(0.25, 0.9),
    fidget: Math.floor(rnd(0, 3)),
    copycat: i === N - 1 && N > 1, // the last bot is always a copycat
    powerLust: rnd(0.1, 0.6),
  };
  log(`${name.padEnd(14)} accuracy ${p.accuracy.toFixed(2)} settles at ${(p.settleAt * 100).toFixed(0)}% fidget ${p.fidget}${p.copycat ? ' COPYCAT' : ''} power-ups ${(p.powerLust * 100).toFixed(0)}%`);
  setTimeout(() => new Bot(name, tag, pick(COLORS), p).start(), i * 300);
});
log(`${N} bots heading for room ${CODE} at ${URL}. Ctrl-C to stop.`);
