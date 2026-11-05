// The room engine. Transport-agnostic: Lambda + DynamoDB in production,
// an in-memory store + `ws` server for local development.
import { randomBytes, randomUUID } from 'node:crypto';
import { quiz } from '../../shared/quiz.js';
import { scorePosition, revealFor, publicQuestion } from '../../shared/scoring.js';
import { clamp01 } from '../../shared/spatial.js';
import type { Store, Transport, Room, Player, Conn, Results, PlayerResult } from './types.js';

// Moves arriving up to this long after endsAt still count (network latency).
export const GRACE_MS = 1000;

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const EMOJI_RE = /^\p{Extended_Pictographic}(‍\p{Extended_Pictographic}|️|\p{Emoji_Modifier})*$/u;

type Msg = { type: string; [k: string]: unknown };

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
    if (next >= quiz.questions.length) {
      await this.store.updateRoom(room.code, { phase: 'final', endsAt: null, results: null });
      return this.broadcastState({ ...room, phase: 'final', endsAt: null, results: null });
    }
    const q = quiz.questions[next];
    const endsAt = Date.now() + q.timeLimit * 1000;
    // Everyone starts off the board for a new question.
    const players = await this.store.listPlayers(room.code);
    await Promise.all(players.map((p) => this.store.updatePlayer(room.code, p.id, { x: null, y: null, placedQ: null })));
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
    await Promise.all(players.map((p) => this.store.updatePlayer(room.code, p.id, { score: 0, x: null, y: null, placedQ: null })));
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
    const emoji = EMOJI_RE.test(String(msg.emoji || '')) ? String(msg.emoji) : '🙂';
    let player: Player | null = null;
    if (typeof msg.playerId === 'string') player = await this.store.getPlayer(code, msg.playerId);

    if (player) {
      // Reconnect. Only the connection changes, so a dropped phone keeps its score and position.
      await this.store.updatePlayer(code, player.id, { conn: connId });
      player.conn = connId;
    } else {
      if (!name) return this.transport.send(connId, { type: 'error', message: 'Pick a name' });
      player = {
        room: code, id: randomUUID(), name, emoji, initials: initialsOf(name),
        score: 0, conn: connId, x: null, y: null, placedQ: null,
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
    await this.store.updatePlayer(room.code, conn.playerId, { x, y, placedQ: room.qIndex });
    await this.broadcast(room, { type: 'pos', id: conn.playerId, x, y }, connId);
  }

  // --------------------------------------------------------------- finalize

  // Idempotent: called by the timer and by the host's "end now". Whoever gets
  // the conditional write wins; the other call is a no-op.
  async finalize(code: string, qIndex: number) {
    const room = await this.store.getRoom(code);
    if (!room || room.phase !== 'question' || room.qIndex !== qIndex) return;
    const q = quiz.questions[qIndex];
    const players = await this.store.listPlayers(code);
    const perPlayer: Results['perPlayer'] = {};
    for (const p of players) {
      const placed = p.placedQ === qIndex && p.x !== null && p.y !== null;
      const scored = placed ? scorePosition(q, { x: p.x!, y: p.y! }) : null;
      perPlayer[p.id] = scored ? { x: p.x!, y: p.y!, ...scored } as PlayerResult : null;
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

  private async broadcastState(room: Room) {
    const players = await this.store.listPlayers(room.code);
    const state = buildState(room, players);
    await this.broadcast(room, state, undefined, players);
  }

  private async broadcast(room: Room, msg: object, exceptConn?: string, players?: Player[]) {
    players = players ?? (await this.store.listPlayers(room.code));
    const targets: { conn: string; playerId?: string }[] = [];
    if (room.hostConn) targets.push({ conn: room.hostConn });
    for (const p of players) if (p.conn) targets.push({ conn: p.conn, playerId: p.id });
    await Promise.all(
      targets
        .filter((t) => t.conn !== exceptConn)
        .map(async (t) => {
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

export function buildState(room: Room, players: Player[]) {
  const total = quiz.questions.length;
  const q = room.qIndex >= 0 && room.qIndex < total ? quiz.questions[room.qIndex] : null;
  const showLive = room.phase === 'question';
  const results = room.phase === 'reveal' ? room.results : null;
  return {
    type: 'state',
    serverNow: Date.now(),
    quiz: { title: quiz.title, subtitle: quiz.subtitle, total },
    room: { code: room.code, phase: room.phase, qIndex: room.qIndex, endsAt: room.endsAt, hostOnline: !!room.hostConn },
    question: q && room.phase !== 'final' ? publicQuestion(q, room.qIndex, total) : null,
    reveal: results?.reveal ?? null,
    players: players
      .map((p) => {
        const live = showLive && p.placedQ === room.qIndex;
        const r = results?.perPlayer[p.id] ?? null;
        return {
          id: p.id, name: p.name, emoji: p.emoji, initials: p.initials, score: p.score, online: !!p.conn,
          x: live ? p.x : r ? r.x : null,
          y: live ? p.y : r ? r.y : null,
          result: r ? { value: r.value, delta: r.delta, correct: r.correct } : results ? { value: null, delta: 0, correct: false } : null,
        };
      })
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)),
  };
}

function initialsOf(name: string) {
  const parts = name.split(/\s+/).filter(Boolean);
  const s = parts.length >= 2 ? parts[0][0] + parts[parts.length - 1][0] : name.slice(0, 2);
  return s.toUpperCase();
}
