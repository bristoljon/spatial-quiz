// The room engine. Transport-agnostic: Lambda + DynamoDB in production,
// an in-memory store + `ws` server for local development.
import { randomBytes, randomUUID } from 'node:crypto';
import { quiz, questions } from '../../shared/quiz.js';
import { scorePosition, revealFor, publicQuestion, hintFor, hostClock, holdsReveal } from '../../shared/scoring.js';
import { clamp01 } from '../../shared/spatial.js';
import { initialsOf, assignColor } from '../../shared/avatar.js';
import { POWER_IDS, powerStatus, activePowers, isActive, mirrored, bumpTargets } from '../../shared/powers.js';
import type { Store, Transport, Room, Player, Results, PlayerResult, Effect, VideoState } from './types.js';

// Moves arriving up to this long after endsAt still count (network latency).
export const GRACE_MS = 1000;

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

type Msg = { type: string; [k: string]: unknown };
type Target = { conn: string; playerId?: string };

type Replenish = 'never' | 'round' | 'random';

export class Core {
  private replenish: Replenish;
  private randomChance: number;
  constructor(
    private store: Store,
    private transport: Transport,
    private opts: { hostPin?: string; replenish?: Replenish; randomChance?: number; random?: () => number } = {},
  ) {
    const cfg = (quiz.settings as any)?.powerUps ?? {};
    this.replenish = opts.replenish ?? cfg.replenish ?? 'round';
    this.randomChance = opts.randomChance ?? cfg.randomChance ?? 0.3;
    buildReplenish = this.replenish;
  }

  // ---------------------------------------------------------------- inbound

  async onDisconnect(connId: string) {
    const conn = await this.store.getConn(connId);
    if (!conn) return;
    await this.store.deleteConn(connId);
    const room = await this.store.getRoom(conn.room);
    if (!room) return;
    if (conn.role === 'host' && room.hostConn === connId) {
      await this.store.updateRoom(room.code, { hostConn: null });
      room.hostConn = null;
    } else if (conn.role === 'player' && conn.playerId) {
      const p = await this.store.getPlayer(room.code, conn.playerId);
      if (p && p.conn === connId) await this.store.updatePlayer(room.code, p.id, { conn: null });
    }
    await this.broadcastState(room);
  }

  async onMessage(connId: string, raw: string) {
    let msg: Msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return this.transport.send(connId, { type: 'error', message: 'Bad JSON' });
    }
    try {
      switch (msg.type) {
        case 'ping': return this.transport.send(connId, { type: 'pong', serverNow: Date.now(), t: msg.t });
        case 'host:create': return this.hostCreate(connId, msg);
        case 'host:join': return this.hostJoin(connId, msg);
        case 'player:join': return this.playerJoin(connId, msg);
        case 'player:move': return this.playerMove(connId, msg);
        case 'player:power': return this.playerPower(connId, msg);
        case 'player:drop': return this.playerDrop(connId);
        case 'player:loaded': return this.playerLoaded(connId, msg);
        case 'host:start':
        case 'host:next': return this.hostNext(connId);
        case 'host:end': return this.hostEnd(connId);
        case 'host:clock': return this.hostClock(connId, msg);
        case 'host:video': return this.hostVideo(connId, msg);
        case 'host:reveal': return this.hostReveal(connId);
        case 'host:reset': return this.hostReset(connId);
        default: return this.transport.send(connId, { type: 'error', message: `Unknown message ${msg.type}` });
      }
    } catch (err) {
      console.error('onMessage failed', msg.type, err);
      return this.transport.send(connId, { type: 'error', message: 'Something went wrong' });
    }
  }

  // ------------------------------------------------------------------- host

  private async hostCreate(connId: string, msg: Msg) {
    if (this.opts.hostPin && msg.pin !== this.opts.hostPin) {
      return this.transport.send(connId, { type: 'error', message: 'Wrong host PIN' });
    }
    let code = '';
    for (let i = 0; i < 10; i++) {
      code = this.newCode();
      if (!(await this.store.getRoom(code))) break;
    }
    const room: Room = {
      code, phase: 'lobby', qIndex: -1, endsAt: null,
      hostConn: connId, hostToken: randomUUID(), results: null, effects: [], replenishedAt: 0, createdAt: Date.now(),
    };
    await this.store.putRoom(room);
    await this.store.putConn({ id: connId, room: code, role: 'host' });
    await this.transport.send(connId, { type: 'host:ok', code, token: room.hostToken });
    await this.broadcastState(room);
  }

  private async hostJoin(connId: string, msg: Msg) {
    const room = await this.store.getRoom(String(msg.code || '').toUpperCase());
    if (!room) return this.transport.send(connId, { type: 'error', message: 'No such room', fatal: true });
    if (room.hostToken !== msg.token) return this.transport.send(connId, { type: 'error', message: 'Not the host of this room', fatal: true });
    await this.store.updateRoom(room.code, { hostConn: connId });
    room.hostConn = connId;
    await this.store.putConn({ id: connId, room: room.code, role: 'host' });
    await this.transport.send(connId, { type: 'host:ok', code: room.code, token: room.hostToken });
    await this.broadcastState(room);
  }

  private async requireHost(connId: string): Promise<Room | null> {
    const conn = await this.store.getConn(connId);
    if (!conn || conn.role !== 'host') {
      await this.transport.send(connId, { type: 'error', message: 'Host only' });
      return null;
    }
    return this.store.getRoom(conn.room);
  }

  private async hostNext(connId: string) {
    const room = await this.requireHost(connId);
    if (!room) return;
    if (room.phase === 'question' || room.phase === 'locked') return; // use host:end / host:reveal first
    const next = room.qIndex + 1;
    const players = await this.store.listPlayers(room.code);
    // Leaving a practice round: everything earned in it is wiped, so the
    // next round starts level. The reveal before this still showed the points.
    if (leavesPractice(room.qIndex)) {
      await Promise.all(players.map((p) => this.store.updatePlayer(room.code, p.id, { score: 0 })));
    }
    if (next >= questions.length) {
      await this.store.updateRoom(room.code, { phase: 'final', endsAt: null, results: null });
      return this.broadcastState({ ...room, phase: 'final', endsAt: null, results: null });
    }
    const q = questions[next];
    // Everyone starts off the board for a new question.
    await Promise.all(players.map((p) => this.store.updatePlayer(room.code, p.id, { x: null, y: null, placedQ: null, placedAt: null })));
    // A host-started clock (every video question) opens in `intro`: the
    // question is on screen but nothing counts down until host:clock.
    const manual = hostClock(q);
    const endsAt = manual ? null : Date.now() + q.timeLimit * 1000;
    const patch: Partial<Room> = {
      phase: manual ? 'intro' : 'question', qIndex: next, endsAt, results: null, effects: [],
      video: q.type === 'video' ? { playing: false, t: 0, at: Date.now() } : null,
    };
    if (this.shouldReplenish(next)) patch.replenishedAt = next;
    await this.store.updateRoom(room.code, patch);
    if (endsAt) await this.transport.scheduleFinalize(room.code, next, endsAt + GRACE_MS);
    await this.broadcastState({ ...room, ...patch });
  }

  // intro -> question: start the countdown. For a video question the host's
  // clip is paused at `t` (the frame everyone answers against).
  private async hostClock(connId: string, msg: Msg) {
    const room = await this.requireHost(connId);
    if (!room || room.phase !== 'intro') return;
    const q = questions[room.qIndex];
    const endsAt = Date.now() + q.timeLimit * 1000;
    const patch: Partial<Room> = { phase: 'question', endsAt };
    if (room.video) patch.video = { playing: false, t: typeof msg.t === 'number' ? msg.t : videoTime(room.video), at: Date.now() };
    await this.store.updateRoom(room.code, patch);
    await this.transport.scheduleFinalize(room.code, room.qIndex, endsAt + GRACE_MS);
    await this.broadcastState({ ...room, ...patch });
  }

  // The host's player is the source of truth; everyone else follows it.
  // Allowed whenever the clock isn't running, so the clip can't move under
  // players mid-answer.
  private async hostVideo(connId: string, msg: Msg) {
    const room = await this.requireHost(connId);
    if (!room || !room.video || room.phase === 'question') return;
    const video: VideoState = { playing: !!msg.playing, t: Math.max(0, Number(msg.t) || 0), at: Date.now() };
    await this.store.updateRoom(room.code, { video });
    await this.broadcast(room, () => ({ type: 'video', ...video }));
  }

  // locked -> reveal: scores land now, so the leaderboard can't give the
  // game away while the clip plays out.
  private async hostReveal(connId: string) {
    const room = await this.requireHost(connId);
    if (!room || room.phase !== 'locked' || !room.results) return;
    const won = await this.store.updateRoom(room.code, { phase: 'reveal' }, { phase: 'locked', qIndex: room.qIndex });
    if (!won) return;
    await this.applyScores(room.code, room.results);
    await this.broadcastState({ ...room, phase: 'reveal' });
  }

  // Do used power-ups come back on this question?
  private shouldReplenish(qIndex: number) {
    if (qIndex === 0) return true;
    switch (this.replenish) {
      case 'never': return false;
      case 'round': return questions[qIndex].round !== questions[qIndex - 1].round;
      case 'random': return (this.opts.random ?? Math.random)() < this.randomChance;
    }
  }

  private async hostEnd(connId: string) {
    const room = await this.requireHost(connId);
    if (!room || room.phase !== 'question') return;
    await this.finalize(room.code, room.qIndex);
  }

  private async hostReset(connId: string) {
    const room = await this.requireHost(connId);
    if (!room) return;
    const players = await this.store.listPlayers(room.code);
    await Promise.all(players.map((p) => this.store.updatePlayer(room.code, p.id, { score: 0, x: null, y: null, placedQ: null, placedAt: null, powers: {} })));
    const patch: Partial<Room> = { phase: 'lobby', qIndex: -1, endsAt: null, results: null, effects: [], replenishedAt: 0 };
    await this.store.updateRoom(room.code, patch);
    await this.broadcastState({ ...room, ...patch });
  }

  // ----------------------------------------------------------------- player

  private async playerJoin(connId: string, msg: Msg) {
    const code = String(msg.code || '').toUpperCase().trim();
    const room = await this.store.getRoom(code);
    if (!room) return this.transport.send(connId, { type: 'error', message: 'No room with that code', fatal: true });

    const name = String(msg.name || '').trim().slice(0, 20);
    let player: Player | null = null;
    if (typeof msg.playerId === 'string') player = await this.store.getPlayer(code, msg.playerId);

    if (player) {
      // Reconnect. Only the connection changes, so a dropped phone keeps its score and position.
      await this.store.updatePlayer(code, player.id, { conn: connId });
      player.conn = connId;
    } else {
      if (!name) return this.transport.send(connId, { type: 'error', message: 'Pick a name' });
      const tag = initialsOf(name);
      const others = await this.store.listPlayers(code);
      const color = assignColor(String(msg.color || ''), tag, others);
      player = {
        room: code, id: randomUUID(), name, tag, color,
        score: 0, conn: connId, x: null, y: null, placedQ: null, placedAt: null, powers: {},
      };
      await this.store.putPlayer(player);
    }
    await this.store.putConn({ id: connId, room: code, role: 'player', playerId: player.id });
    await this.transport.send(connId, { type: 'player:ok', playerId: player.id, code });
    await this.broadcastState(room);
  }

  private async playerMove(connId: string, msg: Msg) {
    const conn = await this.store.getConn(connId);
    if (!conn || conn.role !== 'player' || !conn.playerId) return;
    const room = await this.store.getRoom(conn.room);
    if (!room || room.phase !== 'question' || !room.endsAt) return;
    if (Date.now() > room.endsAt + GRACE_MS) return;
    const player = await this.store.getPlayer(room.code, conn.playerId);
    if (!player) return;
    const effects = room.effects ?? [];
    // Possessed or locked: your own avatar doesn't answer to you.
    if (effects.some((e) => e.to === player.id)) return;
    const possessing = effects.find((e) => e.from === player.id && !e.dropped);
    const subject = possessing ? await this.store.getPlayer(room.code, possessing.to) : player;
    if (!subject) return;
    const x = clamp01(msg.x), y = clamp01(msg.y);
    await this.store.updatePlayer(room.code, subject.id, { x, y, placedQ: room.qIndex, placedAt: Date.now() });
    await this.broadcastPos(room, { ...subject, x, y });
    if (possessing && msg.release) await this.drop(room, possessing);
  }

  // A phone has a clip in memory. The host sees how many are ready before
  // starting the clock.
  private async playerLoaded(connId: string, msg: Msg) {
    const conn = await this.store.getConn(connId);
    if (!conn || conn.role !== 'player' || !conn.playerId) return;
    const src = String(msg.src || '');
    if (!VIDEO_SRCS.includes(src)) return;
    const room = await this.store.getRoom(conn.room);
    const player = await this.store.getPlayer(conn.room, conn.playerId);
    if (!room || !player || (player.loaded ?? []).includes(src)) return;
    await this.store.updatePlayer(room.code, player.id, { loaded: [...(player.loaded ?? []), src] });
    // Only the host cares, and only while a video question is on the intro screen.
    if (room.phase === 'intro' && questions[room.qIndex]?.type === 'video') await this.broadcastState(room);
  }

  private async playerDrop(connId: string) {
    const conn = await this.store.getConn(connId);
    if (!conn || conn.role !== 'player' || !conn.playerId) return;
    const room = await this.store.getRoom(conn.room);
    if (!room || room.phase !== 'question') return;
    const possessing = (room.effects ?? []).find((e) => e.from === conn.playerId && !e.dropped);
    if (possessing) await this.drop(room, possessing);
  }

  // Lock the victim where they are and hand control back to the possessor.
  private async drop(room: Room, effect: Effect) {
    const effects = (room.effects ?? []).map((e) => (e === effect || (e.from === effect.from && e.to === effect.to) ? { ...e, dropped: true } : e));
    await this.store.updateRoom(room.code, { effects });
    await this.broadcastState({ ...room, effects });
  }

  // A position as each viewer should see it: you (and whoever is possessing
  // you) see the truth; invisible players are withheld from everyone else;
  // mirrored ones are reflected.
  private async broadcastPos(room: Room, subject: Player) {
    const pos = { x: subject.x!, y: subject.y! };
    await this.broadcast(room, (t) => {
      if (seesTruth(t.playerId ?? null, subject.id, room)) return { type: 'pos', id: subject.id, ...pos };
      if (isActive(subject.powers, 'invisible', room.qIndex)) return null;
      const seen = isActive(subject.powers, 'mirror', room.qIndex) ? mirrored(pos) : pos;
      return { type: 'pos', id: subject.id, ...seen };
    });
  }

  private async playerPower(connId: string, msg: Msg) {
    const conn = await this.store.getConn(connId);
    if (!conn || conn.role !== 'player' || !conn.playerId) return;
    const room = await this.store.getRoom(conn.room);
    if (!room || room.phase !== 'question' || !room.endsAt || Date.now() > room.endsAt + GRACE_MS) {
      return this.transport.send(connId, { type: 'error', message: 'Power-ups can only be used during a question' });
    }
    const id = String(msg.power);
    if (!POWER_IDS.includes(id)) return this.transport.send(connId, { type: 'error', message: 'Unknown power-up' });
    const player = await this.store.getPlayer(room.code, conn.playerId);
    if (!player) return;
    const q = questions[room.qIndex];
    const status = powerStatus(player.powers, id, room.qIndex, room.replenishedAt ?? 0);
    if (status === 'active') return; // already on
    if (status === 'used') return this.transport.send(connId, { type: 'error', message: 'Already used this round' });

    let effects = room.effects ?? [];
    if (id === 'possess') {
      const target = typeof msg.target === 'string' ? await this.store.getPlayer(room.code, msg.target) : null;
      if (!target || target.id === player.id) return this.transport.send(connId, { type: 'error', message: 'Pick someone to possess' });
      if (effects.some((e) => e.from === player.id && !e.dropped)) return this.transport.send(connId, { type: 'error', message: 'You are already possessing someone' });
      if (effects.some((e) => e.to === target.id)) return this.transport.send(connId, { type: 'error', message: `${target.name} is already possessed` });
      if (isActive(target.powers, 'shield', room.qIndex)) {
        // Blocked. The attempt still costs you the power-up.
        await this.store.updatePlayer(room.code, player.id, { powers: { ...player.powers, possess: { q: room.qIndex } } });
        await this.transport.send(connId, { type: 'error', message: `🛡️ ${target.name} is shielded. Possess wasted.` });
        return this.broadcastState(room);
      }
      effects = [...effects, { type: 'possess', from: player.id, to: target.id, dropped: false }];
      await this.store.updateRoom(room.code, { effects });
    }
    if (id === 'bump') {
      if (player.placedQ !== room.qIndex || player.x === null) return this.transport.send(connId, { type: 'error', message: 'Place yourself on the board first' });
      const others = (await this.store.listPlayers(room.code)).filter((o) => o.id !== player.id && o.placedQ === room.qIndex && !isActive(o.powers, 'shield', room.qIndex));
      const moved = bumpTargets({ x: player.x, y: player.y! }, others, (quiz.settings as any)?.bump);
      const now = Date.now();
      await Promise.all(moved.map((m) => this.store.updatePlayer(room.code, m.id, { x: m.x, y: m.y, placedAt: now })));
      // The shockwave is drawn where you are, so it obeys your own invisibility/mirror.
      await this.broadcastFx(room, player, { type: 'bump', id: player.id, hits: moved.length });
      for (const m of moved) {
        const victim = others.find((o) => o.id === m.id)!;
        await this.broadcastPos(room, { ...victim, x: m.x, y: m.y });
      }
    }
    const powers = { ...player.powers, [id]: { q: room.qIndex } };
    await this.store.updatePlayer(room.code, player.id, { powers });
    await this.broadcastState({ ...room, effects });
  }

  // A one-off visual at a player's position, transformed per viewer like a pos.
  private async broadcastFx(room: Room, subject: Player, fx: { type: string; [k: string]: unknown }) {
    const pos = { x: subject.x!, y: subject.y! };
    await this.broadcast(room, (t) => {
      if (seesTruth(t.playerId ?? null, subject.id, room)) return { ...fx, ...pos };
      if (isActive(subject.powers, 'invisible', room.qIndex)) return null;
      return { ...fx, ...(isActive(subject.powers, 'mirror', room.qIndex) ? mirrored(pos) : pos) };
    });
  }

  // --------------------------------------------------------------- finalize

  // Idempotent: called by the timer and by the host's "end now". Whoever gets
  // the conditional write wins; the other call is a no-op.
  async finalize(code: string, qIndex: number) {
    const room = await this.store.getRoom(code);
    if (!room || room.phase !== 'question' || room.qIndex !== qIndex) return;
    const q = questions[qIndex];
    const players = await this.store.listPlayers(code);
    const perPlayer: Results['perPlayer'] = {};
    for (const p of players) {
      const placed = p.placedQ === qIndex && p.x !== null && p.y !== null;
      const scored = placed ? scorePosition(q, { x: p.x!, y: p.y! }) : null;
      if (!scored) { perPlayer[p.id] = null; continue; }
      const powers = activePowers(p.powers, qIndex);
      let delta = scored.delta;
      if (powers.includes('double') && delta > 0) delta *= 2;
      perPlayer[p.id] = { x: p.x!, y: p.y!, value: scored.value, correct: scored.correct, delta, powers } as PlayerResult;
    }
    // Speed bonus: of the players who got it right, whoever settled first.
    const bonus = quiz.settings?.speedBonus ?? 0;
    if (bonus > 0) {
      const fastest = players
        .filter((p) => { const r = perPlayer[p.id]; return r && r.correct && r.delta > 0 && p.placedAt; })
        .sort((a, b) => a.placedAt! - b.placedAt!)[0];
      if (fastest) {
        perPlayer[fastest.id]!.delta += bonus;
        perPlayer[fastest.id]!.fastest = true;
      }
    }
    const results: Results = { qIndex, reveal: revealFor(q), perPlayer };
    // Video questions hold the results back until the host has played the rest of the clip.
    const phase = holdsReveal(q) ? 'locked' : 'reveal';
    const won = await this.store.updateRoom(code, { phase, results, endsAt: null }, { phase: 'question', qIndex });
    if (!won) return;
    if (phase === 'reveal') await this.applyScores(code, results);
    await this.broadcastState({ ...room, phase, results, endsAt: null });
  }

  private async applyScores(code: string, results: Results) {
    const players = await this.store.listPlayers(code);
    await Promise.all(players.map((p) => {
      const r = results.perPlayer[p.id];
      return r && r.delta ? this.store.updatePlayer(code, p.id, { score: p.score + r.delta }) : Promise.resolve();
    }));
  }

  // -------------------------------------------------------------- outbound

  // State is tailored per viewer: you always see your own position and
  // power-ups, but invisible players are stripped out for everyone else.
  private async broadcastState(room: Room) {
    const players = await this.store.listPlayers(room.code);
    await this.broadcast(room, (t) => buildState(room, players, t.playerId ?? null), players);
  }

  private async broadcast(room: Room, build: (t: Target) => object | null, players?: Player[]) {
    players = players ?? (await this.store.listPlayers(room.code));
    const targets: Target[] = [];
    if (room.hostConn) targets.push({ conn: room.hostConn });
    for (const p of players) if (p.conn) targets.push({ conn: p.conn, playerId: p.id });
    await Promise.all(
      targets.map(async (t) => {
        const msg = build(t);
        if (!msg) return;
        const ok = await this.transport.send(t.conn, msg);
        if (ok) return;
        // Stale connection: forget it so we stop trying.
        await this.store.deleteConn(t.conn).catch(() => {});
        if (t.playerId) await this.store.updatePlayer(room.code, t.playerId, { conn: null }).catch(() => {});
        else await this.store.updateRoom(room.code, { hostConn: null }).catch(() => {});
      }),
    );
  }

  private newCode() {
    const bytes = randomBytes(4);
    return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
  }
}

let buildReplenish: Replenish = (quiz.settings as any)?.powerUps?.replenish ?? 'round';
// Is `qIndex` the last question of a practice round (so moving on from it
// resets the scores)?
export function leavesPractice(qIndex: number) {
  const q = qIndex >= 0 ? questions[qIndex] : null;
  if (!q || !q.practice) return false;
  const after = questions[qIndex + 1];
  return !after || after.round !== q.round;
}
// Every clip in the quiz, so phones can fetch them in the lobby.
export const VIDEO_SRCS: string[] = [...new Set(questions.filter((q: any) => q.type === 'video').map((q: any) => String(q.video.src)))];
// And every picture that's swapped in at the unveiling, so the swap is instant.
export const REVEAL_SRCS: string[] = [...new Set(questions.filter((q: any) => q.type === 'image' && q.image?.reveal).map((q: any) => String(q.image.reveal)))];
const pick = (e?: Effect) => (e ? { dropped: e.dropped } : null);

// Where the clip is now, given where it was and whether it's been playing since.
export function videoTime(v: VideoState, now = Date.now()) {
  return v.playing ? v.t + (now - v.at) / 1000 : v.t;
}

// You see your own true position, and so does anyone currently steering you.
function seesTruth(viewerId: string | null, subjectId: string, room: Room) {
  if (!viewerId) return false;
  if (viewerId === subjectId) return true;
  return (room.effects ?? []).some((e) => e.to === subjectId && e.from === viewerId && !e.dropped);
}

export function buildState(room: Room, players: Player[], viewerId: string | null) {
  const total = questions.length;
  const q = room.qIndex >= 0 && room.qIndex < total ? questions[room.qIndex] : null;
  // Positions are live (and invisibility/mirror apply) while the clock runs
  // and while answers are locked in waiting for the reveal.
  const showLive = room.phase === 'question' || room.phase === 'locked';
  const results = room.phase === 'reveal' ? room.results : null;
  const me = viewerId ? players.find((p) => p.id === viewerId) : null;
  return {
    type: 'state',
    serverNow: Date.now(),
    quiz: { title: quiz.title, subtitle: quiz.subtitle, total, speedBonus: quiz.settings?.speedBonus ?? 0, replenish: buildReplenish, rounds: quiz.rounds.map((r) => ({ title: r.title, count: r.questions.length, practice: !!(r as any).practice })), videos: VIDEO_SRCS, images: REVEAL_SRCS },
    room: {
      code: room.code, phase: room.phase, qIndex: room.qIndex, endsAt: room.endsAt, hostOnline: !!room.hostConn,
      replenished: (room.phase === 'question' || room.phase === 'intro') && (room.replenishedAt ?? 0) === room.qIndex,
      video: room.video ?? null,
    },
    question: q && room.phase !== 'final' ? publicQuestion(q, room.qIndex, total) : null,
    reveal: results?.reveal ?? null,
    me: me && q && room.phase !== 'final'
      ? {
          powers: Object.fromEntries(POWER_IDS.map((id) => [id, powerStatus(me.powers, id, room.qIndex, room.replenishedAt ?? 0)])),
          hint: showLive && isActive(me.powers, 'reveal', room.qIndex) ? hintFor(q) : null,
          // Who you're steering, and whether someone has you.
          placed: showLive && me.placedQ === room.qIndex && me.x !== null,
          possessing: showLive ? (room.effects ?? []).find((e) => e.from === me.id && !e.dropped)?.to ?? null : null,
          possessed: showLive ? pick((room.effects ?? []).find((e) => e.to === me.id)) : null,
        }
      : null,
    players: players
      .map((p) => {
        const live = showLive && p.placedQ === room.qIndex;
        const truth = seesTruth(viewerId, p.id, room);
        const hidden = showLive && !truth && isActive(p.powers, 'invisible', room.qIndex);
        const flip = showLive && !truth && isActive(p.powers, 'mirror', room.qIndex);
        const r = results?.perPlayer[p.id] ?? null;
        const powers = showLive ? activePowers(p.powers, room.qIndex) : r?.powers ?? [];
        const livePos = live && p.x !== null ? (flip ? mirrored({ x: p.x, y: p.y! }) : { x: p.x, y: p.y! }) : null;
        return {
          id: p.id, name: p.name, tag: p.tag, color: p.color, score: p.score, online: !!p.conn,
          ready: q?.type === 'video' ? (p.loaded ?? []).includes((q as any).video.src) : undefined,
          x: hidden ? null : live ? livePos!.x : r ? r.x : null,
          y: hidden ? null : live ? livePos!.y : r ? r.y : null,
          hidden,
          // Power-ups are private: only you ever learn what you used.
          powers: p.id === viewerId ? powers : [],
          result: r ? { value: r.value, delta: r.delta, correct: r.correct, fastest: !!r.fastest } : results ? { value: null, delta: 0, correct: false, fastest: false } : null,
        };
      })
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)),
  };
}
