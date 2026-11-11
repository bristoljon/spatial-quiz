// Drives the Core through a whole game with fake connections and asserts
// the scoring. Run with: npm test  (from repo root or infra/)
import assert from 'node:assert/strict';
import { Core, GRACE_MS } from '../lambda/core.js';
import { MemStore } from './mem-store.js';
import type { Transport } from '../lambda/types.js';
import { questions } from '../../shared/quiz.js';
import { zonesFor, rangeX, xyPosition } from '../../shared/spatial.js';
import { initialsOf } from '../../shared/avatar.js';

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
await core.onMessage(a, JSON.stringify({ type: 'player:join', code, name: 'Ada Lovelace', color: '#ff7a59' }));
await core.onMessage(b, JSON.stringify({ type: 'player:join', code, name: 'Bob', color: '#ff7a59' }));
await core.onMessage(c, JSON.stringify({ type: 'player:join', code: code.toLowerCase(), name: 'Cy Lee', color: '#ff7a59' }));
const ida = last(a, 'player:ok').playerId, idb = last(b, 'player:ok').playerId, idc = last(c, 'player:ok').playerId;
let st = last(host, 'state');
assert.equal(st.players.length, 3);
assert.equal(st.players.find((p: any) => p.id === ida).tag, 'AL');
assert.equal(st.players.find((p: any) => p.id === idb).tag, 'BO', 'single word -> first two letters');
assert.equal(st.players.find((p: any) => p.id === idc).tag, 'CL');
assert.equal(initialsOf('Jean Paul Sartre'), 'JPS');
assert.equal(initialsOf('Mary Anne de Winter'), 'MAW');
assert.equal(initialsOf('Jean-Luc Picard'), 'JLP');
// Same tag + same colour would clash; different tags may share a colour.
const d = open('d');
await core.onMessage(d, JSON.stringify({ type: 'player:join', code, name: 'Bo Oakes', color: '#ff7a59' })); // also 'BO'
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

// --- Possess / Mirror / Shield --------------------------------------------
await core.onMessage(host, JSON.stringify({ type: 'host:next' }));
st = last(host, 'state'); assert.equal(st.room.qIndex, 3);
// c shields; b tries to possess c -> blocked and b's possess is spent
await core.onMessage(c, JSON.stringify({ type: 'player:power', power: 'shield' }));
await core.onMessage(b, JSON.stringify({ type: 'player:power', power: 'possess', target: idc }));
assert.match(last(b, 'error').message, /shielded/);
assert.equal(last(b, 'state').me.powers.possess, 'active', 'blocked possess is consumed');
// a possesses b: a's moves move b, b's own moves are ignored
await core.onMessage(a, JSON.stringify({ type: 'player:power', power: 'possess', target: idb }));
assert.equal(last(a, 'state').me.possessing, idb);
assert.deepEqual(last(b, 'state').me.possessed, { dropped: false });
await core.onMessage(a, JSON.stringify({ type: 'player:move', x: 0.9, y: 0.9 }));
await core.onMessage(b, JSON.stringify({ type: 'player:move', x: 0.1, y: 0.1 }));
let pb = last(host, 'pos'); assert.equal(pb.id, idb); assert.equal(pb.x, 0.9, "possessor's move lands on the victim");
assert.ok(!inbox.get(host)!.some((m) => m.type === 'pos' && m.x === 0.1), "victim's own move ignored");
// a drops b at the target: b is locked there, a regains control
await core.onMessage(a, JSON.stringify({ type: 'player:move', x: t.x, y: t.y, release: true }));
assert.equal(last(a, 'state').me.possessing, null);
assert.deepEqual(last(b, 'state').me.possessed, { dropped: true });
await core.onMessage(b, JSON.stringify({ type: 'player:move', x: 0.1, y: 0.1 }));
await core.onMessage(a, JSON.stringify({ type: 'player:move', x: 0.2, y: 0.2 }));
pb = [...inbox.get(host)!].reverse().find((m) => m.type === 'pos' && m.id === idb);
assert.equal(pb.x, t.x, 'victim stays locked where dropped');
assert.equal(last(host, 'pos').id, ida, 'possessor moves themselves again');
// a can't possess twice; nobody can possess an already-locked b
await core.onMessage(a, JSON.stringify({ type: 'player:power', power: 'possess', target: idc }));
assert.match(last(a, 'error').message, /Already used/);
// mirror: c turns on mirror and moves; host + others see the reflection, c sees the truth
await core.onMessage(c, JSON.stringify({ type: 'player:power', power: 'mirror' }));
await core.onMessage(c, JSON.stringify({ type: 'player:move', x: 0.2, y: 0.3 }));
const pc = last(host, 'pos'); assert.equal(pc.id, idc); assert.equal(pc.x, 0.8); assert.equal(pc.y, 0.7);
assert.equal(last(c, 'pos').x, 0.2);
assert.equal(last(a, 'pos').x, 0.8);
await core.finalize(code, 3);
st = last(host, 'state');
assert.equal(st.players.find((p: any) => p.id === idb).result.delta, 13, 'b was dropped on the answer by a, and settled first');
assert.equal(st.players.find((p: any) => p.id === idc).x, 0.2, 'reveal shows true positions');
console.log('✓ q4 xy possess/mirror/shield', Object.fromEntries(st.players.map((p: any) => [p.name, p.result.delta])));

// Round 2 starts at q5: power-ups replenish, and Reveal + Double down may stack.
const q5 = questions[4] as any;
assert.equal(q5.round, 1);
const z5 = zonesFor(q5.options);
await expectScore({ a: centre(z5.find((zz: any) => zz.id === q5.answer)), b: centre(z5.find((zz: any) => zz.id === q5.answer)) }, { a: 11, b: 20 }, { a: 'invisible', b: ['reveal', 'double'] }); // both right; a settled first
assert.equal(preReveal(a).me.powers.invisible, 'active', 'replenished in round 2');
assert.deepEqual(last(b, 'state').players.find((p: any) => p.id === idb).powers.sort(), ['double', 'reveal']);


st = last(host, 'state');
assert.deepEqual(st.players.filter((p: any) => p.name !== 'Bo Oakes').map((p: any) => [p.name, p.score]), [['Ada Lovelace', 54], ['Bob', 28], ['Cy Lee', 0]]);

// Reconnect keeps score
inbox.delete(a);
await core.onDisconnect(a);
const a2 = open('a2');
await core.onMessage(a2, JSON.stringify({ type: 'player:join', code, playerId: ida }));
assert.equal(last(a2, 'state').players.find((p: any) => p.id === ida).score, 54);

// q6: possessing someone who then goes invisible. Only the possessor (and the
// victim) see where they are; the host and others see nothing.
await core.onMessage(host, JSON.stringify({ type: 'host:next' }));
assert.equal(last(host, 'state').room.qIndex, 5);
await core.onMessage(b, JSON.stringify({ type: 'player:move', x: 0.3, y: 0.3 }));
await core.onMessage(a2, JSON.stringify({ type: 'player:power', power: 'possess', target: idb }));
await core.onMessage(b, JSON.stringify({ type: 'player:power', power: 'invisible' }));
assert.equal(last(host, 'state').players.find((p: any) => p.id === idb).hidden, true, 'host loses b');
assert.equal(last(c, 'state').players.find((p: any) => p.id === idb).hidden, true, 'others lose b');
assert.equal(last(a2, 'state').players.find((p: any) => p.id === idb).hidden, false, 'possessor still sees b');
assert.equal(last(a2, 'state').players.find((p: any) => p.id === idb).x, 0.3);
inbox.get(host)!.length = 0; inbox.get(c)!.length = 0; inbox.get(a2)!.length = 0;
await core.onMessage(a2, JSON.stringify({ type: 'player:move', x: 0.6, y: 0.6 }));
assert.equal(last(a2, 'pos')?.x, 0.6, 'possessor gets live positions of the invisible victim');
assert.ok(!inbox.get(host)!.some((m) => m.type === 'pos'), 'host gets none');
assert.ok(!inbox.get(c)!.some((m) => m.type === 'pos'), 'others get none');
// mirrored victim: possessor sees the truth, others the reflection
await core.onMessage(b, JSON.stringify({ type: 'player:power', power: 'mirror' }));
await core.onMessage(a2, JSON.stringify({ type: 'player:move', x: 0.6, y: 0.6, release: true })); // drop: a no longer privileged
await core.onMessage(host, JSON.stringify({ type: 'host:end' }));
console.log('✓ q6 possess an invisible player');

// q7: Bump. Needs placement; shoves the near, spares the far and the shielded;
// the closest flies furthest.
await core.onMessage(host, JSON.stringify({ type: 'host:next' }));
assert.equal(last(host, 'state').room.qIndex, 6);
assert.equal(last(a2, 'state').me.placed, false);
await core.onMessage(a2, JSON.stringify({ type: 'player:power', power: 'bump' }));
assert.match(last(a2, 'error').message, /Place yourself/);
await core.onMessage(a2, JSON.stringify({ type: 'player:move', x: 0.5, y: 0.5 }));
assert.equal(last(a2, 'pos').x, 0.5); // clients learn they're placed from their own echoed pos
await core.onMessage(b, JSON.stringify({ type: 'player:move', x: 0.55, y: 0.5 }));   // close
await core.onMessage(c, JSON.stringify({ type: 'player:move', x: 0.5, y: 0.65 }));   // further
await core.onMessage(d, JSON.stringify({ type: 'player:move', x: 0.52, y: 0.5 }));   // closest, but shielded
await core.onMessage(d, JSON.stringify({ type: 'player:power', power: 'shield' }));
inbox.get(host)!.length = 0;
await core.onMessage(a2, JSON.stringify({ type: 'player:power', power: 'bump' }));
const fx = inbox.get(host)!.find((m) => m.type === 'bump');
assert.ok(fx && fx.x === 0.5 && fx.hits === 2, 'shockwave at the bumper, two hits');
st = last(host, 'state');
const P = (id: string) => st.players.find((p: any) => p.id === id);
assert.ok(P(idb).x > 0.7, `b shoved right (${P(idb).x})`); assert.equal(P(idb).y, 0.5);
assert.ok(P(idc).y > 0.65 && P(idc).y < P(idb).x - 0.5 + 0.5 + 0.2, `c shoved down less (${P(idc).y})`);
assert.ok((P(idb).x - 0.55) > (P(idc).y - 0.65), 'closest flies furthest');
assert.equal(P(idd).x, 0.52, 'shielded player unmoved');
assert.equal(P(ida).x, 0.5, 'bumper stays put');
await core.onMessage(host, JSON.stringify({ type: 'host:end' }));
console.log('✓ q7 bump');

// Run to the end
for (let i = 7; i < questions.length; i++) {
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


// --- Replenish modes ------------------------------------------------------
async function playTwoRoundsWith(mode: 'never' | 'random', random?: () => number) {
  const c2 = new Core(new MemStore(), transport, { replenish: mode, randomChance: 0.5, random });
  const h = open('h-' + mode); await c2.onMessage(h, JSON.stringify({ type: 'host:create' }));
  const code2 = last(h, 'host:ok').code;
  const p = open('p-' + mode); await c2.onMessage(p, JSON.stringify({ type: 'player:join', code: code2, name: 'Pat Q' }));
  const statuses: string[] = []; const flags: boolean[] = [];
  for (let i = 0; i < questions.length; i++) {
    await c2.onMessage(h, JSON.stringify({ type: 'host:next' }));
    const s = last(p, 'state');
    flags.push(s.room.replenished);
    statuses.push(s.me.powers.shield);
    if (i === 0) await c2.onMessage(p, JSON.stringify({ type: 'player:power', power: 'shield' }));
    await c2.onMessage(h, JSON.stringify({ type: 'host:end' }));
  }
  return { statuses, flags };
}
let r = await playTwoRoundsWith('never');
assert.deepEqual(r.statuses, ['available', 'used', 'used', 'used', 'used', 'used', 'used', 'used'], 'never: spent for the whole quiz');
assert.deepEqual(r.flags, [true, false, false, false, false, false, false, false]);
// random: scripted dice -> replenish only on q3 and q6 (0-based 2 and 5)
const dice = [0.9, 0.1, 0.9, 0.9, 0.1, 0.9, 0.9]; let di = 0;
r = await playTwoRoundsWith('random', () => dice[di++]);
assert.deepEqual(r.flags, [true, false, true, false, false, true, false, false]);
assert.deepEqual(r.statuses, ['available', 'used', 'available', 'available', 'available', 'available', 'available', 'available']);
console.log('✓ replenish modes never/random');

console.log('\nAll good.');
