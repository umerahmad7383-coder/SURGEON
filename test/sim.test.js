import { createSim, STEP } from '../public/js/sim.js';
const results = [];
for (let g = 0; g < 6; g++) {
  const sim = createSim(); sim.reset({ ctrl: { driver: 'ai', surgeon: 'ai', anesth: 'ai' } });
  let over = null, n = 0, evCount = 0;
  while (!over && n < 60 * 400) { sim.step(STEP, {}); for (const e of sim.drain()) { evCount++; if (e[0] === 'over') over = e[1]; } n++; }
  if (!over) throw new Error('game did not end');
  results.push(over);
  console.log(`game ${g}: won=${over.won} ${over.reason} t=${over.time.toFixed(1)} blood=${over.blood.toFixed(1)} ex=${over.extracted}/${over.total} swats=${over.stats.swats} stabs=${over.stats.stabs} events=${evCount}`);
}
// snapshot round trip
const a = createSim(), b = createSim(); a.reset({ ctrl: { driver: 'human', surgeon: 'human', anesth: 'human' } });
for (let i = 0; i < 60 * 20; i++) { a.step(STEP, { driver: { steer: Math.sin(i / 50), throttle: true }, surgeon: { tx: 0, tz: 0, clamp: false } }); if (i % 90 === 0) a.act('swat1'); }
const snap = a.snapshot(); const json = JSON.stringify(snap); b.apply(JSON.parse(json));
const ok = b.G.hazards.length === a.G.hazards.length && b.G.tools.length === a.G.tools.length && Math.abs(b.G.amb.x - a.G.amb.x) < 0.01 && b.G.parasites.every((p, i) => p.type === a.G.parasites[i].type);
console.log('snapshot bytes', json.length, 'roundtrip ok', ok, 'hazards', a.G.hazards.length, 'tools', a.G.tools.length);
b.extrapolate(0.016);
if (!ok || results.some((r) => r.extracted > r.total)) process.exit(1);
