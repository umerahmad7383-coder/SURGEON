// CODE RED: TURBO SURGERY: browser client (rendering, HUD, audio, input, online rooms).
import { createSim, STEP, LANE_X, AMB_HL, TOTAL_DIST, TIME_LIMIT, DETOUR_DIST, PHOTO, PULSE, ARMOR, ROLES, ROLE_NAMES, PINFO, HZ, ORG, RX, RZ, RIB_DEFS, NERVE_DEFS, RIBS, NERVES, ANE, nearPolys, clamp, lerp, damp, rand } from './sim.js';

const $ = (id) => document.getElementById(id);
if (!window.THREE) { $('fatal').classList.remove('hidden'); $('menu').classList.add('hidden'); throw new Error('Three.js failed to load'); }
const THREE = window.THREE;

/* ============================== UTIL ============================== */
const TAU = Math.PI * 2;
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const gauss = (x, s) => Math.exp(-(x * x) / (2 * s * s));
const wrap = (v, mn, mx) => { const r = mx - mn; return mn + (((v - mn) % r) + r) % r; };
const easeOutBack = (x) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
const PANE_COL = ['#ff9a1f', '#18e6ff', '#ff3df2'];

/* ============================== SESSION ============================== */
// kind: 'attract' (demo behind menus) | 'local' (one machine) | 'online' (server-run room)
const Sess = { kind: 'attract', menuMode: 'online', coop: true, soloRole: 1, paused: false, room: null, myId: 0, myRole: null, last: null };
const sim = createSim();
let G = null;
let realTime = 0;
// client-only visual state (shake, flashes, banners, heartbeat trace)
const V = { gen: -1, shake: { trauma: 0, x: 0, y: 0, vx: 0, vy: 0 }, bounce: 0, bounceV: 0, flash: [0, 0, 0], bezel: [0, 0, 0], whiteFlash: 0, hitStop: 0, banners: [],
  beatPhase: 0, beatPulse: 0, ecg: new Float32Array(540), ecgIdx: 0, ecgAcc: 0, injPress: [0, 0], laneFlash: [0, 0, 0], localSurg: { tx: 0, tz: 1.6 } };
const roleIdx = (r) => ROLES.indexOf(r);
function humanRole(r) {
  if (!G) return false;
  if (Sess.kind === 'online') return Sess.myRole === r;
  return Sess.kind === 'local' && G.ctrl[r] === 'human';
}
const isAI = (r) => !G || G.ctrl[r] === 'ai';
function seatName(r) { const s = Sess.room && Sess.room.seats && Sess.room.seats[r]; return s ? s.name : null; }

/* ============================== INPUT ============================== */
const Input = { keys: new Set(), mx: window.innerWidth / 2, my: window.innerHeight / 2, lmb: false, rmb: false };
const PREVENT = new Set(['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const GAME_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight', 'KeyQ', 'KeyE', 'KeyR', 'KeyF', 'KeyG', 'KeyH', 'Digit1', 'Digit2', 'Digit3', 'Numpad1', 'Numpad2', 'Numpad3', 'Enter', 'Escape']);
const inMatch = () => G && (Sess.kind === 'local' || Sess.kind === 'online') && (G.mode === 'playing' || G.mode === 'ending');
window.addEventListener('keydown', (e) => {
  const tag = e.target && e.target.tagName;
  if (tag === 'INPUT') { if (e.code === 'Enter') { e.preventDefault(); if (e.target.id === 'codeIn') $('btnJoin').click(); else if (e.target.id === 'nameIn') ($('codeIn').value.trim() ? $('btnJoin') : $('btnCreate')).click(); } return; }
  if (PREVENT.has(e.code) || (inMatch() && GAME_KEYS.has(e.code))) e.preventDefault();
  Input.keys.add(e.code);
  if (e.repeat) return;
  onKeyPress(e.code, e);
}, { passive: false });
window.addEventListener('keyup', (e) => { Input.keys.delete(e.code); if (PREVENT.has(e.code)) e.preventDefault(); }, { passive: false });
window.addEventListener('mousemove', (e) => { Input.mx = e.clientX; Input.my = e.clientY; Input.lmb = (e.buttons & 1) !== 0; Input.rmb = (e.buttons & 2) !== 0; });
window.addEventListener('mousedown', (e) => {
  if (e.button === 0) Input.lmb = true; if (e.button === 2) Input.rmb = true;
  if (e.target === $('gl')) { e.preventDefault(); $('gl').focus({ preventScroll: true }); }
});
window.addEventListener('mouseup', (e) => { if (e.button === 0) Input.lmb = false; if (e.button === 2) Input.rmb = false; });
window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('wheel', (e) => { if (inMatch()) e.preventDefault(); }, { passive: false });
function dropInputs() { Input.keys.clear(); Input.lmb = Input.rmb = false; }
window.addEventListener('blur', () => { dropInputs(); if (Sess.kind === 'local' && G && G.mode === 'playing' && !Sess.paused) setPaused(true); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { dropInputs(); if (Sess.kind === 'local' && G && G.mode === 'playing' && !Sess.paused) setPaused(true); } });

const ACT_KEYS = { KeyQ: 'sed', KeyE: 'adr', KeyR: 'lamp', Tab: 'lamp', Digit1: 'swat0', Numpad1: 'swat0', KeyF: 'swat0', Digit2: 'swat1', Numpad2: 'swat1', KeyG: 'swat1', Digit3: 'swat2', Numpad3: 'swat2', KeyH: 'swat2' };
function onKeyPress(code, e) {
  if (code === 'KeyM') { Sfx.toggleMute(); return; }
  const menuOpen = !UI.menu.classList.contains('hidden'), endOpen = !UI.end.classList.contains('hidden');
  if (code === 'Escape') {
    if (Sess.kind === 'local' && G && G.mode === 'playing') { setPaused(!Sess.paused); return; }
    if (Sess.kind === 'online' && !endOpen) { toggleOnlineMenu(); return; }
    if (endOpen) { $('btnMenu').click(); return; }
  }
  if ((code === 'Enter' || code === 'Space') && endOpen && !$('btnReplay').classList.contains('hidden')) { e.preventDefault(); $('btnReplay').click(); return; }
  if (code === 'Enter' && menuOpen && Sess.menuMode !== 'online') { e.preventDefault(); startLocal(); return; }
  if (!G || G.mode !== 'playing' || Sess.paused) return;
  const a = ACT_KEYS[code];
  if (!a || !humanRole('anesth')) return;
  if (Sess.kind === 'online') Net.act(a); else sim.act(a);
}

/* ============================== AUDIO (procedural Web Audio) ============================== */
const Sfx = (() => {
  let ctx = null, master = null, bus = null, noiseBuf = null, muted = false, siren = null, engine = null, flat = null, loopsOn = false;
  function init() {
    try {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
        ctx = new AC();
        master = ctx.createGain(); master.gain.value = muted ? 0 : 0.85; master.connect(ctx.destination);
        const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.knee.value = 10; comp.ratio.value = 5; comp.attack.value = 0.003; comp.release.value = 0.2; comp.connect(master);
        bus = ctx.createGain(); bus.gain.value = 1; bus.connect(comp);
        noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
        const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        buildLoops();
      }
      if (ctx.state === 'suspended') ctx.resume();
    } catch (err) { console.warn('Audio init failed', err); ctx = null; }
  }
  function buildLoops() {
    const so = ctx.createOscillator(); so.type = 'sawtooth'; so.frequency.value = 900;
    const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.42;
    const lg = ctx.createGain(); lg.gain.value = 330; lfo.connect(lg); lg.connect(so.frequency);
    const sf = ctx.createBiquadFilter(); sf.type = 'lowpass'; sf.frequency.value = 2000; sf.Q.value = 0.8;
    const sg = ctx.createGain(); sg.gain.value = 0;
    so.connect(sf); sf.connect(sg); sg.connect(bus); so.start(); lfo.start();
    siren = { so, lfo, lg, sg };
    const e1 = ctx.createOscillator(); e1.type = 'sawtooth'; e1.frequency.value = 40;
    const e2 = ctx.createOscillator(); e2.type = 'square'; e2.frequency.value = 40.6;
    const e2g = ctx.createGain(); e2g.gain.value = 0.5;
    const ef = ctx.createBiquadFilter(); ef.type = 'lowpass'; ef.frequency.value = 260; ef.Q.value = 3;
    const eg = ctx.createGain(); eg.gain.value = 0;
    e1.connect(ef); e2.connect(e2g); e2g.connect(ef); ef.connect(eg); eg.connect(bus); e1.start(); e2.start();
    const rn = ctx.createBufferSource(); rn.buffer = noiseBuf; rn.loop = true;
    const rf = ctx.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 180;
    const rg = ctx.createGain(); rg.gain.value = 0;
    rn.connect(rf); rf.connect(rg); rg.connect(bus); rn.start();
    engine = { e1, e2, ef, eg, rg };
  }
  function update(active, speed, boost) {
    if (!ctx) return;
    const t = ctx.currentTime, on = active && loopsOn;
    siren.sg.gain.setTargetAtTime(on ? 0.026 : 0, t, 0.12);
    siren.so.frequency.setTargetAtTime(860 * (1 + (speed - 24) / 260), t, 0.25);
    siren.lfo.frequency.setTargetAtTime(boost ? 3.4 : 0.42, t, 0.2);
    siren.lg.gain.setTargetAtTime(boost ? 230 : 330, t, 0.2);
    const ef = 34 + speed * 1.35;
    engine.e1.frequency.setTargetAtTime(ef, t, 0.1);
    engine.e2.frequency.setTargetAtTime(ef * 1.012, t, 0.1);
    engine.ef.frequency.setTargetAtTime(180 + speed * 9 + (boost ? 400 : 0), t, 0.1);
    engine.eg.gain.setTargetAtTime(on ? 0.08 + (boost ? 0.05 : 0) : 0, t, 0.1);
    engine.rg.gain.setTargetAtTime(on ? 0.05 + speed * 0.002 : 0, t, 0.15);
  }
  function envG(t, a, peak, d) { const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); return g; }
  function tone(type, f0, f1, dur, vol, delay) {
    const t = ctx.currentTime + (delay || 0); const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(Math.max(1, f0), t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = envG(t, 0.004, vol, dur); o.connect(g); g.connect(bus); o.start(t); o.stop(t + dur + 0.06);
  }
  function noise(dur, vol, ftype, f0, f1, q, delay) {
    const t = ctx.currentTime + (delay || 0); const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = ftype; f.frequency.setValueAtTime(Math.max(10, f0), t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(10, f1), t + dur); f.Q.value = q || 1;
    const g = envG(t, 0.003, vol, dur); s.connect(f); f.connect(g); g.connect(bus); s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.06);
  }
  const can = () => !!ctx && Sess.kind !== 'attract' && ctx.state === 'running';
  const S = {
    init, update,
    setLoops(v) { loopsOn = v; },
    get muted() { return muted; },
    toggleMute() { muted = !muted; if (master) master.gain.setTargetAtTime(muted ? 0 : 0.85, ctx.currentTime, 0.03); },
    suspend() { if (ctx && ctx.state === 'running') ctx.suspend(); },
    resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); },
    beep(blood) { if (!can()) return; const f = 520 + clamp(blood, 0, 100) * 4.8; tone('sine', f, f, 0.085, 0.11); },
    flatStart() { if (!can() || flat) return; const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 1000; const g = ctx.createGain(); g.gain.value = 0; g.gain.setTargetAtTime(0.09, ctx.currentTime, 0.02); o.connect(g); g.connect(bus); o.start(); flat = { o, g }; },
    flatStop() { if (!flat || !ctx) return; const f = flat; flat = null; const t = ctx.currentTime; f.g.gain.cancelScheduledValues(t); f.g.gain.setTargetAtTime(0, t, 0.04); f.o.stop(t + 0.4); },
    crash() { if (!can()) return; noise(0.7, 0.9, 'lowpass', 2600, 160, 0.7); tone('sine', 120, 32, 0.45, 0.8); [430, 910, 1570, 2380].forEach((f, i) => tone('square', f, f * 0.82, 0.22 + i * 0.04, 0.05)); noise(0.12, 0.5, 'highpass', 3500, 3500, 1); },
    bump() { if (!can()) return; tone('sine', 95, 38, 0.28, 0.7); noise(0.2, 0.45, 'lowpass', 1000, 140, 1); tone('square', 260, 180, 0.06, 0.05, 0.02); },
    screech() { if (!can()) return; noise(0.75, 0.3, 'bandpass', 2700, 1900, 9); tone('sawtooth', 1760, 1480, 0.65, 0.035); tone('sawtooth', 1790, 1500, 0.6, 0.03, 0.03); },
    scrape() { if (!can()) return; noise(0.4, 0.3, 'bandpass', 1500, 700, 3); tone('square', 180, 120, 0.3, 0.04); },
    clang() { if (!can()) return; [[587, 0.2, 0.9], [1373, 0.13, 0.7], [2241, 0.1, 0.5], [3389, 0.07, 0.35], [4597, 0.05, 0.25]].forEach(([f, v, d]) => tone('sine', f, f * 0.995, d, v)); noise(0.05, 0.5, 'highpass', 5000, 5000, 1); },
    squelch() { if (!can()) return; noise(0.38, 0.6, 'bandpass', 1500, 220, 5); tone('sine', 230, 55, 0.32, 0.3); tone('triangle', 520, 120, 0.13, 0.12, 0.06); },
    extract() { if (!can()) return; S.squelch(); tone('sine', 300, 1250, 0.14, 0.28, 0.09); tone('triangle', 1250, 1900, 0.25, 0.08, 0.18); tone('sine', 1900, 2600, 0.3, 0.05, 0.26); },
    zap() { if (!can()) return; tone('square', 1500, 170, 0.17, 0.1); noise(0.14, 0.25, 'highpass', 2500, 7000, 1); },
    whoosh() { if (!can()) return; noise(0.24, 0.22, 'bandpass', 450, 2400, 2.2); },
    whiff() { if (!can()) return; noise(0.18, 0.16, 'bandpass', 1200, 500, 2); },
    alarm() { if (!can()) return; tone('square', 960, 960, 0.12, 0.07); tone('square', 720, 720, 0.12, 0.07, 0.15); },
    inject(sed) { if (!can()) return; noise(0.2, 0.22, 'highpass', 4500, 1800, 1); tone('sine', sed ? 620 : 700, sed ? 320 : 1300, 0.18, 0.07, 0.03); },
    click() { if (!can()) return; tone('square', 2400, 1700, 0.03, 0.06); tone('sine', 600, 400, 0.05, 0.06, 0.02); },
    grab() { if (!can()) return; noise(0.12, 0.25, 'bandpass', 900, 500, 4); tone('square', 3200, 2600, 0.02, 0.04); },
    stab() { if (!can()) return; tone('sine', 170, 48, 0.24, 0.6); noise(0.32, 0.55, 'bandpass', 950, 200, 3); S.squelch(); },
    rip() { if (!can()) return; noise(0.42, 0.6, 'bandpass', 280, 2600, 3); S.squelch(); },
    bone() { if (!can()) return; tone('triangle', 340, 210, 0.1, 0.25); noise(0.08, 0.3, 'bandpass', 2200, 1400, 4); },
    zone() { if (!can()) return; tone('sine', 660, 990, 0.12, 0.06); tone('sine', 990, 1320, 0.12, 0.05, 0.12); },
    warn() { if (!can()) return; tone('square', 1250, 1250, 0.05, 0.035); },
    join() { if (!ctx || ctx.state !== 'running') return; tone('triangle', 660, 990, 0.12, 0.08); },
    win() { if (!can()) return; [523, 659, 784, 1047, 1319].forEach((f, i) => tone('triangle', f, f, 0.35, 0.13, i * 0.11)); },
    lose() { if (!can()) return; tone('sawtooth', 320, 70, 1.4, 0.12); tone('sine', 160, 40, 1.6, 0.2); },
  };
  return S;
})();
function playSfx(name, arg, role) {
  if (role && Sess.kind === 'online' && Sess.myRole !== role) return;
  if (role && Sess.kind === 'local' && !humanRole(role)) return;
  if (name === 'beep' || typeof Sfx[name] !== 'function' || name === 'init' || name === 'update') return;
  Sfx[name](arg);
}

/* ============================== RENDERER ============================== */
const glCanvas=$('gl'),hud=$('hud'),hctx=hud.getContext('2d');
const renderer=new THREE.WebGLRenderer({canvas:glCanvas,antialias:true,powerPreference:'high-performance'});
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.autoClear=true;
const L={W:1,H:1,dpr:1,top:44,fs:12,panes:[{x:0,y:0,w:1,h:1},{x:0,y:0,w:1,h:1},{x:0,y:0,w:1,h:1}]};

function canvasTex(w,h,draw){const c=document.createElement('canvas');c.width=w;c.height=h;draw(c.getContext('2d'),w,h);return new THREE.CanvasTexture(c);}
const glowTex=canvasTex(128,128,(g,w,h)=>{const gr=g.createRadialGradient(64,64,0,64,64,64);gr.addColorStop(0,'rgba(255,255,255,1)');gr.addColorStop(0.25,'rgba(255,255,255,0.5)');gr.addColorStop(1,'rgba(255,255,255,0)');g.fillStyle=gr;g.fillRect(0,0,w,h);});
function glowSprite(color,scale,opacity){const m=new THREE.SpriteMaterial({map:glowTex,color,transparent:true,opacity:opacity==null?0.8:opacity,blending:THREE.AdditiveBlending,depthWrite:false,fog:false});const s=new THREE.Sprite(m);s.scale.set(scale,scale,1);return s;}
const roadTex=canvasTex(512,512,(g,w,h)=>{
 g.fillStyle='#1c1f27';g.fillRect(0,0,w,h);
 for(let i=0;i<7000;i++){const v=18+Math.random()*30|0;g.fillStyle=`rgba(${v},${v},${v+6},${Math.random()*0.6})`;g.fillRect(Math.random()*w,Math.random()*h,2,2);}
 const X=x=>(x+7)/14*w;
 g.fillStyle='#111318';g.fillRect(0,0,X(-6),h);g.fillRect(X(6),0,w-X(6),h);
 g.fillStyle='#ececec';g.fillRect(X(-6)-3,0,6,h);g.fillRect(X(6)-3,0,6,h);
 g.fillStyle='#ffcc22';g.fillRect(X(0)-8,0,5,h);g.fillRect(X(0)+3,0,5,h);
 g.fillStyle='#dedede';for(let y=0;y<h;y+=128){g.fillRect(X(-3)-3,y,6,64);g.fillRect(X(3)-3,y,6,64);}
 g.strokeStyle='rgba(0,0,0,0.5)';g.lineWidth=2;for(let i=0;i<8;i++){g.beginPath();let x=Math.random()*w,y=Math.random()*h;g.moveTo(x,y);for(let k=0;k<5;k++){x+=rand(-20,20);y+=rand(5,25);g.lineTo(x,y);}g.stroke();}
});
roadTex.wrapS=THREE.ClampToEdgeWrapping;roadTex.wrapT=THREE.RepeatWrapping;roadTex.repeat.set(1,15);
roadTex.anisotropy=renderer.capabilities.getMaxAnisotropy();
const winCanvasDraw=(g,w,h)=>{g.fillStyle='#000';g.fillRect(0,0,w,h);for(let y=6;y<h;y+=16)for(let x=5;x<w;x+=14){if(Math.random()<0.42){g.fillStyle=pick(['#ffd27a','#9fd8ff','#ff9ad5','#fff3c4']);g.globalAlpha=rand(0.35,1);g.fillRect(x,y,8,9);}}g.globalAlpha=1;};
const winTex=canvasTex(128,256,winCanvasDraw);winTex.wrapS=winTex.wrapT=THREE.RepeatWrapping;

/* ============================== PARTICLES ============================== */
const PVS=`attribute vec3 pcolor;attribute float palpha;attribute float psize;uniform float uScale;varying vec3 vC;varying float vA;
void main(){vC=pcolor;vA=palpha;vec4 mv=modelViewMatrix*vec4(position,1.0);gl_PointSize=max(1.0,psize*uScale/max(0.001,-mv.z));gl_Position=projectionMatrix*mv;}`;
const PFS=`varying vec3 vC;varying float vA;
void main(){vec2 d=gl_PointCoord-vec2(0.5);float r=length(d);if(r>0.5)discard;float a=smoothstep(0.5,0.0,r)*vA;gl_FragColor=vec4(vC*(1.0+0.6*(1.0-r*2.0)),a);}`;
class Particles{
 constructor(scene,max,additive){
  this.max=max;this.n=0;
  this.pos=new Float32Array(max*3);this.col=new Float32Array(max*3);this.alp=new Float32Array(max);this.siz=new Float32Array(max);
  this.vel=new Float32Array(max*3);this.life=new Float32Array(max);this.ml=new Float32Array(max);this.bs=new Float32Array(max);this.grav=new Float32Array(max);this.flo=new Float32Array(max);
  const g=this.geo=new THREE.BufferGeometry();
  const mk=(a,n)=>new THREE.BufferAttribute(a,n).setUsage(THREE.DynamicDrawUsage);
  this.aPos=mk(this.pos,3);this.aCol=mk(this.col,3);this.aAlp=mk(this.alp,1);this.aSiz=mk(this.siz,1);
  g.setAttribute('position',this.aPos);g.setAttribute('pcolor',this.aCol);g.setAttribute('palpha',this.aAlp);g.setAttribute('psize',this.aSiz);
  g.setDrawRange(0,0);
  this.mat=new THREE.ShaderMaterial({uniforms:{uScale:{value:300}},vertexShader:PVS,fragmentShader:PFS,transparent:true,depthWrite:false,blending:additive?THREE.AdditiveBlending:THREE.NormalBlending});
  this.pts=new THREE.Points(g,this.mat);this.pts.frustumCulled=false;this.pts.renderOrder=3;scene.add(this.pts);
 }
 setScale(s){this.mat.uniforms.uScale.value=s;}
 emit(x,y,z,count,o){
  const sp=o.spread||1,spd=o.speed||2,c=o.color||[1,1,1],life=o.life||0.6,size=o.size||0.2,grav=o.grav||0,fl=o.floor==null?-1e9:o.floor,dir=o.dir;
  for(let k=0;k<count;k++){
   const i=this.n<this.max?this.n++:Math.floor(Math.random()*this.max),i3=i*3;
   this.pos[i3]=x+(Math.random()-0.5)*0.1*sp;this.pos[i3+1]=y;this.pos[i3+2]=z+(Math.random()-0.5)*0.1*sp;
   const vx=Math.random()*2-1,vy=Math.random()*1.2-0.2,vz=Math.random()*2-1,l=Math.hypot(vx,vy,vz)||1,s=spd*(0.4+Math.random()*0.8)/l;
   this.vel[i3]=vx*s*sp+(dir?dir[0]:0);this.vel[i3+1]=vy*s+(dir?dir[1]:0);this.vel[i3+2]=vz*s*sp+(dir?dir[2]:0);
   const v=0.85+Math.random()*0.3;this.col[i3]=c[0]*v;this.col[i3+1]=c[1]*v;this.col[i3+2]=c[2]*v;
   this.life[i]=this.ml[i]=life*(0.6+Math.random()*0.8);this.bs[i]=size*(0.6+Math.random()*0.8);this.grav[i]=grav;this.flo[i]=fl;this.alp[i]=1;this.siz[i]=this.bs[i];
  }
 }
 cp(f,t){if(f===t)return;const f3=f*3,t3=t*3;for(let j=0;j<3;j++){this.pos[t3+j]=this.pos[f3+j];this.vel[t3+j]=this.vel[f3+j];this.col[t3+j]=this.col[f3+j];}
  this.life[t]=this.life[f];this.ml[t]=this.ml[f];this.bs[t]=this.bs[f];this.grav[t]=this.grav[f];this.flo[t]=this.flo[f];this.alp[t]=this.alp[f];this.siz[t]=this.siz[f];}
 update(dt){
  let n=this.n;const dr=Math.exp(-1.5*dt);
  for(let i=0;i<n;i++){
   this.life[i]-=dt;
   if(this.life[i]<=0){n--;this.cp(n,i);i--;continue;}
   const i3=i*3;this.vel[i3+1]-=this.grav[i]*dt;this.vel[i3]*=dr;this.vel[i3+2]*=dr;
   this.pos[i3]+=this.vel[i3]*dt;this.pos[i3+1]+=this.vel[i3+1]*dt;this.pos[i3+2]+=this.vel[i3+2]*dt;
   if(this.pos[i3+1]<this.flo[i]){this.pos[i3+1]=this.flo[i];this.vel[i3+1]*=-0.25;this.vel[i3]*=0.5;this.vel[i3+2]*=0.5;}
   const k=this.life[i]/this.ml[i];this.alp[i]=Math.min(1,k*1.6);this.siz[i]=this.bs[i]*(0.4+0.6*k);
  }
  this.n=n;this.geo.setDrawRange(0,n);
  if(n>0){this.aPos.needsUpdate=true;this.aCol.needsUpdate=true;this.aAlp.needsUpdate=true;this.aSiz.needsUpdate=true;}
 }
 clear(){this.n=0;this.geo.setDrawRange(0,0);}
}

/* ============================== SHARED TOOL MESHES ============================== */
const ToolKit=(()=>{
 const steel=new THREE.MeshPhongMaterial({color:0xd8e0ea,specular:0xffffff,shininess:120,emissive:0x15191f});
 const blueM=new THREE.MeshPhongMaterial({color:0x2a5bd7,shininess:40});
 const orangeM=new THREE.MeshPhongMaterial({color:0xff7a18,shininess:40});
 const glassM=new THREE.MeshPhongMaterial({color:0xf0f6ff,transparent:true,opacity:0.6,shininess:90});
 const fluid=new THREE.MeshBasicMaterial({color:0x40c0ff});
 const g={
  scH:new THREE.BoxGeometry(0.08,0.035,0.55),
  scB:(()=>{const c=new THREE.ConeGeometry(0.05,0.3,4);c.rotateX(-Math.PI/2);c.scale(1,0.3,1);return c;})(),
  syB:new THREE.CylinderGeometry(0.055,0.055,0.42,12).rotateX(Math.PI/2),
  syN:new THREE.CylinderGeometry(0.008,0.008,0.26,4).rotateX(Math.PI/2),
  syR:new THREE.CylinderGeometry(0.018,0.018,0.22,6).rotateX(Math.PI/2),
  syT:new THREE.CylinderGeometry(0.075,0.075,0.02,12).rotateX(Math.PI/2),
  syF:new THREE.CylinderGeometry(0.045,0.045,0.3,10).rotateX(Math.PI/2),
  saH:new THREE.BoxGeometry(0.11,0.07,0.32),saB:new THREE.BoxGeometry(0.17,0.012,0.6),saS:new THREE.BoxGeometry(0.03,0.03,0.6)
 };
 function make(kind){
  const grp=new THREE.Group();const add=(geo,mat,x,y,z)=>{const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);grp.add(m);return m;};
  if(kind==='scalpel'){add(g.scH,steel,0,0,0.1);add(g.scB,steel,0,0,-0.32);}
  else if(kind==='syringe'){add(g.syB,glassM,0,0,0);add(g.syF,fluid,0,0,-0.04);add(g.syN,steel,0,0,-0.34);add(g.syR,steel,0,0,0.31);add(g.syT,blueM,0,0,0.42);}
  else{add(g.saH,orangeM,0,0.02,0.32);add(g.saB,steel,0,0,-0.12);add(g.saS,steel,0.085,0.01,-0.12);}
  return grp;
 }
 return {make,steel};
})();
const _up=new THREE.Vector3(0,1,0),_ta=new THREE.Vector3(),_tb=new THREE.Vector3(),_tc=new THREE.Vector3();
function orientCyl(mesh,a,b,thick){_tc.subVectors(b,a);const len=_tc.length();mesh.position.copy(a).addScaledVector(_tc,0.5);mesh.scale.set(thick||1,Math.max(0.001,len),thick||1);if(len>1e-5)mesh.quaternion.setFromUnitVectors(_up,_tc.multiplyScalar(1/len));}
function roundedRect(s,x,y,w,h,r){s.moveTo(x+r,y);s.lineTo(x+w-r,y);s.quadraticCurveTo(x+w,y,x+w,y+r);s.lineTo(x+w,y+h-r);s.quadraticCurveTo(x+w,y+h,x+w-r,y+h);s.lineTo(x+r,y+h);s.quadraticCurveTo(x,y+h,x,y+h-r);s.lineTo(x,y+r);s.quadraticCurveTo(x,y,x+r,y);}


/* ============================== PANE 1: DRIVER SCENE ============================== */
const Drv={camK:1};
(function(){
 const S=Drv.scene=new THREE.Scene();
 S.background=new THREE.Color(0x060914);S.fog=new THREE.Fog(0x060914,80,175);
 Drv.cam=new THREE.PerspectiveCamera(60,0.6,0.5,420);
 S.add(new THREE.HemisphereLight(0x5566cc,0x140a0a,0.75));
 const moon=new THREE.DirectionalLight(0x9aaaff,0.45);moon.position.set(-20,40,15);S.add(moon);
 const road=new THREE.Mesh(new THREE.PlaneGeometry(14,300),new THREE.MeshLambertMaterial({map:roadTex}));
 road.rotation.x=-Math.PI/2;road.position.set(0,0,-110);S.add(road);
 const ground=new THREE.Mesh(new THREE.PlaneGeometry(420,420),new THREE.MeshLambertMaterial({color:0x0a0d12}));
 ground.rotation.x=-Math.PI/2;ground.position.set(0,-0.05,-100);S.add(ground);
 const railMat=new THREE.MeshStandardMaterial({color:0x8a95a8,metalness:0.6,roughness:0.4});
 for(const s of[-1,1]){const r=new THREE.Mesh(new THREE.BoxGeometry(0.15,0.35,300),railMat);r.position.set(s*6.9,0.75,-110);S.add(r);}
 Drv.scenery=[];
 const SPAN=290;
 const poleMat=new THREE.MeshStandardMaterial({color:0x3a4050,metalness:0.5,roughness:0.5});
 const bulbMat=new THREE.MeshBasicMaterial({color:0xffd9a0});
 const poolMat=new THREE.MeshBasicMaterial({map:glowTex,color:0xffb060,transparent:true,opacity:0.22,blending:THREE.AdditiveBlending,depthWrite:false});
 const poleGeo=new THREE.CylinderGeometry(0.12,0.16,7,8),armGeo=new THREE.BoxGeometry(2.2,0.12,0.12),bulbGeo=new THREE.BoxGeometry(0.6,0.15,0.35),poolGeo=new THREE.PlaneGeometry(7,7);
 for(let i=0;i<10;i++)for(const s of[-1,1]){
  const g=new THREE.Group();
  const p=new THREE.Mesh(poleGeo,poleMat);p.position.y=3.5;g.add(p);
  const a=new THREE.Mesh(armGeo,poleMat);a.position.set(-s*1.0,7,0);g.add(a);
  const b=new THREE.Mesh(bulbGeo,bulbMat);b.position.set(-s*2.0,6.9,0);g.add(b);
  const gl=glowSprite(0xffc070,3.2,0.7);gl.position.set(-s*2.0,6.8,0);g.add(gl);
  const pool=new THREE.Mesh(poolGeo,poolMat);pool.rotation.x=-Math.PI/2;pool.position.set(-s*2.2,0.03,0);g.add(pool);
  g.position.x=s*7.5;S.add(g);Drv.scenery.push({obj:g,base:-i*SPAN/10+(s>0?SPAN/20:0)});
 }
 const refGeo=new THREE.BoxGeometry(0.12,0.9,0.12),refMat=new THREE.MeshBasicMaterial({color:0xff7a00});
 for(let i=0;i<28;i++)for(const s of[-1,1]){const m=new THREE.Mesh(refGeo,refMat);m.position.set(s*6.5,0.45,0);S.add(m);Drv.scenery.push({obj:m,base:-i*SPAN/28});}
 const bGeo=new THREE.BoxGeometry(1,1,1);
 const neonGeo=new THREE.BoxGeometry(0.2,0.6,6),neonCols=[0xff3df2,0x18e6ff,0xff2a3d,0x39ff14,0xffb020];
 for(let i=0;i<22;i++)for(const s of[-1,1]){
  const h=rand(8,38),w=rand(6,13),d=rand(8,16);
  const tex=winTex.clone();tex.needsUpdate=true;tex.repeat.set(Math.max(1,Math.round(d/8)),Math.max(1,Math.round(h/12)));
  const mat=new THREE.MeshStandardMaterial({color:0x10141f,roughness:0.9,emissive:0xffffff,emissiveMap:tex,emissiveIntensity:rand(0.35,0.8)});
  const m=new THREE.Mesh(bGeo,mat);m.scale.set(w,h,d);const bx=s*(15+w/2+rand(0,8));m.position.set(bx,h/2,0);S.add(m);
  const base=-i*SPAN/22-rand(0,6);Drv.scenery.push({obj:m,base});
  if(Math.random()<0.4){const n=new THREE.Mesh(neonGeo,new THREE.MeshBasicMaterial({color:pick(neonCols)}));n.position.set(bx-s*(w/2+0.12),rand(3,Math.min(h-1,12)),0);S.add(n);Drv.scenery.push({obj:n,base});}
 }
 // ambulance
 const amb=Drv.amb=new THREE.Group();
 const white=new THREE.MeshStandardMaterial({color:0xf3f5f8,roughness:0.45,metalness:0.1});
 const red=new THREE.MeshStandardMaterial({color:0xe0142a,roughness:0.5,emissive:0x400008});
 const glass=new THREE.MeshStandardMaterial({color:0x0a1a2a,roughness:0.1,metalness:0.6,emissive:0x0a2a40});
 const dark=new THREE.MeshStandardMaterial({color:0x111318,roughness:0.8});
 const add=(geo,mat,x,y,z)=>{const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);amb.add(m);return m;};
 add(new THREE.BoxGeometry(2.2,2.1,3.7),white,0,1.45,0.65);
 add(new THREE.BoxGeometry(2.1,1.45,1.6),white,0,1.1,-1.95);
 add(new THREE.BoxGeometry(1.9,0.62,0.06),glass,0,1.45,-2.76).rotation.x=-0.25;
 add(new THREE.BoxGeometry(2.24,0.28,5.35),red,0,0.95,-0.1);
 add(new THREE.BoxGeometry(0.35,0.03,1.2),red,0,2.52,0.9);add(new THREE.BoxGeometry(1.2,0.03,0.35),red,0,2.52,0.9);
 add(new THREE.BoxGeometry(1.9,0.18,0.36),dark,0,2.6,-0.9);
 Drv.lbRed=new THREE.MeshBasicMaterial({color:0xff1030});Drv.lbBlue=new THREE.MeshBasicMaterial({color:0x1050ff});
 add(new THREE.BoxGeometry(0.85,0.2,0.3),Drv.lbRed,-0.47,2.72,-0.9);add(new THREE.BoxGeometry(0.85,0.2,0.3),Drv.lbBlue,0.47,2.72,-0.9);
 Drv.sprRed=glowSprite(0xff1030,4.5,0.9);Drv.sprRed.position.set(-0.5,2.9,-0.9);amb.add(Drv.sprRed);
 Drv.sprBlue=glowSprite(0x2060ff,4.5,0.9);Drv.sprBlue.position.set(0.5,2.9,-0.9);amb.add(Drv.sprBlue);
 const wGeo=new THREE.CylinderGeometry(0.44,0.44,0.32,14);wGeo.rotateZ(Math.PI/2);
 Drv.wheels=[[-1.05,-1.9],[1.05,-1.9],[-1.05,1.7],[1.05,1.7]].map(([x,z])=>add(wGeo,dark,x,0.44,z));
 const hl=new THREE.MeshBasicMaterial({color:0xfff6d0}),tl=new THREE.MeshBasicMaterial({color:0xff2020});
 for(const s of[-1,1]){add(new THREE.BoxGeometry(0.4,0.22,0.05),hl,s*0.72,0.75,-2.77);add(new THREE.BoxGeometry(0.35,0.3,0.05),tl,s*0.85,1.0,2.52);}
 const beam=new THREE.Mesh(new THREE.PlaneGeometry(5,16),new THREE.MeshBasicMaterial({map:glowTex,color:0xfff0c0,transparent:true,opacity:0.28,blending:THREE.AdditiveBlending,depthWrite:false}));
 beam.rotation.x=-Math.PI/2;beam.position.set(0,0.04,-10);amb.add(beam);
 const head=new THREE.SpotLight(0xfff2d0,1.4,70,0.5,0.6,1);head.position.set(0,1.2,-2.6);head.target.position.set(0,0,-25);amb.add(head);amb.add(head.target);
 Drv.sirenR=new THREE.PointLight(0xff1030,0,24,1.6);Drv.sirenR.position.set(-0.6,3.3,-0.9);amb.add(Drv.sirenR);
 Drv.sirenB=new THREE.PointLight(0x2050ff,0,24,1.6);Drv.sirenB.position.set(0.6,3.3,-0.9);amb.add(Drv.sirenB);
 S.add(amb);
 // hazard assets
 Drv.geo={pothole:new THREE.CircleGeometry(0.75,22),potRim:new THREE.RingGeometry(0.72,0.98,22),oil:new THREE.CircleGeometry(1,28),
  carBody:new THREE.BoxGeometry(1.9,0.85,4.1),carCab:new THREE.BoxGeometry(1.6,0.7,2.0),light:new THREE.BoxGeometry(0.4,0.18,0.06),
  beam:new THREE.CylinderGeometry(0.32,0.32,16,12,1,true),ring:new THREE.RingGeometry(1.15,1.5,28),headBeam:new THREE.PlaneGeometry(3,9)};
 Drv.mat={pothole:new THREE.MeshBasicMaterial({color:0x020203}),potRim:new THREE.MeshLambertMaterial({color:0x3a3a40}),
  oil:new THREE.MeshStandardMaterial({color:0x08040f,metalness:0.9,roughness:0.12,emissive:0x3a0a6a,emissiveIntensity:0.7}),
  carCols:[0x2b6cff,0xffd21f,0x22c55e,0xe5e7eb,0xa855f7,0x0ea5e9,0xf97316].map(c=>new THREE.MeshStandardMaterial({color:c,roughness:0.35,metalness:0.4})),
  cab:glass,tail:tl,head:hl,
  headBeam:new THREE.MeshBasicMaterial({map:glowTex,color:0xfff0c0,transparent:true,opacity:0.3,blending:THREE.AdditiveBlending,depthWrite:false})};
 // speed lines
 const N=70,pos=new Float32Array(N*6),sg=new THREE.BufferGeometry();sg.setAttribute('position',new THREE.BufferAttribute(pos,3));
 Drv.speedLines={geo:sg,pos,data:[]};
 for(let i=0;i<N;i++)Drv.speedLines.data.push({x:(Math.random()<0.5?-1:1)*rand(1.5,10),y:rand(0.3,6),z:rand(-120,15)});
 Drv.speedMat=new THREE.LineBasicMaterial({color:0xaee6ff,transparent:true,opacity:0,blending:THREE.AdditiveBlending,depthWrite:false,fog:false});
 const ls=new THREE.LineSegments(sg,Drv.speedMat);ls.frustumCulled=false;S.add(ls);
 // hospital / finish
 const hosp=Drv.hospital=new THREE.Group();hosp.visible=false;
 const htex=canvasTex(128,256,winCanvasDraw);htex.wrapS=htex.wrapT=THREE.RepeatWrapping;htex.repeat.set(2,2);
 const hb=new THREE.Mesh(new THREE.BoxGeometry(18,16,14),new THREE.MeshStandardMaterial({color:0xd8dde6,roughness:0.7,emissive:0xffffff,emissiveMap:htex,emissiveIntensity:0.35}));hb.position.set(19,8,-6);hosp.add(hb);
 const crossMat=new THREE.MeshBasicMaterial({color:0xff1a2e});
 const c1=new THREE.Mesh(new THREE.BoxGeometry(1.6,6,0.4),crossMat);c1.position.set(19,12,1.2);hosp.add(c1);
 const c2=new THREE.Mesh(new THREE.BoxGeometry(6,1.6,0.4),crossMat);c2.position.set(19,12,1.2);hosp.add(c2);
 const cg=glowSprite(0xff1a2e,14,0.7);cg.position.set(19,12,1.6);hosp.add(cg);
 const signTex=canvasTex(512,64,(g,w,h)=>{g.fillStyle='#03150a';g.fillRect(0,0,w,h);g.font='bold 38px Arial';g.textAlign='center';g.textBaseline='middle';g.fillStyle='#3dff7a';g.fillText('+ EMERGENCY · ER BAY +',w/2,h/2+2);});
 const sign=new THREE.Mesh(new THREE.BoxGeometry(15,1.8,0.3),[dark,dark,dark,dark,new THREE.MeshBasicMaterial({map:signTex}),dark]);sign.position.set(0,7,0);hosp.add(sign);
 for(const s of[-1,1]){const p=new THREE.Mesh(new THREE.BoxGeometry(0.4,7.5,0.4),poleMat);p.position.set(s*7.6,3.75,0);hosp.add(p);}
 const fin=new THREE.Mesh(new THREE.PlaneGeometry(12,1.2),new THREE.MeshBasicMaterial({color:0x3dff7a,transparent:true,opacity:0.7,blending:THREE.AdditiveBlending,depthWrite:false}));fin.rotation.x=-Math.PI/2;fin.position.y=0.05;hosp.add(fin);
 S.add(hosp);
 Drv.sparks=new Particles(S,320,true);
})();
function makeHazardMesh(h){
 const g=new THREE.Group(),o={g};
 if(h.type==='pothole'){const a=new THREE.Mesh(Drv.geo.pothole,Drv.mat.pothole);a.rotation.x=-Math.PI/2;a.position.y=0.025;g.add(a);const r=new THREE.Mesh(Drv.geo.potRim,Drv.mat.potRim);r.rotation.x=-Math.PI/2;r.position.y=0.02;g.add(r);}
 else if(h.type==='oil'){const a=new THREE.Mesh(Drv.geo.oil,Drv.mat.oil);a.rotation.x=-Math.PI/2;a.scale.set(1.3,1.9,1);a.position.y=0.03;g.add(a);}
 else{
  const body=new THREE.Mesh(Drv.geo.carBody,pick(Drv.mat.carCols));body.position.y=0.75;g.add(body);
  const cab=new THREE.Mesh(Drv.geo.carCab,Drv.mat.cab);cab.position.set(0,1.5,0.25);g.add(cab);
  const lm=h.oncoming?Drv.mat.head:Drv.mat.tail;
  for(const s of[-1,1]){const l=new THREE.Mesh(Drv.geo.light,lm);l.position.set(s*0.65,0.8,2.06);g.add(l);}
  if(h.oncoming){const bm=new THREE.Mesh(Drv.geo.headBeam,Drv.mat.headBeam);bm.rotation.x=-Math.PI/2;bm.position.set(0,0.05,6.5);g.add(bm);}
 }
 const col=HZ[h.key].color;
 const bm=new THREE.MeshBasicMaterial({color:col,transparent:true,opacity:0.4,blending:THREE.AdditiveBlending,depthWrite:false,fog:false,side:THREE.DoubleSide});
 const beam=new THREE.Mesh(Drv.geo.beam,bm);beam.position.y=8;g.add(beam);
 const rm=bm.clone();const ring=new THREE.Mesh(Drv.geo.ring,rm);ring.rotation.x=-Math.PI/2;ring.position.y=0.06;g.add(ring);
 const top=glowSprite(col,3.5,0.9);top.position.y=16;g.add(top);
 o.beam=beam;o.ring=ring;o.top=top;o.mats=[bm,rm,top.material];o.born=h.born;
 return o;
}


/* ============================== PANE 2: SURGEON SCENE ============================== */
const Srg={camK:1,lampBlend:1,spread:0.05,stuck:[]};
(function(){
 const S=Srg.scene=new THREE.Scene();S.background=new THREE.Color(0x03070b);
 Srg.cam=new THREE.PerspectiveCamera(46,0.8,0.1,100);
 Srg.rayCam=new THREE.PerspectiveCamera(46,0.8,0.1,100);
 Srg.camBase=new THREE.Vector3(0,13.6,3.9);
 Srg.ambL=new THREE.AmbientLight(0x2a3a50,0.42);S.add(Srg.ambL);
 Srg.hemi=new THREE.HemisphereLight(0x8899bb,0x331111,0.32);S.add(Srg.hemi);
 const spot=Srg.lamp=new THREE.SpotLight(0xfff3dc,2.4,45,0.42,0.5,1.1);
 spot.position.set(0.6,15,3);spot.target.position.set(0,0,0.3);S.add(spot);S.add(spot.target);
 spot.castShadow=true;spot.shadow.mapSize.set(1024,1024);spot.shadow.camera.near=4;spot.shadow.camera.far=30;spot.shadow.bias=-0.0008;
 Srg.sirenR=new THREE.PointLight(0xff1030,0,26,1.5);S.add(Srg.sirenR);
 Srg.sirenB=new THREE.PointLight(0x2050ff,0,26,1.5);S.add(Srg.sirenB);
 Srg.tipLight=new THREE.PointLight(0x80f0ff,0,3.5,2);S.add(Srg.tipLight);
 const steel=new THREE.MeshStandardMaterial({color:0x5b6573,metalness:0.7,roughness:0.35});
 const table=new THREE.Mesh(new THREE.BoxGeometry(10,0.6,15),steel);table.position.set(0,-1.2,0);S.add(table);
 const floor=new THREE.Mesh(new THREE.PlaneGeometry(60,60),new THREE.MeshStandardMaterial({color:0x0b1016,roughness:0.9}));floor.rotation.x=-Math.PI/2;floor.position.y=-3;S.add(floor);
 Srg.RX=RX;Srg.RZ=RZ;
 const torso=new THREE.Shape();roundedRect(torso,-3.9,-5.6,7.8,11.2,1.8);
 const hole=new THREE.Path();hole.absellipse(0,0,RX,RZ,0,TAU,true);torso.holes.push(hole);
 const skinGeo=new THREE.ExtrudeGeometry(torso,{depth:0.55,bevelEnabled:true,bevelThickness:0.12,bevelSize:0.12,bevelSegments:3,curveSegments:48});
 skinGeo.rotateX(-Math.PI/2);
 const skin=new THREE.Mesh(skinGeo,new THREE.MeshStandardMaterial({color:0xd99a7c,roughness:0.6}));skin.receiveShadow=true;S.add(skin);
 const wall=new THREE.Mesh(new THREE.CylinderGeometry(1,1,1.3,48,1,true),new THREE.MeshStandardMaterial({color:0x4a0a0e,roughness:0.35,emissive:0x1a0204,side:THREE.BackSide}));
 wall.scale.set(RX,1,RZ);wall.position.y=-0.05;S.add(wall);
 const cf=new THREE.Mesh(new THREE.CircleGeometry(1,48),new THREE.MeshStandardMaterial({color:0x3a0709,roughness:0.4,emissive:0x140103}));
 cf.rotation.x=-Math.PI/2;cf.scale.set(RX,RZ,1);cf.position.y=-0.6;cf.receiveShadow=true;S.add(cf);
 const rim=new THREE.Mesh(new THREE.TorusGeometry(1,0.07,8,64),new THREE.MeshStandardMaterial({color:0x8a1418,roughness:0.3,emissive:0x2a0204}));
 rim.rotation.x=-Math.PI/2;rim.scale.set(RX+0.02,RZ+0.02,1);rim.position.y=0.62;S.add(rim);
 const drape=new THREE.Shape();drape.moveTo(-9,-11);drape.lineTo(9,-11);drape.lineTo(9,11);drape.lineTo(-9,11);drape.lineTo(-9,-11);
 const dh=new THREE.Path();roundedRect(dh,-3.35,-4.75,6.7,9.5,1.4);drape.holes.push(dh);
 const dgeo=new THREE.ShapeGeometry(drape,24);dgeo.rotateX(-Math.PI/2);
 const dr=new THREE.Mesh(dgeo,new THREE.MeshStandardMaterial({color:0x136e68,roughness:0.95}));dr.position.y=0.72;dr.receiveShadow=true;S.add(dr);
 const clampGeo=new THREE.BoxGeometry(0.25,0.18,0.6);
 for(const [x,z] of[[-3.2,-4.5],[3.2,-4.5],[-3.2,4.5],[3.2,4.5]]){const c=new THREE.Mesh(clampGeo,steel);c.position.set(x,0.82,z);c.rotation.y=Math.atan2(x,z);S.add(c);}
 // ribs (collision polylines kept in Srg.ribs)
 const boneMat=new THREE.MeshStandardMaterial({color:0xeee6cf,roughness:0.5,emissive:0x1a1810});
 Srg.ribs=RIBS;const capGeo=new THREE.SphereGeometry(0.15,10,8);
 for(const d of RIB_DEFS){
  const pts=d.map(p=>new THREE.Vector3(p[0],p[1],p[2]));
  const curve=new THREE.CatmullRomCurve3(pts,false,'catmullrom',0.5);
  const m=new THREE.Mesh(new THREE.TubeGeometry(curve,16,0.13,8,false),boneMat);m.castShadow=true;S.add(m);
  const cap=new THREE.Mesh(capGeo,boneMat);cap.position.copy(pts[2]);S.add(cap);
 }
 // organs
 const sph=new THREE.SphereGeometry(1,28,20);
 const addOrgan=o=>{const m=new THREE.Mesh(sph,new THREE.MeshStandardMaterial({color:o.col,roughness:0.32,metalness:0.05,emissive:o.em}));m.position.set(o.c[0],o.c[1],o.c[2]);m.scale.set(o.s[0],o.s[1],o.s[2]);m.castShadow=true;m.receiveShadow=true;S.add(m);return m;};
 addOrgan(ORG.lungL);addOrgan(ORG.lungR);addOrgan(ORG.liver);addOrgan(ORG.stomach);Srg.heart=addOrgan(ORG.heart);
 const intMat=new THREE.MeshStandardMaterial({color:0xd98b7b,roughness:0.35,emissive:0x1a0505});const tg=new THREE.TorusGeometry(0.4,0.17,10,24);
 [[-0.9,2.2],[-0.1,2.0],[0.75,2.25],[-0.5,2.9],[0.35,2.85],[1.05,2.85],[-1.2,2.75]].forEach(([x,z])=>{const m=new THREE.Mesh(tg,intMat);m.rotation.x=-Math.PI/2;m.rotation.z=Math.random()*TAU;m.position.set(x,-0.25,z);m.castShadow=true;m.receiveShadow=true;S.add(m);});
 const vesMat=new THREE.MeshStandardMaterial({color:0x9a0c18,roughness:0.3,emissive:0x2a0004});
 S.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(-0.2,0.45,-1.7),new THREE.Vector3(-0.1,0.5,-2.6),new THREE.Vector3(0.3,0.3,-3.3)]),16,0.17,8,false),vesMat));
 // nerves
 const nerveMat=new THREE.MeshBasicMaterial({color:0xffe14a});Srg.nerves=NERVES;
 NERVE_DEFS.forEach(d=>{
  const c=new THREE.CatmullRomCurve3(d.map(p=>new THREE.Vector3(p[0],p[1],p[2])),false,'catmullrom',0.5);
  S.add(new THREE.Mesh(new THREE.TubeGeometry(c,24,0.045,6,false),nerveMat));
  for(const p of c.getPoints(5)){const g=glowSprite(0xffd030,0.6,0.35);g.position.copy(p);S.add(g);}
 });
 // forceps (origin = tip)
 const F=Srg.forceps=new THREE.Group();S.add(F);
 const fsteel=new THREE.MeshPhongMaterial({color:0xdde4ec,specular:0xffffff,shininess:120,emissive:0x15191f});
 const H=new THREE.Vector3(0,2.6,5.0),len=H.length();
 const hinge=new THREE.Group();hinge.position.copy(H);F.add(hinge);hinge.lookAt(0,0,0);
 const tineGeo=new THREE.BoxGeometry(0.09,0.05,len);tineGeo.translate(0,0,len/2);
 const padGeo=new THREE.BoxGeometry(0.07,0.09,0.32);
 Srg.tines=[];
 for(const s of[-1,1]){const t=new THREE.Mesh(tineGeo,fsteel);t.castShadow=true;hinge.add(t);const pad=new THREE.Mesh(padGeo,fsteel);pad.position.z=len-0.16;t.add(pad);Srg.tines.push({m:t,s});}
 const hg=new THREE.CylinderGeometry(0.07,0.09,3,10);hg.rotateX(Math.PI/2);hg.translate(0,0,-1.5);
 const handle=new THREE.Mesh(hg,fsteel);handle.castShadow=true;hinge.add(handle);
 const ringGeo=new THREE.TorusGeometry(0.32,0.06,8,20);
 for(const s of[-1,1]){const r=new THREE.Mesh(ringGeo,fsteel);r.position.set(s*0.35,0,-3.0);hinge.add(r);}
 Srg.tipGlow=glowSprite(0x80f0ff,0.8,0.5);F.add(Srg.tipGlow);
 Srg.retMat=new THREE.MeshBasicMaterial({color:0x18e6ff,transparent:true,opacity:0.85,depthTest:false,blending:THREE.AdditiveBlending});
 Srg.reticle=new THREE.Mesh(new THREE.RingGeometry(0.17,0.24,24),Srg.retMat);Srg.reticle.rotation.x=-Math.PI/2;Srg.reticle.renderOrder=6;S.add(Srg.reticle);
 // specimen jar
 const jar=Srg.jar=new THREE.Group();jar.position.set(3.25,0.72,3.7);S.add(jar);
 const jg=new THREE.Mesh(new THREE.CylinderGeometry(0.62,0.62,1.3,24,1,true),new THREE.MeshStandardMaterial({color:0xaaddff,transparent:true,opacity:0.22,roughness:0.05,metalness:0.2,depthWrite:false,side:THREE.DoubleSide}));jg.position.y=0.65;jar.add(jg);
 const liq=new THREE.Mesh(new THREE.CylinderGeometry(0.58,0.58,0.9,24),new THREE.MeshStandardMaterial({color:0x2aff8a,transparent:true,opacity:0.32,emissive:0x0a7a3a,depthWrite:false}));liq.position.y=0.45;jar.add(liq);
 const jb=new THREE.Mesh(new THREE.CylinderGeometry(0.66,0.66,0.1,24),steel);jb.position.y=0.02;jar.add(jb);
 Srg.fx=new Particles(S,420,true);Srg.blood=new Particles(S,320,false);
})();


/* ============================== PANE 3: ANESTHESIOLOGIST SCENE ============================== */
const Ane={camK:1,lampBlend:1,LANE_X:ANE.LANE_X,TH_Z:ANE.TH_Z,laneState:[{},{},{}]};
(function(){
 const S=Ane.scene=new THREE.Scene();S.background=new THREE.Color(0x07050d);
 Ane.cam=new THREE.PerspectiveCamera(52,0.6,0.1,100);
 Ane.camBase=new THREE.Vector3(0,5.8,6.6);Ane.camLook=new THREE.Vector3(0,0.9,-0.5);
 S.add(new THREE.AmbientLight(0x2a2440,0.6));
 const key=new THREE.DirectionalLight(0xc8d4ff,0.7);key.position.set(2,9,6);S.add(key);
 Ane.monLight=new THREE.PointLight(0x30ff90,0.9,9,1.5);Ane.monLight.position.set(0,2.6,-1.6);S.add(Ane.monLight);
 Ane.lampLight=new THREE.PointLight(0xfff0d0,0.8,12,1.5);Ane.lampLight.position.set(1.2,2.6,0.8);S.add(Ane.lampLight);
 Ane.sirenR=new THREE.PointLight(0xff1030,0,20,1.5);S.add(Ane.sirenR);
 Ane.sirenB=new THREE.PointLight(0x2050ff,0,20,1.5);S.add(Ane.sirenB);
 const wallMat=new THREE.MeshStandardMaterial({color:0x1a1f2e,roughness:0.8});
 const back=new THREE.Mesh(new THREE.BoxGeometry(12,9,0.3),wallMat);back.position.set(0,3,-4.2);S.add(back);
 for(const s of[-1,1]){const w=new THREE.Mesh(new THREE.BoxGeometry(0.3,9,14),wallMat);w.position.set(s*4.2,3,1);S.add(w);}
 const floor=new THREE.Mesh(new THREE.PlaneGeometry(20,20),new THREE.MeshStandardMaterial({color:0x0c0e16,roughness:0.9}));floor.rotation.x=-Math.PI/2;floor.position.y=-0.5;S.add(floor);
 const ledM=new THREE.MeshBasicMaterial({color:0x2a6cff});
 for(const y of[0.9,4.75]){const l=new THREE.Mesh(new THREE.BoxGeometry(12,0.05,0.05),ledM);l.position.set(0,y,-4.04);S.add(l);}
 Ane.streakTex=canvasTex(256,64,(g,w,h)=>{g.fillStyle='#02030a';g.fillRect(0,0,w,h);for(let i=0;i<40;i++){g.fillStyle=pick(['#ffcf7a','#9fd8ff','#ff5a7a','#ffffff']);g.globalAlpha=rand(0.3,0.9);g.fillRect(rand(0,w),rand(4,h-4),rand(10,60),rand(1,3));}g.globalAlpha=1;});
 Ane.streakTex.wrapS=THREE.RepeatWrapping;
 const win=new THREE.Mesh(new THREE.PlaneGeometry(6,1.0),new THREE.MeshBasicMaterial({map:Ane.streakTex}));win.position.set(0,4.15,-4.03);S.add(win);
 const deskMat=new THREE.MeshStandardMaterial({color:0x222838,roughness:0.6,metalness:0.3});
 const desk=new THREE.Mesh(new THREE.BoxGeometry(6,0.4,6.2),deskMat);desk.position.set(0,0.4,0);S.add(desk);
 const steelA=new THREE.MeshStandardMaterial({color:0x9aa6b6,metalness:0.8,roughness:0.28});
 // ECG monitor (CanvasTexture)
 Ane.ecgCanvas=document.createElement('canvas');Ane.ecgCanvas.width=512;Ane.ecgCanvas.height=256;Ane.ecgCtx=Ane.ecgCanvas.getContext('2d');
 Ane.ecgTex=new THREE.CanvasTexture(Ane.ecgCanvas);Ane.ecgTex.minFilter=THREE.LinearFilter;Ane.ecgTex.generateMipmaps=false;
 const mon=new THREE.Group();mon.position.set(0,2.55,-2.55);mon.rotation.x=-0.32;S.add(mon);
 mon.add(new THREE.Mesh(new THREE.BoxGeometry(3.3,1.85,0.22),new THREE.MeshStandardMaterial({color:0x2c3240,roughness:0.5,metalness:0.4})));
 const scr=new THREE.Mesh(new THREE.PlaneGeometry(3.05,1.55),new THREE.MeshBasicMaterial({map:Ane.ecgTex}));scr.position.z=0.115;mon.add(scr);
 const mg=glowSprite(0x30ff90,4.2,0.12);mg.position.z=0.3;mon.add(mg);
 const stand=new THREE.Mesh(new THREE.CylinderGeometry(0.1,0.14,1.4,10),deskMat);stand.position.set(0,1.35,-2.75);S.add(stand);
 // surgical lamp (pivot swings between chest and wall)
 const lampPos=new THREE.Vector3(1.95,3.4,-1.0);
 const armA=new THREE.Vector3(2.9,7.5,-2.5);const arm=new THREE.Mesh(new THREE.CylinderGeometry(0.07,0.07,1,8),steelA);orientCyl(arm,armA,lampPos);S.add(arm);
 const piv=Ane.lampPivot=new THREE.Group();piv.position.copy(lampPos);S.add(piv);
 const headM=new THREE.MeshStandardMaterial({color:0xcfd6e0,metalness:0.6,roughness:0.3});
 piv.add(new THREE.Mesh(new THREE.CylinderGeometry(0.4,0.48,0.24,24),headM));
 Ane.lampFace=new THREE.MeshBasicMaterial({color:0xfff2cc});
 const face=new THREE.Mesh(new THREE.CircleGeometry(0.38,24),Ane.lampFace);face.rotation.x=Math.PI/2;face.position.y=-0.15;piv.add(face);
 const cone=new THREE.ConeGeometry(1.3,4.4,24,1,true);cone.translate(0,-2.2,0);
 Ane.beamMat=new THREE.MeshBasicMaterial({color:0xfff0c8,transparent:true,opacity:0.14,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide});
 piv.add(new THREE.Mesh(cone,Ane.beamMat));
 Ane.lampGlow=glowSprite(0xfff0c8,1.7,0.7);Ane.lampGlow.position.y=-0.2;piv.add(Ane.lampGlow);
 const down=new THREE.Vector3(0,-1,0);
 Ane.qOn=new THREE.Quaternion().setFromUnitVectors(down,new THREE.Vector3(0,1.0,3.0).sub(lampPos).normalize());
 Ane.qOff=new THREE.Quaternion().setFromUnitVectors(down,new THREE.Vector3(1.0,0.2,-0.9).normalize());
 // injectors
 const glassA=new THREE.MeshStandardMaterial({color:0xe6f3ff,transparent:true,opacity:0.3,roughness:0.1,depthWrite:false});
 Ane.inj=[];
 [[-1.85,0x2a9dff],[1.85,0xff3a3a]].forEach(([x,col],i)=>{
  const g=new THREE.Group();g.position.set(x,0.6,-1.55);S.add(g);
  const base=new THREE.Mesh(new THREE.CylinderGeometry(0.34,0.4,0.25,16),deskMat);base.position.y=0.12;g.add(base);
  const barrel=new THREE.Mesh(new THREE.CylinderGeometry(0.2,0.2,1.3,16,1,true),glassA);barrel.position.y=0.95;g.add(barrel);
  const liqM=new THREE.MeshBasicMaterial({color:col,transparent:true,opacity:0.8});
  const liq=new THREE.Mesh(new THREE.CylinderGeometry(0.17,0.17,1,16),liqM);liq.position.y=0.75;liq.scale.y=0.9;g.add(liq);
  const plunger=new THREE.Group();plunger.position.y=1.65;g.add(plunger);
  const rod=new THREE.Mesh(new THREE.CylinderGeometry(0.05,0.05,0.7,8),steelA);rod.position.y=-0.15;plunger.add(rod);
  const thumb=new THREE.Mesh(new THREE.CylinderGeometry(0.26,0.26,0.07,16),new THREE.MeshStandardMaterial({color:col,emissive:col,emissiveIntensity:0.4}));thumb.position.y=0.2;plunger.add(thumb);
  const glow=glowSprite(col,1.6,0.3);glow.position.y=0.8;g.add(glow);
  const ivM=new THREE.MeshBasicMaterial({color:0x2a2f3a});
  const sx=Math.sign(x);
  const iv=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(x,0.7,-1.3),new THREE.Vector3(sx*1.65,0.66,1.0),new THREE.Vector3(sx*0.7,1.1,2.9)]),24,0.035,6,false),ivM);S.add(iv);
  Ane.inj.push({g,liq,liqM,plunger,glow,ivM,press:0,col:new THREE.Color(col)});
 });
 // tool tray with loose tools
 const tray=new THREE.Mesh(new THREE.BoxGeometry(3.4,0.08,1.4),steelA);tray.position.set(0,0.66,-0.95);S.add(tray);
 for(const [w,d,x,z] of[[3.4,0.06,0,-1.65],[3.4,0.06,0,-0.25],[0.06,1.4,-1.7,-0.95],[0.06,1.4,1.7,-0.95]]){const r=new THREE.Mesh(new THREE.BoxGeometry(w,0.14,d),steelA);r.position.set(x,0.72,z);S.add(r);}
 Ane.slots=[];
 // lanes + swat zones + threshold
 Ane.laneMats=[];Ane.zoneMats=[];Ane.paddles=[];
 const laneGeo=new THREE.PlaneGeometry(0.78,2.6),zoneGeo=new THREE.PlaneGeometry(0.78,1.1);
 const chevTex=canvasTex(64,256,(g,w,h)=>{g.fillStyle='#8a8a8a';g.fillRect(0,0,w,h);g.fillStyle='#ffffff';g.fillRect(0,0,4,h);g.fillRect(w-4,0,4,h);
  g.lineWidth=7;g.strokeStyle='#ffffff';for(let y=20;y<h;y+=42){g.beginPath();g.moveTo(10,y);g.lineTo(w/2,y+16);g.lineTo(w-10,y);g.stroke();}});
 for(let i=0;i<3;i++){
  const m=new THREE.MeshBasicMaterial({color:0x334055,map:chevTex,transparent:true,opacity:0.9,depthWrite:false});
  const p=new THREE.Mesh(laneGeo,m);p.rotation.x=-Math.PI/2;p.position.set(Ane.LANE_X[i],0.605,0.85);S.add(p);Ane.laneMats.push(m);
  const zm=new THREE.MeshBasicMaterial({color:0x1a6a3a,transparent:true,opacity:0.55,blending:THREE.AdditiveBlending,depthWrite:false});
  const zp=new THREE.Mesh(zoneGeo,zm);zp.rotation.x=-Math.PI/2;zp.position.set(Ane.LANE_X[i],0.61,1.6);S.add(zp);Ane.zoneMats.push(zm);
  const pm=new THREE.MeshBasicMaterial({color:0x7ff6ff,transparent:true,opacity:0,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide});
  const pg=new THREE.Group();pg.position.set(Ane.LANE_X[i],1.35,1.55);S.add(pg);
  const pad=new THREE.Mesh(new THREE.BoxGeometry(0.95,0.05,0.32),pm);pad.position.x=0.25;pg.add(pad);
  Ane.paddles.push({g:pg,mat:pm,t:0,lane:i});
 }
 const divM=new THREE.MeshBasicMaterial({color:0x5a6a88});for(const x of[-1.43,-0.475,0.475,1.43]){const dv=new THREE.Mesh(new THREE.BoxGeometry(0.03,0.02,2.6),divM);dv.position.set(x,0.615,0.85);S.add(dv);}
 Ane.thMat=new THREE.MeshBasicMaterial({color:0xff2a3d});
 const th=new THREE.Mesh(new THREE.BoxGeometry(2.9,0.06,0.12),Ane.thMat);th.position.set(0,0.63,Ane.TH_Z);S.add(th);
 for(const x of Ane.LANE_X){const g=glowSprite(0xff2a3d,0.9,0.5);g.position.set(x,0.7,Ane.TH_Z);S.add(g);}
 // patient (near the camera)
 const pd=new THREE.Mesh(new THREE.BoxGeometry(5.6,0.3,2.6),new THREE.MeshStandardMaterial({color:0x136e68,roughness:0.95}));pd.position.set(0,0.75,3.95);S.add(pd);
 const bodyBump=new THREE.Mesh(new THREE.SphereGeometry(1,24,16),new THREE.MeshStandardMaterial({color:0x3a7fc8,roughness:0.8}));bodyBump.scale.set(1.7,0.35,1.1);bodyBump.position.set(0,0.95,4.15);S.add(bodyBump);
 Ane.fx=new Particles(S,320,true);Ane.blood=new Particles(S,220,false);
})();
Ane.swing=function(l){Ane.paddles[l].t=0.2;};
Ane.jiggle=function(mag){for(const s of Ane.slots){s.hopV+=mag*rand(1.5,3.5);s.tiltV+=mag*rand(-4,4);}};

Ane.buildTray=function(slots){
 for(const s of Ane.slots)Ane.scene.remove(s.m);
 Ane.slots=slots.map(q=>{const m=ToolKit.make(q.kind);m.position.set(q.x,ANE.Y,q.z);m.rotation.y=q.ry;Ane.scene.add(m);
  return {m,kind:q.kind,bx:q.x,bz:q.z,by:ANE.Y,ry:q.ry,present:q.present,hop:0,hopV:0,tilt:0,tiltV:0,pop:1};});
};

/* ============================== PARASITES ============================== */
const PGEO={body:new THREE.SphereGeometry(0.3,20,16),spot:new THREE.SphereGeometry(0.06,8,6),eye:new THREE.SphereGeometry(0.075,10,8),
 stalk:new THREE.CylinderGeometry(0.025,0.03,1,6),tendril:new THREE.CylinderGeometry(0.035,0.02,1,6),
 plate:new THREE.SphereGeometry(0.33,14,8,0,TAU,0,Math.PI*0.42),core:new THREE.SphereGeometry(0.16,12,10),leg:new THREE.CylinderGeometry(0.025,0.02,1,5),
 vein:new THREE.TorusGeometry(0.29,0.025,6,24)};
function makeParasite(type,slot,idx){
 const info=PINFO[type];
 const root=new THREE.Group();root.position.set(slot.x,slot.y,slot.z);Srg.scene.add(root);
 const body=new THREE.Group();root.add(body);
 const mats=[];
 const bm=new THREE.MeshStandardMaterial({color:info.color,emissive:info.emis,emissiveIntensity:1.0,roughness:0.28,metalness:0.1});mats.push(bm);
 const core=new THREE.Mesh(PGEO.body,bm);core.scale.set(1,0.72,1.25);core.castShadow=true;body.add(core);
 const am=new THREE.MeshBasicMaterial({color:info.accent});mats.push(am);
 const tm=new THREE.MeshStandardMaterial({color:info.color,emissive:info.emis,emissiveIntensity:0.6,roughness:0.4});mats.push(tm);
 const ex={};
 if(type===PHOTO){
  for(let i=0;i<7;i++){const s=new THREE.Mesh(PGEO.spot,am);const a=i/7*TAU;s.position.set(Math.cos(a)*0.24,0.13,Math.sin(a)*0.3);body.add(s);}
  ex.stalks=[-1,1].map(sx=>{const st=new THREE.Mesh(PGEO.stalk,tm);body.add(st);const e=new THREE.Mesh(PGEO.eye,am);body.add(e);return {st,e,sx};});
 }else if(type===PULSE){
  bm.transparent=true;bm.opacity=0.78;
  const cm=new THREE.MeshBasicMaterial({color:0xeaffd0,transparent:true,opacity:0.9});mats.push(cm);
  ex.core=new THREE.Mesh(PGEO.core,cm);ex.core.position.y=0.04;body.add(ex.core);
  const vr=new THREE.Mesh(PGEO.vein,am);vr.rotation.x=Math.PI/2;vr.scale.set(1,1.25,1);body.add(vr);
 }else{
  const pm=new THREE.MeshStandardMaterial({color:0xb34700,emissive:0xff2200,emissiveIntensity:0.35,roughness:0.25,metalness:0.6});mats.push(pm);
  for(let i=0;i<3;i++){const p=new THREE.Mesh(PGEO.plate,pm);p.position.set(0,0.02,-0.22+i*0.22);p.scale.set(1.05,0.75,0.55);p.castShadow=true;body.add(p);}
  ex.legs=[];for(let i=0;i<6;i++){const l=new THREE.Mesh(PGEO.leg,tm);root.add(l);ex.legs.push({l,a:i<3?-1:1,k:i%3});}
 }
 const glow=glowSprite(info.color,1.5,0.6);root.add(glow);mats.push(glow.material);
 const tendrils=[];
 for(let i=0;i<5;i++){const a=i/5*TAU+Math.random()*0.5;const t=new THREE.Mesh(PGEO.tendril,tm);root.add(t);tendrils.push({m:t,ax:Math.cos(a)*0.42,az:Math.sin(a)*0.5});}
 return {type,info,slot,idx,root,body,bm,mats,ex,glow,tendrils,progress:0,state:'attached',grabbed:false,burrow:type===PHOTO?1:0,noGrab:0,seed:Math.random()*10,shake:0,flyT:0,from:new THREE.Vector3(),jarSlot:0};
}
function disposeParasite(p){Srg.scene.remove(p.root);p.mats.forEach(m=>m.dispose());}
function jarPos(p,out){const j=Srg.jar.position,k=p.jarSlot,a=k*2.1;return out.set(j.x+Math.cos(a)*0.27,j.y+0.3+(k%3)*0.2,j.z+Math.sin(a)*0.27);}
const _pa=new THREE.Vector3(),_pb=new THREE.Vector3(),_pj=new THREE.Vector3(),_pf=new THREE.Vector3();
function updateParasiteVisual(vp,p,t,dt){
 if(p.state==='jar'||p.state==='flying'){
  for(const td of vp.tendrils)td.m.visible=false;if(vp.ex.legs)for(const l of vp.ex.legs)l.l.visible=false;
  jarPos(p,_pj);
  if(p.state==='jar'){vp.root.position.copy(_pj);vp.root.position.y+=Math.sin(t*2+p.jarSlot)*0.05;vp.root.scale.setScalar(0.42);vp.body.rotation.y=t*0.8+p.jarSlot;}
  else{const k=clamp(p.flyT,0,1);_pf.set(p.from.x,p.from.y,p.from.z);vp.root.position.lerpVectors(_pf,_pj,k);vp.root.position.y+=Math.sin(k*Math.PI)*2.2;vp.root.scale.setScalar(lerp(1,0.42,k));vp.body.rotation.x+=dt*9;}
  vp.body.position.set(0,0,0);vp.body.scale.setScalar(1);vp.glow.position.set(0,0,0);vp.glow.material.opacity=0.45;vp.bm.emissiveIntensity=1.2;return;
 }
 vp.root.position.set(p.slot.x,p.slot.y,p.slot.z);vp.root.scale.setScalar(1);
 let bx=0,by=0.14,bz=0,sc=1,emis=1.0;
 if(p.type===PHOTO){sc*=1-0.38*p.burrow;by-=0.2*p.burrow;emis=0.35+1.5*(1-p.burrow);}
 else if(p.type===PULSE){const th=V.beatPulse;sc*=1+0.28*th;emis=0.7+2.0*th;vp.ex.core.scale.setScalar(0.8+0.6*th);}
 else{sc*=1+Math.sin(t*2+vp.seed)*0.03;emis=0.85;}
 const s=G.srg;
 if(p.grabbed){bx=s.tipX-p.slot.x;bz=s.tipZ-p.slot.z;by=Math.max(0.12,s.tipY+s.tipOy-p.slot.y-0.02);const j=p.shake*0.035;bx+=rand(-j,j);bz+=rand(-j,j);emis*=1.35;vp.body.rotation.y=Math.atan2(bx,bz);}
 else{by+=Math.sin(t*3+vp.seed)*0.03;vp.body.rotation.y=Math.sin(t*0.7+vp.seed)*0.3;}
 if(p.noGrab>0){bx+=rand(-0.04,0.04);bz+=rand(-0.04,0.04);}
 vp.body.position.set(bx,by,bz);vp.body.scale.setScalar(sc);
 vp.bm.emissiveIntensity=emis;vp.glow.position.set(bx,by,bz);vp.glow.material.opacity=clamp(0.2+0.35*emis,0,0.95);vp.glow.scale.setScalar(1.1+0.6*sc);
 const thick=1-0.6*p.progress,shr=1-0.25*p.burrow;
 for(const td of vp.tendrils){td.m.visible=true;_pa.set(td.ax*shr,-0.08,td.az*shr);_pb.set(bx+td.ax*0.35*sc,by-0.05,bz+td.az*0.35*sc);orientCyl(td.m,_pa,_pb,thick);}
 if(vp.ex.legs)for(const lg of vp.ex.legs){lg.l.visible=true;_pa.set(lg.a*0.6,-0.08,(lg.k-1)*0.32);_pb.set(bx+lg.a*0.24*sc,by-0.02,bz+(lg.k-1)*0.2*sc);orientCyl(lg.l,_pa,_pb,1);}
 if(vp.ex.stalks)for(const sk of vp.ex.stalks){const ey=0.18+0.25*(1-p.burrow);_pa.set(sk.sx*0.08,0.15,-0.2);_pb.set(sk.sx*0.16,ey,-0.3);orientCyl(sk.st,_pa,_pb,1);sk.e.position.copy(_pb);sk.e.visible=p.burrow<0.85;sk.st.visible=p.burrow<0.85;}
}


/* ============================== ECG MONITOR (client-side trace from synced BPM) ============================== */
function ecgValue(phase, bpm) {
  const cyc = 60 / Math.max(1, bpm), t = phase * cyc, tn = (1 - phase) * cyc, k = Math.min(1, cyc / 0.8);
  return gauss(t, 0.012) + gauss(tn, 0.012) - 0.28 * gauss(t - 0.035, 0.012) + 0.32 * gauss(t - 0.23 * k, 0.045) - 0.12 * gauss(tn - 0.03, 0.01) + 0.14 * gauss(tn - 0.16 * k, 0.028);
}
function updateHeart(dt) {
  if (!G) return;
  V.ecgAcc += dt;
  const sdt = 1 / 180, live = G.mode === 'playing' || G.mode === 'attract' || G.mode === 'ending' || G.mode === 'ended';
  let n = 0;
  while (V.ecgAcc >= sdt && n < 60) {
    V.ecgAcc -= sdt; n++;
    let v = 0;
    if (!G.flatlined && live) {
      V.beatPhase += G.heartBPM / 60 * sdt;
      if (V.beatPhase >= 1) { V.beatPhase -= 1; V.beatPulse = 1; if (G.mode === 'playing') Sfx.beep(G.patientBlood); }
      v = ecgValue(V.beatPhase, G.heartBPM);
    }
    V.ecg[V.ecgIdx] = v + (Math.random() - 0.5) * 0.03; V.ecgIdx = (V.ecgIdx + 1) % V.ecg.length;
  }
  if (n >= 60) V.ecgAcc = 0;
  V.beatPulse = Math.max(0, V.beatPulse - dt * 4);
}
function drawECG() {
  const g = Ane.ecgCtx, W = 512, H = 256;
  g.fillStyle = '#010805'; g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(30,120,60,0.28)'; g.lineWidth = 1; g.beginPath(); for (let x = 0; x <= W; x += 32) { g.moveTo(x, 0); g.lineTo(x, H); } for (let y = 0; y <= H; y += 32) { g.moveTo(0, y); g.lineTo(W, y); } g.stroke();
  const N = V.ecg.length, x0 = 10, x1 = 360, yMid = 100, amp = 62, flat = G.flatlined;
  g.strokeStyle = flat ? '#ff3040' : '#39ff6a'; g.lineWidth = 3; g.shadowColor = g.strokeStyle; g.shadowBlur = 8; g.beginPath();
  let started = false;
  for (let i = 0; i < N; i++) { const gap = (i - V.ecgIdx + N) % N; if (gap < 14) { started = false; continue; } const x = x0 + (i / (N - 1)) * (x1 - x0), y = yMid - V.ecg[i] * amp; if (!started) { g.moveTo(x, y); started = true; } else g.lineTo(x, y); }
  g.stroke(); g.shadowBlur = 0;
  const z0 = G.targetBPMZone[0], z1 = G.targetBPMZone[1], bpm = G.heartBPM, crit = bpm < 50 || bpm > 160;
  const col = flat || crit ? '#ff3040' : G.inZone ? '#39ff6a' : '#ffd23a';
  g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillStyle = col; g.font = 'bold 20px Consolas,monospace'; g.fillText('HR', 378, 34);
  if (V.beatPulse > 0.5 && !flat) { g.fillStyle = '#ff3a5a'; g.fillText('♥', 420, 34); }
  g.fillStyle = col; g.font = 'bold 62px Consolas,monospace'; g.fillText(flat ? '---' : String(Math.round(bpm)), 372, 92);
  g.font = 'bold 16px Consolas,monospace'; g.fillStyle = '#9fffc0'; g.fillText(`ZONE ${Math.round(z0)}-${Math.round(z1)}`, 376, 118);
  g.fillStyle = '#ff7080'; g.fillText(`BLOOD ${Math.ceil(G.patientBlood)}%`, 376, 144);
  g.fillStyle = '#2a0a10'; g.fillRect(376, 152, 120, 10); g.fillStyle = '#ff2a3d'; g.fillRect(376, 152, 120 * G.patientBlood / 100, 10);
  g.fillStyle = G.lampFocusedOnChest ? '#fff3a0' : '#a48bff'; g.fillText(G.lampFocusedOnChest ? 'LAMP: ON CHEST' : 'LAMP: AWAY', 20, 176);
  const bx0 = 20, bx1 = 492, by = 192, bh = 30, X = (b) => bx0 + (clamp(b, 40, 180) - 40) / 140 * (bx1 - bx0);
  g.fillStyle = '#14202a'; g.fillRect(bx0, by, bx1 - bx0, bh);
  g.fillStyle = 'rgba(255,40,60,0.45)'; g.fillRect(X(40), by, X(50) - X(40), bh); g.fillRect(X(160), by, X(180) - X(160), bh);
  g.fillStyle = 'rgba(57,255,106,0.6)'; g.fillRect(X(z0), by, X(z1) - X(z0), bh);
  g.fillStyle = '#7f93a8'; g.font = '12px Consolas,monospace'; g.textAlign = 'center';
  for (let b = 40; b <= 180; b += 20) { g.fillRect(X(b) - 0.5, by + bh, 1, 5); g.fillText(String(b), X(b), by + bh + 17); }
  if (!flat) { const nx = X(bpm); g.fillStyle = '#ffffff'; g.fillRect(nx - 2, by - 6, 4, bh + 12); g.beginPath(); g.moveTo(nx - 8, by - 12); g.lineTo(nx + 8, by - 12); g.lineTo(nx, by - 3); g.closePath(); g.fill(); }
  Ane.ecgTex.needsUpdate = true;
}

/* ============================== LAYOUT / RESIZE (your own pane is bigger online) ============================== */
let scanPattern = null;
function camScale(cam, h) { return h * L.dpr / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2)); }
function paneFractions() {
  if (Sess.kind === 'online' && Sess.myRole) { const i = roleIdx(Sess.myRole); return [0, 1, 2].map((k) => (k === i ? 0.46 : 0.27)); }
  return [0.3, 0.4, 0.3];
}
function layout() {
  L.W = Math.max(320, window.innerWidth); L.H = Math.max(240, window.innerHeight); L.dpr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(L.dpr); renderer.setSize(L.W, L.H, true);
  hud.width = Math.round(L.W * L.dpr); hud.height = Math.round(L.H * L.dpr); hud.style.width = L.W + 'px'; hud.style.height = L.H + 'px';
  L.fs = clamp(Math.min(L.W / 112, L.H / 58), 9, 15);
  L.top = Math.round(clamp(L.H * 0.06, 34, 50));
  const gap = 12, side = 8, bottom = 8, fr = paneFractions(), avail = L.W - side * 2 - gap * 2;
  let x = side;
  for (let i = 0; i < 3; i++) { const w = Math.floor(avail * fr[i]); L.panes[i] = { x, y: L.top + 8, w, h: Math.max(60, L.H - L.top - 8 - bottom) }; x += w + gap; }
  const cams = [Drv.cam, Srg.cam, Ane.cam];
  for (let i = 0; i < 3; i++) { cams[i].aspect = L.panes[i].w / L.panes[i].h; cams[i].updateProjectionMatrix(); }
  Drv.camK = clamp(0.6 / Drv.cam.aspect, 0.9, 1.6);
  Srg.camK = clamp(0.76 / Srg.cam.aspect, 1, 1.7);
  Ane.camK = clamp(0.6 / Ane.cam.aspect, 1, 1.7);
  Srg.rayCam.aspect = Srg.cam.aspect; Srg.rayCam.position.copy(Srg.camBase).multiplyScalar(Srg.camK); Srg.rayCam.lookAt(0, 0, 0.3); Srg.rayCam.updateProjectionMatrix(); Srg.rayCam.updateMatrixWorld();
  Drv.sparks.setScale(camScale(Drv.cam, L.panes[0].h));
  Srg.fx.setScale(camScale(Srg.cam, L.panes[1].h)); Srg.blood.setScale(camScale(Srg.cam, L.panes[1].h));
  Ane.fx.setScale(camScale(Ane.cam, L.panes[2].h)); Ane.blood.setScale(camScale(Ane.cam, L.panes[2].h));
  scanPattern = null;
}
window.addEventListener('resize', layout);

/* ============================== VIEW SYNC: sim state -> 3D meshes ============================== */
const VH = new Map(), VT = new Map(); let VP = [];
const PSYS = { ds: Drv.sparks, sf: Srg.fx, sb: Srg.blood, af: Ane.fx, ab: Ane.blood };
function clearViews() {
  for (const o of VH.values()) { Drv.scene.remove(o.g); o.mats.forEach((m) => m.dispose()); } VH.clear();
  for (const o of VT.values()) { Ane.scene.remove(o.m); o.glow.material.dispose(); } VT.clear();
  for (const vp of VP) disposeParasite(vp); VP = [];
  for (const o of Srg.stuck) Srg.scene.remove(o.m); Srg.stuck.length = 0;
  Object.values(PSYS).forEach((p) => p.clear());
}
function viewReset() {
  clearViews();
  V.gen = G.gen; V.banners.length = 0; V.flash = [0, 0, 0]; V.bezel = [0, 0, 0]; V.whiteFlash = 0; V.hitStop = 0; V.bounce = V.bounceV = 0;
  V.shake = { trauma: 0, x: 0, y: 0, vx: 0, vy: 0 }; V.ecg.fill(0); V.injPress = [0, 0]; V.laneFlash = [0, 0, 0];
  VP = G.parasites.map((p, i) => makeParasite(p.type, p.slot, i));
  Ane.buildTray(G.slots);
  Srg.lampBlend = Ane.lampBlend = G.lampFocusedOnChest ? 1 : 0;
  Sfx.flatStop();
}
function viewSync() {
  if (!G) return;
  if (V.gen !== G.gen) viewReset();
  const seen = new Set();
  for (const h of G.hazards) {
    seen.add(h.id);
    let o = VH.get(h.id);
    if (!o) { o = makeHazardMesh(h); Drv.scene.add(o.g); VH.set(h.id, o); }
    o.g.position.set(h.x, 0, h.z); if (h.knock) o.g.rotation.y = h.rot;
  }
  for (const [id, o] of VH) if (!seen.has(id)) { Drv.scene.remove(o.g); o.mats.forEach((m) => m.dispose()); VH.delete(id); }
  seen.clear();
  for (const t of G.tools) {
    seen.add(t.id);
    let o = VT.get(t.id);
    if (!o) { const m = ToolKit.make(t.kind), glow = glowSprite(0xff3030, 0.9, 0.45); m.add(glow); Ane.scene.add(m); o = { m, glow }; VT.set(t.id, o); }
    o.m.visible = t.state !== 'pending';
    o.m.position.set(t.pos.x, t.pos.y, t.pos.z); o.m.rotation.set(t.rot.x, t.rot.y, t.rot.z); o.m.scale.setScalar(t.scale);
    if (t.gold) { o.glow.material.color.set(0xffd34d); o.glow.material.opacity = Math.max(0, t.life / 1.6) * 0.9; }
    else o.glow.material.opacity = t.state === 'flying' ? (t.t >= t.tZone && t.t < t.tTh ? 0.95 : 0.45) : 0;
  }
  for (const [id, o] of VT) if (!seen.has(id)) { Ane.scene.remove(o.m); o.glow.material.dispose(); VT.delete(id); }
  G.slots.forEach((q, i) => { const s = Ane.slots[i]; if (!s) return; if (q.present && !s.present) s.pop = 0; s.present = q.present; s.m.visible = q.present; });
}

/* ============================== EVENTS: sim -> sounds / particles / banners ============================== */
function banner(pane, text, color, o) {
  o = o || {}; const list = pane < 0 ? [0, 1, 2] : [pane];
  for (const pi of list) {
    const ex = V.banners.find((b) => b.pane === pi && b.text === text);
    if (ex) { if (ex.age > 0.25) ex.age = 0.18; ex.life = Math.max(ex.life, ex.age + (o.life || 1.9)); continue; }
    V.banners.push({ pane: pi, text, color, age: 0, life: o.life || 1.9, big: !!o.big });
  }
  while (V.banners.length > 18) V.banners.shift();
}
function kickShake(ix, iy, tr) { const s = V.shake; s.vx += ix * 5; s.vy += iy * 5; s.trauma = Math.min(1, s.trauma + tr); }
function handleEvents(list) {
  for (const e of list) {
    switch (e[0]) {
      case 'sfx': if (e[1] === 'flatStart') { if (Sess.kind !== 'attract') Sfx.flatStart(); } else playSfx(e[1], e[2], e[3]); break;
      case 'banner': banner(e[1], e[2], e[3], e[4]); break;
      case 'fx': { const sys = PSYS[e[1]]; if (sys) sys.emit(e[2], e[3], e[4], e[5], e[6] || {}); break; }
      case 'flash': V.flash[e[1]] = Math.max(V.flash[e[1]], e[2]); break;
      case 'kick': kickShake(e[1], e[2], e[3]); break;
      case 'bezel': V.bezel = [1, 1, 1]; break;
      case 'bounce': V.bounceV += e[1]; break;
      case 'hitstop': V.hitStop = 0.05; break;
      case 'white': V.whiteFlash = 1; break;
      case 'jiggle': Ane.jiggle(e[1]); break;
      case 'swing': Ane.swing(e[1]); break;
      case 'laneflash': V.laneFlash[e[1]] = 1; break;
      case 'inject': V.injPress[e[1]] = 1; break;
      case 'stuck': Srg.addStuck(e[1]); break;
      case 'over': onOver(e[1]); break;
      default: break;
    }
  }
}

/* ============================== VISUAL UPDATES (per frame) ============================== */
function updateShake(dt) { const s = V.shake; s.trauma = Math.max(0, s.trauma - 1.3 * dt); s.vx += (-110 * s.x - 11 * s.vx) * dt; s.vy += (-110 * s.y - 11 * s.vy) * dt; s.x += s.vx * dt; s.y += s.vy * dt; }
function shakeOffset(scale, seed) {
  const s = V.shake, tr = s.trauma * s.trauma, t = realTime * 37 + seed;
  return { x: (s.x * 0.6 + tr * (Math.sin(t * 1.7) + Math.sin(t * 2.9)) * 0.5) * scale, y: (s.y * 0.6 + tr * (Math.sin(t * 2.3 + 1) + Math.sin(t * 3.7)) * 0.5) * scale, r: tr * Math.sin(t * 1.3) * 0.03 * scale };
}
const sirenPhase = () => Math.sin(realTime * TAU * 2.3);
const _white = new THREE.Color(1, 1, 1);
Drv.update = function (dt, t) {
  const a = G.amb;
  roadTex.offset.y = (G.traveled / 20) % 1;
  for (const s of Drv.scenery) s.obj.position.z = wrap(s.base + G.traveled, -260, 30);
  V.bounceV += (-60 * V.bounce - 7 * V.bounceV) * dt; V.bounce += V.bounceV * dt;
  Drv.amb.position.set(a.x, Math.max(-0.05, V.bounce * 0.12), 0);
  const yaw = -a.vx * 0.035 + (a.skid > 0 ? Math.sin(t * 14) * 0.25 * Math.min(1, a.skid) : 0);
  Drv.amb.rotation.y = damp(Drv.amb.rotation.y, yaw, 10, dt);
  Drv.amb.rotation.z = damp(Drv.amb.rotation.z, a.vx * 0.012, 8, dt);
  Drv.amb.rotation.x = V.bounce * 0.05;
  for (const w of Drv.wheels) w.rotation.x -= a.speed * dt / 0.44;
  const ph = sirenPhase(), rI = Math.max(0, ph), bI = Math.max(0, -ph);
  Drv.sirenR.intensity = rI * 3.2; Drv.sirenB.intensity = bI * 3.2;
  Drv.sprRed.material.opacity = 0.2 + rI * 0.8; Drv.sprBlue.material.opacity = 0.2 + bI * 0.8;
  Drv.lbRed.color.setRGB(0.3 + 0.7 * rI, 0.02, 0.06); Drv.lbBlue.color.setRGB(0.04, 0.15 + 0.2 * bI, 0.3 + 0.7 * bI);
  for (const h of G.hazards) {
    const o = VH.get(h.id); if (!o) continue;
    const far = h.hit ? 0 : clamp((-h.z - 10) / 22, 0, 1), pulse = 0.65 + 0.35 * Math.sin(t * 12 + o.born);
    o.beam.visible = o.ring.visible = o.top.visible = far > 0.01;
    o.beam.material.opacity = 0.42 * far * pulse; o.ring.material.opacity = 0.85 * far * pulse; o.top.material.opacity = 0.95 * far; o.ring.scale.setScalar(1 + 0.25 * Math.sin(t * 8 + o.born));
  }
  Drv.mat.oil.emissive.setHSL((t * 0.15) % 1, 0.9, 0.22);
  if (G.distanceRemaining < 240) { Drv.hospital.visible = true; Drv.hospital.position.z = -G.distanceRemaining; } else Drv.hospital.visible = false;
  const sp = a.speed, k = clamp((sp - 28) / 22, 0, 1);
  Drv.speedMat.opacity = k * 0.55;
  if (k > 0) {
    const arr = Drv.speedLines.pos, len = 1.5 + sp * 0.12;
    Drv.speedLines.data.forEach((d, i) => {
      d.z += sp * 1.6 * dt; if (d.z > 15) { d.z = rand(-110, -60); d.x = (Math.random() < 0.5 ? -1 : 1) * rand(1.5, 10); d.y = rand(0.3, 6); }
      const j = i * 6; arr[j] = d.x + a.x * 0.3; arr[j + 1] = d.y; arr[j + 2] = d.z; arr[j + 3] = d.x + a.x * 0.3; arr[j + 4] = d.y; arr[j + 5] = d.z - len;
    });
    Drv.speedLines.geo.attributes.position.needsUpdate = true;
  }
  const bf = clamp((sp - 36) / 16, 0, 1), fov = 60 + bf * 10;
  if (Math.abs(Drv.cam.fov - fov) > 0.05) { Drv.cam.fov = damp(Drv.cam.fov, fov, 4, dt); Drv.cam.updateProjectionMatrix(); Drv.sparks.setScale(camScale(Drv.cam, L.panes[0].h)); }
  const sh = shakeOffset(1, 0), cx = a.x * 0.55, K = Drv.camK;
  Drv.cam.position.set(cx + sh.x * 0.9, (16.5 - bf * 1.5) * K + sh.y * 0.7, (13.5 - bf * 1.5) * K);
  Drv.cam.lookAt(cx * 0.85, 0, -15); Drv.cam.rotation.z += sh.r;
  Drv.sparks.update(dt);
};
Srg.addStuck = function (kind) {
  const m = ToolKit.make(kind), side = Math.random() < 0.5 ? -1 : 1;
  m.position.set(side * rand(2.9, 3.25), 0.85, rand(-3, 3)); m.rotation.set(-1.0, rand(-1, 1), rand(-0.3, 0.3)); m.scale.setScalar(2.2);
  Srg.scene.add(m); Srg.stuck.push({ m, life: 3 });
  Srg.blood.emit(m.position.x, 0.8, m.position.z, 40, { spread: 1, speed: 3, color: [0.6, 0.02, 0.04], life: 1.2, size: 0.18, grav: 6, floor: 0.72 });
};
Srg.update = function (dt, t) {
  const s = G.srg;
  Srg.lampBlend = damp(Srg.lampBlend, G.lampFocusedOnChest ? 1 : 0, 7, dt);
  const lb = Srg.lampBlend;
  Srg.lamp.target.position.set(lerp(7.5, 0, lb), 0, lerp(-6.5, 0.3, lb));
  Srg.lamp.intensity = 0.45 + 1.95 * lb; Srg.ambL.intensity = 0.1 + 0.32 * lb; Srg.hemi.intensity = 0.05 + 0.27 * lb;
  Srg.forceps.position.set(s.tipX, s.tipY + s.tipOy, s.tipZ);
  Srg.spread = damp(Srg.spread, s.clamp ? (s.grab ? 0.012 : 0) : 0.05, 18, dt);
  for (const tn of Srg.tines) tn.m.rotation.y = tn.s * (0.006 + Srg.spread);
  Srg.forceps.rotation.z = damp(Srg.forceps.rotation.z, clamp(-(s.tx - s.fx) * 0.08, -0.25, 0.25), 8, dt);
  Srg.forceps.rotation.x = damp(Srg.forceps.rotation.x, clamp((s.tz - s.fz) * 0.05, -0.2, 0.2), 8, dt);
  const hot = s.grab ? 1 : s.clamp ? 0.6 : 0.3;
  Srg.tipGlow.material.opacity = 0.3 + 0.5 * hot;
  Srg.tipLight.position.set(s.tipX, s.tipY + 0.3, s.tipZ); Srg.tipLight.intensity = (s.grab ? 1.2 : s.clamp ? 0.6 : 0.25) + (1 - lb) * 0.5;
  // online surgeon: the ring follows your hand instantly, the forceps follow the server
  const rx = Sess.kind === 'online' && Sess.myRole === 'surgeon' ? V.localSurg.tx : s.tipX, rz = Sess.kind === 'online' && Sess.myRole === 'surgeon' ? V.localSurg.tz : s.tipZ;
  const danger = nearPolys(Srg.ribs, rx, rz, 0.3) || nearPolys(Srg.nerves, rx, rz, 0.25);
  Srg.reticle.position.set(rx, 0.64, rz);
  Srg.retMat.color.set(s.grab ? (s.inBand ? 0x39ff14 : 0xffb020) : danger ? 0xff2a3d : s.hoverP ? 0x39ff14 : 0x18e6ff);
  Srg.reticle.scale.setScalar(s.hoverP && !s.grab ? 1.2 + 0.15 * Math.sin(t * 10) : 1);
  const hp = V.beatPulse, o = ORG.heart; Srg.heart.scale.set(o.s[0] * (1 + 0.07 * hp), o.s[1] * (1 + 0.1 * hp), o.s[2] * (1 + 0.07 * hp));
  G.parasites.forEach((p, i) => { if (VP[i]) updateParasiteVisual(VP[i], p, t, dt); });
  const ph = sirenPhase(), ang = t * 1.6;
  Srg.sirenR.position.set(Math.cos(ang) * 8, 5, Math.sin(ang) * 8); Srg.sirenB.position.set(-Math.cos(ang) * 8, 5, -Math.sin(ang) * 8);
  Srg.sirenR.intensity = Math.max(0, ph) * 1.4; Srg.sirenB.intensity = Math.max(0, -ph) * 1.4;
  for (let i = Srg.stuck.length - 1; i >= 0; i--) { const st = Srg.stuck[i]; st.life -= dt; if (st.life < 0.4) st.m.scale.setScalar(2.2 * Math.max(0.01, st.life / 0.4)); if (st.life <= 0) { Srg.scene.remove(st.m); Srg.stuck.splice(i, 1); } }
  if (G.bleed > 0.2 && Math.random() < dt * G.bleed * 12) Srg.blood.emit(s.tipX + rand(-0.4, 0.4), 0.5, s.tipZ + rand(-0.4, 0.4), 3, { spread: 0.3, speed: 1, color: [0.5, 0.02, 0.03], life: 1, size: 0.14, grav: 3, floor: -0.5 });
  const sh = shakeOffset(0.28, 11), K = Srg.camK;
  Srg.cam.position.set(Srg.camBase.x * K + sh.x, Srg.camBase.y * K, Srg.camBase.z * K + sh.y);
  Srg.cam.lookAt(sh.x * 0.5, 0, 0.3 + sh.y * 0.5); Srg.cam.rotation.z += sh.r * 0.5;
  Srg.fx.update(dt); Srg.blood.update(dt);
};
Ane.update = function (dt, t) {
  drawECG();
  Ane.streakTex.offset.x = (Ane.streakTex.offset.x + G.amb.speed * dt * 0.012) % 1;
  Ane.lampBlend = damp(Ane.lampBlend, G.lampFocusedOnChest ? 1 : 0, 8, dt);
  const lb = Ane.lampBlend;
  Ane.lampPivot.quaternion.copy(Ane.qOff).slerp(Ane.qOn, lb);
  Ane.beamMat.opacity = 0.03 + 0.13 * lb; Ane.lampFace.color.setRGB(lerp(0.35, 1, lb), lerp(0.3, 0.95, lb), lerp(0.25, 0.8, lb));
  Ane.lampGlow.material.opacity = 0.2 + 0.6 * lb; Ane.lampLight.intensity = 0.2 + 0.8 * lb;
  for (let i = 0; i < 2; i++) {
    const inj = Ane.inj[i];
    if (V.injPress[i] > 0) { inj.press = 1; V.injPress[i] = 0; Ane.fx.emit(inj.g.position.x, 0.9, inj.g.position.z, 10, { spread: 0.5, speed: 1.5, color: [inj.col.r, inj.col.g, inj.col.b], life: 0.4, size: 0.1, grav: 1 }); }
    inj.press = Math.max(0, inj.press - dt * 3.5);
    inj.plunger.position.y = 1.65 - 0.35 * inj.press; inj.glow.material.opacity = 0.25 + 0.65 * inj.press;
    inj.ivM.color.setRGB(lerp(0.16, inj.col.r, inj.press), lerp(0.18, inj.col.g, inj.press), lerp(0.23, inj.col.b, inj.press));
  }
  for (const sl of Ane.slots) {
    sl.hopV -= 22 * dt; sl.hop += sl.hopV * dt; if (sl.hop < 0) { sl.hop = 0; sl.hopV = -sl.hopV * 0.3; if (Math.abs(sl.hopV) < 0.4) sl.hopV = 0; }
    sl.tiltV += (-80 * sl.tilt - 6 * sl.tiltV) * dt; sl.tilt += sl.tiltV * dt; sl.pop = Math.min(1, sl.pop + dt * 4);
    sl.m.position.set(sl.bx, sl.by + sl.hop, sl.bz); sl.m.rotation.set(sl.tilt * 0.5, sl.ry + sl.tilt, sl.tilt * 0.3);
    sl.m.scale.setScalar(sl.pop < 1 ? Math.max(0.05, 0.3 + 0.7 * easeOutBack(sl.pop)) : 1);
  }
  const blink = 0.5 + 0.5 * Math.sin(t * 20);
  for (let l = 0; l < 3; l++) {
    let incoming = false, inZone = false;
    for (const tl of G.tools) if (tl.lane === l && (tl.state === 'flying' || tl.state === 'pending')) { incoming = true; if (tl.state === 'flying' && tl.t >= tl.tZone && tl.t < tl.tTh) inZone = true; }
    Ane.laneState[l] = { incoming, inZone, locked: G.laneLock[l] > 0 };
    const m = Ane.laneMats[l], zm = Ane.zoneMats[l];
    if (G.laneLock[l] > 0) m.color.setRGB(0.18, 0.18, 0.22);
    else if (inZone) m.color.setRGB(0.1, 0.35 + 0.65 * blink, 0.25);
    else if (incoming) m.color.setRGB(1, 0.25 + 0.2 * blink, 0.1);
    else m.color.setRGB(0.2, 0.42, 0.75);
    zm.color.setRGB(inZone ? 0.2 : 0.06, inZone ? 1 : 0.35, inZone ? 0.4 : 0.18);
    V.laneFlash[l] = Math.max(0, V.laneFlash[l] - dt * 3); if (V.laneFlash[l] > 0) m.color.lerp(_white, V.laneFlash[l]);
    const pd = Ane.paddles[l]; pd.t = Math.max(0, pd.t - dt); pd.g.visible = pd.t > 0;
    if (pd.t > 0) { const k = 1 - pd.t / 0.2; pd.g.rotation.y = lerp(1.3, -1.3, k) * (l === 0 ? -1 : 1); pd.mat.opacity = 0.95 * (pd.t / 0.2); }
  }
  Ane.thMat.color.setRGB(1, 0.1 + 0.1 * blink, 0.2);
  const ph = sirenPhase(), ang = t * 1.6;
  Ane.sirenR.position.set(Math.cos(ang) * 3.5, 4.5, Math.sin(ang) * 3 + 1); Ane.sirenB.position.set(-Math.cos(ang) * 3.5, 4.5, -Math.sin(ang) * 3 + 1);
  Ane.sirenR.intensity = Math.max(0, ph) * 1.6; Ane.sirenB.intensity = Math.max(0, -ph) * 1.6;
  const sh = shakeOffset(0.35, 23), K = Ane.camK;
  Ane.cam.position.set(Ane.camLook.x + (Ane.camBase.x - Ane.camLook.x) * K + sh.x, Ane.camLook.y + (Ane.camBase.y - Ane.camLook.y) * K + sh.y * 0.5, Ane.camLook.z + (Ane.camBase.z - Ane.camLook.z) * K);
  Ane.cam.lookAt(Ane.camLook.x + sh.x * 0.3, Ane.camLook.y, Ane.camLook.z); Ane.cam.rotation.z += sh.r;
  Ane.fx.update(dt); Ane.blood.update(dt);
};
function updateVisuals(dt) {
  updateShake(dt); updateHeart(dt);
  Drv.update(dt, realTime); Srg.update(dt, realTime); Ane.update(dt, realTime);
  for (let i = 0; i < 3; i++) { V.flash[i] = Math.max(0, V.flash[i] - dt * 2.2); V.bezel[i] = Math.max(0, V.bezel[i] - dt * 2.5); }
  V.whiteFlash = Math.max(0, V.whiteFlash - dt * 5);
}
function renderPanes() {
  renderer.setScissorTest(false); renderer.setClearColor(0x020308, 1); renderer.clear();
  renderer.setScissorTest(true);
  const sc = [[Drv.scene, Drv.cam], [Srg.scene, Srg.cam], [Ane.scene, Ane.cam]];
  for (let i = 0; i < 3; i++) {
    const p = L.panes[i], y = L.H - p.y - p.h;
    renderer.setViewport(p.x, y, p.w, p.h); renderer.setScissor(p.x, y, p.w, p.h);
    renderer.render(sc[i][0], sc[i][1]);
  }
  renderer.setScissorTest(false);
}


/* ============================== HUD OVERLAY (2D canvas) ============================== */
const F=(sz,w)=>`${w||'bold'} ${Math.round(sz)}px Consolas,"Courier New",monospace`;
function rr(c,x,y,w,h,r){r=Math.max(0,Math.min(r,w/2,h/2));c.beginPath();c.moveTo(x+r,y);c.arcTo(x+w,y,x+w,y+h,r);c.arcTo(x+w,y+h,x,y+h,r);c.arcTo(x,y+h,x,y,r);c.arcTo(x,y,x+w,y,r);c.closePath();}
function glowText(c,t,x,y,col,size,align,blur){c.font=F(size);c.textAlign=align||'left';c.textBaseline='middle';c.shadowColor=col;c.shadowBlur=blur==null?8:blur;c.fillStyle=col;c.fillText(t,x,y);c.shadowBlur=0;}
function fitText(c,t,maxW,size){c.font=F(size);const w=c.measureText(t).width;return w>maxW?size*maxW/w:size;}
const _pv=new THREE.Vector3();
function project(cam,p,x,y,z){_pv.set(x,y,z).project(cam);if(_pv.z>1||_pv.z<-1)return null;return {x:p.x+(_pv.x*0.5+0.5)*p.w,y:p.y+(-_pv.y*0.5+0.5)*p.h,inside:Math.abs(_pv.x)<=1&&Math.abs(_pv.y)<=1};}
function tag(c,text,x,y,col,size,alpha){
 c.save();c.globalAlpha=alpha==null?1:alpha;c.font=F(size);const w=c.measureText(text).width+size*0.9,h=size*1.5;
 c.fillStyle='rgba(4,6,12,0.72)';rr(c,x-w/2,y-h/2,w,h,h*0.3);c.fill();c.strokeStyle=col;c.lineWidth=1;c.stroke();
 c.fillStyle=col;c.textAlign='center';c.textBaseline='middle';c.fillText(text,x,y+0.5);c.restore();
}
function bar(c,x,y,w,h,frac,col,bg){c.fillStyle=bg||'rgba(255,255,255,0.08)';rr(c,x,y,w,h,h/2);c.fill();if(frac>0){c.fillStyle=col;rr(c,x,y,Math.max(h,w*clamp(frac,0,1)),h,h/2);c.fill();}}
function fmtTime(s){s=Math.max(0,Math.ceil(s));return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');}

function drawHUD(dt){
 const c=hctx;
 c.setTransform(L.dpr,0,0,L.dpr,0,0);c.clearRect(0,0,L.W,L.H);
 if(!scanPattern){const sc=document.createElement('canvas');sc.width=1;sc.height=3;const g=sc.getContext('2d');g.fillStyle='rgba(0,0,0,0.16)';g.fillRect(0,0,1,1);scanPattern=c.createPattern(sc,'repeat');}
 for(let i=0;i<3;i++){const p=L.panes[i];c.fillStyle=scanPattern;c.fillRect(p.x,p.y,p.w,p.h);
  const g=c.createRadialGradient(p.x+p.w/2,p.y+p.h/2,Math.min(p.w,p.h)*0.35,p.x+p.w/2,p.y+p.h/2,Math.max(p.w,p.h)*0.72);
  g.addColorStop(0,'rgba(0,0,0,0)');g.addColorStop(1,'rgba(0,0,0,0.45)');c.fillStyle=g;c.fillRect(p.x,p.y,p.w,p.h);}
 const clip=(i,fn)=>{const p=L.panes[i];c.save();c.beginPath();c.rect(p.x,p.y,p.w,p.h);c.clip();fn(p);c.restore();};
 clip(0,drawDriverHUD);clip(1,drawSurgeonHUD);clip(2,drawAnesthHUD);
 drawFX(c);
 for(let i=0;i<3;i++)drawFrame(c,i);
 drawTopBar(c);
 drawBanners(c,dt);
}
function drawTopBar(c){
 const H=L.top,W=L.W,fs=L.fs;
 const gr=c.createLinearGradient(0,0,0,H);gr.addColorStop(0,'#14060f');gr.addColorStop(1,'#07060c');c.fillStyle=gr;c.fillRect(0,0,W,H);
 c.strokeStyle='rgba(255,42,61,0.65)';c.lineWidth=1;c.beginPath();c.moveTo(0,H-0.5);c.lineTo(W,H-0.5);c.stroke();
 const my=H/2;
 glowText(c,'CODE RED',12,my-fs*0.35,'#ff2a3d',fs*1.35,'left',12);
 c.font=F(fs*0.7);c.fillStyle='#ffffff';c.textAlign='left';c.fillText('TURBO SURGERY',13,my+fs*0.75);
 const lab=(t,x)=>{c.font=F(fs*0.68);c.fillStyle='#8293a8';c.textAlign='left';c.textBaseline='middle';c.fillText(t,x,my-fs*0.6);};
 const val=(t,x,col)=>{c.font=F(fs*1.1);c.fillStyle=col||'#fff';c.textAlign='left';c.textBaseline='middle';c.fillText(t,x,my+fs*0.45);};
 let x=W*0.15;
 lab('DIST TO ER',x);val(Math.max(0,Math.ceil(G.distanceRemaining))+' m',x,G.distanceRemaining<300?'#39ff14':'#fff');
 const tot=TOTAL_DIST+G.detours*DETOUR_DIST;bar(c,x,my+fs*1.1,W*0.08,3,1-G.distanceRemaining/tot,'#ff9a1f');
 x=W*0.27;const tl=TIME_LIMIT-G.time,tc=tl<30?(Math.sin(realTime*10)>0?'#ff2a3d':'#fff'):'#fff';
 lab('TIME LEFT',x);val(fmtTime(tl),x,tc);
 x=W*0.36;lab('BLOOD',x);const bl=G.patientBlood,bc=bl<25?(Math.sin(realTime*12)>0?'#ff2a3d':'#ff8090'):'#ff5a6a';
 val(Math.ceil(bl)+'%',x,bc);bar(c,x+fs*3.6,my+fs*0.05,W*0.08,fs*0.75,bl/100,'#ff2a3d','rgba(255,42,61,0.15)');
 x=W*0.53;lab('PARASITES',x);
 for(let i=0;i<G.parasites.length;i++){const p=G.parasites[i],cx=x+fs*0.55+i*fs*1.35,cy=my+fs*0.45,out=p.state!=='attached';
  c.beginPath();c.arc(cx,cy,fs*0.45,0,TAU);if(out){c.fillStyle=p.info.css;c.shadowColor=p.info.css;c.shadowBlur=8;c.fill();c.shadowBlur=0;}else{c.strokeStyle=p.info.css;c.lineWidth=1.5;c.stroke();}}
 x=W*0.66;lab('HEART',x);const hrc=G.flatlined?'#ff2a3d':(G.inZone?'#39ff6a':'#ffd23a');
 val(G.flatlined?'---':Math.round(G.heartBPM)+' BPM',x,hrc);
 const ex=x+fs*6.4,ew=W*0.1,eh=H*0.7,ey=(H-eh)/2;
 c.fillStyle='rgba(0,30,10,0.6)';c.fillRect(ex,ey,ew,eh);c.strokeStyle=hrc;c.lineWidth=1.5;c.beginPath();
 const N=V.ecg.length,cnt=240;
 for(let k=0;k<cnt;k++){const idx=(V.ecgIdx-cnt+k+N)%N,px=ex+k/(cnt-1)*ew,py=ey+eh*0.62-V.ecg[idx]*eh*0.42;if(k===0)c.moveTo(px,py);else c.lineTo(px,py);}c.stroke();
 c.font=F(fs*0.66);c.fillStyle='#7f90a6';c.textAlign='right';c.textBaseline='middle';
 const mode=Sess.kind==='attract'?'ATTRACT DEMO':Sess.kind==='online'?(`ROOM ${Sess.room?Sess.room.code:''} · `+(Sess.myRole?'YOU: '+ROLE_NAMES[roleIdx(Sess.myRole)]:'SPECTATING')):(Sess.coop?'LOCAL 3P CO-OP':'SOLO: '+ROLE_NAMES[Sess.soloRole]);
 c.fillText(mode,W-12,my-fs*0.55);c.fillText((Sfx.muted?'MUTED · ':'')+(Sess.kind==='online'?'M MUTE · ESC MENU':'M MUTE · ESC PAUSE'),W-12,my+fs*0.6);
}
function drawFrame(c,i){
 const p=L.panes[i],col=PANE_COL[i],pulse=V.bezel[i],fs=L.fs,role=ROLES[i],ai=isAI(role);
 const mine=Sess.kind==='online'&&Sess.myRole===role;
 c.save();c.shadowColor=col;c.shadowBlur=10+pulse*20+(mine?10:0);c.strokeStyle=col;c.globalAlpha=0.7+0.3*pulse;c.lineWidth=2+pulse*2+(mine?1.5:0);
 rr(c,p.x-3,p.y-3,p.w+6,p.h+6,9);c.stroke();c.restore();
 c.strokeStyle='rgba(255,255,255,0.35)';c.lineWidth=2;const b=14;
 for(const [x,y,sx,sy] of[[p.x+4,p.y+4,1,1],[p.x+p.w-4,p.y+4,-1,1],[p.x+4,p.y+p.h-4,1,-1],[p.x+p.w-4,p.y+p.h-4,-1,-1]]){c.beginPath();c.moveTo(x,y+sy*b);c.lineTo(x,y);c.lineTo(x+sx*b,y);c.stroke();}
 const who=Sess.kind==='online'?(ai?'AI':(seatName(role)||'')):'';
 const label=`P${i+1} · ${ROLE_NAMES[i]}`+(who&&!ai?` · ${who.toUpperCase()}`:''),sz=fitText(c,label,p.w*0.66,fs*0.95);c.font=F(sz);
 const badge=mine?'YOU':(ai?'AI':''),tw=c.measureText(label).width,hh=sz*1.75,bw=badge?sz*(badge.length*0.75+1.2):0;
 c.fillStyle='rgba(0,0,0,0.7)';rr(c,p.x+8,p.y+8,tw+16+(badge?bw+sz*0.5:0),hh,5);c.fill();c.strokeStyle=col;c.lineWidth=1;c.stroke();
 c.fillStyle=col;c.textAlign='left';c.textBaseline='middle';c.fillText(label,p.x+16,p.y+8+hh/2);
 if(badge){const bx=p.x+16+tw+sz*0.5;c.fillStyle=mine?'#ffffff':col;rr(c,bx,p.y+8+hh*0.18,bw,hh*0.64,3);c.fill();c.fillStyle='#000';c.font=F(sz*0.8);c.textAlign='center';c.fillText(badge,bx+bw/2,p.y+8+hh/2);}
 const hints=['W/S GAS·BRAKE  A/D STEER  SHIFT BOOST','MOUSE MOVE  LMB CLAMP/PULL  RMB BRACE','Q SEDATE  E ADREN  R/TAB LAMP  1·2·3 / F·G·H SWAT'];
 let ht;
 if(ai)ht='AI CO-PILOT ACTIVE';
 else if(Sess.kind==='online'&&!mine)ht=`${(seatName(role)||'PLAYER').toUpperCase()} IS ON THIS STATION`;
 else ht=hints[i];
 const hs=fitText(c,ht,p.w-24,fs*0.72);
 c.font=F(hs);c.textAlign='center';c.textBaseline='middle';c.fillStyle='rgba(0,0,0,0.55)';const hw=c.measureText(ht).width+14;
 rr(c,p.x+p.w/2-hw/2,p.y+p.h-hs*2.1,hw,hs*1.6,4);c.fill();c.fillStyle=ai?col:(Sess.kind==='online'&&!mine?col:'rgba(220,235,255,0.8)');c.fillText(ht,p.x+p.w/2,p.y+p.h-hs*1.3);
}
function drawDriverHUD(p){
 const c=hctx,a=G.amb,fs=L.fs;
 for(const h of G.hazards){
  if(h.hit||h.z>-14||h.z<-130)continue;const pr=project(Drv.cam,p,h.x,17.5,h.z);if(!pr||!pr.inside)continue;
  const d=HZ[h.key];tag(c,h.eta<4?`${d.short} ${h.eta.toFixed(1)}s`:d.short,pr.x,pr.y,d.css,fs*0.7,0.9);
 }
 if(G.threat){
  const th=G.threat,d=HZ[th.key],blink=Math.sin(realTime*18)>0,cx=p.x+p.w/2,y=p.y+p.h*0.17;
  const s1=fitText(c,d.label,p.w-30,fs*1.6);
  c.fillStyle='rgba(0,0,0,0.55)';rr(c,p.x+10,y-s1*1.1,p.w-20,s1*3.9,10);c.fill();c.strokeStyle=d.css;c.lineWidth=2;c.stroke();
  glowText(c,d.label,cx,y,d.css,s1,'center',14);
  glowText(c,`IMPACT ${th.eta.toFixed(1)}s`,cx,y+s1*1.15,'#fff',s1*0.6,'center',4);
  glowText(c,th.sug,cx,y+s1*2.1,blink?'#ffffff':d.css,fitText(c,th.sug,p.w-30,s1*0.85),'center',10);
 }
 if(a.skid>0)glowText(c,'SKIDDING!',p.x+p.w/2,p.y+p.h*0.42,'#c47bff',fs*1.4,'center',12);
 const kmh=Math.round(a.speed*3.6),by=p.y+p.h-fs*3.4;
 glowText(c,String(kmh),p.x+16,by-fs*1.9,a.boosting?'#6ff':'#fff',fs*2.4,'left',10);
 c.font=F(fs*2.4);const kw=c.measureText(String(kmh)).width;c.font=F(fs*0.8);c.fillStyle='#9fb0c4';c.textAlign='left';c.fillText('KM/H',p.x+20+kw,by-fs*1.5);
 const bw=Math.min(p.w*0.5,190);
 c.font=F(fs*0.7);c.fillStyle=a.boosting?'#6ff':'#9fb0c4';c.fillText(a.boosting?'BOOSTING!':'BOOST [SHIFT]',p.x+16,by-fs*0.15);
 bar(c,p.x+16,by+fs*0.35,bw,fs*0.6,a.boostFuel,a.boosting?'#5ff':'#ff9a1f');
 const vx=p.x+p.w-16,vy0=p.y+fs*3.4,vy1=p.y+p.h-fs*4;
 c.strokeStyle='rgba(255,255,255,0.25)';c.lineWidth=3;c.beginPath();c.moveTo(vx,vy0);c.lineTo(vx,vy1);c.stroke();
 const tot=TOTAL_DIST+G.detours*DETOUR_DIST,prog=clamp(1-G.distanceRemaining/tot,0,1),my=lerp(vy1,vy0,prog);
 c.strokeStyle='#ff9a1f';c.beginPath();c.moveTo(vx,vy1);c.lineTo(vx,my);c.stroke();
 glowText(c,'✚',vx,vy0-fs*0.8,'#ff2a3d',fs*1.1,'center',8);
 c.fillStyle='#fff';c.beginPath();c.arc(vx,my,fs*0.4,0,TAU);c.fill();
 if(G.detours>0)glowText(c,`DETOUR ×${G.detours}`,vx-8,vy1+fs*0.9,'#ff4a5c',fs*0.7,'right',4);
}
function drawSurgeonHUD(p){
 const c=hctx,s=G.srg,fs=L.fs,lb=Srg.lampBlend;
 const tp=project(Srg.cam,p,s.tipX,0.6,s.tipZ);
 if(lb<0.98&&tp){const g=c.createRadialGradient(tp.x,tp.y,p.w*0.08,tp.x,tp.y,p.w*0.55);g.addColorStop(0,'rgba(0,0,8,0)');g.addColorStop(1,`rgba(0,0,8,${0.6*(1-lb)})`);c.fillStyle=g;c.fillRect(p.x,p.y,p.w,p.h);}
 for(const q of G.parasites){
  if(q.state!=='attached')continue;const pr=project(Srg.cam,p,q.slot.x,q.slot.y+0.15,q.slot.z);if(!pr)continue;
  const R=Math.max(14,p.w*0.045);
  if(q.progress>0.01){c.strokeStyle='rgba(0,0,0,0.5)';c.lineWidth=5;c.beginPath();c.arc(pr.x,pr.y,R,0,TAU);c.stroke();c.strokeStyle=q.info.css;c.lineWidth=3;c.beginPath();c.arc(pr.x,pr.y,R,-Math.PI/2,-Math.PI/2+TAU*q.progress);c.stroke();}
  let txt,col;
  if(q.type===PHOTO){if(G.lampFocusedOnChest){txt='☀ LIGHT! BURROWING';col='#ff5a6a';}else{txt='☾ DARK: SAFE TO PULL';col='#a48bff';}}
  else if(q.type===PULSE){txt=G.inZone?'♥ BPM IN ZONE':'♥ BPM OFF-ZONE';col=G.inZone?'#39ff14':'#ffb020';}
  else{txt=s.brace?'■ BRACED':'■ BRACE ON BUMPS';col=s.brace?'#18e6ff':'#ff9a1f';}
  const focus=s.hoverP===q||s.grab===q;
  tag(c,focus?`${q.info.name}: ${txt}`:txt,pr.x,pr.y-R-fs*0.9,col,fs*(focus?0.78:0.62),focus?1:0.7);
 }
 if(s.grab){
  const q=s.grab,info=q.info,w=Math.min(p.w*0.72,340),x=p.x+(p.w-w)/2,y=p.y+p.h-fs*6.2,h=fs*0.95,mx=info.tear*1.12,X=v=>x+clamp(v/mx,0,1)*w;
  c.fillStyle='rgba(0,0,0,0.6)';rr(c,x-10,y-fs*2.3,w+20,fs*5.2,8);c.fill();
  c.font=F(fs*0.72);c.fillStyle='#cfe3ff';c.textAlign='left';c.textBaseline='middle';c.fillText('TENSION',x,y-fs*1.2);
  c.textAlign='right';c.fillStyle=info.css;c.fillText(info.name,x+w,y-fs*1.2);
  c.fillStyle='rgba(255,255,255,0.08)';c.fillRect(x,y,w,h);
  c.fillStyle='rgba(57,255,20,0.55)';c.fillRect(X(info.band[0]),y,X(info.band[1])-X(info.band[0]),h);
  c.fillStyle='rgba(255,42,61,0.55)';c.fillRect(X(info.tear),y,x+w-X(info.tear),h);
  const nx=X(s.tension);c.fillStyle=s.inBand?'#39ff14':'#fff';c.fillRect(nx-2,y-4,4,h+8);
  bar(c,x,y+h+fs*0.6,w,fs*0.55,q.progress,info.css);
  c.font=F(fs*0.66);c.fillStyle='#fff';c.textAlign='center';c.fillText(`EXTRACTING ${Math.round(q.progress*100)}%`,x+w/2,y+h+fs*1.75);
  if(s.blockReason&&Math.sin(realTime*12)>-0.3)glowText(c,s.blockReason,p.x+p.w/2,y-fs*3.2,s.blockReason==='PULL HARDER'?'#ffd34d':'#ff4a5c',fs*0.95,'center',8);
 }
 const sy=p.y+fs*3.4;
 tag(c,G.lampFocusedOnChest?'LAMP ☀ ON CHEST':'LAMP ☾ AWAY',p.x+p.w-fs*5.6,sy,G.lampFocusedOnChest?'#fff3a0':'#a48bff',fs*0.7);
 if(s.brace)tag(c,'■ BRACED (RMB)',p.x+p.w-fs*5.6,sy+fs*1.5,'#18e6ff',fs*0.7);
 if(G.threat&&!isAI('driver')&&Math.sin(realTime*16)>0){c.fillStyle='#ffb020';c.shadowColor='#ffb020';c.shadowBlur=14;c.beginPath();c.arc(p.x+fs*1.6,sy+fs*1.5,fs*0.45,0,TAU);c.fill();c.shadowBlur=0;c.font=F(fs*0.66);c.textAlign='left';c.fillText('ROAD ALERT',p.x+fs*2.4,sy+fs*1.5);}
 const jp=project(Srg.cam,p,Srg.jar.position.x,Srg.jar.position.y+1.55,Srg.jar.position.z);
 if(jp)tag(c,`SPECIMENS ${G.extracted}/${G.parasites.length}`,jp.x,jp.y,'#3dff7a',fs*0.62,0.9);
}
function drawAnesthHUD(p){
 const c=hctx,fs=L.fs,w=p.w-32,x=p.x+16,y=p.y+fs*3.6,h=fs*0.95,X=b=>x+(clamp(b,40,180)-40)/140*w;
 c.fillStyle='rgba(0,0,0,0.55)';rr(c,x-8,y-fs*1.5,w+16,fs*3.3,8);c.fill();
 c.font=F(fs*0.7);c.fillStyle='#cfe3ff';c.textAlign='left';c.textBaseline='middle';c.fillText('HEART RATE',x,y-fs*0.75);
 const z0=G.targetBPMZone[0],z1=G.targetBPMZone[1],hrc=G.flatlined?'#ff2a3d':(G.inZone?'#39ff6a':'#ffd23a');
 c.textAlign='right';c.fillStyle=hrc;c.font=F(fs*0.9);c.fillText(G.flatlined?'FLATLINE':`${Math.round(G.heartBPM)} BPM`,x+w,y-fs*0.75);
 c.fillStyle='rgba(255,255,255,0.08)';c.fillRect(x,y,w,h);
 c.fillStyle='rgba(255,42,61,0.45)';c.fillRect(X(40),y,X(50)-X(40),h);c.fillRect(X(160),y,X(180)-X(160),h);
 c.fillStyle='rgba(57,255,106,0.6)';c.fillRect(X(z0),y,X(z1)-X(z0),h);
 if(!G.flatlined){const nx=X(G.heartBPM);c.fillStyle='#fff';c.fillRect(nx-2,y-5,4,h+10);}
 c.font=F(fs*0.6);c.fillStyle='#8ea2ba';c.textAlign='left';c.fillText('Q ▼ SEDATE',x,y+h+fs*0.6);c.textAlign='right';c.fillText('ADRENALINE ▲ E',x+w,y+h+fs*0.6);
 for(let l=0;l<3;l++){
  const pr=project(Ane.cam,p,Ane.LANE_X[l],0.62,Ane.TH_Z+0.38);if(!pr)continue;
  const st=Ane.laneState[l]||{},label=`${l+1}/${'FGH'[l]}`;
  let col='rgba(220,235,255,0.75)',txt=label;
  if(st.locked){col='#667';txt=label+' ✕';}else if(st.inZone){col='#39ff14';txt='SWAT '+label;}else if(st.incoming){col='#ffb020';txt='! '+label;}
  const sz=st.inZone?fs*(0.85+0.1*Math.sin(realTime*20)):fs*0.72;tag(c,txt,pr.x,pr.y,col,sz);
 }
 Ane.inj.forEach((inj,i)=>{const pr=project(Ane.cam,p,inj.g.position.x,2.55,inj.g.position.z);if(pr)tag(c,i===0?'Q SEDATIVE ▼':'E ADRENALINE ▲',pr.x,pr.y,i===0?'#5ab4ff':'#ff6a6a',fs*0.62);});
 {const lt=`R/TAB LAMP: ${G.lampFocusedOnChest?'☀ ON CHEST':'☾ AWAY'}`;c.font=F(fs*0.66);const lw=c.measureText(lt).width;tag(c,lt,p.x+p.w-lw/2-fs*1.2,y+fs*3.0,G.lampFocusedOnChest?'#fff3a0':'#a48bff',fs*0.66);}
 const pp=project(Ane.cam,p,0,1.2,4.6);if(pp)tag(c,'▼ PATIENT ▼',pp.x,clamp(pp.y,p.y+p.h*0.82,p.y+p.h-fs*3.4),'#ff8090',fs*0.6,0.8);
}
function drawBanners(c,dt){
 const fs=L.fs,per=[[],[],[]];
 for(let i=V.banners.length-1;i>=0;i--){const b=V.banners[i];b.age+=dt;if(b.age>b.life)V.banners.splice(i,1);}
 for(const b of V.banners)per[b.pane].push(b);
 for(let i=0;i<3;i++){
  const p=L.panes[i];let y=p.y+p.h*(i===0?0.4:0.28);
  const list=per[i].slice(-4).reverse();
  for(const b of list){
   const size=fs*(b.big?1.35:1.0),k=b.age<0.18?easeOutBack(b.age/0.18):1,alpha=b.age>b.life-0.35?(b.life-b.age)/0.35:1;
   const sz=fitText(c,b.text,p.w-40,size);c.font=F(sz);const tw=c.measureText(b.text).width,bw=tw+sz*1.4,bh=sz*1.9;
   c.save();c.globalAlpha=clamp(alpha,0,1);c.translate(p.x+p.w/2,y+bh/2);c.scale(Math.max(0.01,k),Math.max(0.01,k));
   c.fillStyle='rgba(5,5,12,0.8)';rr(c,-bw/2,-bh/2,bw,bh,bh*0.3);c.fill();
   c.shadowColor=b.color;c.shadowBlur=14;c.strokeStyle=b.color;c.lineWidth=2;c.stroke();c.shadowBlur=0;
   c.fillStyle=b.color;c.textAlign='center';c.textBaseline='middle';c.fillText(b.text,0,1);
   c.restore();y+=bh+6;
  }
 }
}
function drawFX(c){
 for(let i=0;i<3;i++)if(V.flash[i]>0){const p=L.panes[i];c.fillStyle=`rgba(255,20,40,${0.32*V.flash[i]})`;c.fillRect(p.x,p.y,p.w,p.h);}
 if(V.whiteFlash>0){const p=L.panes[0];c.fillStyle=`rgba(255,255,255,${0.55*V.whiteFlash})`;c.fillRect(p.x,p.y,p.w,p.h);}
 const b=G.patientBlood;
 if(b<40){
  const I=(40-b)/40*(0.55+0.45*V.beatPulse);
  const g=c.createRadialGradient(L.W/2,L.H/2,Math.min(L.W,L.H)*0.3,L.W/2,L.H/2,Math.max(L.W,L.H)*0.75);
  g.addColorStop(0,'rgba(255,0,20,0)');g.addColorStop(1,`rgba(255,0,20,${0.55*I})`);c.fillStyle=g;c.fillRect(0,0,L.W,L.H);
  c.save();c.globalCompositeOperation='lighter';const off=3+6*I;c.lineWidth=6;
  for(const p of L.panes){c.strokeStyle=`rgba(255,0,60,${0.4*I})`;c.strokeRect(p.x+off,p.y,p.w,p.h);c.strokeStyle=`rgba(0,220,255,${0.3*I})`;c.strokeRect(p.x-off,p.y,p.w,p.h);}
  c.restore();
 }
}

/* ============================== INPUT GATHERING ============================== */
function humanDriverInput() {
  const k = Input.keys;
  return { steer: ((k.has('KeyD') || k.has('ArrowRight')) ? 1 : 0) - ((k.has('KeyA') || k.has('ArrowLeft')) ? 1 : 0),
    throttle: k.has('KeyW') || k.has('ArrowUp'), brake: k.has('KeyS') || k.has('ArrowDown'), boost: k.has('ShiftLeft') || k.has('ShiftRight') };
}
const _ray = new THREE.Raycaster(), _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.6), _hit = new THREE.Vector3(), _ndc = new THREE.Vector2();
function humanSurgeonInput() {
  const p = L.panes[1];
  _ndc.x = clamp((Input.mx - p.x) / p.w * 2 - 1, -1, 1); _ndc.y = clamp(-((Input.my - p.y) / p.h * 2 - 1), -1, 1);
  _ray.setFromCamera(_ndc, Srg.rayCam);
  if (_ray.ray.intersectPlane(_plane, _hit)) { V.localSurg.tx = clamp(_hit.x, -4.3, 4.3); V.localSurg.tz = clamp(_hit.z, -5.4, 5.4); }
  return { tx: V.localSurg.tx, tz: V.localSurg.tz, clamp: Input.lmb, brace: Input.rmb };
}
function localInputs() {
  return { driver: humanRole('driver') ? humanDriverInput() : null, surgeon: humanRole('surgeon') ? humanSurgeonInput() : null };
}

/* ============================== NETWORK (Socket.IO rooms) ============================== */
const Net = {
  sock: null, sendT: 0, lastSent: '', keepT: 0,
  available() { return typeof window.io === 'function'; },
  connect() {
    if (this.sock) return this.sock;
    if (!this.available()) return null;
    const sock = this.sock = window.io({ transports: ['websocket', 'polling'] });
    sock.on('room:update', (r) => onRoomUpdate(r));
    sock.on('match:start', (d) => enterOnline(d.snap));
    sock.on('snap', (d) => {
      if (Sess.kind !== 'online') return;
      sim.apply(d.s); G = sim.G; viewSync(); handleEvents(d.e || []);
    });
    sock.on('disconnect', () => {
      if (Sess.room) { const wasIn = Sess.kind === 'online'; Sess.room = null; Sess.myRole = null; showMenu(); setOnlineMsg(wasIn ? 'Connection lost. The run was interrupted. Create or join a room to play again.' : 'Disconnected from the server.'); }
    });
    sock.on('connect_error', () => setOnlineMsg('Can\'t reach the game server. If it was asleep it may take up to a minute to wake up. Try again shortly.'));
    return sock;
  },
  emit(ev, data) { return new Promise((res) => { const s = this.connect(); if (!s) return res({ ok: false, error: 'Online play needs the game server. Open the site from its web address, not as a file.' }); s.timeout(15000).emit(ev, data, (err, r) => res(err ? { ok: false, error: 'The server took too long to answer. It may be waking up, so try again in a moment.' } : r)); }); },
  act(a) { if (this.sock) this.sock.emit('act', a); },
  leave() { if (this.sock) this.sock.emit('room:leave'); Sess.room = null; Sess.myRole = null; },
  sendInputs(dt) {
    if (!this.sock || Sess.kind !== 'online' || !G || G.mode !== 'playing') return;
    this.sendT -= dt; this.keepT -= dt;
    if (this.sendT > 0) return;
    this.sendT = 1 / 30;
    let payload = null;
    if (Sess.myRole === 'driver') payload = { d: humanDriverInput() };
    else if (Sess.myRole === 'surgeon') { const s = humanSurgeonInput(); payload = { s: { tx: Math.round(s.tx * 1000) / 1000, tz: Math.round(s.tz * 1000) / 1000, clamp: s.clamp, brace: s.brace } }; }
    if (!payload) return;
    const key = JSON.stringify(payload);
    if (key === this.lastSent && this.keepT > 0) return;
    this.lastSent = key; this.keepT = 0.25;
    this.sock.volatile.emit('in', payload);
  },
};

/* ============================== MENUS & FLOW ============================== */
const UI = { menu: $('menu'), end: $('end'), pause: $('pause'), lobby: $('lobby') };
const hideAll = () => { for (const k in UI) UI[k].classList.add('hidden'); };
function setOnlineMsg(t) { $('onlineMsg').textContent = t || ''; }
function setLobbyMsg(t) { $('lbMsg').textContent = t || ''; }
function refreshMenu() {
  const m = Sess.menuMode;
  $('btnOnline').classList.toggle('sel', m === 'online'); $('btnCoop').classList.toggle('sel', m === 'coop'); $('btnSolo').classList.toggle('sel', m === 'solo');
  $('onlineBox').classList.toggle('hidden', m !== 'online');
  $('rolePick').classList.toggle('hidden', m !== 'solo');
  $('btnStart').classList.toggle('hidden', m === 'online');
  document.querySelectorAll('#rolePick button').forEach((b) => b.classList.toggle('sel', +b.dataset.role === Sess.soloRole));
}
function storedName() { try { return localStorage.getItem('codered.name') || ''; } catch (e) { return ''; } }
function saveName(n) { try { localStorage.setItem('codered.name', n); } catch (e) { /* storage unavailable */ } }
$('nameIn').value = storedName();
$('btnOnline').addEventListener('click', () => { Sfx.init(); Sess.menuMode = 'online'; refreshMenu(); });
$('btnCoop').addEventListener('click', () => { Sfx.init(); Sess.menuMode = 'coop'; refreshMenu(); });
$('btnSolo').addEventListener('click', () => { Sfx.init(); Sess.menuMode = 'solo'; refreshMenu(); });
document.querySelectorAll('#rolePick button').forEach((b) => b.addEventListener('click', () => { Sess.soloRole = +b.dataset.role; refreshMenu(); }));
$('btnStart').addEventListener('click', () => startLocal());
const myName = () => { const n = $('nameIn').value.trim().slice(0, 14) || 'Medic'; saveName(n); return n; };
$('btnCreate').addEventListener('click', async () => {
  Sfx.init(); setOnlineMsg('Opening a room…'); $('btnCreate').disabled = true;
  const r = await Net.emit('room:create', { name: myName() });
  $('btnCreate').disabled = false;
  if (!r || !r.ok) return setOnlineMsg((r && r.error) || 'Could not create a room.');
  Sess.myId = r.you; setOnlineMsg(''); showLobby();
});
$('btnJoin').addEventListener('click', async () => {
  Sfx.init();
  const code = $('codeIn').value.trim().toUpperCase();
  if (code.length !== 4) return setOnlineMsg('Enter the 4-character room code.');
  setOnlineMsg('Joining…'); $('btnJoin').disabled = true;
  const r = await Net.emit('room:join', { code, name: myName() });
  $('btnJoin').disabled = false;
  if (!r || !r.ok) return setOnlineMsg((r && r.error) || 'Could not join that room.');
  Sess.myId = r.you; setOnlineMsg('');
  if (r.inProgress && r.snap) enterOnline(r.snap); else showLobby();
});
document.querySelectorAll('.seat').forEach((el) => el.addEventListener('click', async () => {
  const role = el.dataset.role;
  const r = await Net.emit('room:seat', Sess.myRole === role ? null : role);
  if (r && !r.ok) setLobbyMsg(r.error); else setLobbyMsg('');
}));
$('btnStand').addEventListener('click', async () => { const r = await Net.emit('room:seat', null); if (r && !r.ok) setLobbyMsg(r.error); });
$('btnRun').addEventListener('click', async () => { Sfx.init(); const r = await Net.emit('room:start', null); if (r && !r.ok) setLobbyMsg(r.error); });
$('btnLeave').addEventListener('click', () => { Net.leave(); showMenu(); });
$('btnCopy').addEventListener('click', async () => {
  const link = $('lbLink').textContent;
  try { await navigator.clipboard.writeText(link); setLobbyMsg('Invite link copied. Send it to your two teammates.'); }
  catch (e) { const sel = window.getSelection(), rg = document.createRange(); rg.selectNodeContents($('lbLink')); sel.removeAllRanges(); sel.addRange(rg); setLobbyMsg('Press Ctrl+C to copy the highlighted link.'); }
});
$('btnReplay').addEventListener('click', async () => {
  if (Sess.room) { const r = await Net.emit('room:start', null); if (r && !r.ok) $('endFoot').textContent = r.error; }
  else startLocal();
});
$('btnToLobby').addEventListener('click', () => { if (Net.sock) Net.sock.emit('room:lobby'); });
$('btnMenu').addEventListener('click', () => { if (Sess.room) Net.leave(); showMenu(); });
$('btnResume').addEventListener('click', () => { if (Sess.kind === 'online') toggleOnlineMenu(false); else setPaused(false); });
$('btnQuit').addEventListener('click', () => { if (Sess.room) Net.leave(); showMenu(); });

function onRoomUpdate(r) {
  const prev = Sess.room;
  Sess.room = r;
  const me = r.members.find((m) => m.id === Sess.myId);
  Sess.myRole = me ? me.role : null;
  if (prev && r.members.length > prev.members.length) Sfx.join();
  renderLobby();
  if (r.state === 'lobby' && Sess.kind === 'online') { showLobby(); }
  if (r.state === 'ended' && Sess.kind === 'online' && !UI.end.classList.contains('hidden')) refreshEndButtons();
}
function renderLobby() {
  const r = Sess.room; if (!r) return;
  $('lbCode').textContent = r.code;
  $('lbLink').textContent = `${location.origin}${location.pathname}?room=${r.code}`;
  for (const role of ROLES) {
    const s = r.seats[role], el = $('seat-' + role), card = el.parentElement;
    if (s) { el.className = 'who'; el.innerHTML = ''; el.textContent = s.name; if (s.id === Sess.myId) el.insertAdjacentHTML('beforeend', '<span class="youtag">YOU</span>'); if (s.id === r.hostId) el.insertAdjacentHTML('beforeend', '<span class="hosttag">HOST</span>'); }
    else { el.className = 'who ai'; el.textContent = 'OPEN · AI flies this seat'; }
    card.classList.toggle('mine', !!(s && s.id === Sess.myId));
  }
  const spect = r.members.filter((m) => !m.role).map((m) => m.name + (m.id === Sess.myId ? ' (you)' : ''));
  $('lbSpect').textContent = spect.length ? 'Not seated: ' + spect.join(', ') : '';
  const host = r.members.find((m) => m.id === r.hostId), iAmHost = r.hostId === Sess.myId, humans = ROLES.filter((x) => r.seats[x]).length;
  $('btnRun').classList.toggle('hidden', !iAmHost);
  $('btnStand').classList.toggle('hidden', !Sess.myRole);
  if (r.state === 'playing') setLobbyMsg('A run is in progress. Seats open up when it ends.');
  else if (!iAmHost) setLobbyMsg(`Waiting for ${host ? host.name : 'the host'} to start the run…`);
  else setLobbyMsg(humans < 3 ? `${3 - humans} seat${3 - humans > 1 ? 's are' : ' is'} open. Share the link, or start now and the AI fills in.` : 'All three stations are staffed. Start the run!');
}
function showLobby() {
  hideAll(); UI.lobby.classList.remove('hidden'); renderLobby();
  if (Sess.kind !== 'attract') startAttract();
}
function enterOnline(snap) {
  Sess.kind = 'online'; Sess.paused = false;
  hideAll(); dropInputs(); layout();
  sim.apply(snap); G = sim.G; viewSync();
  Sfx.init(); Sfx.setLoops(true);
  const r = Sess.myRole;
  banner(-1, 'GO! GO! GO! PATIENT IS CRASHING!', '#ff2a3d', { big: true, life: 2.4 });
  if (r) banner(roleIdx(r), `YOU ARE THE ${ROLE_NAMES[roleIdx(r)]}`, PANE_COL[roleIdx(r)], { big: true, life: 3 });
  else banner(1, 'SPECTATING: SEATS OPEN AFTER THIS RUN', '#9fb3c8', { life: 3 });
  glCanvas.focus({ preventScroll: true });
}
function toggleOnlineMenu(force) {
  const show = force === undefined ? UI.pause.classList.contains('hidden') : force;
  $('pauseTitle').textContent = 'MENU'; $('pauseText').textContent = 'The run keeps going for everyone while this is open.';
  $('btnResume').textContent = 'BACK TO THE RUN ▶'; $('btnQuit').textContent = 'LEAVE ROOM';
  UI.pause.classList.toggle('hidden', !show); dropInputs();
}
function startLocal() {
  Sfx.init(); Sfx.resume();
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  const coop = Sess.menuMode !== 'solo'; Sess.coop = coop;
  const ctrl = {}; ROLES.forEach((r, i) => { ctrl[r] = coop || i === Sess.soloRole ? 'human' : 'ai'; });
  Sess.kind = 'local'; Sess.paused = false; layout();
  sim.reset({ ctrl }); G = sim.G; sim.drain(); viewSync();
  hideAll(); Sfx.setLoops(true); dropInputs(); accReset();
  banner(-1, 'GO! GO! GO! PATIENT IS CRASHING!', '#ff2a3d', { big: true, life: 2.4 });
  glCanvas.focus({ preventScroll: true });
}
function startAttract() { Sess.kind = 'attract'; Sess.paused = false; layout(); sim.reset({ attract: true }); G = sim.G; sim.drain(); viewSync(); Sfx.setLoops(false); Sfx.flatStop(); }
function showMenu() {
  Sfx.flatStop(); Sfx.setLoops(false); Sfx.resume();
  hideAll(); UI.menu.classList.remove('hidden'); refreshMenu(); startAttract();
}
function setPaused(v) {
  if (Sess.kind !== 'local' || !G || G.mode !== 'playing') return;
  Sess.paused = v;
  $('pauseTitle').textContent = 'PAUSED'; $('pauseText').textContent = 'The patient is (briefly) stable.';
  $('btnResume').textContent = 'RESUME ▶'; $('btnQuit').textContent = 'QUIT TO MENU';
  UI.pause.classList.toggle('hidden', !v); dropInputs();
  if (v) Sfx.suspend(); else { Sfx.resume(); accReset(); }
}
function fmtT(s) { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function refreshEndButtons() {
  const online = !!Sess.room, host = online && Sess.room.hostId === Sess.myId;
  $('btnReplay').classList.toggle('hidden', online && !host);
  $('btnToLobby').classList.toggle('hidden', !host);
  $('btnMenu').textContent = online ? 'LEAVE ROOM' : 'MAIN MENU';
  $('endFoot').innerHTML = online ? (host ? 'You are the host: <kbd>Enter</kbd> runs it back with the same seats.' : 'Waiting for the host to run it back…') : '<kbd>Enter</kbd> / <kbd>Space</kbd> replay · <kbd>Esc</kbd> menu';
}
function onOver(sum) {
  if (Sess.kind === 'attract') { startAttract(); return; }
  Sess.last = sum;
  const st = sum.stats, won = sum.won;
  $('endTitle').textContent = won ? 'PATIENT SAVED!' : sum.reason === 'TIME EXPIRED' ? 'TIME EXPIRED' : 'PATIENT LOST';
  $('endTitle').style.color = won ? '#39ff14' : '#ff2a3d';
  $('endTitle').style.textShadow = `0 0 24px ${won ? '#39ff14' : '#ff2a3d'}`;
  $('endReason').textContent = won ? `Hospital reached with all ${sum.total} parasites in the jar.` :
    sum.reason === 'TIME EXPIRED' ? `The clock ran out ${sum.distanceRemaining} m from the ER with ${sum.total - sum.extracted} parasite(s) still inside.` :
      `Flatline at ${fmtT(sum.time)}. ${sum.extracted}/${sum.total} parasites extracted.`;
  let grade = '';
  if (won) { const sc = sum.blood + Math.max(0, TIME_LIMIT - sum.time) * 0.25 - st.stabs * 3; grade = sc >= 95 ? 'S' : sc >= 75 ? 'A' : sc >= 55 ? 'B' : 'C'; }
  $('endGrade').innerHTML = won ? `TEAM GRADE: <b style="font-size:22px;color:#ffd34d">${grade}</b>` : '';
  const crew = Sess.room ? ROLES.map((r, i) => `${ROLE_NAMES[i]}: ${seatName(r) || 'AI'}`).join(' · ') : '';
  const cells = [['TIME', fmtT(sum.time)], ['BLOOD LEFT', Math.ceil(sum.blood) + '%'], ['PARASITES', `${sum.extracted}/${sum.total}`], ['TOP SPEED', Math.round(st.maxSpeed * 3.6) + ' km/h'],
    ['CRASHES', st.crashes], ['BUMPS / SKIDS', `${st.bumps} / ${st.skids}`], ['TOOLS SWATTED', st.swats], ['STABS', st.stabs],
    ['SLIPS', st.slips], ['TEARS', st.tears], ['NERVE / RIB HITS', `${st.nerves} / ${st.ribs}`], ['DOSES GIVEN', st.doses]];
  $('endStats').innerHTML = cells.map(([k, v]) => `<div class="stat"><div class="v">${v}</div><div class="k">${k}</div></div>`).join('') + (crew ? `<div class="stat" style="grid-column:1/-1"><div class="k">${crew}</div></div>` : '');
  refreshEndButtons();
  UI.pause.classList.add('hidden'); UI.end.classList.remove('hidden');
}

/* ============================== MAIN LOOP ============================== */
let last = performance.now(), acc = 0, audioT = 0;
function accReset() { acc = 0; last = performance.now(); }
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000; last = now; if (!(dt > 0)) dt = 0; if (dt > 0.1) dt = 0.1;
  const paused = Sess.kind === 'local' && Sess.paused;
  let frozen = false;
  if (!paused) {
    realTime += dt;
    if (V.hitStop > 0) { V.hitStop -= dt; frozen = true; }
    if (Sess.kind === 'online') {
      Net.sendInputs(dt);
      if (!frozen) sim.extrapolate(dt);
    } else if (!frozen) {
      acc += dt; let n = 0;
      while (acc >= STEP && n < 8) { sim.step(STEP, localInputs()); acc -= STEP; n++; }
      if (n >= 8) acc = 0;
      G = sim.G; viewSync(); handleEvents(sim.drain());
    }
    if (!frozen && G) { viewSync(); updateVisuals(dt); }
  }
  if (G) { renderPanes(); drawHUD(paused || frozen ? 0 : dt); }
  audioT -= dt;
  if (audioT <= 0) { audioT = 0.06; Sfx.update(!!G && G.mode === 'playing' && !paused && (Sess.kind === 'local' || Sess.kind === 'online'), G ? G.amb.speed : 0, G ? G.amb.boosting : false); }
}

// boot
layout(); startAttract();
const qRoom = new URLSearchParams(location.search).get('room');
if (qRoom) { Sess.menuMode = 'online'; $('codeIn').value = qRoom.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4); setOnlineMsg('You were invited! Type your name and press JOIN ROOM.'); }
refreshMenu();
if (!Net.available()) setOnlineMsg('Online play needs the game server. Local co-op and solo work right here.');
window.CODE_RED = { get state() { return G; }, get session() { return Sess; } };
requestAnimationFrame((t) => { last = t; frame(t); });
