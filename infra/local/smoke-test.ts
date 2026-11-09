// Drives the Core through a whole game with fake connections and asserts
// the scoring. Run with: npm test  (from repo root or infra/)
import assert from 'node:assert/strict';
import { Core, GRACE_MS } from '../lambda/core.js';
import { MemStore } from './mem-store.js';
import type { Transport } from '../lambda/types.js';
import { questions } from '../../shared/quiz.js';
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
await core.onMessage(a, JSON.stringify({ type: 'player:join', code, name: 'Ada Lovelace', tag: '🦊', color: '#ff7a59' }));
await core.onMessage(b, JSON.stringify({ type: 'player:join', code, name: 'Bob', tag: 'Bobby', color: '#ff7a59' }));
await core.onMessage(c, JSON.stringify({ type: 'player:join', code: code.toLowerCase(), name: 'Cy Lee', tag: '  ', color: '#ff7a59' }));
const ida = last(a, 'player:ok').playerId, idb = last(b, 'player:ok').playerId, idc = last(c, 'player:ok').playerId;
let st = last(host, 'state');
assert.equal(st.players.length, 3);
assert.equal(st.players.find((p: any) => p.id === ida).tag, '🦊');
assert.equal(st.players.find((p: any) => p.id === idb).tag, 'Bo', 'tag trimmed to 2 graphemes');
assert.equal(st.players.find((p: any) => p.id === idc).tag, 'CL', 'blank tag falls back to initials');
// Same tag + same colour would clash; different tags may share a colour.
const d = open('d');
await core.onMessage(d, JSON.stringify({ type: 'player:join', code, name: 'Dee', tag: 'Bo', color: '#ff7a59' }));
const idd = last(d, 'player:ok').playerId;
st = last(host, 'state');
assert.equal(st.players.find((p: any) => p.id === ida).color, '#ff7a59');
assert.equal(st.players.find((p: any) => p.id === idb).color, '#ff7a59');
assert.notEqual(st.players.find((p: any) => p.id === idd).color, '#ff7a59');

// Players can't drive the game.
await core.onMessage(a, JSON.stringify({ type: 'host:start' }));
assert.equal(last(host, 'state').room.phase, 'lobby');

const expectScore = async (positions: Record<string, { x: number; y: number }>, expected: Record<string, number>, powers: Record<string, string | string[]> = {}) => {
  await core.onMessage(host, JSON.stringify({ type: 'host:next' }));
  st = last(host, 'state');
  assert.equal(st.room.phase, 'question');
  const q = questions[st.room.qIndex];
  assert.equal(st.question.answer, undefined, 'answers must not leak');
  assert.equal(timers.at(-1)!.fireAt, st.room.endsAt + GRACE_MS);
  for (const [conn, ps] of Object.entries(powers)) for (const power of ([] as string[]).concat(ps)) await core.onMessage(conn, JSON.stringify({ type: 'player:power', power }));
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
    const id = ({ a: ida, b: idb, c: idc } as Record<string, string>)[conn];
    const p = st.players.find((p: any) => p.id === id);
    assert.equal(p.result.delta, delta, `${q.id} ${conn}: expected ${delta}, got ${p.result.delta} (${JSON.stringify(p.result.value)})`);
  }
  console.log(`✓ ${q.id} ${q.type}`, Object.fromEntries(st.players.map((p: any) => [p.name, p.result.delta])));
};

// q1 choice: a in correct zone, b in wrong zone, c never moves
const q1 = questions[0] as any;
const z = zonesFor(q1.options);
const centre = (zone: any) => ({ x: zone.x + zone.w / 2, y: zone.y + zone.h / 2 });
inbox.get(b)!.length = 0;
await expectScore({ a: centre(z.find((zz: any) => zz.id === q1.answer)), b: centre(z.find((zz: any) => zz.id !== q1.answer)) }, { a: 11, b: 0, c: 0 }, { a: 'invisible' });
assert.equal(st.players.find((p: any) => p.id === ida).result.fastest, true);
assert.equal(st.players.find((p: any) => p.id === idb).result.fastest, false);
// During the question (look at the last state before the reveal) a was hidden from b and the host.
const preReveal = (id: string) => [...inbox.get(id)!].filter((m) => m.type === 'state' && m.room.phase === 'question').at(-1);
assert.equal(preReveal(host).players.find((p: any) => p.id === ida).hidden, true);
assert.equal(preReveal(host).players.find((p: any) => p.id === ida).x, null);
assert.equal(preReveal(b).players.find((p: any) => p.id === ida).hidden, true);
assert.equal(preReveal(a).players.find((p: any) => p.id === ida).hidden, false);
assert.equal(preReveal(a).me.powers.invisible, 'active');
assert.ok(!inbox.get(b)!.some((m) => m.type === 'pos' && m.id === ida), 'no pos messages for the invisible player reach others');
assert.ok(inbox.get(b)!.some((m) => m.type === 'pos' && m.id === idb), 'own moves are echoed');
// On reveal everyone is visible again, with the power-up listed.
assert.equal(st.players.find((p: any) => p.id === ida).hidden, false);
assert.ok(typeof st.players.find((p: any) => p.id === ida).x === 'number');
assert.deepEqual(st.players.find((p: any) => p.id === ida).powers, [], 'host never learns which power-ups were used');
assert.deepEqual(last(a, 'state').players.find((p: any) => p.id === ida).powers, ['invisible'], 'but you see your own');
assert.deepEqual(last(b, 'state').players.find((p: any) => p.id === ida).powers, []);

// q2 range: a exact, b 30 off (half way to zeroAt=60 -> ~half points), c way off
const q2 = questions[1] as any;
await expectScore(
  { a: { x: rangeX(q2, 206), y: 0.5 }, b: { x: rangeX(q2, 236), y: 0.5 }, c: { x: rangeX(q2, 400), y: 0.5 } },
  { a: 21, b: 5, c: 0 }, // doubled to 20, then +1 speed bonus (not doubled)
  { a: 'double', b: 'reveal' },
);
assert.equal(preReveal(b).me.hint.answer, 206, 'reveal hands over the answer');
assert.equal(preReveal(a).me.hint, null);
assert.equal(preReveal(host).players.find((p: any) => p.id === ida).powers.length, 0, 'double down is private too');
assert.equal(preReveal(a).players.find((p: any) => p.id === ida).powers[0], 'double');


// q3 wager: a all-in correct, b all-in wrong, c sits on the line
inbox.get(a)!.length = 0;
await expectScore({ a: { x: 0.02, y: 0.5 }, b: { x: 0.98, y: 0.5 }, c: { x: 0.5, y: 0.5 } }, { a: 11, b: -10, c: 0 }, { a: 'invisible', b: 'double', c: 'double' });
assert.match(last(a, 'error').message, /Already used/);
assert.equal(preReveal(a).me.powers.invisible, 'used');
// Double down only doubles gains: b's all-in loss stays at -10.


// q4 xy: a on target, b far away
const q4 = questions[3] as any;
const t = xyPosition(q4, q4.answer);
await expectScore({ a: t, b: { x: 0.95, y: 0.95 } }, { a: 13, b: 0 });

// Round 2 starts at q5: power-ups replenish, and Reveal + Double down may stack.
const q5 = questions[4] as any;
assert.equal(q5.round, 1);
const z5 = zonesFor(q5.options);
await expectScore({ a: centre(z5.find((zz: any) => zz.id === q5.answer)), b: centre(z5.find((zz: any) => zz.id === q5.answer)) }, { a: 11, b: 20 }, { a: 'invisible', b: ['reveal', 'double'] }); // both right; a settled first
assert.equal(preReveal(a).me.powers.invisible, 'active', 'replenished in round 2');
assert.deepEqual(last(b, 'state').players.find((p: any) => p.id === idb).powers.sort(), ['double', 'reveal']);


st = last(host, 'state');
assert.deepEqual(st.players.filter((p: any) => p.name !== 'Dee').map((p: any) => [p.name, p.score]), [['Ada Lovelace', 67], ['Bob', 15], ['Cy Lee', 0]]);

// Reconnect keeps score
inbox.delete(a);
await core.onDisconnect(a);
const a2 = open('a2');
await core.onMessage(a2, JSON.stringify({ type: 'player:join', code, playerId: ida }));
assert.equal(last(a2, 'state').players.find((p: any) => p.id === ida).score, 67);

// Run to the end
for (let i = 5; i < questions.length; i++) {
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
