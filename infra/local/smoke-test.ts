// Drives the Core through a whole game with fake connections and asserts
// the scoring. Run with: npm test  (from repo root or infra/)
import assert from 'node:assert/strict';
import { Core, GRACE_MS } from '../lambda/core.js';
import { MemStore } from './mem-store.js';
import type { Transport } from '../lambda/types.js';
import { quiz } from '../../shared/quiz.js';
import { zonesFor, rangeX, xyPosition } from '../../shared/spatial.js';

const inbox = new Map<string, any[]>();
const timers: { code: string; q: number; fireAt: number }[] = [];
const transport: Transport = {
  async send(conn, msg) { if (!inbox.has(conn)) return false; inbox.get(conn)!.push(msg); return true; },
  async scheduleFinalize(code, q, fireAt) { timers.push({ code, q, fireAt }); },
};
const open = (id: string) => { inbox.set(id, []); return id; };
const last = (id: string, type: string) => [...inbox.get(id)!].reverse().find((m) => m.type === type);

const core = new Core(new MemStore(), transport);
const host = open('host');
await core.onMessage(host, JSON.stringify({ type: 'host:create' }));
const { code, token } = last(host, 'host:ok');
assert.equal(code.length, 4);

const a = open('a'), b = open('b'), c = open('c');
await core.onMessage(a, JSON.stringify({ type: 'player:join', code, name: 'Ada Lovelace', emoji: '🦊' }));
await core.onMessage(b, JSON.stringify({ type: 'player:join', code, name: 'Bob', emoji: '🐸' }));
await core.onMessage(c, JSON.stringify({ type: 'player:join', code: code.toLowerCase(), name: 'Cy', emoji: 'not-an-emoji' }));
const ida = last(a, 'player:ok').playerId, idb = last(b, 'player:ok').playerId, idc = last(c, 'player:ok').playerId;
let st = last(host, 'state');
assert.equal(st.players.length, 3);
assert.equal(st.players.find((p: any) => p.id === ida).initials, 'AL');
assert.equal(st.players.find((p: any) => p.id === idc).emoji, '🙂');

// Players can't drive the game.
await core.onMessage(a, JSON.stringify({ type: 'host:start' }));
assert.equal(last(host, 'state').room.phase, 'lobby');

const expectScore = async (positions: Record<string, { x: number; y: number }>, expected: Record<string, number>) => {
  await core.onMessage(host, JSON.stringify({ type: 'host:next' }));
  st = last(host, 'state');
  assert.equal(st.room.phase, 'question');
  const q = quiz.questions[st.room.qIndex];
  assert.equal(st.question.answer, undefined, 'answers must not leak');
  assert.equal(timers.at(-1)!.fireAt, st.room.endsAt + GRACE_MS);
  for (const [conn, p] of Object.entries(positions)) await core.onMessage(conn, JSON.stringify({ type: 'player:move', ...p }));
  // Host saw the live positions.
  const pos = last(host, 'pos');
  assert.ok(pos && typeof pos.x === 'number');
  await core.finalize(code, st.room.qIndex);
  await core.finalize(code, st.room.qIndex); // idempotent
  st = last(host, 'state');
  assert.equal(st.room.phase, 'reveal');
  assert.equal(st.reveal.answer !== undefined, true);
  for (const [conn, delta] of Object.entries(expected)) {
    const id = { a: ida, b: idb, c: idc }[conn];
    const p = st.players.find((p: any) => p.id === id);
    assert.equal(p.result.delta, delta, `${q.id} ${conn}: expected ${delta}, got ${p.result.delta} (${JSON.stringify(p.result.value)})`);
  }
  console.log(`✓ ${q.id} ${q.type}`, Object.fromEntries(st.players.map((p: any) => [p.name, p.result.delta])));
};

// q1 choice: a in correct zone, b in wrong zone, c never moves
const q1 = quiz.questions[0] as any;
const z = zonesFor(q1.options);
const centre = (zone: any) => ({ x: zone.x + zone.w / 2, y: zone.y + zone.h / 2 });
await expectScore({ a: centre(z.find((zz: any) => zz.id === q1.answer)), b: centre(z.find((zz: any) => zz.id !== q1.answer)) }, { a: 10, b: 0, c: 0 });

// q2 range: a exact, b 30 off (half way to zeroAt=60 -> ~half points), c way off
const q2 = quiz.questions[1] as any;
await expectScore(
  { a: { x: rangeX(q2, 206), y: 0.5 }, b: { x: rangeX(q2, 236), y: 0.5 }, c: { x: rangeX(q2, 400), y: 0.5 } },
  { a: 10, b: 5, c: 0 },
);

// q3 wager: a all-in correct, b all-in wrong, c sits on the line
await expectScore({ a: { x: 0.02, y: 0.5 }, b: { x: 0.98, y: 0.5 }, c: { x: 0.5, y: 0.5 } }, { a: 10, b: -10, c: 0 });

// q4 xy: a on target, b far away
const q4 = quiz.questions[3] as any;
const t = xyPosition(q4, q4.answer);
await expectScore({ a: t, b: { x: 0.95, y: 0.95 } }, { a: 12, b: 0 });

st = last(host, 'state');
assert.deepEqual(st.players.map((p: any) => [p.name, p.score]), [['Ada Lovelace', 42], ['Bob', -5], ['Cy', 0]].sort((x, y) => (y[1] as number) - (x[1] as number)));

// Reconnect keeps score
inbox.delete(a);
await core.onDisconnect(a);
const a2 = open('a2');
await core.onMessage(a2, JSON.stringify({ type: 'player:join', code, playerId: ida }));
assert.equal(last(a2, 'state').players.find((p: any) => p.id === ida).score, 42);

// Run to the end
for (let i = 4; i < quiz.questions.length; i++) {
  await core.onMessage(host, JSON.stringify({ type: 'host:next' }));
  await core.onMessage(host, JSON.stringify({ type: 'host:end' }));
}
await core.onMessage(host, JSON.stringify({ type: 'host:next' }));
assert.equal(last(host, 'state').room.phase, 'final');

// Host reconnect with token
const host2 = open('host2');
await core.onMessage(host2, JSON.stringify({ type: 'host:join', code, token }));
assert.equal(last(host2, 'host:ok').code, code);
await core.onMessage(open('bad'), JSON.stringify({ type: 'host:join', code, token: 'nope' }));
assert.equal(last('bad', 'error').fatal, true);

console.log('\nAll good.');
