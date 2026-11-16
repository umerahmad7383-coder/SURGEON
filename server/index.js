// CODE RED: TURBO SURGERY: online multiplayer server.
// Serves the static client AND hosts the Socket.IO room backend on one port,
// so a single Render web service gives you https:// + wss:// on the same URL.
// The server runs the authoritative game simulation for every room (60 Hz) and
// streams snapshots + events to the three players (20 Hz).
import express from 'express';
import http from 'node:http';
import { Server } from 'socket.io';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSim, STEP, ROLES } from '../public/js/sim.js';

const PORT = Number(process.env.PORT) || 3000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || '*';
const SNAP_HZ = Math.min(30, Math.max(10, Number(process.env.SNAP_HZ) || 20));
const MAX_MEMBERS = 6; // 3 players + up to 3 spectators
const ROOM_IDLE_MS = 30 * 60 * 1000;

const app = express();
const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size, uptime: Math.round(process.uptime()) }));
app.use(express.static(publicDir, { etag: true, lastModified: true, setHeaders: (res, p) => res.setHeader('Cache-Control', p.includes('vendor') ? 'public, max-age=604800' : 'no-cache') }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CLIENT_ORIGIN === '*' ? true : CLIENT_ORIGIN.split(',').map((s) => s.trim()) },
  pingInterval: 10000, pingTimeout: 20000,
});

/** code -> room */
const rooms = new Map();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function makeCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0];
    if (!rooms.has(c)) return c;
  }
}
const cleanName = (n) => String(n ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 14) || 'Medic';
function uniqueName(room, name) {
  const taken = new Set([...room.members.values()].map((m) => m.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let i = 2; i < 99; i++) { const n = `${name.slice(0, 11)} ${i}`; if (!taken.has(n.toLowerCase())) return n; }
  return name;
}

function roomView(r) {
  const seats = {};
  for (const role of ROLES) { const m = [...r.members.values()].find((x) => x.role === role); seats[role] = m ? { id: m.id, name: m.name } : null; }
  return {
    code: r.code, state: r.state, hostId: r.hostId, seats,
    members: [...r.members.values()].map((m) => ({ id: m.id, name: m.name, role: m.role })),
    last: r.last || null,
  };
}
const push = (r) => { r.touched = Date.now(); io.to(r.code).emit('room:update', roomView(r)); };

function stopLoop(r) { if (r.timer) clearInterval(r.timer); r.timer = null; }

function startMatch(r) {
  stopLoop(r);
  const ctrl = {};
  for (const role of ROLES) ctrl[role] = [...r.members.values()].some((m) => m.role === role) ? 'human' : 'ai';
  r.sim = createSim();
  r.sim.reset({ ctrl });
  r.inputs = { driver: null, surgeon: null };
  r.state = 'playing'; r.last = null;
  io.to(r.code).emit('match:start', { snap: r.sim.snapshot() });
  let last = Date.now(), acc = 0, snapAcc = 0;
  const snapEvery = 1 / SNAP_HZ;
  r.timer = setInterval(() => {
    const now = Date.now();
    const dt = Math.min(0.25, (now - last) / 1000); last = now;
    acc += dt; snapAcc += dt;
    try {
      let n = 0;
      while (acc >= STEP && n < 15) { r.sim.step(STEP, r.inputs); acc -= STEP; n++; }
      if (n >= 15) acc = 0;
      if (snapAcc >= snapEvery) {
        snapAcc = 0;
        const events = r.sim.drain();
        io.to(r.code).emit('snap', { s: r.sim.snapshot(), e: events });
        const over = events.find((e) => e[0] === 'over');
        if (over) {
          r.state = 'ended'; r.last = over[1]; stopLoop(r);
          push(r);
        }
      }
    } catch (err) {
      console.error('room tick error', r.code, err);
    }
  }, 1000 / 60);
  push(r);
}

function joinRoom(socket, r, name) {
  const id = r.nextId++;
  r.members.set(socket.id, { id, sid: socket.id, name: uniqueName(r, cleanName(name)), role: null });
  socket.join(r.code);
  socket.data.code = r.code; socket.data.id = id;
  if (!r.hostId) r.hostId = id;
  // grab the first free seat automatically so three friends can just join and go
  const taken = new Set([...r.members.values()].map((m) => m.role).filter(Boolean));
  const free = ROLES.find((x) => !taken.has(x));
  if (free && r.state !== 'playing') r.members.get(socket.id).role = free;
  push(r);
  return id;
}

function leaveRoom(socket) {
  const code = socket.data.code;
  const r = code && rooms.get(code);
  socket.data.code = null;
  if (!r) return;
  const m = r.members.get(socket.id);
  r.members.delete(socket.id);
  socket.leave(code);
  if (r.members.size === 0) { stopLoop(r); rooms.delete(code); return; }
  if (m && m.role && r.state === 'playing' && r.sim) {
    r.sim.setCtrl(m.role, 'ai');
    r.sim.events.push(['banner', -1, `${m.name.toUpperCase()} LEFT: AI TAKES OVER`, '#ffb020', { big: true }]);
    if (m.role in r.inputs) r.inputs[m.role] = null;
  }
  if (m && r.hostId === m.id) r.hostId = [...r.members.values()][0].id; // host migration
  push(r);
}

io.on('connection', (socket) => {
  const roomOf = () => rooms.get(socket.data.code);
  const me = () => roomOf()?.members.get(socket.id);
  const ack = (cb, v) => typeof cb === 'function' && cb(v);

  socket.on('room:create', (d, cb) => {
    leaveRoom(socket);
    const r = { code: makeCode(), members: new Map(), hostId: 0, nextId: 1, state: 'lobby', sim: null, timer: null, inputs: { driver: null, surgeon: null }, touched: Date.now() };
    rooms.set(r.code, r);
    const id = joinRoom(socket, r, d?.name);
    ack(cb, { ok: true, code: r.code, you: id });
  });

  socket.on('room:join', (d, cb) => {
    const code = String(d?.code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const r = rooms.get(code);
    if (!r) return ack(cb, { ok: false, error: 'No room with that code. Check the 4 characters and try again.' });
    if (r.members.size >= MAX_MEMBERS) return ack(cb, { ok: false, error: 'That room is full.' });
    leaveRoom(socket);
    const id = joinRoom(socket, r, d?.name);
    ack(cb, { ok: true, code: r.code, you: id, inProgress: r.state === 'playing', snap: r.state === 'playing' && r.sim ? r.sim.snapshot() : null });
  });

  socket.on('room:leave', () => leaveRoom(socket));

  // claim a seat (or null to stand up). Seats can only change between matches.
  socket.on('room:seat', (role, cb) => {
    const r = roomOf(), m = me();
    if (!r || !m) return ack(cb, { ok: false, error: 'Not in a room.' });
    if (r.state === 'playing') return ack(cb, { ok: false, error: 'Seats lock while a run is in progress.' });
    if (role !== null && !ROLES.includes(role)) return ack(cb, { ok: false, error: 'Unknown role.' });
    if (role && [...r.members.values()].some((x) => x.role === role && x !== m)) return ack(cb, { ok: false, error: 'Someone already has that seat.' });
    m.role = role; push(r); ack(cb, { ok: true });
  });

  socket.on('room:start', (_d, cb) => {
    const r = roomOf(), m = me();
    if (!r || !m) return ack(cb, { ok: false, error: 'Not in a room.' });
    if (m.id !== r.hostId) return ack(cb, { ok: false, error: 'Only the host can start the run.' });
    if (r.state === 'playing') return ack(cb, { ok: false, error: 'Run already in progress.' });
    if (![...r.members.values()].some((x) => x.role)) return ack(cb, { ok: false, error: 'At least one person needs a seat.' });
    startMatch(r);
    ack(cb, { ok: true });
  });

  socket.on('room:lobby', () => {
    const r = roomOf(), m = me();
    if (!r || !m || m.id !== r.hostId || r.state === 'playing') return;
    r.state = 'lobby'; push(r);
  });

  // in-game input from the player who owns that seat (the server ignores everyone else)
  socket.on('in', (d) => {
    const r = roomOf(), m = me();
    if (!r || !m || r.state !== 'playing' || !d) return;
    if (m.role === 'driver' && d.d) r.inputs.driver = { steer: +d.d.steer || 0, throttle: !!d.d.throttle, brake: !!d.d.brake, boost: !!d.d.boost };
    else if (m.role === 'surgeon' && d.s) r.inputs.surgeon = { tx: +d.s.tx || 0, tz: +d.s.tz || 0, clamp: !!d.s.clamp, brace: !!d.s.brace };
  });
  socket.on('act', (a) => {
    const r = roomOf(), m = me();
    if (r && m && m.role === 'anesth' && r.state === 'playing' && r.sim) r.sim.act(String(a));
  });

  socket.on('disconnect', () => leaveRoom(socket));
});

// sweep abandoned rooms
setInterval(() => {
  const now = Date.now();
  for (const [code, r] of rooms) if (r.state !== 'playing' && now - r.touched > ROOM_IDLE_MS) { stopLoop(r); rooms.delete(code); }
}, 60 * 1000).unref();

server.listen(PORT, () => console.log(`CODE RED server listening on :${PORT}`));
