// CODE RED: TURBO SURGERY: shared game simulation.
// Pure JavaScript (no DOM, no Three.js), so the exact same rules run in the browser
// (local co-op, solo test mode, attract demo) and on the Node server (online rooms).
// The sim never touches visuals: everything audible/visible that "happens" is pushed
// to sim.events, and renderers turn those into sounds, particles and banners.

export const STEP = 1 / 60;
export const LANE_X = [-4.5, -1.5, 1.5, 4.5];
export const ROAD_HALF = 6, AMB_HW = 1.1, AMB_HL = 2.6;
export const TOTAL_DIST = 4200, TIME_LIMIT = 210, DETOUR_DIST = 600;
export const PHOTO = 0, PULSE = 1, ARMOR = 2;
export const ROLES = ['driver', 'surgeon', 'anesth'];
export const ROLE_NAMES = ['DRIVER', 'SURGEON', 'ANESTHESIOLOGIST'];
export const PINFO = [
  { name: 'PHOTOPHOBIC', color: 0x7a4dff, emis: 0x5a2cff, accent: 0x00f0ff, css: '#a48bff', band: [0.7, 1.8], tear: 2.5, rate: 0.21 },
  { name: 'PULSE-LINKED', color: 0x39ff14, emis: 0x22dd00, accent: 0xd8ffc0, css: '#39ff14', band: [0.6, 1.6], tear: 2.3, rate: 0.23 },
  { name: 'ARMORED TICK', color: 0xff8a00, emis: 0xff3a00, accent: 0xff2200, css: '#ffa020', band: [1.3, 2.6], tear: 3.3, rate: 0.12 },
];
export const HZ = {
  pothole: { label: 'BUMP INCOMING!', short: 'BUMP', color: 0xffb020, css: '#ffb020', hw: 0.65, hl: 0.65 },
  oil: { label: 'OIL SLICK!', short: 'OIL', color: 0xb44cff, css: '#c47bff', hw: 1.3, hl: 1.9 },
  car: { label: 'TRAFFIC AHEAD!', short: 'CAR', color: 0xff2a3d, css: '#ff4a5c', hw: 0.95, hl: 2.1 },
  oncoming: { label: 'ONCOMING TRAFFIC!', short: 'ONCOMING', color: 0xff2a3d, css: '#ff4a5c', hw: 0.95, hl: 2.1 },
};
export const HKEYS = ['pothole', 'oil', 'car', 'oncoming'];
export const TOOL_KINDS = ['scalpel', 'syringe', 'saw'];
export const T_STATES = ['pending', 'flying', 'swatted', 'stuck'];
export const P_STATES = ['attached', 'flying', 'jar'];
export const ORG = {
  lungL: { c: [-1.45, -0.1, -1.45], s: [0.95, 0.6, 1.55], col: 0xd27a86, em: 0x2a0609 },
  lungR: { c: [1.45, -0.1, -1.55], s: [0.95, 0.6, 1.5], col: 0xd27a86, em: 0x2a0609 },
  heart: { c: [-0.3, 0.0, -1.1], s: [0.85, 0.72, 0.95], col: 0xb3121e, em: 0x3a0006 },
  liver: { c: [1.15, -0.1, 0.95], s: [1.25, 0.55, 0.95], col: 0x7a1c16, em: 0x1a0302 },
  stomach: { c: [-1.15, -0.1, 0.85], s: [0.95, 0.55, 0.85], col: 0xc65a5c, em: 0x220404 },
};
function surfY(o, x, z) { const u = (x - o.c[0]) / o.s[0], w = (z - o.c[2]) / o.s[2]; return o.c[1] + o.s[1] * Math.sqrt(Math.max(0, 1 - u * u - w * w)); }
export const SLOTS = [
  { x: -1.2, z: -1.6, o: 'lungL', name: 'L. LUNG' }, { x: -0.35, z: -1.15, o: 'heart', name: 'HEART' }, { x: 1.25, z: -1.8, o: 'lungR', name: 'R. LUNG' },
  { x: -1.1, z: 0.85, o: 'stomach', name: 'STOMACH' }, { x: 1.15, z: 0.95, o: 'liver', name: 'LIVER' }, { x: 0.25, z: 2.1, y: -0.02, name: 'BOWEL' },
].map((s) => Object.assign({}, s, { y: s.y != null ? s.y : surfY(ORG[s.o], s.x, s.z) }));
export const RX = 2.7, RZ = 3.7;
const halfW = (z) => RX * Math.sqrt(Math.max(0, 1 - (z / RZ) * (z / RZ)));
export const RIB_DEFS = (() => {
  const out = [];
  for (const s of [-1, 1]) for (let i = 0; i < 5; i++) {
    const z0 = -3.0 + i * 1.15, zi = z0 + 0.35, inner = Math.max(0.6, halfW(zi) - 0.32), outer = halfW(z0) + 0.7;
    out.push([[s * outer, 0.44, z0 - 0.2], [s * (outer + inner) / 2, 0.55, z0 + 0.08], [s * inner, 0.5, zi]]);
  }
  return out;
})();
export const NERVE_DEFS = [
  [[-2.05, 0.32, -0.3], [-2.25, 0.36, 0.55], [-1.95, 0.34, 1.6]],
  [[1.85, 0.36, -2.3], [2.2, 0.38, -1.3], [2.05, 0.36, -0.35]],
  [[-1.25, 0.1, 3.08], [0.0, 0.15, 3.3], [1.2, 0.1, 3.02]],
];
// Collision polylines: Catmull-Rom samples through the same control points the renderer uses.
function crPoints(def, n) {
  const P = def.map((p) => ({ x: p[0], z: p[2] })), out = [];
  const pts = [P[0], ...P, P[P.length - 1]];
  for (let seg = 1; seg < pts.length - 2; seg++) {
    const p0 = pts[seg - 1], p1 = pts[seg], p2 = pts[seg + 1], p3 = pts[seg + 2];
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), z: f(p0.z, p1.z, p2.z, p3.z) });
    }
  }
  out.push(P[P.length - 1]);
  return out;
}
export const RIBS = RIB_DEFS.map((d) => crPoints(d, 5));
export const NERVES = NERVE_DEFS.map((d) => crPoints(d, 8));
export const ANE = { LANE_X: [-0.95, 0, 0.95], TH_Z: 2.15, COLS: [-1.05, 0, 1.05], ROWS: [-1.3, -0.95, -0.6], Y: 0.75 };

/* ---------- small helpers ---------- */
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, r, dt) => a + (b - a) * (1 - Math.exp(-r * dt));
export const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
const pick = (a) => a[Math.floor(Math.random() * a.length)];
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function distSeg(px, pz, ax, az, bx, bz) { const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz; let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0; t = clamp(t, 0, 1); return Math.hypot(ax + dx * t - px, az + dz * t - pz); }
export function nearPolys(polys, x, z, r) { for (const pl of polys) for (let i = 0; i < pl.length - 1; i++) if (distSeg(x, z, pl[i].x, pl[i].z, pl[i + 1].x, pl[i + 1].z) < r) return true; return false; }
const r3 = (v) => Math.round(v * 1000) / 1000;
export const laneOfX = (x) => { let b = 0, bd = 1e9; for (let i = 0; i < 4; i++) { const d = Math.abs(LANE_X[i] - x); if (d < bd) { bd = d; b = i; } } return b; };
export function bez(t, a, b, c, o) { const u = 1 - t; o.x = u * u * a.x + 2 * u * t * b.x + t * t * c.x; o.y = u * u * a.y + 2 * u * t * b.y + t * t * c.y; o.z = u * u * a.z + 2 * u * t * b.z + t * t * c.z; return o; }
function bezD(t, a, b, c) { return { x: 2 * (1 - t) * (b.x - a.x) + 2 * t * (c.x - b.x), y: 2 * (1 - t) * (b.y - a.y) + 2 * t * (c.y - b.y), z: 2 * (1 - t) * (b.z - a.z) + 2 * t * (c.z - b.z) }; }
function solveT(tl, z) { let lo = 0, hi = 1; for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2, u = 1 - m, zz = u * u * tl.p0.z + 2 * u * m * tl.p1.z + m * m * tl.p2.z; if (zz < z) lo = m; else hi = m; } return (lo + hi) / 2; }
const NO_DRIVE = { steer: 0, throttle: false, brake: false, boost: false };
const VALID_ACTS = new Set(['sed', 'adr', 'lamp', 'swat0', 'swat1', 'swat2']);

/* ============================================================ */
export function createSim() {
  const S = { G: null, events: [] };
  let G = null;
  const ev = (...a) => { S.events.push(a); };
  const sfx = (name, arg, role) => ev('sfx', name, arg == null ? null : arg, role || null);
  const banner = (pane, text, color, o) => ev('banner', pane, text, color, o || null);
  const fx = (sys, x, y, z, n, o) => ev('fx', sys, r3(x), r3(y), r3(z), n, o);
  const flash = (pane, v) => ev('flash', pane, v);
  const kick = (ix, iy, tr) => ev('kick', r3(ix), r3(iy), r3(tr));

  function fresh() {
    return {
      gen: 0, mode: 'playing', attract: false, ctrl: { driver: 'ai', surgeon: 'ai', anesth: 'ai' }, nextId: 1,
      time: 0, distanceRemaining: TOTAL_DIST, traveled: 0, detours: 0,
      amb: { x: LANE_X[2], vx: 0, speed: 24, boostFuel: 1, boosting: false, regen: 0, skid: 0, skidDir: 0, edgeCD: 0, screechCD: 0 },
      hazards: [], spawnTimer: 2.2, threat: null, impulseX: 0, impulseY: 0,
      patientBlood: 100, heartBPM: 90, targetBPMZone: [78, 102], zoneTarget: [78, 102], zoneTimer: 13, lampFocusedOnChest: true,
      bpmDrift: 0, driftTimer: 2, pendingDose: 0, bleed: 0, flatlined: false, alarmCD: 0, inZone: true,
      srg: { tx: 0, tz: 1.6, fx: 0, fz: 1.6, jx: 0, jz: 0, jvx: 0, jvz: 0, tipX: 0, tipZ: 1.6, tipY: 1.75, tipVy: 0, tipOy: 0, clamp: false, prevClamp: false, brace: false, grab: null, tension: 0, inBand: false, blockReason: '', ribCD: 0, nerveCD: 0, hoverP: null },
      parasites: [], extracted: 0, allOutAnnounced: false,
      queue: [], tools: [], slots: [], laneLock: [0, 0, 0],
      stats: { crashes: 0, bumps: 0, skids: 0, swats: 0, stabs: 0, slips: 0, tears: 0, nerves: 0, ribs: 0, recoils: 0, maxSpeed: 0, doses: 0 },
      endReason: '', endTimer: 0, won: false,
    };
  }
  function makeParasites(types) {
    return SLOTS.map((s, i) => ({ id: i, type: types[i], info: PINFO[types[i]], slot: s, progress: 0, state: 'attached', grabbed: false, burrow: types[i] === PHOTO ? 1 : 0, noGrab: 0, shake: 0, flyT: 0, from: { x: 0, y: 0, z: 0 }, jarSlot: 0 }));
  }

  S.reset = function (cfg) {
    cfg = cfg || {};
    G = S.G = fresh();
    G.gen = 1 + Math.floor(Math.random() * 1e9);
    G.attract = !!cfg.attract;
    G.mode = G.attract ? 'attract' : 'playing';
    Object.assign(G.ctrl, cfg.ctrl || {});
    G.parasites = makeParasites(shuffle([PHOTO, PHOTO, PULSE, PULSE, ARMOR, ARMOR]));
    for (const r of ANE.ROWS) for (const c of ANE.COLS) G.slots.push({ kind: pick(TOOL_KINDS), x: c + rand(-0.12, 0.12), z: r, ry: Math.PI / 2 + rand(-0.35, 0.35), present: true, respawn: 0 });
    AI.reset();
    S.events.length = 0;
    ev('reset');
    return G;
  };
  S.setCtrl = (role, v) => { if (G && G.ctrl[role] !== undefined) G.ctrl[role] = v; };
  S.act = (a) => { if (G && VALID_ACTS.has(a) && G.ctrl.anesth !== 'ai' && G.queue.length < 20) G.queue.push(a); };
  S.drain = () => { const e = S.events; S.events = []; return e; };
  S.step = function (dt, inputs) {
    if (!G) return;
    inputs = inputs || {};
    if (G.mode === 'playing' || G.mode === 'attract') simStep(dt, inputs);
    else if (G.mode === 'ending') endStep(dt);
    else if (G.mode === 'ended') idleStep(dt);
  };

  const difficulty = () => clamp(G.time / 160, 0, 1);
  function damage(n) { if (G.flatlined) return; G.patientBlood = Math.max(0, G.patientBlood - n); flash(1, 0.6); }
  function spikeBPM(n) { G.pendingDose += n; }

  function simStep(dt, inputs) {
    G.time += dt;
    updateDriver(dt, inputs.driver);
    updateHazards(dt);
    updateVitals(dt);
    if (G.ctrl.anesth === 'ai') AI.anesth(dt);
    processQueue();
    updateSurgeon(dt, inputs.surgeon);
    updateTools(dt);
    G.impulseX *= Math.exp(-5 * dt); G.impulseY *= Math.exp(-5 * dt);
    for (let i = 0; i < 3; i++) G.laneLock[i] = Math.max(0, G.laneLock[i] - dt);
    checkEnd();
  }

  /* ---------- driver ---------- */
  function cleanDrive(i) { if (!i) return NO_DRIVE; return { steer: clamp(+i.steer || 0, -1, 1), throttle: !!i.throttle, brake: !!i.brake, boost: !!i.boost }; }
  function updateDriver(dt, hin) {
    const a = G.amb, inp = G.ctrl.driver === 'ai' ? AI.driver(dt) : cleanDrive(hin);
    let target = 24, accel = 3;
    if (inp.throttle) { target = 36; accel = 9; }
    if (inp.brake) { target = 8; accel = 20; }
    a.boosting = false;
    if (inp.boost && a.boostFuel > 0.02 && !inp.brake) { a.boosting = true; target = 52; accel = 16; a.boostFuel = Math.max(0, a.boostFuel - 0.24 * dt); a.regen = 0.8; }
    else { a.regen -= dt; if (a.regen <= 0) a.boostFuel = Math.min(1, a.boostFuel + 0.11 * dt); }
    if (a.speed < target) a.speed = Math.min(target, a.speed + accel * dt); else a.speed = Math.max(target, a.speed - (inp.brake ? accel : 6) * dt);
    const control = a.skid > 0 ? 0.18 : 1, steerSpeed = 7.5 + a.speed * 0.08;
    a.vx += (inp.steer * steerSpeed - a.vx) * Math.min(1, 9 * dt * control);
    if (a.skid > 0) { a.skid -= dt; a.vx += a.skidDir * 9 * dt; }
    a.x += a.vx * dt;
    const lim = ROAD_HALF - AMB_HW - 0.15;
    a.edgeCD -= dt; a.screechCD -= dt;
    if (Math.abs(a.x) > lim) {
      const sg = Math.sign(a.x); a.x = sg * lim;
      if (a.edgeCD <= 0 && Math.abs(a.vx) > 2.5) {
        a.edgeCD = 0.7; a.speed *= 0.92; sfx('scrape'); kick(-sg * 0.6, 0.2, 0.15); G.impulseX -= sg * 0.4;
        banner(0, 'GUARDRAIL SCRAPE!', '#ff9a1f');
        fx('ds', sg * (lim + AMB_HW), 0.6, 0, 24, { spread: 1.5, speed: 5, color: [1, 0.75, 0.3], life: 0.5, size: 0.22, grav: 10 });
      }
      a.vx = 0;
    }
    if (Math.abs(a.vx) > 9.5 && a.speed > 34 && a.screechCD <= 0) { sfx('screech'); a.screechCD = 1.2; }
    G.traveled += a.speed * dt; G.distanceRemaining -= a.speed * dt;
    G.stats.maxSpeed = Math.max(G.stats.maxSpeed, a.speed);
  }

  function spawnHazard() {
    const a = G.amb, r = Math.random(), type = r < 0.4 ? 'pothole' : r < 0.62 ? 'oil' : 'car';
    for (let attempt = 0; attempt < 4; attempt++) {
      const lane = randi(0, 3); let v = 0, oncoming = false;
      if (type === 'car') { if (lane <= 1) { oncoming = true; v = -rand(13, 20); } else v = rand(11, 18); }
      const closing = Math.max(5, a.speed - v), z = -clamp(closing * 2.15, 46, 125);
      const x = LANE_X[lane] + (type === 'pothole' ? rand(-0.5, 0.5) : type === 'oil' ? rand(-0.25, 0.25) : 0);
      let ok = true; const blocked = new Set([lane]);
      for (const o of G.hazards) { if (Math.abs(o.z - z) < 9) { if (Math.abs(o.x - x) < 2.6) { ok = false; break; } blocked.add(laneOfX(o.x)); } }
      if (!ok || blocked.size >= 4 || (blocked.size >= 3 && Math.random() < 0.6)) continue;
      const key = type === 'car' ? (oncoming ? 'oncoming' : 'car') : type, d = HZ[key];
      const id = G.nextId++;
      G.hazards.push({ id, type, key, oncoming, x, z, v, hw: d.hw, hl: d.hl, hit: false, knock: false, kvx: 0, rot: 0, spin: 0, eta: 99, called: false, warned: false,
        aiIgnore: type === 'pothole' ? Math.random() < 0.42 : type === 'oil' ? Math.random() < 0.18 : false, srgMiss: Math.random() < 0.08, born: id * 7 });
      return;
    }
  }
  function laneFree(l, except) {
    if (l < 0 || l > 3) return false; const a = G.amb;
    return !G.hazards.some((o) => { if (o.hit || o === except || o.z > 4) return false; if (Math.abs(o.x - LANE_X[l]) >= o.hw + AMB_HW + 0.3) return false; if (o.z > -6) return true; const cl = a.speed - o.v; return cl > 0.5 && (-o.z) / cl < 2.6; });
  }
  function updateHazards(dt) {
    const a = G.amb;
    G.spawnTimer -= dt;
    if (G.spawnTimer <= 0) { spawnHazard(); G.spawnTimer = lerp(1.5, 0.78, difficulty()) * rand(0.75, 1.3); }
    let threat = null;
    for (let i = G.hazards.length - 1; i >= 0; i--) {
      const h = G.hazards[i];
      h.z += (a.speed - h.v) * dt;
      if (h.knock) { h.x += h.kvx * dt; h.kvx *= Math.exp(-2.5 * dt); h.rot += h.spin * dt; h.spin *= Math.exp(-2 * dt); }
      if (!h.hit) {
        if (Math.abs(h.x - a.x) < AMB_HW + h.hw && Math.abs(h.z) < AMB_HL + h.hl) impact(h);
        else if (h.z < 0) {
          const cl = a.speed - h.v, eta = cl > 0.5 ? Math.max(0, (-h.z - AMB_HL - h.hl) / cl) : 99; h.eta = eta;
          const inPath = Math.abs(h.x - a.x) < AMB_HW + h.hw + 0.25;
          if (inPath && eta < 2.4 && (!threat || eta < threat.eta)) threat = { h, eta };
          if (G.ctrl.driver === 'ai' && !G.attract && !h.called && inPath && eta < (h.type === 'car' ? 0.8 : 1.35) && (G.ctrl.surgeon !== 'ai' || G.ctrl.anesth !== 'ai')) { h.called = true; aiCallout(h); }
        }
      }
      if (h.z > 28 || h.z < -235 || Math.abs(h.x) > 40) G.hazards.splice(i, 1);
    }
    if (threat) {
      const h = threat.h, lane = laneOfX(a.x), Lf = laneFree(lane - 1, h), Rf = laneFree(lane + 1, h);
      let sug;
      if (Lf && Rf) sug = a.x > h.x ? 'HARD RIGHT ➜' : '⟵ HARD LEFT'; else if (Lf) sug = '⟵ HARD LEFT'; else if (Rf) sug = 'HARD RIGHT ➜'; else sug = h.type === 'car' ? 'BRAKE!' : 'BRACE FOR IT!';
      G.threat = { type: h.type, key: h.key, eta: r3(threat.eta), sug };
      if (!h.warned) { h.warned = true; if (G.ctrl.driver !== 'ai') sfx('warn', null, 'driver'); }
    } else G.threat = null;
  }
  function aiCallout(h) {
    const txt = h.type === 'car' ? 'AI DRIVER: HOLD ON! IMPACT!' : h.type === 'oil' ? 'AI DRIVER: OIL! SLIDE INCOMING!' : 'AI DRIVER: BUMP INCOMING! BRACE!';
    if (G.ctrl.surgeon !== 'ai') banner(1, txt, HZ[h.key].css);
    if (G.ctrl.anesth !== 'ai') banner(2, txt, HZ[h.key].css);
  }
  function impact(h) {
    h.hit = true; const a = G.amb;
    if (h.type === 'pothole') {
      G.stats.bumps++; sfx('bump'); ev('bounce', 4.5);
      roadImpulse(rand(-0.35, 0.35), 1.0, 1.0, 'bump'); banner(0, 'BUMP!', HZ.pothole.css); spikeBPM(5);
      fx('ds', a.x, 0.3, -1.8, 14, { spread: 2, speed: 4, color: [1, 0.7, 0.3], life: 0.5, size: 0.25, grav: 9 });
    } else if (h.type === 'oil') {
      G.stats.skids++; sfx('screech'); a.skid = 1.15; a.skidDir = Math.random() < 0.5 ? -1 : 1;
      roadImpulse(a.skidDir * 1.1, 0.3, 0.75, 'skid'); banner(0, 'OIL SLICK! SKIDDING!', HZ.oil.css); spikeBPM(4);
    } else {
      G.stats.crashes++; sfx('crash'); ev('hitstop'); ev('white');
      const side = Math.sign(a.x - h.x) || (Math.random() < 0.5 ? -1 : 1);
      a.speed *= 0.4; a.vx = side * 7; h.knock = true; h.kvx = -side * 10; h.spin = rand(-5, 5);
      roadImpulse(side * 0.9, 1.25, 2.2, 'crash'); damage(4); spikeBPM(20);
      banner(-1, 'CRASH!', '#ff2a3d', { big: true });
      fx('ds', (a.x + h.x) / 2, 1.0, h.z * 0.5, 60, { spread: 3, speed: 9, color: [1, 0.8, 0.4], life: 0.7, size: 0.3, grav: 12 });
    }
  }
  function roadImpulse(ix, iy, mag, kind) {
    G.impulseX += ix * mag; G.impulseY += iy * mag;
    kick(ix * mag, iy * mag, 0.22 * mag);
    ev('bezel');
    surgeonJolt(ix * mag, iy * mag, mag);
    const n = kind === 'crash' ? 2 : kind === 'bump' ? (Math.random() < 0.55 ? 1 : 2) : kind === 'skid' ? 1 : 0;
    if (n > 0) { launchTools(n); banner(2, n > 1 ? 'TOOLS FLYING!' : 'TOOL FLYING!', '#ffd34d'); }
    ev('jiggle', r3(mag));
  }
  function surgeonJolt(ix, iy, mag) {
    const s = G.srg, k = s.brace ? 0.15 : 1, sg = Math.random() < 0.5 ? -1 : 1;
    s.jvx += ix * 3.4 * k; s.jvz += iy * 2.6 * k * sg; s.tipVy += iy * 3 * k;
    if (s.grab) {
      const p = s.grab;
      if (s.brace) banner(1, 'BRACED! GRIP HELD', '#18e6ff');
      else if (p.type === ARMOR && mag >= 0.6) slip();
      else if (mag >= 1.5) { banner(1, 'JOLT! LOST GRIP', '#ff9a1f'); p.progress = Math.max(0, p.progress - 0.1); releaseGrab(); }
    }
  }
  function releaseGrab() { const s = G.srg; if (s.grab) s.grab.grabbed = false; s.grab = null; s.tension = 0; s.inBand = false; s.blockReason = ''; }
  function slip() {
    const s = G.srg, p = s.grab; if (!p) return;
    p.progress = Math.max(0, p.progress - 0.3); releaseGrab();
    G.stats.slips++; damage(12); G.bleed += 2.2; spikeBPM(12); sfx('rip'); flash(1, 1);
    fx('sb', s.tipX, s.tipY, s.tipZ, 50, { spread: 1.2, speed: 3, color: [0.55, 0.02, 0.04], life: 1.2, size: 0.16, grav: 6, floor: -0.5 });
    banner(1, 'FORCEPS SLIPPED! TISSUE SLICED -12%', '#ff2a3d', { big: true });
    banner(0, 'SURGEON SLIPPED! DRIVE SMOOTHER!', '#ff2a3d'); banner(2, 'HEAVY BLEEDING!', '#ff2a3d');
  }

  /* ---------- vitals ---------- */
  function updateVitals(dt) {
    const diff = difficulty();
    G.zoneTimer -= dt;
    if (G.zoneTimer <= 0) {
      const w = lerp(26, 19, diff), cur = (G.zoneTarget[0] + G.zoneTarget[1]) / 2; let c, tries = 0;
      do { c = rand(68, 142); tries++; } while (Math.abs(c - cur) < 18 && tries < 10);
      G.zoneTarget = [Math.round(c - w / 2), Math.round(c + w / 2)]; G.zoneTimer = rand(10, 15);
      banner(2, `TARGET ZONE → ${G.zoneTarget[0]}–${G.zoneTarget[1]} BPM`, '#39ff14'); sfx('zone');
    }
    G.targetBPMZone[0] = damp(G.targetBPMZone[0], G.zoneTarget[0], 1.8, dt);
    G.targetBPMZone[1] = damp(G.targetBPMZone[1], G.zoneTarget[1], 1.8, dt);
    G.driftTimer -= dt;
    if (G.driftTimer <= 0) { G.bpmDrift = rand(-1, 1) * lerp(2.4, 4.2, diff); G.driftTimer = rand(1.8, 3.6); }
    let bpm = G.heartBPM + G.bpmDrift * dt + (95 - G.heartBPM) * 0.012 * dt;
    if (G.pendingDose !== 0) { const st = G.pendingDose * Math.min(1, dt * 6); bpm += st; G.pendingDose -= st; if (Math.abs(G.pendingDose) < 0.02) G.pendingDose = 0; }
    G.heartBPM = clamp(bpm, 40, 180);
    let active = 0, activeNon = 0; for (const p of G.parasites) if (p.state === 'attached') { active++; if (p.type !== PHOTO) activeNon++; }
    let drain = active * 0.03;
    if (!G.lampFocusedOnChest) drain += activeNon * 0.035;
    G.inZone = G.heartBPM >= G.targetBPMZone[0] && G.heartBPM <= G.targetBPMZone[1];
    if (!G.inZone) drain += 0.12;
    if (G.heartBPM < 50 || G.heartBPM > 160) {
      drain += 1.0; G.alarmCD -= dt;
      if (G.alarmCD <= 0) { G.alarmCD = 0.75; sfx('alarm'); banner(2, G.heartBPM > 160 ? 'CRITICAL TACHYCARDIA! SEDATE (Q)' : 'CRITICAL BRADYCARDIA! ADRENALINE (E)', '#ff2a3d'); }
    }
    drain += G.bleed; G.bleed *= Math.exp(-dt / 2.4); if (G.bleed < 0.01) G.bleed = 0;
    G.patientBlood = Math.max(0, G.patientBlood - drain * dt);
  }

  /* ---------- surgeon ---------- */
  function cleanSurg(i, s) { if (!i) return { tx: s.tx, tz: s.tz, clamp: false, brace: false }; const tx = +i.tx, tz = +i.tz; return { tx: Number.isFinite(tx) ? tx : s.tx, tz: Number.isFinite(tz) ? tz : s.tz, clamp: !!i.clamp, brace: !!i.brace }; }
  function updateSurgeon(dt, hin) {
    const s = G.srg, inp = G.ctrl.surgeon === 'ai' ? AI.surgeon(dt) : cleanSurg(hin, s);
    s.tx = clamp(inp.tx, -4.3, 4.3); s.tz = clamp(inp.tz, -5.4, 5.4); s.brace = !!inp.brace;
    const rate = s.brace ? 7 : 17;
    s.fx = damp(s.fx, s.tx, rate, dt); s.fz = damp(s.fz, s.tz, rate, dt);
    s.jvx += (-75 * s.jx - 10 * s.jvx) * dt; s.jvz += (-75 * s.jz - 10 * s.jvz) * dt; s.jx += s.jvx * dt; s.jz += s.jvz * dt;
    s.tipVy += (-90 * s.tipOy - 9 * s.tipVy) * dt; s.tipOy += s.tipVy * dt;
    s.tipX = s.fx + s.jx; s.tipZ = s.fz + s.jz;
    const down = !!inp.clamp, pressed = down && !s.prevClamp, released = !down && s.prevClamp; s.prevClamp = down; s.clamp = down;
    s.tipY = damp(s.tipY, s.grab ? s.grab.slot.y + 0.12 : down ? 0.58 : 1.75, 14, dt);
    s.ribCD -= dt; s.nerveCD -= dt;
    if (pressed) tryGrab();
    if (released && s.grab) releaseGrab();
    if (down) {
      if (s.nerveCD <= 0 && s.tipY < 0.95 && nearPolys(NERVES, s.tipX, s.tipZ, 0.17)) nerveTouch();
      if (s.ribCD <= 0 && s.tipY < 1.0 && nearPolys(RIBS, s.tipX, s.tipZ, 0.22)) ribHit();
    }
    if (s.grab) updateGrab(dt);
    for (const p of G.parasites) {
      if (p.state === 'attached') {
        p.noGrab = Math.max(0, p.noGrab - dt); p.shake = Math.max(0, p.shake - dt * 3);
        if (p.type === PHOTO) { p.burrow = damp(p.burrow, G.lampFocusedOnChest ? 1 : 0, 3, dt); if (G.lampFocusedOnChest && !p.grabbed && p.progress > 0) p.progress = Math.max(0, p.progress - 0.05 * dt); }
      } else if (p.state === 'flying') { p.flyT += dt * 1.7; if (p.flyT >= 1) p.state = 'jar'; }
    }
    s.hoverP = null; let bd = 0.75;
    for (const p of G.parasites) { if (p.state !== 'attached') continue; const d = Math.hypot(p.slot.x - s.tipX, p.slot.z - s.tipZ); if (d < bd) { bd = d; s.hoverP = p; } }
  }
  function tryGrab() {
    const s = G.srg; let best = null, bd = 0.62;
    for (const p of G.parasites) { if (p.state !== 'attached') continue; const d = Math.hypot(p.slot.x - s.tipX, p.slot.z - s.tipZ); if (d < bd) { bd = d; best = p; } }
    if (!best) return;
    if (best.noGrab > 0) { banner(1, 'IT SQUIRMED AWAY!', '#ff9a1f'); return; }
    if (best.type === PHOTO && G.lampFocusedOnChest) { photoRecoil(best); return; }
    s.grab = best; best.grabbed = true; sfx('grab');
  }
  function photoRecoil(p) {
    p.noGrab = 1.1; p.progress = Math.max(0, p.progress - 0.2); p.burrow = 1; G.stats.recoils++; sfx('squelch'); spikeBPM(3);
    banner(1, 'RECOILS FROM THE LIGHT! NEED LAMP OFF', '#a48bff'); banner(2, 'SURGEON: KILL THE LAMP! (R / TAB)', '#a48bff');
  }
  function updateGrab(dt) {
    const s = G.srg, p = s.grab, info = p.info;
    const t = Math.hypot(s.tipX - p.slot.x, s.tipZ - p.slot.z); s.tension = t; s.blockReason = '';
    if (p.type === PHOTO && G.lampFocusedOnChest) { releaseGrab(); photoRecoil(p); return; }
    if (t > info.tear) { tear(p); return; }
    const inBand = t >= info.band[0] && t <= info.band[1]; let ok = inBand;
    if (p.type === PULSE && !G.inZone) { ok = false; s.blockReason = 'BPM OUT OF ZONE: HOLD!'; if (inBand) p.progress = Math.max(0, p.progress - 0.06 * dt); }
    if (!s.blockReason && t < info.band[0]) s.blockReason = 'PULL HARDER';
    s.inBand = ok;
    if (ok) {
      p.progress += info.rate * dt; p.shake = 1;
      if (Math.random() < dt * 10) { const c = info.color; fx('sf', p.slot.x, p.slot.y + 0.1, p.slot.z, 2, { spread: 0.4, speed: 1.2, color: [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255], life: 0.5, size: 0.1, grav: 2 }); }
    }
    if (p.progress >= 1) extract(p);
  }
  function tear(p) {
    releaseGrab(); G.stats.tears++; damage(6); G.bleed += 1.6; spikeBPM(10); p.progress = Math.max(0, p.progress - 0.25); sfx('rip'); flash(1, 1);
    fx('sb', p.slot.x, p.slot.y + 0.1, p.slot.z, 40, { spread: 1, speed: 2.5, color: [0.55, 0.02, 0.04], life: 1.1, size: 0.15, grav: 5, floor: -0.5 });
    banner(1, 'TOO HARD! TISSUE TORN -6%', '#ff2a3d'); banner(2, 'TISSUE TEAR! BPM RISING', '#ff9a1f');
  }
  function extract(p) {
    const s = G.srg; releaseGrab(); p.state = 'flying'; p.flyT = 0; p.progress = 1;
    p.from = { x: s.tipX, y: s.tipY + 0.1, z: s.tipZ }; p.jarSlot = G.extracted; G.extracted++;
    sfx('extract'); spikeBPM(4);
    const c = p.info.color, col = [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
    fx('sf', s.tipX, s.tipY, s.tipZ, 45, { spread: 1, speed: 4, color: col, life: 0.9, size: 0.2, grav: 5 });
    fx('sb', p.slot.x, p.slot.y + 0.1, p.slot.z, 18, { spread: 0.8, speed: 2, color: [0.5, 0.02, 0.04], life: 0.9, size: 0.13, grav: 5, floor: -0.5 });
    const n = G.parasites.length;
    banner(1, `${p.info.name} EXTRACTED! ${G.extracted}/${n}`, p.info.css, { big: true });
    banner(0, `PARASITE OUT ${G.extracted}/${n}`, p.info.css); banner(2, `PARASITE OUT ${G.extracted}/${n}`, p.info.css);
    if (p.type === PHOTO && !G.lampFocusedOnChest) banner(2, 'PHOTOPHOBIC OUT! LAMP BACK ON (R)', '#fff3a0');
  }
  function nerveTouch() {
    const s = G.srg; s.nerveCD = 1.0; G.stats.nerves++; spikeBPM(10); sfx('zap');
    fx('sf', s.tipX, 0.5, s.tipZ, 26, { spread: 1, speed: 3.5, color: [1, 0.9, 0.3], life: 0.4, size: 0.12, grav: 3 });
    banner(1, 'NERVE HIT! BPM SPIKE', '#ffe14a'); banner(2, 'NERVE HIT! BPM ↑', '#ffe14a');
  }
  function ribHit() {
    const s = G.srg; s.ribCD = 0.9; G.stats.ribs++; spikeBPM(6); sfx('bone');
    damage(s.grab ? 3 : 1);
    fx('sf', s.tipX, 0.55, s.tipZ, 18, { spread: 1, speed: 2.5, color: [1, 0.97, 0.85], life: 0.35, size: 0.1, grav: 4 });
    s.jvx += -Math.sign(s.tipX) * 2.5;
    if (s.grab) { const p = s.grab; p.progress = p.type === PULSE ? p.progress * 0.5 : Math.max(0, p.progress - 0.15); releaseGrab(); banner(1, 'HIT THE RIBCAGE! GRIP LOST', '#ff2a3d'); }
    else banner(1, 'RIB CONTACT!', '#ff9a1f');
  }

  /* ---------- anesthesiologist ---------- */
  function processQueue() {
    while (G.queue.length) {
      const a = G.queue.shift();
      if (a === 'sed') { G.pendingDose -= 7; ev('inject', 0); sfx('inject', true); G.stats.doses++; }
      else if (a === 'adr') { G.pendingDose += 7; ev('inject', 1); sfx('inject', false); G.stats.doses++; }
      else if (a === 'lamp') { G.lampFocusedOnChest = !G.lampFocusedOnChest; sfx('click'); banner(1, G.lampFocusedOnChest ? 'LAMP ON CHEST' : 'LAMP AWAY: LOW LIGHT', G.lampFocusedOnChest ? '#fff3a0' : '#a48bff'); }
      else if (a.indexOf('swat') === 0) trySwat(+a.charAt(4));
    }
  }
  function launchTools(n) {
    const avail = shuffle(G.slots.filter((s) => s.present)), used = [];
    for (let i = 0; i < n && i < avail.length; i++) {
      const sl = avail[i]; sl.present = false; sl.respawn = rand(3, 4.5);
      const opts = [0, 1, 2].filter((l) => used.indexOf(l) < 0), lane = pick(opts.length ? opts : [0, 1, 2]); used.push(lane);
      const lx = ANE.LANE_X[lane];
      const tl = { id: G.nextId++, kind: sl.kind, lane, p0: { x: sl.x, y: ANE.Y, z: sl.z }, p1: { x: lx, y: rand(3.2, 3.8), z: 0.4 }, p2: { x: lx + rand(-0.15, 0.15), y: 1.0, z: 2.85 },
        T: rand(1.55, 1.85) * lerp(1, 0.85, difficulty()), t: 0, delay: i * rand(0.14, 0.32), state: 'pending',
        pos: { x: sl.x, y: ANE.Y, z: sl.z }, rot: { x: 0, y: sl.ry, z: 0 }, vel: { x: 0, y: 0, z: 0 }, spin: { x: rand(-9, 9), y: rand(-9, 9), z: rand(-9, 9) },
        life: 0, scale: 1, gold: 0, aiHandled: false, aiDelay: rand(0.02, 0.2), aiSuccess: Math.random() < 0.9 };
      tl.tTh = solveT(tl, ANE.TH_Z); tl.tZone = tl.tTh * 0.5;
      G.tools.push(tl);
    }
  }
  function trySwat(lane) {
    if (!(lane >= 0 && lane <= 2) || G.laneLock[lane] > 0) return;
    ev('swing', lane);
    let best = null;
    for (const tl of G.tools) if (tl.state === 'flying' && tl.lane === lane && tl.t < tl.tTh && (!best || tl.t > best.t)) best = tl;
    if (best && best.t >= best.tZone) swatTool(best);
    else { G.laneLock[lane] = 0.45; sfx('whiff'); if (best) banner(2, 'TOO EARLY!', '#ff9a1f'); }
  }
  function swatTool(tl) {
    tl.state = 'swatted'; tl.life = 1.6;
    const d = bezD(tl.t, tl.p0, tl.p1, tl.p2), side = tl.lane === 0 ? -1 : tl.lane === 2 ? 1 : Math.random() < 0.5 ? -1 : 1;
    tl.vel = { x: side * rand(5, 7), y: rand(3, 5), z: -(d.z / tl.T) * 0.3 - 1.5 };
    tl.spin = { x: tl.spin.x * 2.2, y: tl.spin.y * 2.2, z: tl.spin.z * 2.2 }; tl.gold = 1;
    fx('af', tl.pos.x, tl.pos.y, tl.pos.z, 36, { spread: 1.2, speed: 6, color: [1, 0.85, 0.4], life: 0.45, size: 0.12, grav: 6 });
    sfx('clang'); G.stats.swats++; ev('laneflash', tl.lane); banner(2, 'CLANG! PARRIED', '#ffd34d');
  }
  function stabTool(tl) {
    tl.state = 'stuck'; tl.life = 2.4; tl.pos = { x: tl.p2.x, y: tl.p2.y, z: tl.p2.z }; tl.rot = { x: -1.1, y: rand(-0.4, 0.4), z: 0 };
    damage(15); spikeBPM(14); G.stats.stabs++; sfx('stab'); flash(2, 1); flash(1, 0.8);
    fx('ab', tl.p2.x, tl.p2.y, tl.p2.z, 40, { spread: 1, speed: 3, color: [0.6, 0.02, 0.04], life: 1.1, size: 0.12, grav: 6, floor: 0.9 });
    banner(2, 'STABBED! -15% BLOOD', '#ff2a3d', { big: true }); banner(1, 'FLYING TOOL STAB! -15%', '#ff2a3d');
    ev('stuck', tl.kind);
  }
  function updateTools(dt) {
    for (let i = G.tools.length - 1; i >= 0; i--) {
      const tl = G.tools[i];
      if (tl.state === 'pending') {
        tl.delay -= dt;
        if (tl.delay <= 0) { tl.state = 'flying'; sfx('whoosh'); fx('af', tl.p0.x, tl.p0.y + 0.1, tl.p0.z, 8, { spread: 0.6, speed: 1.5, color: [1, 1, 1], life: 0.3, size: 0.08, grav: 2 }); }
        continue;
      }
      if (tl.state === 'flying') {
        tl.t += dt / tl.T; bez(Math.min(tl.t, 1), tl.p0, tl.p1, tl.p2, tl.pos);
        tl.rot.x += tl.spin.x * dt; tl.rot.y += tl.spin.y * dt; tl.rot.z += tl.spin.z * dt;
        if (tl.t >= 1) stabTool(tl);
      } else if (tl.state === 'swatted') {
        tl.vel.y -= 16 * dt; tl.pos.x += tl.vel.x * dt; tl.pos.y += tl.vel.y * dt; tl.pos.z += tl.vel.z * dt;
        tl.rot.x += tl.spin.x * dt; tl.rot.y += tl.spin.y * dt; tl.rot.z += tl.spin.z * dt;
        tl.life -= dt; if (tl.life <= 0) G.tools.splice(i, 1);
      } else if (tl.state === 'stuck') {
        tl.life -= dt; if (tl.life < 0.5) tl.scale = Math.max(0.01, tl.life / 0.5); if (tl.life <= 0) G.tools.splice(i, 1);
      }
    }
    for (const sl of G.slots) if (!sl.present) { sl.respawn -= dt; if (sl.respawn <= 0) sl.present = true; }
  }

  /* ---------- end conditions ---------- */
  function checkEnd() {
    if (G.patientBlood <= 0 && !G.flatlined) { G.flatlined = true; sfx('flatStart'); endGame(false, 'PATIENT FLATLINED'); return; }
    if (G.time >= TIME_LIMIT) { endGame(false, 'TIME EXPIRED'); return; }
    const all = G.extracted >= G.parasites.length;
    if (all && !G.allOutAnnounced) { G.allOutAnnounced = true; banner(-1, 'ALL PARASITES OUT! FLOOR IT TO THE ER!', '#39ff14', { big: true, life: 2.6 }); }
    if (G.distanceRemaining <= 0) {
      if (all) endGame(true, 'HOSPITAL REACHED');
      else { const left = G.parasites.length - G.extracted; G.distanceRemaining += DETOUR_DIST; G.detours++; banner(-1, `ER LOCKED: ${left} PARASITE${left > 1 ? 'S' : ''} ACTIVE! DETOUR +${DETOUR_DIST}m`, '#ff2a3d', { big: true, life: 2.6 }); }
    }
  }
  function endGame(won, reason) {
    if (G.mode !== 'playing' && G.mode !== 'attract') return;
    G.won = won; G.endReason = reason; G.endTimer = won ? 1.6 : 2.4; G.mode = 'ending';
    releaseGrab();
    if (!G.attract) sfx(won ? 'win' : 'lose');
    banner(-1, won ? 'HOSPITAL REACHED!' : reason + '!', won ? '#39ff14' : '#ff2a3d', { big: true, life: 3 });
  }
  function idleStep(dt) {
    const a = G.amb; a.speed = damp(a.speed, G.won ? 0 : 6, G.won ? 3 : 1.5, dt); a.boosting = false;
    G.traveled += a.speed * dt; G.distanceRemaining -= a.speed * dt;
    for (const h of G.hazards) h.z += (a.speed - h.v) * dt;
  }
  function endStep(dt) {
    G.endTimer -= dt; idleStep(dt);
    if (G.endTimer <= 0) { G.mode = 'ended'; ev('over', S.summary()); }
  }
  S.summary = () => ({ won: G.won, reason: G.endReason, time: r3(G.time), distanceRemaining: Math.max(0, Math.ceil(G.distanceRemaining)), blood: r3(G.patientBlood), extracted: G.extracted, total: G.parasites.length, detours: G.detours, stats: Object.assign({}, G.stats) });

  /* ---------- AI co-pilots ---------- */
  function imminentImpact(t) {
    const a = G.amb;
    for (const h of G.hazards) {
      if (h.hit || h.z > 2 || h.srgMiss) continue;
      if (Math.abs(h.x - a.x) < AMB_HW + h.hw + 0.2) { const cl = a.speed - h.v; if (cl > 0.5 && (-h.z - AMB_HL - h.hl) / cl < t) return true; }
    }
    return false;
  }
  const AI = {
    drv: {}, srg: {}, ane: {},
    reset() { this.drv = { timer: 0, target: laneOfX(G.amb.x), boost: false, blocked: false }; this.srg = { target: null, retarget: 0, cool: 0, requestCD: 0, wob: Math.random() * 10 }; this.ane = { doseCD: 0, lampCD: 0, lampT: 0 }; },
    driver(dt) {
      const a = G.amb, st = this.drv, cur = laneOfX(a.x);
      st.timer -= dt;
      if (st.timer <= 0) {
        st.timer = 0.1;
        const cost = [0, 0, 0, 0];
        for (const h of G.hazards) {
          if (h.hit || h.z > 4) continue;
          const cl = a.speed - h.v, eta = cl > 0.5 ? Math.max(0, (-h.z - AMB_HL - h.hl) / cl) : h.z > -8 ? 0 : 99;
          if (eta > 3.0) continue;
          let w = h.type === 'car' ? 14 : h.type === 'oil' ? 5 : 3.5; if (h.aiIgnore) w = 0;
          const urg = 3.0 - eta + (h.z > -7 ? 4 : 0);
          for (let l = 0; l < 4; l++) if (Math.abs(h.x - LANE_X[l]) < h.hw + AMB_HW + 0.35) cost[l] += w * urg;
        }
        let best = cur, bc = 1e9;
        for (let l = 0; l < 4; l++) {
          let c = cost[l] + Math.abs(l - cur) * 0.7 + (l <= 1 ? 0.4 : 0);
          for (let m = Math.min(l, cur); m <= Math.max(l, cur); m++) c = Math.max(c, cost[m] * 0.8 + Math.abs(l - cur) * 0.7);
          if (c < bc) { bc = c; best = l; }
        }
        st.target = best; st.blocked = bc > 30;
        let clear = true;
        for (const h of G.hazards) { if (h.hit || h.z > 2) continue; if (Math.abs(h.x - LANE_X[best]) < h.hw + AMB_HW + 0.4) { const cl = a.speed + 8 - h.v; if (cl > 0.5 && (-h.z) / cl < 2.8) clear = false; } }
        st.boost = clear && (a.boostFuel > 0.3 || (st.boost && a.boostFuel > 0.08));
      }
      const dx = LANE_X[st.target] - a.x;
      return { steer: Math.abs(dx) < 0.12 ? 0 : clamp(dx * 1.4, -1, 1), throttle: !st.blocked, brake: st.blocked, boost: st.boost && !st.blocked };
    },
    surgeon(dt) {
      const s = G.srg, st = this.srg;
      st.cool -= dt; st.requestCD -= dt; st.wob += dt;
      const att = G.parasites.filter((p) => p.state === 'attached');
      if (!att.length) return { tx: 2.4, tz: 3.2, clamp: false, brace: false };
      const soon = imminentImpact(1.05);
      const ready = (p) => (p.type === PHOTO ? !G.lampFocusedOnChest : p.type === PULSE ? G.inZone : true);
      if (!s.grab) {
        st.retarget -= dt;
        if (!st.target || st.target.state !== 'attached' || st.retarget <= 0) {
          let best = null, bs = 1e9;
          for (const p of att) { let sc = Math.hypot(p.slot.x - s.tipX, p.slot.z - s.tipZ) * 0.25; if (!ready(p)) sc += p.type === PHOTO ? (G.ctrl.anesth === 'ai' ? 1.2 : 2.0) : 2.5; if (p.noGrab > 0) sc += 3; if (sc < bs) { bs = sc; best = p; } }
          st.target = best; st.retarget = 1.2;
        }
      }
      const p = st.target, info = p.info, r = ready(p);
      if (!r && p.type === PHOTO && G.ctrl.anesth !== 'ai' && st.requestCD <= 0 && !G.attract) { st.requestCD = 5; banner(2, 'AI SURGEON: LAMP OFF PLEASE! (R / TAB)', '#a48bff'); banner(1, 'WAITING FOR DARKNESS…', '#a48bff'); }
      let dx = -p.slot.x, dz = 0.3 - p.slot.z; const dl = Math.hypot(dx, dz); if (dl < 0.3) { dx = 0; dz = 1; } else { dx /= dl; dz /= dl; }
      const wx = Math.sin(st.wob * 6.3) * 0.05, wz = Math.cos(st.wob * 5.1) * 0.05;
      if (s.grab) {
        if (s.grab !== p) return { tx: s.tipX, tz: s.tipZ, clamp: false, brace: soon };
        if (!r) {
          if (p.type === PHOTO) return { tx: p.slot.x, tz: p.slot.z, clamp: false, brace: soon };
          const k = info.band[0] * 0.5; return { tx: p.slot.x + dx * k + wx, tz: p.slot.z + dz * k + wz, clamp: true, brace: true };
        }
        const k = (info.band[0] + info.band[1]) / 2;
        return { tx: p.slot.x + dx * k + wx, tz: p.slot.z + dz * k + wz, clamp: true, brace: soon || p.type === ARMOR };
      }
      const d = Math.hypot(p.slot.x - s.tipX, p.slot.z - s.tipZ);
      const canGrab = r && d < 0.2 && st.cool <= 0 && !imminentImpact(0.6) && p.noGrab <= 0;
      if (canGrab) st.cool = 0.5;
      return { tx: p.slot.x, tz: p.slot.z, clamp: canGrab, brace: soon };
    },
    anesth(dt) {
      const st = this.ane, s = G.srg; st.doseCD -= dt; st.lampCD -= dt;
      const z0 = G.targetBPMZone[0], z1 = G.targetBPMZone[1], pred = G.heartBPM + G.pendingDose + G.bpmDrift * 0.8;
      if (st.doseCD <= 0) { if (pred < z0 + 5) { G.queue.push('adr'); st.doseCD = rand(0.3, 0.55); } else if (pred > z1 - 5) { G.queue.push('sed'); st.doseCD = rand(0.3, 0.55); } }
      let wantOff = false;
      if (G.ctrl.surgeon === 'ai') { const t = AI.srg.target; wantOff = !!(t && t.state === 'attached' && t.type === PHOTO && Math.hypot(t.slot.x - s.tipX, t.slot.z - s.tipZ) < 1.8); }
      else if (s.grab && s.grab.type === PHOTO) wantOff = true;
      else for (const p of G.parasites) if (p.state === 'attached' && p.type === PHOTO && Math.hypot(p.slot.x - s.tipX, p.slot.z - s.tipZ) < 1.1) { wantOff = true; break; }
      if (wantOff === G.lampFocusedOnChest) { st.lampT += dt; if (st.lampT > (wantOff ? 0.25 : 0.6) && st.lampCD <= 0) { G.queue.push('lamp'); st.lampCD = 0.6; st.lampT = 0; } } else st.lampT = 0;
      for (let l = 0; l < 3; l++) {
        let lead = null; for (const tl of G.tools) if (tl.state === 'flying' && tl.lane === l && tl.t < tl.tTh && (!lead || tl.t > lead.t)) lead = tl;
        if (lead && !lead.aiHandled && lead.t >= lead.tZone + lead.aiDelay) { lead.aiHandled = true; if (lead.aiSuccess) G.queue.push('swat' + l); }
      }
    },
  };

  /* ---------- network snapshot (server -> clients) ---------- */
  S.snapshot = function () {
    const a = G.amb, s = G.srg;
    return {
      g: G.gen, m: G.mode, at: G.attract ? 1 : 0, c: G.ctrl, t: r3(G.time), d: r3(G.distanceRemaining), tr: r3(G.traveled), dt: G.detours,
      a: [r3(a.x), r3(a.vx), r3(a.speed), r3(a.boostFuel), a.boosting ? 1 : 0, r3(a.skid)],
      h: G.hazards.map((h) => [h.id, HKEYS.indexOf(h.key), r3(h.x), r3(h.z), r3(h.v), h.hit ? 1 : 0, h.knock ? 1 : 0, r3(h.kvx), r3(h.rot), r3(h.spin), r3(Math.min(h.eta, 99))]),
      th: G.threat ? [HKEYS.indexOf(G.threat.key), G.threat.eta, G.threat.sug] : 0,
      b: r3(G.patientBlood), hr: r3(G.heartBPM), zn: [r3(G.targetBPMZone[0]), r3(G.targetBPMZone[1])], iz: G.inZone ? 1 : 0, lp: G.lampFocusedOnChest ? 1 : 0, fl: G.flatlined ? 1 : 0, bl: r3(G.bleed),
      s: [r3(s.tipX), r3(s.tipZ), r3(s.tipY), r3(s.tipOy), r3(s.tx), r3(s.tz), r3(s.fx), r3(s.fz), s.clamp ? 1 : 0, s.brace ? 1 : 0, s.grab ? s.grab.id : -1, r3(s.tension), s.inBand ? 1 : 0, s.blockReason, s.hoverP ? s.hoverP.id : -1],
      p: G.parasites.map((p) => [p.type, P_STATES.indexOf(p.state), r3(p.progress), p.grabbed ? 1 : 0, r3(p.burrow), r3(p.noGrab), r3(p.shake), r3(p.flyT), r3(p.from.x), r3(p.from.y), r3(p.from.z), p.jarSlot]),
      ex: G.extracted,
      tl: G.tools.map((t) => [t.id, TOOL_KINDS.indexOf(t.kind), t.lane, T_STATES.indexOf(t.state), r3(t.p0.x), r3(t.p0.y), r3(t.p0.z), r3(t.p1.x), r3(t.p1.y), r3(t.p1.z), r3(t.p2.x), r3(t.p2.y), r3(t.p2.z), r3(t.T), r3(t.t), r3(t.tTh), r3(t.tZone),
        r3(t.pos.x), r3(t.pos.y), r3(t.pos.z), r3(t.rot.x), r3(t.rot.y), r3(t.rot.z), r3(t.vel.x), r3(t.vel.y), r3(t.vel.z), r3(t.spin.x), r3(t.spin.y), r3(t.spin.z), r3(t.life), r3(t.scale), t.gold]),
      sl: G.slots.map((q) => [TOOL_KINDS.indexOf(q.kind), r3(q.x), r3(q.z), r3(q.ry), q.present ? 1 : 0]),
      ll: G.laneLock.map(r3), st: G.stats, er: G.endReason, w: G.won ? 1 : 0,
    };
  };
  S.apply = function (n) {
    if (!G || G.gen !== n.g) { G = S.G = fresh(); G.gen = n.g; G.parasites = makeParasites(n.p.map((q) => q[0])); }
    G.mode = n.m; G.attract = !!n.at; G.ctrl = n.c; G.time = n.t; G.distanceRemaining = n.d; G.traveled = n.tr; G.detours = n.dt;
    const a = G.amb; a.x = n.a[0]; a.vx = n.a[1]; a.speed = n.a[2]; a.boostFuel = n.a[3]; a.boosting = !!n.a[4]; a.skid = n.a[5];
    G.hazards = n.h.map((q) => { const key = HKEYS[q[1]], d = HZ[key]; return { id: q[0], key, type: key === 'oncoming' ? 'car' : key, oncoming: key === 'oncoming', x: q[2], z: q[3], v: q[4], hit: !!q[5], knock: !!q[6], kvx: q[7], rot: q[8], spin: q[9], eta: q[10], hw: d.hw, hl: d.hl, born: q[0] * 7 }; });
    G.threat = n.th ? { key: HKEYS[n.th[0]], type: HKEYS[n.th[0]] === 'oncoming' ? 'car' : HKEYS[n.th[0]], eta: n.th[1], sug: n.th[2] } : null;
    G.patientBlood = n.b; G.heartBPM = n.hr; G.targetBPMZone = n.zn; G.inZone = !!n.iz; G.lampFocusedOnChest = !!n.lp; G.flatlined = !!n.fl; G.bleed = n.bl;
    n.p.forEach((q, i) => { const p = G.parasites[i]; if (!p) return; p.state = P_STATES[q[1]]; p.progress = q[2]; p.grabbed = !!q[3]; p.burrow = q[4]; p.noGrab = q[5]; p.shake = q[6]; p.flyT = q[7]; p.from = { x: q[8], y: q[9], z: q[10] }; p.jarSlot = q[11]; });
    const s = G.srg, v = n.s;
    s.tipX = v[0]; s.tipZ = v[1]; s.tipY = v[2]; s.tipOy = v[3]; s.tx = v[4]; s.tz = v[5]; s.fx = v[6]; s.fz = v[7]; s.clamp = !!v[8]; s.brace = !!v[9];
    s.grab = v[10] >= 0 ? G.parasites[v[10]] || null : null; s.tension = v[11]; s.inBand = !!v[12]; s.blockReason = v[13]; s.hoverP = v[14] >= 0 ? G.parasites[v[14]] || null : null;
    G.extracted = n.ex;
    G.tools = n.tl.map((q) => ({ id: q[0], kind: TOOL_KINDS[q[1]], lane: q[2], state: T_STATES[q[3]], p0: { x: q[4], y: q[5], z: q[6] }, p1: { x: q[7], y: q[8], z: q[9] }, p2: { x: q[10], y: q[11], z: q[12] }, T: q[13], t: q[14], tTh: q[15], tZone: q[16],
      pos: { x: q[17], y: q[18], z: q[19] }, rot: { x: q[20], y: q[21], z: q[22] }, vel: { x: q[23], y: q[24], z: q[25] }, spin: { x: q[26], y: q[27], z: q[28] }, life: q[29], scale: q[30], gold: q[31] }));
    G.slots = n.sl.map((q) => ({ kind: TOOL_KINDS[q[0]], x: q[1], z: q[2], ry: q[3], present: !!q[4] }));
    G.laneLock = n.ll; G.stats = n.st; G.endReason = n.er; G.won = !!n.w;
  };
  // Client-side dead reckoning between snapshots so motion stays smooth at 60 fps.
  S.extrapolate = function (dt) {
    if (!G) return;
    const a = G.amb;
    if (G.mode === 'playing') G.time += dt;
    G.traveled += a.speed * dt; G.distanceRemaining -= a.speed * dt;
    if (G.mode === 'playing' || G.mode === 'attract') { a.x = clamp(a.x + a.vx * dt, -(ROAD_HALF - AMB_HW - 0.15), ROAD_HALF - AMB_HW - 0.15); }
    for (const h of G.hazards) { h.z += (a.speed - h.v) * dt; if (h.knock) { h.x += h.kvx * dt; h.rot += h.spin * dt; } }
    for (const tl of G.tools) {
      if (tl.state === 'flying') { tl.t = Math.min(1, tl.t + dt / tl.T); bez(tl.t, tl.p0, tl.p1, tl.p2, tl.pos); tl.rot.x += tl.spin.x * dt; tl.rot.y += tl.spin.y * dt; tl.rot.z += tl.spin.z * dt; }
      else if (tl.state === 'swatted') { tl.vel.y -= 16 * dt; tl.pos.x += tl.vel.x * dt; tl.pos.y += tl.vel.y * dt; tl.pos.z += tl.vel.z * dt; tl.rot.x += tl.spin.x * dt; tl.rot.y += tl.spin.y * dt; tl.rot.z += tl.spin.z * dt; }
    }
    for (const p of G.parasites) if (p.state === 'flying') p.flyT = Math.min(1, p.flyT + dt * 1.7);
    for (let i = 0; i < 3; i++) G.laneLock[i] = Math.max(0, G.laneLock[i] - dt);
  };
  return S;
}
