// The room engine. Transport-agnostic: Lambda + DynamoDB in production,
// an in-memory store + `ws` server for local development.
import { randomBytes, randomUUID } from 'node:crypto';
import { quiz, questions } from '../../shared/quiz.js';
import { scorePosition, revealFor, publicQuestion, hintFor } from '../../shared/scoring.js';
import { clamp01 } from '../../shared/spatial.js';
import { initialsOf, assignColor } from '../../shared/avatar.js';
import { POWER_IDS, powerStatus, activePowers, isActive } from '../../shared/powers.js';
import type { Store, Transport, Room, Player, Results, PlayerResult } from './types.js';

// Moves arriving up to this long after endsAt still count (network latency).
export const GRACE_MS = 1000;

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

type Msg = { type: string; [k: string]: unknown };
type Target = { conn: string; playerId?: string };

export class Core {
  constructor(
    private store: Store,
    private transport: Transport,
    private opts: { hostPin?: string } = {},
  ) {}

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
        case 'host:start':
        case 'host:next': return this.hostNext(connId);
        case 'host:end': return this.hostEnd(connId);
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
      hostConn: connId, hostToken: randomUUID(), results: null, createdAt: Date.now(),
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
    if (room.phase === 'question') return; // use host:end first
    const next = room.qIndex + 1;
    if (next >= questions.length) {
      await this.store.updateRoom(room.code, { phase: 'final', endsAt: null, results: null });
      return this.broadcastState({ ...room, phase: 'final', endsAt: null, results: null });
    }
    const q = questions[next];
    const endsAt = Date.now() + q.timeLimit * 1000;
    // Everyone starts off the board for a new question.
    const players = await this.store.listPlayers(room.code);
    await Promise.all(players.map((p) => this.store.updatePlayer(room.code, p.id, { x: null, y: null, placedQ: null, placedAt: null })));
    const patch: Partial<Room> = { phase: 'question', qIndex: next, endsAt, results: null };
    await this.store.updateRoom(room.code, patch);
    await this.transport.scheduleFinalize(room.code, next, endsAt + GRACE_MS);
    await this.broadcastState({ ...room, ...patch });
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
    const patch: Partial<Room> = { phase: 'lobby', qIndex: -1, endsAt: null, results: null };
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
    const x = clamp01(msg.x), y = clamp01(msg.y);
    const player = await this.store.getPlayer(room.code, conn.playerId);
    if (!player) return;
    await this.store.updatePlayer(room.code, player.id, { x, y, placedQ: room.qIndex, placedAt: Date.now() });
    const pos = { type: 'pos', id: player.id, x, y };
    // Invisible players' positions only ever go back to themselves.
    if (isActive(player.powers, 'invisible', room.qIndex)) await this.transport.send(connId, pos);
    else await this.broadcast(room, () => pos);
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
    const status = powerStatus(player.powers, id, q.round, room.qIndex);
    if (status === 'active') return; // already on
    if (status === 'used') return this.transport.send(connId, { type: 'error', message: 'Already used this round' });
    const powers = { ...player.powers, [id]: { round: q.round, q: room.qIndex } };
    await this.store.updatePlayer(room.code, player.id, { powers });
    await this.broadcastState(room);
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
    const won = await this.store.updateRoom(code, { phase: 'reveal', results, endsAt: null }, { phase: 'question', qIndex });
    if (!won) return;
    await Promise.all(players.map((p) => {
      const r = perPlayer[p.id];
      return r && r.delta ? this.store.updatePlayer(code, p.id, { score: p.score + r.delta }) : Promise.resolve();
    }));
    await this.broadcastState({ ...room, phase: 'reveal', results, endsAt: null });
  }

  // -------------------------------------------------------------- outbound

  // State is tailored per viewer: you always see your own position and
  // power-ups, but invisible players are stripped out for everyone else.
  private async broadcastState(room: Room) {
    const players = await this.store.listPlayers(room.code);
    await this.broadcast(room, (t) => buildState(room, players, t.playerId ?? null), players);
  }

  private async broadcast(room: Room, build: (t: Target) => object, players?: Player[]) {
    players = players ?? (await this.store.listPlayers(room.code));
    const targets: Target[] = [];
    if (room.hostConn) targets.push({ conn: room.hostConn });
    for (const p of players) if (p.conn) targets.push({ conn: p.conn, playerId: p.id });
    await Promise.all(
      targets.map(async (t) => {
        const ok = await this.transport.send(t.conn, build(t));
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

export function buildState(room: Room, players: Player[], viewerId: string | null) {
  const total = questions.length;
  const q = room.qIndex >= 0 && room.qIndex < total ? questions[room.qIndex] : null;
  const showLive = room.phase === 'question';
  const results = room.phase === 'reveal' ? room.results : null;
  const me = viewerId ? players.find((p) => p.id === viewerId) : null;
  return {
    type: 'state',
    serverNow: Date.now(),
    quiz: { title: quiz.title, subtitle: quiz.subtitle, total, speedBonus: quiz.settings?.speedBonus ?? 0, rounds: quiz.rounds.map((r) => ({ title: r.title, count: r.questions.length })) },
    room: { code: room.code, phase: room.phase, qIndex: room.qIndex, endsAt: room.endsAt, hostOnline: !!room.hostConn },
    question: q && room.phase !== 'final' ? publicQuestion(q, room.qIndex, total) : null,
    reveal: results?.reveal ?? null,
    me: me && q && room.phase !== 'final'
      ? {
          powers: Object.fromEntries(POWER_IDS.map((id) => [id, powerStatus(me.powers, id, q.round, room.qIndex)])),
          hint: showLive && isActive(me.powers, 'reveal', room.qIndex) ? hintFor(q) : null,
        }
      : null,
    players: players
      .map((p) => {
        const live = showLive && p.placedQ === room.qIndex;
        const hidden = showLive && p.id !== viewerId && isActive(p.powers, 'invisible', room.qIndex);
        const r = results?.perPlayer[p.id] ?? null;
        const powers = showLive ? activePowers(p.powers, room.qIndex) : r?.powers ?? [];
        return {
          id: p.id, name: p.name, tag: p.tag, color: p.color, score: p.score, online: !!p.conn,
          x: hidden ? null : live ? p.x : r ? r.x : null,
          y: hidden ? null : live ? p.y : r ? r.y : null,
          hidden,
          // Power-ups are private: only you ever learn what you used.
          powers: p.id === viewerId ? powers : [],
          result: r ? { value: r.value, delta: r.delta, correct: r.correct, fastest: !!r.fastest } : results ? { value: null, delta: 0, correct: false, fastest: false } : null,
        };
      })
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)),
  };
}
