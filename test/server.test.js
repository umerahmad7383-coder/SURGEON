// Spins up the real server and plays a room with three socket clients.
import { spawn } from 'node:child_process';
import { io } from 'socket.io-client';

const PORT = 4300 + Math.floor(Math.random() * 500);
const URL = `http://localhost:${PORT}`;
const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.stderr.on('data', (d) => process.stderr.write(d));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (m) => { console.error('FAIL:', m); srv.kill(); process.exit(1); };
const call = (s, ev, d) => new Promise((res) => s.timeout(5000).emit(ev, d, (err, r) => res(err ? { ok: false, error: String(err) } : r)));

async function main() {
  for (let i = 0; i < 40; i++) { try { const r = await fetch(URL + '/health'); if (r.ok) break; } catch { /* booting */ } await sleep(100); }
  const mk = () => io(URL, { transports: ['websocket'], forceNew: true });
  const A = mk(), B = mk(), C = mk();
  const state = { A: {}, B: {}, C: {} };
  for (const [k, s] of Object.entries({ A, B, C })) {
    s.on('room:update', (r) => { state[k].room = r; });
    s.on('snap', (d) => { state[k].snap = d.s; state[k].events = (state[k].events || 0) + d.e.length; for (const e of d.e) if (e[0] === 'over') state[k].over = e[1]; });
    s.on('match:start', () => { state[k].started = (state[k].started || 0) + 1; });
  }
  await sleep(300);
  const cr = await call(A, 'room:create', { name: 'Umer' });
  if (!cr.ok || cr.code.length !== 4) fail('create');
  const jb = await call(B, 'room:join', { code: cr.code.toLowerCase(), name: 'Ali' });
  const jc = await call(C, 'room:join', { code: cr.code, name: 'Sara' });
  if (!jb.ok || !jc.ok) fail('join');
  const bad = await call(mk(), 'room:join', { code: 'ZZZZ', name: 'x' });
  if (bad.ok) fail('bad code accepted');
  await sleep(200);
  const seats = state.A.room.seats;
  console.log('seats:', Object.fromEntries(Object.entries(seats).map(([k, v]) => [k, v && v.name])));
  if (!seats.driver || !seats.surgeon || !seats.anesth) fail('auto seating');
  const taken = await call(B, 'room:seat', 'driver');
  if (taken.ok) fail('seat stealing allowed');
  const notHost = await call(B, 'room:start', null);
  if (notHost.ok) fail('non-host started');
  const st = await call(A, 'room:start', null);
  if (!st.ok) fail('start ' + st.error);
  await sleep(500);
  if (!(state.A.started && state.B.started && state.C.started)) fail('match:start not broadcast');
  const s0 = state.C.snap;
  console.log('ctrl:', JSON.stringify(s0.c));
  if (s0.c.driver !== 'human' || s0.c.surgeon !== 'human' || s0.c.anesth !== 'human') fail('roles not human');
  // driver (A) steers left hard; surgeon (B) moves forceps; anesth (C) gives adrenaline
  const x0 = s0.a[0], hr0 = s0.hr;
  for (let i = 0; i < 20; i++) { A.emit('in', { d: { steer: -1, throttle: true, brake: false, boost: false } }); B.emit('in', { s: { tx: -2, tz: 2, clamp: false, brace: false } }); await sleep(30); }
  for (let i = 0; i < 4; i++) C.emit('act', 'adr');
  // someone without the role trying to drive must be ignored
  C.emit('in', { d: { steer: 1, throttle: false, brake: true, boost: true } });
  await sleep(600);
  const s1 = state.A.snap;
  console.log(`ambulance x ${x0} -> ${s1.a[0]}, forceps tip (${s1.s[0]}, ${s1.s[1]}), bpm ${hr0} -> ${s1.hr}`);
  if (!(s1.a[0] < x0 - 2)) fail('driver input not applied');
  if (!(s1.s[0] < -1.5 && s1.s[1] > 1.5)) fail('surgeon input not applied');
  if (!(s1.hr > hr0 + 15)) fail('anesth action not applied');
  if (!(state.B.snap && Math.abs(state.B.snap.t - state.A.snap.t) < 0.2)) fail('clients out of sync');
  // surgeon leaves mid-run -> AI takes over the seat
  B.disconnect();
  await sleep(400);
  if (state.A.snap.c.surgeon !== 'ai') fail('AI takeover');
  console.log('surgeon left -> ctrl:', JSON.stringify(state.A.snap.c));
  // host leaves -> host migrates to C
  const aId = state.A.room.hostId;
  A.disconnect();
  await sleep(300);
  if (state.C.room.hostId === aId) fail('host migration');
  console.log('host migrated to', state.C.room.members.find((m) => m.id === state.C.room.hostId).name, '| snaps received by C:', state.C.events, 'events');
  // let the run finish (all AI except anesth on C, who stays idle) — just wait for 'over' with a timeout
  const t0 = Date.now();
  while (!state.C.over && Date.now() - t0 < 240000) { C.emit('act', state.C.snap.hr < state.C.snap.zn[0] ? 'adr' : state.C.snap.hr > state.C.snap.zn[1] ? 'sed' : 'lamp'); await sleep(400); }
  if (!state.C.over) fail('run never ended');
  console.log('run over:', state.C.over.reason, 'won', state.C.over.won, 'time', state.C.over.time);
  await sleep(200);
  if (state.C.room.state !== 'ended') fail('room state not ended');
  const again = await call(C, 'room:start', null);
  if (!again.ok) fail('rematch ' + again.error);
  await sleep(300);
  if (state.C.room.state !== 'playing') fail('rematch not playing');
  console.log('rematch started OK');
  C.disconnect();
  await sleep(200);
  const h = await (await fetch(URL + '/health')).json();
  if (h.rooms !== 0) fail('room not cleaned up');
  console.log('server.test: ALL PASSED');
  srv.kill();
  process.exit(0);
}
main().catch((e) => fail(e.stack || e));
